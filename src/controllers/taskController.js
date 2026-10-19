import { DateTime } from "luxon";

import { prisma } from "../config/db.js";

import {
  cancelPendingTaskReminders,
  createTaskReminders,
  replaceTaskReminders,
} from "../services/reminderService.js";

import { createTaskNotification } from "../services/notificationService.js";

import { getTaskStartDateTime } from "../utils/taskDateTime.js";

// ======================================================
// CONSTANTS
// ======================================================

const TASK_STATUS = {
  PENDING: "PENDING",
  COMPLETED: "COMPLETED",
};

const COMPLETION_MODE = {
  STRICT: "STRICT",
  FLEXIBLE: "FLEXIBLE",
};

const VALID_PRIORITIES = ["LOW", "MEDIUM", "HIGH"];

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

// ======================================================
// ERROR HELPERS
// ======================================================

const sendError = (res, statusCode, message, field) => {
  return res.status(statusCode).json({
    success: false,
    message,
    ...(field && {
      errors: [
        {
          field,
          message,
          description: message,
        },
      ],
    }),
  });
};

class TaskError extends Error {
  constructor(message, statusCode = 400, field = null) {
    super(message);

    this.name = "TaskError";
    this.statusCode = statusCode;
    this.field = field;
  }
}

const handleTaskError = (error, res, next) => {
  if (error instanceof TaskError) {
    return sendError(res, error.statusCode, error.message, error.field);
  }

  return next(error);
};

// ======================================================
// USER AND TASK HELPERS
// ======================================================

const getOwnedTask = async (taskId, userId) => {
  return prisma.task.findFirst({
    where: {
      id: taskId,
      userId,
    },
  });
};

const getUserTimezone = async (userId) => {
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      preference: {
        select: {
          timezone: true,
        },
      },
    },
  });

  if (!user) {
    throw new TaskError("User not found", 404);
  }

  const timezone = user.preference?.timezone || "UTC";

  if (!DateTime.now().setZone(timezone).isValid) {
    throw new TaskError("Your configured timezone is invalid", 400, "dueDate");
  }

  return timezone;
};

const parseTaskDate = (value, field = "dueDate") => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TaskError(
      `${field === "endDate" ? "End date" : "Due date"} must use YYYY-MM-DD format`,
      400,
      field,
    );
  }

  const parsed = DateTime.fromISO(value, {
    zone: "utc",
  });

  if (!parsed.isValid || parsed.toFormat("yyyy-MM-dd") !== value) {
    throw new TaskError(
      `Please provide a valid ${field === "endDate" ? "end date" : "due date"}`,
      400,
      field,
    );
  }

  return parsed.startOf("day").toJSDate();
};

const normalizeStoredDate = (value) => {
  if (value instanceof Date) {
    return DateTime.fromJSDate(value, {
      zone: "utc",
    }).toFormat("yyyy-MM-dd");
  }

  if (typeof value === "string") {
    return value.slice(0, 10);
  }

  throw new TaskError("Invalid task date", 400, "dueDate");
};

const validateTime = (value, field) => {
  if (typeof value !== "string" || !TIME_REGEX.test(value)) {
    throw new TaskError(
      `${field === "startTime" ? "Start" : "End"} time must use HH:mm format`,
      400,
      field,
    );
  }
};

// ======================================================
// DATE AND TIME HELPERS
// ======================================================

/**
 * Build a complete datetime in the user's timezone.
 *
 * dueDate is the starting date.
 * endDate is the ending date.
 *
 * For existing tasks without endDate, dueDate is
 * used as the end date.
 */
const buildTaskDateTime = (date, time, timezone, field) => {
  const dateString = normalizeStoredDate(date);

  const parsed = DateTime.fromFormat(
    `${dateString} ${time}`,
    "yyyy-MM-dd HH:mm",
    {
      zone: timezone,
    },
  );

  if (
    !parsed.isValid ||
    parsed.toFormat("yyyy-MM-dd HH:mm") !== `${dateString} ${time}`
  ) {
    throw new TaskError("Invalid task date or time", 400, field);
  }

  return parsed.toJSDate();
};

const getScheduleStart = (task, timezone) => {
  return buildTaskDateTime(task.dueDate, task.startTime, timezone, "startTime");
};

const getScheduleEnd = (task, timezone) => {
  return buildTaskDateTime(
    task.endDate ?? task.dueDate,
    task.endTime,
    timezone,
    "endTime",
  );
};

/**
 * Validate the complete schedule.
 *
 * Supports:
 * October 17, 20:00 -> October 18, 00:00
 *
 * Also supports tasks spanning multiple days.
 */
const validateTaskSchedule = (task, timezone) => {
  validateTime(task.startTime, "startTime");
  validateTime(task.endTime, "endTime");

  const startDateTime = getScheduleStart(task, timezone);

  const endDateTime = getScheduleEnd(task, timezone);

  if (endDateTime <= startDateTime) {
    throw new TaskError(
      "The task end date and time must be later than its start date and time.",
      400,
      "endDate",
    );
  }

  return {
    startDateTime,
    endDateTime,
  };
};

// ======================================================
// FIELD VALIDATION
// ======================================================

const validateTaskFields = (body, isCreate = false) => {
  const { title, description, priority, completionMode } = body;

  if (
    (isCreate || title !== undefined) &&
    (typeof title !== "string" || !title.trim())
  ) {
    throw new TaskError("Task title is required", 400, "title");
  }

  if (
    description !== undefined &&
    description !== null &&
    typeof description !== "string"
  ) {
    throw new TaskError("Description must be a string", 400, "description");
  }

  if (
    (isCreate || priority !== undefined) &&
    !VALID_PRIORITIES.includes(priority)
  ) {
    throw new TaskError(
      "Priority must be LOW, MEDIUM or HIGH",
      400,
      "priority",
    );
  }

  if (
    (isCreate || completionMode !== undefined) &&
    !Object.values(COMPLETION_MODE).includes(completionMode)
  ) {
    throw new TaskError(
      "Completion mode must be STRICT or FLEXIBLE",
      400,
      "completionMode",
    );
  }
};

// ======================================================
// TASK AND NOTIFICATION HELPERS
// ======================================================

const getTaskWithReminders = async (taskId, userId) => {
  return prisma.task.findFirst({
    where: {
      id: taskId,
      userId,
    },
    include: {
      reminders: {
        orderBy: {
          remindAt: "asc",
        },
      },
    },
  });
};

const notifyTaskChange = async ({ userId, taskId, title, message, type }) => {
  try {
    await createTaskNotification({
      userId,
      taskId,
      title,
      message,
      type,
    });
  } catch (error) {
    console.error(`Task notification failed for ${taskId}:`, error);
  }
};

// ======================================================
// SCHEDULING CONFLICT HELPERS
// ======================================================

/**
 * PostgreSQL transaction-level advisory lock.
 *
 * Serializes scheduling changes for the same user.
 *
 * Casting to text avoids Prisma's void error.
 */
const lockUserSchedule = async (tx, userId) => {
  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${userId}::text, 0)
    )::text
  `;
};

/**
 * Reject overlapping tasks, including overnight tasks.
 *
 * Example:
 * Existing: Oct 17 20:00 -> Oct 18 00:00
 *
 * Oct 17 21:00 -> Oct 17 22:00 = Conflict
 * Oct 17 23:30 -> Oct 18 00:30 = Conflict
 * Oct 18 00:00 -> Oct 18 01:00 = Allowed
 *
 * Both STRICT and FLEXIBLE tasks reserve time.
 */
const checkSchedulingConflict = async (
  tx,
  { userId, dueDate, endDate, startTime, endTime, timezone, excludeTaskId },
) => {
  const proposedSchedule = validateTaskSchedule(
    {
      dueDate,
      endDate,
      startTime,
      endTime,
    },
    timezone,
  );

  const existingTasks = await tx.task.findMany({
    where: {
      userId,
      ...(excludeTaskId && {
        id: {
          not: excludeTaskId,
        },
      }),
      dueDate: {
        lte: endDate,
      },
      OR: [
        {
          endDate: {
            gte: dueDate,
          },
        },
        {
          endDate: null,
          dueDate: {
            gte: dueDate,
          },
        },
      ],
    },
    select: {
      id: true,
      title: true,
      dueDate: true,
      endDate: true,
      startTime: true,
      endTime: true,
    },
  });

  const conflict = existingTasks.find((task) => {
    const existingStart = getScheduleStart(task, timezone);

    const existingEnd = getScheduleEnd(task, timezone);

    return (
      proposedSchedule.startDateTime < existingEnd &&
      proposedSchedule.endDateTime > existingStart
    );
  });

  if (conflict) {
    const conflictStartDate = normalizeStoredDate(conflict.dueDate);

    const conflictEndDate = normalizeStoredDate(
      conflict.endDate ?? conflict.dueDate,
    );

    throw new TaskError(
      `This schedule overlaps with "${conflict.title}" ` +
        `(${conflictStartDate} ${conflict.startTime} - ` +
        `${conflictEndDate} ${conflict.endTime}). ` +
        "Please choose another available time.",
      409,
      "startTime",
    );
  }
};

// ======================================================
// CREATE TASK
// POST /tasks
// ======================================================

export const createTask = async (req, res, next) => {
  try {
    const {
      title,
      description,
      dueDate,
      endDate,
      startTime,
      endTime,
      priority,
      completionMode,
    } = req.body;

    validateTaskFields(req.body, true);

    const timezone = await getUserTimezone(req.user.id);

    const parsedDueDate = parseTaskDate(dueDate);

    // Existing clients can omit endDate for same-day tasks.
    const parsedEndDate =
      endDate === undefined ? parsedDueDate : parseTaskDate(endDate, "endDate");

    validateTaskSchedule(
      {
        dueDate: parsedDueDate,
        endDate: parsedEndDate,
        startTime,
        endTime,
      },
      timezone,
    );

    const task = await prisma.$transaction(
      async (tx) => {
        await lockUserSchedule(tx, req.user.id);

        await checkSchedulingConflict(tx, {
          userId: req.user.id,
          dueDate: parsedDueDate,
          endDate: parsedEndDate,
          startTime,
          endTime,
          timezone,
        });

        return tx.task.create({
          data: {
            title: title.trim(),
            description:
              typeof description === "string"
                ? description.trim() || null
                : null,
            dueDate: parsedDueDate,
            endDate: parsedEndDate,
            startTime,
            endTime,
            priority,
            completionMode,
            userId: req.user.id,
          },
        });
      },
      {
        maxWait: 10000,
        timeout: 15000,
      },
    );

    // Preserve reminder creation.
    try {
      await createTaskReminders({
        task,
        userId: req.user.id,
        timezone,
      });
    } catch (error) {
      console.error(`Failed to create reminders for task ${task.id}:`, error);

      throw error;
    }

    await notifyTaskChange({
      userId: req.user.id,
      taskId: task.id,
      title: "Task created",
      message: `"${task.title}" was created successfully.`,
      type: "CREATED",
    });

    const createdTask = await getTaskWithReminders(task.id, req.user.id);

    return res.status(201).json({
      success: true,
      message: "Task created successfully",
      data: {
        task: createdTask,
      },
    });
  } catch (error) {
    return handleTaskError(error, res, next);
  }
};

// ======================================================
// GET ALL TASKS
// GET /tasks
// ======================================================

export const getTasks = async (req, res, next) => {
  try {
    const tasks = await prisma.task.findMany({
      where: {
        userId: req.user.id,
      },

      // Include all reminder records so the frontend
      // can synchronize native alarms.
      include: {
        reminders: {
          orderBy: {
            remindAt: "asc",
          },
        },
      },

      orderBy: [
        {
          dueDate: "asc",
        },
        {
          startTime: "asc",
        },
      ],
    });

    return res.status(200).json({
      success: true,
      data: {
        tasks,
      },
    });
  } catch (error) {
    return next(error);
  }
};

// ======================================================
// GET SINGLE TASK
// GET /tasks/:id
// ======================================================

export const getTask = async (req, res, next) => {
  try {
    const task = await getTaskWithReminders(req.params.id, req.user.id);

    if (!task) {
      return sendError(res, 404, "Task not found");
    }

    return res.status(200).json({
      success: true,
      data: {
        task,
      },
    });
  } catch (error) {
    return next(error);
  }
};

// ======================================================
// UPDATE TASK
// PATCH /tasks/:id
// ======================================================

export const updateTask = async (req, res, next) => {
  try {
    const {
      title,
      description,
      dueDate,
      endDate,
      startTime,
      endTime,
      priority,
      completionMode,
    } = req.body;

    validateTaskFields(req.body);

    const timezone = await getUserTimezone(req.user.id);

    const result = await prisma.$transaction(
      async (tx) => {
        await lockUserSchedule(tx, req.user.id);

        const existingTask = await tx.task.findFirst({
          where: {
            id: req.params.id,
            userId: req.user.id,
          },
        });

        if (!existingTask) {
          throw new TaskError("Task not found", 404);
        }

        const finalDueDate =
          dueDate !== undefined ? parseTaskDate(dueDate) : existingTask.dueDate;

        const finalEndDate =
          endDate !== undefined
            ? parseTaskDate(endDate, "endDate")
            : (existingTask.endDate ??
              (dueDate !== undefined ? finalDueDate : existingTask.dueDate));

        const finalStartTime =
          startTime !== undefined ? startTime : existingTask.startTime;

        const finalEndTime =
          endTime !== undefined ? endTime : existingTask.endTime;

        validateTaskSchedule(
          {
            dueDate: finalDueDate,
            endDate: finalEndDate,
            startTime: finalStartTime,
            endTime: finalEndTime,
          },
          timezone,
        );

        const existingEndDate = existingTask.endDate ?? existingTask.dueDate;

        const scheduleChanged =
          finalDueDate.getTime() !== existingTask.dueDate.getTime() ||
          finalEndDate.getTime() !== existingEndDate.getTime() ||
          finalStartTime !== existingTask.startTime ||
          finalEndTime !== existingTask.endTime;

        if (scheduleChanged) {
          await checkSchedulingConflict(tx, {
            userId: req.user.id,
            dueDate: finalDueDate,
            endDate: finalEndDate,
            startTime: finalStartTime,
            endTime: finalEndTime,
            timezone,
            excludeTaskId: existingTask.id,
          });
        }

        const updatedTask = await tx.task.update({
          where: {
            id: existingTask.id,
          },
          data: {
            ...(title !== undefined && {
              title: title.trim(),
            }),

            ...(description !== undefined && {
              description:
                typeof description === "string"
                  ? description.trim() || null
                  : null,
            }),

            ...(dueDate !== undefined && {
              dueDate: finalDueDate,
            }),

            ...(scheduleChanged && {
              endDate: finalEndDate,
            }),

            ...(startTime !== undefined && {
              startTime: finalStartTime,
            }),

            ...(endTime !== undefined && {
              endTime: finalEndTime,
            }),

            ...(priority !== undefined && {
              priority,
            }),

            ...(completionMode !== undefined && {
              completionMode,
            }),
          },
        });

        return {
          updatedTask,
          scheduleChanged,
        };
      },
      {
        maxWait: 10000,
        timeout: 15000,
      },
    );

    const { updatedTask, scheduleChanged } = result;

    // Reschedule reminders only when the schedule
    // changes and the task remains pending.
    if (scheduleChanged && updatedTask.status === TASK_STATUS.PENDING) {
      await replaceTaskReminders({
        task: updatedTask,
        userId: req.user.id,
        timezone,
      });
    }

    await notifyTaskChange({
      userId: req.user.id,
      taskId: updatedTask.id,
      title: "Task updated",
      message: `"${updatedTask.title}" was updated.`,
      type: "UPDATED",
    });

    const taskWithReminders = await getTaskWithReminders(
      updatedTask.id,
      req.user.id,
    );

    return res.status(200).json({
      success: true,
      message: "Task updated successfully",
      data: {
        task: taskWithReminders,
      },
    });
  } catch (error) {
    return handleTaskError(error, res, next);
  }
};

// ======================================================
// UPDATE TASK STATUS
// PATCH /tasks/:id/status
// ======================================================

export const updateTaskStatus = async (req, res, next) => {
  try {
    const { status } = req.body;

    if (![TASK_STATUS.PENDING, TASK_STATUS.COMPLETED].includes(status)) {
      return sendError(
        res,
        400,
        "Status must be PENDING or COMPLETED",
        "status",
      );
    }

    const task = await getOwnedTask(req.params.id, req.user.id);

    if (!task) {
      return sendError(res, 404, "Task not found");
    }

    // Return reminders even when status is unchanged.
    if (task.status === status) {
      const taskWithReminders = await getTaskWithReminders(
        task.id,
        req.user.id,
      );

      return res.status(200).json({
        success: true,
        message: `Task is already ${status.toLowerCase()}`,
        data: {
          task: taskWithReminders,
        },
      });
    }

    const timezone = await getUserTimezone(req.user.id);

    // STRICT tasks cannot be completed before
    // their actual end date and time.
    if (
      status === TASK_STATUS.COMPLETED &&
      task.completionMode === COMPLETION_MODE.STRICT
    ) {
      let taskEndDateTime;

      try {
        taskEndDateTime = getScheduleEnd(task, timezone);
      } catch {
        return sendError(res, 400, "Invalid task end date or time", "endTime");
      }

      if (
        !(taskEndDateTime instanceof Date) ||
        Number.isNaN(taskEndDateTime.getTime())
      ) {
        return sendError(res, 400, "Invalid task end date or time", "endTime");
      }

      if (new Date() < taskEndDateTime) {
        return sendError(
          res,
          400,
          "This task cannot be marked as completed before its scheduled end date and time because STRICT mode is enabled.",
          "status",
        );
      }
    }

    // FLEXIBLE tasks can be completed early.
    const updatedTask = await prisma.task.update({
      where: {
        id: task.id,
      },
      data: {
        status,
      },
    });

    // Cancel future reminders when completed.
    if (status === TASK_STATUS.COMPLETED) {
      await cancelPendingTaskReminders({
        taskId: task.id,
        userId: req.user.id,
      });
    }

    // Restore reminders when a completed task
    // is reopened before its scheduled start.
    if (
      status === TASK_STATUS.PENDING &&
      task.status === TASK_STATUS.COMPLETED
    ) {
      const taskStartDateTime = getTaskStartDateTime(updatedTask, timezone);

      if (taskStartDateTime > new Date()) {
        await replaceTaskReminders({
          task: updatedTask,
          userId: req.user.id,
          timezone,
        });
      }
    }

    // Return the updated task with its latest
    // reminder records for alarm synchronization.
    const taskWithReminders = await getTaskWithReminders(
      updatedTask.id,
      req.user.id,
    );

    return res.status(200).json({
      success: true,
      message:
        status === TASK_STATUS.COMPLETED
          ? "Task marked as completed"
          : "Task marked as pending",
      data: {
        task: taskWithReminders,
      },
    });
  } catch (error) {
    return handleTaskError(error, res, next);
  }
};

// ======================================================
// DELETE TASK
// DELETE /tasks/:id
// ======================================================

export const deleteTask = async (req, res, next) => {
  try {
    const task = await getOwnedTask(req.params.id, req.user.id);

    if (!task) {
      return sendError(res, 404, "Task not found");
    }

    await prisma.$transaction(async (tx) => {
      // Remove notifications attached to the task.
      await tx.notification.deleteMany({
        where: {
          taskId: task.id,
          userId: req.user.id,
        },
      });

      // Reminders are deleted through the
      // Task -> Reminder cascade relationship.
      await tx.task.delete({
        where: {
          id: task.id,
        },
      });

      // Preserve the task deletion notification.
      await tx.notification.create({
        data: {
          userId: req.user.id,
          title: "Task deleted",
          message: `"${task.title}" was deleted.`,
          type: "DELETED",
        },
      });
    });

    return res.status(200).json({
      success: true,
      message: "Task deleted successfully",
    });
  } catch (error) {
    return handleTaskError(error, res, next);
  }
};
