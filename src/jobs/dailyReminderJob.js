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

const DAILY_REMINDER_TYPE = "ALARM";

let dailyJobRunning = false;
let dailyCronTask = null;

// ======================================================
// TIMEZONE HELPERS
// ======================================================

const getLocalDateTime = (timezone) => {
  const localDateTime = DateTime.now().setZone(timezone);

  if (!localDateTime.isValid) {
    throw new Error(`Invalid timezone: ${timezone}`);
  }

  return localDateTime;
};

const isTaskDueToday = (dueDate, localDateTime) => {
  const taskDate = DateTime.fromJSDate(new Date(dueDate), {
    zone: "utc",
  });

  if (!taskDate.isValid) {
    return false;
  }

  // dueDate represents a calendar date stored in UTC.
  // Compare its date components with the user's local day.
  return (
    taskDate.year === localDateTime.year &&
    taskDate.month === localDateTime.month &&
    taskDate.day === localDateTime.day
  );
};

// ======================================================
// BUILD DAILY REMINDER MESSAGE
// ======================================================

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
    message: `You have ${tasks.length} tasks scheduled for today. Open TaskFlow to view your schedule.`,
  };
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
        "Daily reminder processing was interrupted and maximum attempts were reached.",
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

  const result = await prisma.dailyReminderDelivery.updateMany({
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

  if (result.count !== 1) {
    return null;
  }

  return prisma.dailyReminderDelivery.findUnique({
    where: {
      id: delivery.id,
    },
  });
};

// ======================================================
// MARK DAILY REMINDER SENT
// ======================================================

const markDailyReminderSent = async (deliveryId) => {
  return prisma.dailyReminderDelivery.updateMany({
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

// ======================================================
// MARK DAILY REMINDER FAILED
// ======================================================

const markDailyReminderFailed = async (deliveryId, attempts, reason) => {
  const exhausted = attempts >= MAX_ATTEMPTS;

  return prisma.dailyReminderDelivery.updateMany({
    where: {
      id: deliveryId,
      status: "PROCESSING",
    },

    data: {
      status: exhausted ? "FAILED" : "PENDING",
      failedAt: exhausted ? new Date() : null,
      failureReason: reason || "Daily reminder delivery failed",
    },
  });
};

// ======================================================
// DELIVER DAILY REMINDER
// ======================================================

const deliverDailyReminder = async ({ user, tasks, localDate }) => {
  if (tasks.length === 0) {
    return {
      delivered: false,
      reason: "NO_TASKS_TODAY",
    };
  }

  const { title, message } = buildDailyReminderContent(tasks);

  let pushAttempted = false;
  let pushSucceeded = false;
  let inAppSucceeded = false;

  // ====================================================
  // IN-APP NOTIFICATION
  // ====================================================

  // Use a stable delivery marker to avoid creating
  // duplicate daily notifications on ordinary retries.
  const notificationMarker = `daily:${user.id}:${localDate}`;

  const existingNotification = await prisma.notification.findFirst({
    where: {
      userId: user.id,
      type: DAILY_REMINDER_TYPE,
      title,
      message: {
        startsWith: `[${notificationMarker}]`,
      },
    },
  });

  if (existingNotification) {
    inAppSucceeded = true;
  } else {
    try {
      await createNotification({
        userId: user.id,
        title,
        message: `[${notificationMarker}] ${message}`,
        type: DAILY_REMINDER_TYPE,
      });

      inAppSucceeded = true;
    } catch (error) {
      console.error(
        `Daily in-app notification failed for user ${user.id}:`,
        error,
      );
    }
  }

  // ====================================================
  // EXPO PUSH NOTIFICATION
  // ====================================================

  const pushEnabled = user.preference?.pushNotifications === true;

  const tokens = Array.isArray(user.pushTokens)
    ? [
        ...new Set(
          user.pushTokens
            .map((item) => item?.token)
            .filter(
              (token) => typeof token === "string" && token.trim().length > 0,
            ),
        ),
      ]
    : [];

  if (pushEnabled && tokens.length > 0) {
    pushAttempted = true;

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

      pushSucceeded =
        Array.isArray(results) &&
        results.some((result) => result.success === true);

      const failedResults = Array.isArray(results)
        ? results.filter((result) => !result.success)
        : [];

      if (failedResults.length > 0) {
        console.error(
          `Some daily push notifications failed for user ${user.id}:`,
          failedResults,
        );
      }
    } catch (error) {
      console.error(
        `Daily push notification failed for user ${user.id}:`,
        error,
      );
    }
  }

  const delivered = inAppSucceeded || pushSucceeded;

  let reason;

  if (!pushAttempted && inAppSucceeded) {
    reason = "IN_APP_ONLY";
  } else if (pushAttempted && !pushSucceeded && inAppSucceeded) {
    reason = "PUSH_FAILED_IN_APP_SUCCEEDED";
  } else if (!delivered) {
    reason = "DELIVERY_FAILED";
  }

  return {
    delivered,
    reason,
    pushAttempted,
    pushSucceeded,
    inAppSucceeded,
  };
};

// ======================================================
// PROCESS SINGLE USER
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
    console.error(`Invalid timezone for user ${user.id}:`, error.message);

    return;
  }

  const scheduledTime = preference.dailyReminderTime || "09:00";

  // Never deliver before the user's configured time.
  if (localDateTime.toFormat("HH:mm") < scheduledTime) {
    return;
  }

  const tasks = user.tasks.filter((task) =>
    isTaskDueToday(task.dueDate, localDateTime),
  );

  if (tasks.length === 0) {
    return;
  }

  const localDate = localDateTime.toFormat("yyyy-MM-dd");

  const delivery = await claimDailyReminder(user.id, localDate);

  if (!delivery) {
    return;
  }

  try {
    const result = await deliverDailyReminder({
      user,
      tasks,
      localDate,
    });

    if (result.delivered) {
      await markDailyReminderSent(delivery.id);

      if (result.pushAttempted && !result.pushSucceeded) {
        console.warn(
          `Daily in-app reminder succeeded but push failed for user ${user.id}`,
        );
      }
    } else {
      await markDailyReminderFailed(
        delivery.id,
        delivery.attempts,
        result.reason,
      );
    }
  } catch (error) {
    await markDailyReminderFailed(
      delivery.id,
      delivery.attempts,
      error.message,
    );

    console.error(`Daily reminder failed for user ${user.id}:`, error);
  }
};

// ======================================================
// PROCESS DAILY REMINDERS
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
            `Failed to process daily reminder for user ${user.id}:`,
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
    console.error("Daily reminder job failed:", error);
  } finally {
    dailyJobRunning = false;
  }
};

// ======================================================
// START DAILY REMINDER CRON JOB
// ======================================================

export const startDailyReminderJob = () => {
  if (dailyCronTask) {
    console.warn("Daily reminder job is already running");
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

  console.log("Daily reminder job started");

  return dailyCronTask;
};
