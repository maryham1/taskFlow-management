import cron from "node-cron";
import { DateTime } from "luxon";

import { prisma } from "../config/db.js";
import { createNotification } from "../services/notificationService.js";
import { sendPushToUser } from "../services/pushNotificationService.js";

// ======================================================
// CONFIGURATION
// ======================================================

const MAX_ATTEMPTS = 3;
const PROCESSING_TIMEOUT_MS = 5 * 60 * 1000;
const BATCH_SIZE = 100;
const DEFAULT_REMINDER_TIME = "09:30";
const DAILY_REMINDER_TYPE = "ALARM";

let dailyJobRunning = false;
let dailyCronTask = null;

// ======================================================
// HELPERS
// ======================================================

const getLocalDateTime = (timezone) => {
  const dateTime = DateTime.now().setZone(timezone);

  if (!dateTime.isValid) {
    throw new Error(`Invalid timezone: ${timezone}`);
  }

  return dateTime;
};

// This preserves your existing convention:
// dueDate is stored as a UTC calendar date.
// Confirm this matches your task creation controller.
const isTaskDueToday = (dueDate, localDateTime) => {
  if (!dueDate) return false;

  const taskDate = DateTime.fromJSDate(new Date(dueDate), {
    zone: "utc",
  });

  if (!taskDate.isValid) return false;

  return (
    taskDate.year === localDateTime.year &&
    taskDate.month === localDateTime.month &&
    taskDate.day === localDateTime.day
  );
};

const isValidReminderTime = (value) => {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
};

const buildDailyReminderContent = (tasks) => {
  const title = "Today's tasks";

  if (tasks.length === 1) {
    return {
      title,
      message: `You have 1 task scheduled for today: "${tasks[0].title}".`,
    };
  }

  return {
    title,
    message: `You have ${tasks.length} pending tasks scheduled for today. Open TaskFlow to view your schedule.`,
  };
};

const getUserPushTokens = (user) => {
  if (!Array.isArray(user.pushTokens)) return [];

  return [
    ...new Set(
      user.pushTokens
        .map((item) => item?.token)
        .filter(
          (token) => typeof token === "string" && token.trim().length > 0,
        ),
    ),
  ];
};

// ======================================================
// RECOVER INTERRUPTED DELIVERIES
// ======================================================

const recoverStaleDailyDeliveries = async () => {
  const staleCondition = {
    status: "PROCESSING",
    OR: [
      {
        lastAttemptAt: {
          lte: new Date(Date.now() - PROCESSING_TIMEOUT_MS),
        },
      },
      {
        lastAttemptAt: null,
      },
    ],
  };

  await prisma.dailyReminderDelivery.updateMany({
    where: {
      ...staleCondition,
      attempts: {
        lt: MAX_ATTEMPTS,
      },
    },
    data: {
      status: "PENDING",
      failedAt: null,
      failureReason:
        "Previous daily reminder attempt was interrupted. Retrying.",
    },
  });

  await prisma.dailyReminderDelivery.updateMany({
    where: {
      ...staleCondition,
      attempts: {
        gte: MAX_ATTEMPTS,
      },
    },
    data: {
      status: "FAILED",
      failedAt: new Date(),
      failureReason:
        "Processing was interrupted and maximum attempts were reached.",
    },
  });
};

// ======================================================
// CLAIM DAILY REMINDER
// ======================================================

const claimDailyReminder = async (userId, localDate) => {
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

  const claimed = await prisma.dailyReminderDelivery.updateMany({
    where: {
      id: delivery.id,
      status: "PENDING",
      attempts: {
        lt: MAX_ATTEMPTS,
      },
    },
    data: {
      status: "PROCESSING",
      attempts: {
        increment: 1,
      },
      lastAttemptAt: new Date(),
      failedAt: null,
      failureReason: null,
    },
  });

  if (claimed.count !== 1) {
    return null;
  }

  return prisma.dailyReminderDelivery.findUnique({
    where: {
      id: delivery.id,
    },
  });
};

// ======================================================
// UPDATE DELIVERY STATUS
// ======================================================

const markDailyReminderSent = async (deliveryId) => {
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

const markDailyReminderFailed = async (deliveryId, attempts, reason) => {
  const exhausted = attempts >= MAX_ATTEMPTS;

  await prisma.dailyReminderDelivery.updateMany({
    where: {
      id: deliveryId,
      status: "PROCESSING",
    },
    data: {
      status: exhausted ? "FAILED" : "PENDING",
      failedAt: exhausted ? new Date() : null,
      failureReason: reason || "Daily reminder push delivery failed",
    },
  });
};

// ======================================================
// CREATE IN-APP DAILY NOTIFICATION
// ======================================================

const createDailyInAppNotification = async ({
  userId,
  localDate,
  title,
  message,
}) => {
  const marker = `daily:${userId}:${localDate}`;

  try {
    const existing = await prisma.notification.findFirst({
      where: {
        userId,
        type: DAILY_REMINDER_TYPE,
        title,
        message: {
          startsWith: `[${marker}]`,
        },
      },
    });

    if (existing) {
      return true;
    }

    await createNotification({
      userId,
      title,
      message: `[${marker}] ${message}`,
      type: DAILY_REMINDER_TYPE,
    });

    return true;
  } catch (error) {
    console.error(
      `[Daily Reminder] In-app notification failed for user ${userId}:`,
      error,
    );

    return false;
  }
};

// ======================================================
// DELIVER DAILY REMINDER
// ======================================================

const deliverDailyReminder = async ({ user, tasks, localDate }) => {
  const { title, message } = buildDailyReminderContent(tasks);

  const inAppSucceeded = await createDailyInAppNotification({
    userId: user.id,
    localDate,
    title,
    message,
  });

  const pushEnabled = user.preference?.pushNotifications === true;

  const tokens = getUserPushTokens(user);

  console.log("[Daily Reminder] Delivery preparation", {
    userId: user.id,
    localDate,
    taskCount: tasks.length,
    pushEnabled,
    tokenCount: tokens.length,
    inAppSucceeded,
  });

  // A successful in-app notification is NOT considered
  // successful phone push delivery.

  if (!pushEnabled) {
    return {
      delivered: false,
      reason: "PUSH_NOTIFICATIONS_DISABLED",
      inAppSucceeded,
      pushSucceeded: false,
    };
  }

  if (tokens.length === 0) {
    return {
      delivered: false,
      reason: "NO_REGISTERED_PUSH_TOKENS",
      inAppSucceeded,
      pushSucceeded: false,
    };
  }

  try {
    const results = await sendPushToUser({
      tokens,
      title,
      body: message,
      data: {
        type: "DAILY_REMINDER",
        localDate,
      },
    });

    const accepted = Array.isArray(results)
      ? results.filter((result) => result.success === true)
      : [];

    const rejected = Array.isArray(results)
      ? results.filter((result) => result.success !== true)
      : [];

    console.log("[Daily Reminder] Expo push results", {
      userId: user.id,
      acceptedCount: accepted.length,
      rejectedCount: rejected.length,
      ticketIds: accepted.map((result) => result.ticketId).filter(Boolean),
      errors: rejected.map((result) => ({
        reason: result.reason,
        error: result.error,
      })),
    });

    // At least one device token must receive an accepted
    // Expo push ticket. This is not proof of device receipt.
    const pushSucceeded = accepted.length > 0;

    return {
      delivered: pushSucceeded,
      reason: pushSucceeded ? "EXPO_PUSH_ACCEPTED" : "EXPO_PUSH_REJECTED",
      inAppSucceeded,
      pushSucceeded,
    };
  } catch (error) {
    console.error(`[Daily Reminder] Push failed for user ${user.id}:`, error);

    return {
      delivered: false,
      reason: "PUSH_REQUEST_FAILED",
      inAppSucceeded,
      pushSucceeded: false,
    };
  }
};

// ======================================================
// PROCESS ONE USER
// ======================================================

const processUserDailyReminder = async (user) => {
  const preference = user.preference;

  if (!preference?.dailyReminderEnabled) {
    return;
  }

  const timezone = preference.timezone || "UTC";

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

  const savedTime = preference.dailyReminderTime;

  const scheduledTime = isValidReminderTime(savedTime)
    ? savedTime
    : DEFAULT_REMINDER_TIME;

  const currentTime = localDateTime.toFormat("HH:mm");
  const localDate = localDateTime.toFormat("yyyy-MM-dd");

  if (currentTime < scheduledTime) {
    return;
  }

  const tasks = user.tasks.filter((task) =>
    isTaskDueToday(task.dueDate, localDateTime),
  );

  if (tasks.length === 0) {
    return;
  }

  const delivery = await claimDailyReminder(user.id, localDate);

  if (!delivery) {
    return;
  }

  console.log("[Daily Reminder] Processing user", {
    userId: user.id,
    timezone,
    localDate,
    currentTime,
    scheduledTime,
    taskCount: tasks.length,
    attempt: delivery.attempts,
  });

  try {
    const result = await deliverDailyReminder({
      user,
      tasks,
      localDate,
    });

    if (result.delivered) {
      await markDailyReminderSent(delivery.id);

      console.log("[Daily Reminder] Push accepted", {
        userId: user.id,
        localDate,
      });
    } else {
      await markDailyReminderFailed(
        delivery.id,
        delivery.attempts,
        result.reason,
      );

      console.warn("[Daily Reminder] Delivery attempt failed", {
        userId: user.id,
        localDate,
        attempt: delivery.attempts,
        reason: result.reason,
      });
    }
  } catch (error) {
    await markDailyReminderFailed(
      delivery.id,
      delivery.attempts,
      error.message,
    );

    console.error(
      `[Daily Reminder] Unexpected error for user ${user.id}:`,
      error,
    );
  }
};

// ======================================================
// PROCESS ALL ELIGIBLE USERS
// ======================================================

export const processDailyReminders = async () => {
  if (dailyJobRunning) {
    return;
  }

  dailyJobRunning = true;

  try {
    await recoverStaleDailyDeliveries();

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
          tasks: {
            where: {
              status: "PENDING",
            },
          },
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

      if (users.length === 0) {
        break;
      }

      for (const user of users) {
        try {
          await processUserDailyReminder(user);
        } catch (error) {
          console.error(
            `[Daily Reminder] User processing failed: ${user.id}`,
            error,
          );
        }
      }

      cursor = users[users.length - 1].id;

      if (users.length < BATCH_SIZE) {
        break;
      }
    }
  } catch (error) {
    console.error("[Daily Reminder] Scheduler failed:", error);
  } finally {
    dailyJobRunning = false;
  }
};

// ======================================================
// START DAILY REMINDER SCHEDULER
// ======================================================

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
    },
  );

  console.log("[Daily Reminder] Scheduler started (every minute)");

  return dailyCronTask;
};
