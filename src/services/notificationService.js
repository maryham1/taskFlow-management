import { prisma } from "../config/db.js";

// ======================================================
// VALIDATION HELPERS
// ======================================================

const validateNotificationInput = ({
  userId,
  taskId,
  title,
  message,
  type,
}) => {
  if (typeof userId !== "string" || !userId.trim()) {
    throw new Error("A valid user ID is required");
  }

  if (
    taskId !== null &&
    taskId !== undefined &&
    (typeof taskId !== "string" || !taskId.trim())
  ) {
    throw new Error("Invalid task ID");
  }

  if (typeof title !== "string" || !title.trim()) {
    throw new Error("Notification title is required");
  }

  if (typeof message !== "string" || !message.trim()) {
    throw new Error("Notification message is required");
  }

  if (typeof type !== "string" || !type.trim()) {
    throw new Error("Notification type is required");
  }
};

// ======================================================
// CREATE GENERAL NOTIFICATION
// ======================================================

export const createNotification = async ({
  userId,
  taskId = null,
  title,
  message,
  type,
}) => {
  validateNotificationInput({
    userId,
    taskId,
    title,
    message,
    type,
  });

  return prisma.notification.create({
    data: {
      userId,

      ...(taskId && {
        taskId,
      }),

      title: title.trim(),
      message: message.trim(),
      type,
    },
  });
};

// ======================================================
// CREATE TASK NOTIFICATION
// ======================================================

export const createTaskNotification = async ({
  userId,
  taskId,
  title,
  message,
  type,
}) => {
  if (typeof taskId !== "string" || !taskId.trim()) {
    throw new Error("Task ID is required for task notifications");
  }

  return createNotification({
    userId,
    taskId,
    title,
    message,
    type,
  });
};

// ======================================================
// GET OWNED NOTIFICATION
// ======================================================

export const getOwnedNotification = async ({ notificationId, userId }) => {
  if (typeof notificationId !== "string" || !notificationId.trim()) {
    throw new Error("A valid notification ID is required");
  }

  if (typeof userId !== "string" || !userId.trim()) {
    throw new Error("A valid user ID is required");
  }

  return prisma.notification.findFirst({
    where: {
      id: notificationId,
      userId,
    },

    include: {
      task: {
        select: {
          id: true,
          title: true,
          dueDate: true,
          startTime: true,
          endTime: true,
          priority: true,
          status: true,
        },
      },
    },
  });
};

// ======================================================
// CREATE DAILY NOTIFICATION ONCE
// ======================================================

export const createDailyNotificationOnce = async ({
  userId,
  localDate,
  title,
  message,
}) => {
  if (typeof localDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
    throw new Error("Local date must use YYYY-MM-DD format");
  }

  const marker = `daily:${userId}:${localDate}`;

  const existingNotification = await prisma.notification.findFirst({
    where: {
      userId,
      type: "ALARM",
      title,
      message: {
        startsWith: `[${marker}]`,
      },
    },
  });

  if (existingNotification) {
    return {
      notification: existingNotification,
      created: false,
    };
  }

  const notification = await createNotification({
    userId,
    title,
    message: `[${marker}] ${message}`,
    type: "ALARM",
  });

  return {
    notification,
    created: true,
  };
};
