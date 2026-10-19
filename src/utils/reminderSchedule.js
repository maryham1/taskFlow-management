import { DateTime, IANAZone } from "luxon";

// ======================================================
// REMINDER SCHEDULE CONFIGURATION
// ======================================================

const REMINDER_SCHEDULE = [
  {
    type: "TWO_YEARS",
    subtract: { years: 2 },
  },
  {
    type: "ONE_YEAR",
    subtract: { years: 1 },
  },
  {
    type: "SIX_MONTHS",
    subtract: { months: 6 },
  },
  {
    type: "THREE_MONTHS",
    subtract: { months: 3 },
  },
  {
    type: "THIRTY_DAYS",
    subtract: { days: 30 },
  },
  {
    type: "FIFTEEN_DAYS",
    subtract: { days: 15 },
  },
  {
    type: "THREE_DAYS",
    subtract: { days: 3 },
  },
  {
    type: "ONE_DAY",
    subtract: { days: 1 },
  },
  {
    type: "THIRTY_MINUTES",
    subtract: { minutes: 5 },
  },
  {
    type: "FIFTEEN_MINUTES",
    subtract: { minutes: 2 },
  },
];

// ======================================================
// VALIDATION HELPERS
// ======================================================

const validateTaskStartDateTime = (taskStartDateTime) => {
  if (
    !(taskStartDateTime instanceof Date) ||
    Number.isNaN(taskStartDateTime.getTime())
  ) {
    throw new Error(
      "A valid task start date/time is required to build reminders",
    );
  }
};

const validateTimezone = (timezone) => {
  if (typeof timezone !== "string" || !IANAZone.isValidZone(timezone)) {
    throw new Error("A valid IANA timezone is required to build reminders");
  }
};

// ======================================================
// BUILD REMINDER SCHEDULE
// ======================================================

export const buildReminderSchedule = (taskStartDateTime, timezone = "UTC") => {
  validateTaskStartDateTime(taskStartDateTime);
  validateTimezone(timezone);

  const now = DateTime.utc();

  // Convert the task's exact UTC start instant
  // into the user's configured timezone.
  const taskStart = DateTime.fromJSDate(taskStartDateTime, {
    zone: timezone,
  });

  if (!taskStart.isValid) {
    throw new Error("Invalid task start date/time");
  }

  // Do not schedule reminders for tasks that
  // have already started or are starting now.
  if (taskStart.toUTC() <= now) {
    return [];
  }

  const reminders = REMINDER_SCHEDULE.map(({ type, subtract }) => {
    // Calendar intervals (years, months, days)
    // are calculated in the user's timezone.
    //
    // Minute intervals represent elapsed time.
    const remindAt = taskStart.minus(subtract);

    return {
      type,
      remindAt,
    };
  })

    // Only keep valid future reminder times.
    .filter(({ remindAt }) => {
      return remindAt.isValid && remindAt.toUTC() > now;
    })

    // Convert reminders to JavaScript Date
    // objects for Prisma/PostgreSQL.
    .map(({ type, remindAt }) => ({
      type,
      remindAt: remindAt.toUTC().toJSDate(),
    }));

  // Always add the exact task start reminder
  // for a task scheduled in the future.
  reminders.push({
    type: "EXACT_TIME",
    remindAt: taskStart.toUTC().toJSDate(),
  });

  // Sort from the earliest reminder to the latest.
  reminders.sort((a, b) => {
    return a.remindAt.getTime() - b.remindAt.getTime();
  });

  return reminders;
};
