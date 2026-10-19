import { DateTime, IANAZone } from "luxon";

// ======================================================
// CONSTANTS
// ======================================================

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// ======================================================
// VALIDATE TIME
// ======================================================

export const isValidTime = (time) => {
  return typeof time === "string" && TIME_REGEX.test(time);
};

// ======================================================
// VALIDATE TIMEZONE
// ======================================================

const validateTimezone = (timezone) => {
  if (typeof timezone !== "string" || !timezone.trim()) {
    throw new Error("User timezone is required");
  }

  if (!IANAZone.isValidZone(timezone)) {
    throw new Error(`Invalid timezone: ${timezone}`);
  }
};

// ======================================================
// EXTRACT TASK CALENDAR DATE
// ======================================================

const getDateParts = (dateValue) => {
  let date;

  if (dateValue instanceof Date) {
    date = dateValue;
  } else if (typeof dateValue === "string" && DATE_REGEX.test(dateValue)) {
    const parsed = DateTime.fromISO(dateValue, {
      zone: "utc",
    });

    if (!parsed.isValid) {
      throw new Error("Invalid task date");
    }

    date = parsed.toJSDate();
  } else {
    throw new Error("Task date must be a valid Date or YYYY-MM-DD string");
  }

  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid task date");
  }

  // Database calendar dates are stored using UTC.
  // Read UTC components to preserve the selected
  // calendar date regardless of the user's timezone.
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
};

// ======================================================
// COMBINE TASK DATE AND LOCAL TIME
// ======================================================

export const combineDateAndTime = (dateValue, time, timezone) => {
  if (!isValidTime(time)) {
    throw new Error("Invalid time. Expected HH:mm in 24-hour format");
  }

  validateTimezone(timezone);

  const { year, month, day } = getDateParts(dateValue);

  const [hour, minute] = time.split(":").map(Number);

  const localDateTime = DateTime.fromObject(
    {
      year,
      month,
      day,
      hour,
      minute,
      second: 0,
      millisecond: 0,
    },
    {
      zone: timezone,
    },
  );

  if (!localDateTime.isValid) {
    throw new Error(
      localDateTime.invalidExplanation || "Invalid task date and time",
    );
  }

  // Reject nonexistent local times caused by
  // daylight-saving transitions.
  if (
    localDateTime.year !== year ||
    localDateTime.month !== month ||
    localDateTime.day !== day ||
    localDateTime.hour !== hour ||
    localDateTime.minute !== minute
  ) {
    throw new Error(
      "The selected local time does not exist in this timezone on that date",
    );
  }

  // Convert the local datetime to an absolute
  // UTC instant for reminders and comparisons.
  return localDateTime.toUTC().toJSDate();
};

// ======================================================
// GET TASK START DATE AND TIME
// ======================================================

export const getTaskStartDateTime = (task, timezone) => {
  if (!task || typeof task !== "object") {
    throw new Error("A valid task is required");
  }

  return combineDateAndTime(task.dueDate, task.startTime, timezone);
};

// ======================================================
// GET TASK END DATE AND TIME
// ======================================================

export const getTaskEndDateTime = (task, timezone) => {
  if (!task || typeof task !== "object") {
    throw new Error("A valid task is required");
  }

  // Support overnight and multi-day tasks.
  // For existing tasks without an endDate,
  // use dueDate to preserve same-day behavior.
  const finalEndDate = task.endDate ?? task.dueDate;

  return combineDateAndTime(finalEndDate, task.endTime, timezone);
};
