import { prisma } from "../config/db.js";

import { buildReminderSchedule } from "../utils/reminderSchedule.js";

import {
  getTaskStartDateTime,
  getTaskEndDateTime,
} from "../utils/taskDateTime.js";

// ======================================================
// CONSTANTS
// ======================================================

const REMINDER_STATUS = {
  PENDING: "PENDING",
  FAILED: "FAILED",
  PROCESSING: "PROCESSING",
  CANCELLED: "CANCELLED",
};

// ======================================================
// VALIDATION HELPERS
// ======================================================

const validateReminderInput = ({ task, userId, timezone }) => {
  if (!task || !task.id) {
    throw new Error("A valid task is required to create reminders");
  }

  if (typeof userId !== "string" || !userId.trim()) {
    throw new Error("A valid user ID is required");
  }

  if (typeof timezone !== "string" || !timezone.trim()) {
    throw new Error("A valid user timezone is required");
  }
};

// ======================================================
// VALIDATE TASK SCHEDULE
// ======================================================

const validateReminderTaskSchedule = (task, timezone) => {
  const taskStartDateTime = getTaskStartDateTime(task, timezone);

  const taskEndDateTime = getTaskEndDateTime(task, timezone);

  if (
    !(taskStartDateTime instanceof Date) ||
    Number.isNaN(taskStartDateTime.getTime()) ||
    !(taskEndDateTime instanceof Date) ||
    Number.isNaN(taskEndDateTime.getTime())
  ) {
    throw new Error("Invalid task date or time for reminder scheduling");
  }

  if (taskEndDateTime <= taskStartDateTime) {
    throw new Error(
      "Task end date and time must be later than the start date and time",
    );
  }

  return {
    taskStartDateTime,
    taskEndDateTime,
  };
};

// ======================================================
// BUILD REMINDER DATA
// ======================================================

const buildReminderData = ({ task, userId, timezone }) => {
  validateReminderInput({
    task,
    userId,
    timezone,
  });

  // Validate the complete task schedule,
  // including overnight and multi-day tasks.
  const { taskStartDateTime } = validateReminderTaskSchedule(task, timezone);

  // Reminders are based on when the task starts,
  // even if it finishes on another calendar date.
  const reminderSchedule = buildReminderSchedule(taskStartDateTime, timezone);

  return reminderSchedule.map((reminder) => ({
    userId,
    taskId: task.id,
    type: reminder.type,
    remindAt: reminder.remindAt,
    status: REMINDER_STATUS.PENDING,
  }));
};

// ======================================================
// GET TASK REMINDERS
// ======================================================

const getTaskReminders = async ({ taskId, userId }) => {
  return prisma.reminder.findMany({
    where: {
      taskId,
      userId,
    },
    orderBy: {
      remindAt: "asc",
    },
  });
};

// ======================================================
// CREATE TASK REMINDERS
// ======================================================

export const createTaskReminders = async ({ task, userId, timezone }) => {
  const data = buildReminderData({
    task,
    userId,
    timezone,
  });

  if (data.length > 0) {
    await prisma.reminder.createMany({
      data,
      skipDuplicates: true,
    });
  }

  return getTaskReminders({
    taskId: task.id,
    userId,
  });
};

// ======================================================
// REPLACE TASK REMINDERS
// ======================================================

export const replaceTaskReminders = async ({ task, userId, timezone }) => {
  const data = buildReminderData({
    task,
    userId,
    timezone,
  });

  // Replace the previous reminder schedule
  // in one database transaction.
  await prisma.$transaction(async (tx) => {
    await tx.reminder.deleteMany({
      where: {
        taskId: task.id,
        userId,
      },
    });

    if (data.length > 0) {
      await tx.reminder.createMany({
        data,
        skipDuplicates: true,
      });
    }
  });

  return getTaskReminders({
    taskId: task.id,
    userId,
  });
};

// ======================================================
// CANCEL PENDING TASK REMINDERS
// ======================================================

export const cancelPendingTaskReminders = async ({ taskId, userId }) => {
  if (!taskId || !userId) {
    throw new Error("Task ID and user ID are required to cancel reminders");
  }

  return prisma.reminder.updateMany({
    where: {
      taskId,
      userId,
      status: {
        in: [REMINDER_STATUS.PENDING, REMINDER_STATUS.FAILED],
      },
    },
    data: {
      status: REMINDER_STATUS.CANCELLED,
      failedAt: null,
      failureReason: null,
    },
  });
};
