import { IANAZone } from "luxon";

import { prisma } from "../config/db.js";
import { replaceTaskReminders } from "../services/reminderService.js";

const DEFAULT_PREFERENCES = {
  pushNotifications: true,
  alarmReminders: true,
  dailyReminderEnabled: true,
  dailyReminderTime: "08:00",
  timezone: "UTC",
  completionMode: "STRICT",
};

const BOOLEAN_FIELDS = [
  "pushNotifications",
  "alarmReminders",
  "dailyReminderEnabled",
];

const ALLOWED_FIELDS = [
  ...BOOLEAN_FIELDS,
  "dailyReminderTime",
  "timezone",
  "completionMode",
];

const VALID_COMPLETION_MODES = ["STRICT", "FLEXIBLE"];
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

const validatePreferenceChanges = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Preferences must be provided as an object");
  }

  const changes = {};

  for (const [key, value] of Object.entries(body)) {
    if (!ALLOWED_FIELDS.includes(key)) {
      throw new Error(`Unknown preference field: ${key}`);
    }

    if (BOOLEAN_FIELDS.includes(key)) {
      if (typeof value !== "boolean") {
        throw new Error(`${key} must be true or false`);
      }

      changes[key] = value;
      continue;
    }

    if (key === "dailyReminderTime") {
      if (typeof value !== "string" || !TIME_REGEX.test(value)) {
        throw new Error("Daily reminder time must use HH:mm format");
      }

      changes[key] = value;
      continue;
    }

    if (key === "timezone") {
      if (typeof value !== "string" || !IANAZone.isValidZone(value)) {
        throw new Error("Please provide a valid IANA timezone");
      }

      changes[key] = value;
      continue;
    }

    if (key === "completionMode") {
      if (!VALID_COMPLETION_MODES.includes(value)) {
        throw new Error("Completion mode must be STRICT or FLEXIBLE");
      }

      changes[key] = value;
    }
  }

  if (Object.keys(changes).length === 0) {
    throw new Error("At least one preference field is required");
  }

  return changes;
};

const getOrCreatePreferences = async (userId) => {
  return prisma.userPreference.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      ...DEFAULT_PREFERENCES,
    },
  });
};

const regenerateTaskReminders = async (userId, timezone) => {
  const tasks = await prisma.task.findMany({
    where: {
      userId,
      status: "PENDING",
    },
  });

  const results = {
    updatedTasks: 0,
    failedTasks: 0,
  };

  for (const task of tasks) {
    try {
      await replaceTaskReminders({
        task,
        userId,
        timezone,
      });

      results.updatedTasks += 1;
    } catch (error) {
      results.failedTasks += 1;

      console.error(
        `Failed to regenerate reminders for task ${task.id}:`,
        error,
      );
    }
  }

  return results;
};

export const getPreferences = async (req, res, next) => {
  try {
    const preference = await getOrCreatePreferences(req.user.id);

    return res.status(200).json({
      success: true,
      data: { preference },
    });
  } catch (error) {
    next(error);
  }
};

export const updatePreferences = async (req, res, next) => {
  try {
    let changes;

    try {
      changes = validatePreferenceChanges(req.body);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    const currentPreference = await getOrCreatePreferences(req.user.id);

    // Daily reminders always run at 8:00 AM in the user's saved timezone.
    if (changes.dailyReminderEnabled === true) {
      changes.pushNotifications = true;
      changes.dailyReminderTime = "08:00";
    }

    const effectiveTimezone =
      changes.timezone ?? currentPreference.timezone ?? "UTC";

    const timezoneChanged =
      changes.timezone !== undefined &&
      changes.timezone !== currentPreference.timezone;

    const preference = await prisma.userPreference.update({
      where: { userId: req.user.id },
      data: changes,
    });

    let reminderSync = null;

    if (timezoneChanged) {
      reminderSync = await regenerateTaskReminders(
        req.user.id,
        effectiveTimezone,
      );
    }

    return res.status(200).json({
      success: true,
      message: "Preferences updated successfully",
      data: {
        preference,
        ...(reminderSync && { reminderSync }),
      },
    });
  } catch (error) {
    next(error);
  }
};
