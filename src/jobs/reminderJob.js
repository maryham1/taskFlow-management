import cron from "node-cron";

import { prisma } from "../config/db.js";

import { deliverReminder } from "../services/reminderDeliveryService.js";

// ======================================================
// CONFIGURATION
// ======================================================

const BATCH_SIZE = 25;
const MAX_ATTEMPTS = 3;
const PROCESSING_TIMEOUT_MS = 5 * 60 * 1000;

let reminderJobRunning = false;
let reminderCronTask = null;

// ======================================================
// RECOVER INTERRUPTED REMINDERS
// ======================================================

const recoverStaleProcessingReminders = async () => {
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

  await prisma.reminder.updateMany({
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
        "Previous reminder delivery attempt was interrupted. Retrying.",
    },
  });

  await prisma.reminder.updateMany({
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
        "Reminder delivery was interrupted and maximum retry attempts were reached.",
    },
  });
};

// ======================================================
// CANCEL REMINDERS FOR COMPLETED TASKS
// ======================================================

const cancelCompletedTaskReminders = async () => {
  await prisma.reminder.updateMany({
    where: {
      status: {
        in: ["PENDING", "PROCESSING"],
      },

      task: {
        status: "COMPLETED",
      },
    },

    data: {
      status: "CANCELLED",
      failedAt: null,
      failureReason: null,
    },
  });
};

// ======================================================
// CLAIM REMINDER
// ======================================================

const claimReminder = async (reminderId) => {
  const result = await prisma.reminder.updateMany({
    where: {
      id: reminderId,
      status: "PENDING",

      attempts: {
        lt: MAX_ATTEMPTS,
      },

      task: {
        status: "PENDING",
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

  return result.count === 1;
};

// ======================================================
// MARK REMINDER SENT
// ======================================================

const markReminderSent = async (reminderId) => {
  return prisma.reminder.updateMany({
    where: {
      id: reminderId,
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
// MARK REMINDER FAILED
// ======================================================

const markReminderFailed = async (reminderId, attempts, reason) => {
  const exhausted = attempts >= MAX_ATTEMPTS;

  return prisma.reminder.updateMany({
    where: {
      id: reminderId,
      status: "PROCESSING",
    },

    data: {
      status: exhausted ? "FAILED" : "PENDING",
      failedAt: exhausted ? new Date() : null,
      failureReason: reason || "No reminder delivery channel succeeded",
    },
  });
};

// ======================================================
// PROCESS SINGLE REMINDER
// ======================================================

const processReminder = async (reminder) => {
  const claimed = await claimReminder(reminder.id);

  if (!claimed) {
    return;
  }

  const attempts = reminder.attempts + 1;

  try {
    // Re-read the current reminder and task after claiming.
    // This avoids relying on potentially outdated task data.
    const currentReminder = await prisma.reminder.findUnique({
      where: {
        id: reminder.id,
      },

      include: {
        task: true,

        user: {
          include: {
            preference: true,
            pushTokens: true,
          },
        },
      },
    });

    if (!currentReminder) {
      return;
    }

    if (currentReminder.status !== "PROCESSING") {
      return;
    }

    if (!currentReminder.task || currentReminder.task.status === "COMPLETED") {
      await prisma.reminder.updateMany({
        where: {
          id: reminder.id,
          status: "PROCESSING",
        },

        data: {
          status: "CANCELLED",
          failedAt: null,
          failureReason: null,
        },
      });

      return;
    }

    const result = await deliverReminder(currentReminder);

    if (result.reason === "TASK_COMPLETED") {
      await prisma.reminder.updateMany({
        where: {
          id: reminder.id,
          status: "PROCESSING",
        },

        data: {
          status: "CANCELLED",
          failedAt: null,
          failureReason: null,
        },
      });

      return;
    }

    // Push requests can fail even when an in-app
    // notification is created successfully.
    //
    // Record the partial failure instead of silently
    // treating both channels as successful.
    if (result.pushFailed) {
      console.warn(`Push delivery failed for reminder ${reminder.id}.`);
    }

    if (result.delivered) {
      await markReminderSent(reminder.id);
    } else {
      await markReminderFailed(
        reminder.id,
        attempts,
        result.reason || "DELIVERY_FAILED",
      );
    }
  } catch (error) {
    const result = await markReminderFailed(
      reminder.id,
      attempts,
      error.message,
    );

    if (result.count > 0) {
      console.error(
        `Reminder ${reminder.id} failed on attempt ${attempts}:`,
        error,
      );
    }
  }
};

// ======================================================
// PROCESS DUE REMINDERS
// ======================================================

export const processDueReminders = async () => {
  if (reminderJobRunning) {
    return;
  }

  reminderJobRunning = true;

  try {
    await recoverStaleProcessingReminders();

    await cancelCompletedTaskReminders();

    const reminders = await prisma.reminder.findMany({
      where: {
        status: "PENDING",

        attempts: {
          lt: MAX_ATTEMPTS,
        },

        remindAt: {
          lte: new Date(),
        },

        task: {
          status: "PENDING",
        },
      },

      orderBy: {
        remindAt: "asc",
      },

      take: BATCH_SIZE,
    });

    for (const reminder of reminders) {
      await processReminder(reminder);
    }
  } catch (error) {
    console.error("Task reminder job failed:", error);
  } finally {
    reminderJobRunning = false;
  }
};

// ======================================================
// START REMINDER CRON JOB
// ======================================================

export const startReminderJob = () => {
  if (reminderCronTask) {
    console.warn("Task reminder job is already running");
    return reminderCronTask;
  }

  reminderCronTask = cron.schedule(
    "* * * * *",
    async () => {
      await processDueReminders();
    },
    {
      noOverlap: true,
    },
  );

  console.log("Task reminder job started");

  return reminderCronTask;
};
