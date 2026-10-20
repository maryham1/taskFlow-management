import cron from "node-cron";
import { DateTime, IANAZone } from "luxon";

import { prisma } from "../config/db.js";
import { sendPushToUser } from "../services/pushNotificationService.js";

const REMINDER_TIME = "08:00";
const DEFAULT_TIMEZONE = "UTC";
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 15 * 60 * 1000;
const PROCESSING_TIMEOUT_MS = 5 * 60 * 1000;
const BATCH_SIZE = 100;

let dailyJobRunning = false;
let dailyCronTask = null;

const getLocalDateTime = (timezone) => {
  if (!IANAZone.isValidZone(timezone)) {
    throw new Error(`Invalid timezone: ${timezone}`);
  }

  return DateTime.now().setZone(timezone);
};

const getPushTokens = (user) => {
  if (!Array.isArray(user.pushTokens)) return [];

  return [
    ...new Set(
      user.pushTokens
        .map((item) => item?.token)
        .filter((token) => typeof token === "string" && token.trim().length > 0)
        .map((token) => token.trim()),
    ),
  ];
};

const recoverStaleDeliveries = async () => {
  const staleBefore = new Date(Date.now() - PROCESSING_TIMEOUT_MS);

  await prisma.dailyReminderDelivery.updateMany({
    where: {
      status: "PROCESSING",
      attempts: { lt: MAX_ATTEMPTS },
      OR: [{ lastAttemptAt: { lte: staleBefore } }, { lastAttemptAt: null }],
    },
    data: {
      status: "PENDING",
      failureReason: "Previous attempt timed out. Eligible for retry.",
    },
  });

  await prisma.dailyReminderDelivery.updateMany({
    where: {
      status: "PROCESSING",
      attempts: { gte: MAX_ATTEMPTS },
      OR: [{ lastAttemptAt: { lte: staleBefore } }, { lastAttemptAt: null }],
    },
    data: {
      status: "FAILED",
      failedAt: new Date(),
      failureReason: "Processing timed out after maximum attempts.",
    },
  });
};

const claimDelivery = async (userId, localDate) => {
  const delivery = await prisma.dailyReminderDelivery.upsert({
    where: {
      userId_localDate: {
        userId,
        localDate,
      },
    },
    update: {},
    create: {
      userId,
      localDate,
      status: "PENDING",
    },
  });

  const retryBefore = new Date(Date.now() - RETRY_DELAY_MS);

  const claimed = await prisma.dailyReminderDelivery.updateMany({
    where: {
      id: delivery.id,
      status: "PENDING",
      attempts: { lt: MAX_ATTEMPTS },
      OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lte: retryBefore } }],
    },
    data: {
      status: "PROCESSING",
      attempts: { increment: 1 },
      lastAttemptAt: new Date(),
      failedAt: null,
      failureReason: null,
    },
  });

  if (claimed.count !== 1) return null;

  return prisma.dailyReminderDelivery.findUnique({
    where: { id: delivery.id },
  });
};

const markSent = async (deliveryId) => {
  await prisma.dailyReminderDelivery.updateMany({
    where: {
      id: deliveryId,
      status: "PROCESSING",
    },
    data: {
      status: "SENT",
      sentAt: new Date(),
      failedAt: null,
      failureReason: null,
    },
  });
};

const markFailed = async (delivery, reason) => {
  const exhausted = delivery.attempts >= MAX_ATTEMPTS;

  await prisma.dailyReminderDelivery.updateMany({
    where: {
      id: delivery.id,
      status: "PROCESSING",
    },
    data: {
      status: exhausted ? "FAILED" : "PENDING",
      failedAt: exhausted ? new Date() : null,
      failureReason: reason || "Daily push notification failed.",
    },
  });
};

const sendDailyReminder = async (user, localDate, delivery) => {
  const tokens = getPushTokens(user);

  console.log("[Daily Reminder] Preparing push", {
    userId: user.id,
    localDate,
    timezone: user.preference?.timezone || DEFAULT_TIMEZONE,
    tokenCount: tokens.length,
    attempt: delivery.attempts,
  });

  if (user.preference?.pushNotifications !== true) {
    await markFailed(delivery, "PUSH_NOTIFICATIONS_DISABLED");
    return;
  }

  if (tokens.length === 0) {
    await markFailed(delivery, "NO_REGISTERED_PUSH_TOKENS");
    return;
  }

  try {
    const results = await sendPushToUser({
      tokens,
      title: "TaskFlow Daily Reminder",
      body: "Good morning! Remember to review your tasks for today.",
      data: {
        type: "DAILY_REMINDER",
        localDate,
      },
    });

    const accepted = Array.isArray(results)
      ? results.filter((result) => result?.success === true)
      : [];

    const rejected = Array.isArray(results)
      ? results.filter((result) => result?.success !== true)
      : [];

    console.log("[Daily Reminder] Push results", {
      userId: user.id,
      acceptedCount: accepted.length,
      rejectedCount: rejected.length,
      errors: rejected.map((result) => ({
        reason: result?.reason,
        error: result?.error,
      })),
    });

    if (accepted.length > 0) {
      await markSent(delivery.id);

      console.log("[Daily Reminder] Push accepted", {
        userId: user.id,
        localDate,
      });
    } else {
      await markFailed(delivery, "EXPO_PUSH_REJECTED");
    }
  } catch (error) {
    console.error(`[Daily Reminder] Push failed for user ${user.id}:`, error);

    await markFailed(delivery, error.message);
  }
};

const processUser = async (user) => {
  const preference = user.preference;

  if (!preference?.dailyReminderEnabled) return;

  const timezone = preference.timezone || DEFAULT_TIMEZONE;

  let localDateTime;

  try {
    localDateTime = getLocalDateTime(timezone);
  } catch (error) {
    console.error(
      `[Daily Reminder] Invalid timezone for user ${user.id}:`,
      error.message,
    );
    return;
  }

  const currentTime = localDateTime.toFormat("HH:mm");
  const localDate = localDateTime.toFormat("yyyy-MM-dd");

  // Send at or after 8:00 AM in this user's local timezone.
  if (currentTime < REMINDER_TIME) return;

  const delivery = await claimDelivery(user.id, localDate);

  // Already sent, currently processing, or waiting for a retry.
  if (!delivery) return;

  await sendDailyReminder(user, localDate, delivery);
};

export const processDailyReminders = async () => {
  if (dailyJobRunning) return;

  dailyJobRunning = true;

  try {
    await recoverStaleDeliveries();

    let cursor;

    while (true) {
      const users = await prisma.user.findMany({
        where: {
          preference: {
            dailyReminderEnabled: true,
          },
        },
        include: {
          preference: true,
          pushTokens: true,
        },
        orderBy: {
          id: "asc",
        },
        take: BATCH_SIZE,
        ...(cursor
          ? {
              cursor: { id: cursor },
              skip: 1,
            }
          : {}),
      });

      if (users.length === 0) break;

      for (const user of users) {
        try {
          await processUser(user);
        } catch (error) {
          console.error(
            `[Daily Reminder] Failed processing user ${user.id}:`,
            error,
          );
        }
      }

      cursor = users[users.length - 1].id;

      if (users.length < BATCH_SIZE) break;
    }
  } catch (error) {
    console.error("[Daily Reminder] Scheduler failed:", error);
  } finally {
    dailyJobRunning = false;
  }
};

export const startDailyReminderJob = () => {
  if (dailyCronTask) {
    console.warn("[Daily Reminder] Scheduler is already running");
    return dailyCronTask;
  }

  dailyCronTask = cron.schedule(
    "* * * * *",
    async () => {
      await processDailyReminders();
    },
    {
      noOverlap: true,
      timezone: "UTC",
    },
  );

  console.log(
    "[Daily Reminder] Scheduler started. Enabled users are checked every minute; notifications are sent at 8:00 AM in each user's timezone.",
  );

  return dailyCronTask;
};
