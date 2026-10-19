import { prisma } from "../config/db.js";

import { createTaskNotification } from "./notificationService.js";

import { sendPushToUser } from "./pushNotificationService.js";

// ======================================================
// REMINDER MESSAGES
// ======================================================

const REMINDER_MESSAGES = {
  TWO_YEARS: "Your task is scheduled to start in 2 years.",
  ONE_YEAR: "Your task is scheduled to start in 1 year.",
  SIX_MONTHS: "Your task starts in 6 months.",
  THREE_MONTHS: "Your task starts in 3 months.",
  THIRTY_DAYS: "Your task starts in 30 days.",
  FIFTEEN_DAYS: "Your task starts in 15 days.",
  THREE_DAYS: "Your task starts in 3 days.",
  ONE_DAY: "Your task starts tomorrow.",
  THIRTY_MINUTES: "Your task starts in 30 minutes.",
  FIFTEEN_MINUTES: "Your task starts in 15 minutes.",
  EXACT_TIME: "It's time to start your task!",
};

// ======================================================
// BUILD REMINDER CONTENT
// ======================================================

const buildReminderContent = (reminder) => {
  const taskTitle = reminder.task.title;

  const reminderMessage =
    REMINDER_MESSAGES[reminder.type] ?? "Your scheduled task is coming up.";

  const title =
    reminder.type === "EXACT_TIME"
      ? "It's time for your task!"
      : "Task reminder";

  const message = `${reminderMessage} Task: "${taskTitle}".`;

  return {
    title,
    message,
  };
};

// ======================================================
// DELIVERY RESULT HELPER
// ======================================================

const buildDeliveryResult = ({
  delivered = false,
  reason,
  pushAttempted = false,
  pushSucceeded = false,
  inAppSucceeded = false,
  pushFailed = false,
}) => {
  return {
    delivered,
    reason,
    pushAttempted,
    pushSucceeded,
    inAppSucceeded,
    pushFailed,
  };
};

// ======================================================
// DELIVER REMINDER
// ======================================================

export const deliverReminder = async (reminder) => {
  if (!reminder?.id || !reminder?.user || !reminder?.task) {
    throw new Error("Reminder is missing required user or task information");
  }

  const { user, task } = reminder;

  // Do not deliver reminders for completed tasks.
  if (task.status === "COMPLETED") {
    return buildDeliveryResult({
      delivered: false,
      reason: "TASK_COMPLETED",
    });
  }

  // Recheck the task status before delivering.
  // This reduces the chance of sending reminders
  // after a task has been completed.
  const currentTask = await prisma.task.findFirst({
    where: {
      id: task.id,
      userId: user.id,
    },

    select: {
      id: true,
      status: true,
    },
  });

  if (!currentTask || currentTask.status === "COMPLETED") {
    return buildDeliveryResult({
      delivered: false,
      reason: "TASK_COMPLETED",
    });
  }

  const { title, message } = buildReminderContent(reminder);

  let pushAttempted = false;
  let pushSucceeded = false;
  let inAppSucceeded = false;
  let pushFailed = false;

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
          type: "TASK_REMINDER",
          taskId: task.id,
          reminderId: reminder.id,
          reminderType: reminder.type,
        },
      });

      pushSucceeded =
        Array.isArray(results) &&
        results.some((result) => result.success === true);

      pushFailed =
        !Array.isArray(results) ||
        results.some((result) => result.success !== true);

      if (pushFailed) {
        console.error(
          `One or more push requests failed for reminder ${reminder.id}`,
        );
      }
    } catch (error) {
      pushFailed = true;

      console.error(`Push reminder failed for ${reminder.id}:`, error);
    }
  }

  // ====================================================
  // IN-APP NOTIFICATION
  // ====================================================

  // The in-app notification is created regardless of
  // whether the user has enabled push notifications.
  try {
    await createTaskNotification({
      userId: user.id,
      taskId: task.id,
      title,
      message,
      type: "ALARM",
    });

    inAppSucceeded = true;
  } catch (error) {
    console.error(`In-app reminder failed for ${reminder.id}:`, error);
  }

  // ====================================================
  // DELIVERY RESULT
  // ====================================================

  const delivered = pushSucceeded || inAppSucceeded;

  let reason;

  if (!pushAttempted && inAppSucceeded) {
    reason = "IN_APP_ONLY";
  } else if (pushFailed && inAppSucceeded) {
    reason = "PUSH_FAILED_IN_APP_SUCCEEDED";
  } else if (pushSucceeded && !inAppSucceeded) {
    reason = "PUSH_ONLY";
  } else if (!delivered) {
    reason = "DELIVERY_FAILED";
  }

  return buildDeliveryResult({
    delivered,
    reason,
    pushAttempted,
    pushSucceeded,
    inAppSucceeded,
    pushFailed,
  });
};
