import { IANAZone } from "luxon";

// ======================================================
// CONSTANTS
// ======================================================

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

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

const COMPLETION_MODES = ["STRICT", "FLEXIBLE"];

// ======================================================
// VALIDATION ERROR RESPONSE
// ======================================================

const fail = (res, message) => {
  return res.status(400).json({
    success: false,
    message,
  });
};

// ======================================================
// VALIDATE PREFERENCE UPDATE
// ======================================================

export const validateUpdatePreferences = (req, res, next) => {
  const body = req.body;

  // --------------------------------------------------
  // VALIDATE REQUEST BODY
  // --------------------------------------------------

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return fail(res, "Preferences must be provided as an object");
  }

  const keys = Object.keys(body);

  if (keys.length === 0) {
    return fail(res, "At least one preference must be provided");
  }

  // --------------------------------------------------
  // CHECK UNSUPPORTED FIELDS
  // --------------------------------------------------

  const unsupportedFields = keys.filter((key) => !ALLOWED_FIELDS.includes(key));

  if (unsupportedFields.length > 0) {
    return fail(
      res,
      `Unsupported preference field(s): ${unsupportedFields.join(", ")}`,
    );
  }

  // --------------------------------------------------
  // VALIDATE BOOLEAN PREFERENCES
  // --------------------------------------------------

  for (const field of BOOLEAN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      if (typeof body[field] !== "boolean") {
        return fail(res, `${field} must be true or false`);
      }
    }
  }

  // --------------------------------------------------
  // VALIDATE DAILY REMINDER TIME
  // --------------------------------------------------

  if (Object.prototype.hasOwnProperty.call(body, "dailyReminderTime")) {
    if (
      typeof body.dailyReminderTime !== "string" ||
      !TIME_REGEX.test(body.dailyReminderTime)
    ) {
      return fail(res, "dailyReminderTime must use 24-hour HH:mm format");
    }
  }

  // --------------------------------------------------
  // VALIDATE COMPLETION MODE
  // --------------------------------------------------

  if (Object.prototype.hasOwnProperty.call(body, "completionMode")) {
    if (!COMPLETION_MODES.includes(body.completionMode)) {
      return fail(res, "completionMode must be STRICT or FLEXIBLE");
    }
  }

  // --------------------------------------------------
  // VALIDATE TIMEZONE
  // --------------------------------------------------

  if (Object.prototype.hasOwnProperty.call(body, "timezone")) {
    if (
      typeof body.timezone !== "string" ||
      !body.timezone.trim() ||
      !IANAZone.isValidZone(body.timezone)
    ) {
      return fail(
        res,
        "timezone must be a valid IANA timezone, such as Africa/Lagos",
      );
    }
  }

  // --------------------------------------------------
  // VALIDATION SUCCESSFUL
  // --------------------------------------------------

  return next();
};
