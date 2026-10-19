const ALLOWED_NOTIFICATION_TYPES = ["ALARM", "CREATED", "UPDATED", "DELETED"];

// ======================================================
// CONSTANTS
// ======================================================

const MAX_LIMIT = 100;

const POSITIVE_INTEGER_REGEX = /^[1-9]\d*$/;

// ======================================================
// ERROR RESPONSE
// ======================================================

const sendValidationError = (res, message) => {
  return res.status(400).json({
    success: false,
    message,
  });
};

// ======================================================
// VALIDATE POSITIVE INTEGER QUERY
// ======================================================

const isValidPositiveInteger = (value) => {
  if (typeof value !== "string") {
    return false;
  }

  if (!POSITIVE_INTEGER_REGEX.test(value)) {
    return false;
  }

  const parsed = Number(value);

  return Number.isSafeInteger(parsed);
};

// ======================================================
// VALIDATE BOOLEAN QUERY
// ======================================================

const isValidBooleanQuery = (value) => {
  return value === "true" || value === "false";
};

// ======================================================
// VALIDATE NOTIFICATION LIST QUERY
//
// GET /notifications
//
// Supported:
// ?page=1
// ?limit=20
// ?read=false
// ?type=ALARM
// ======================================================

export const validateNotificationQuery = (req, res, next) => {
  const { page, limit, read, type } = req.query;

  // --------------------------------------------------
  // PAGE
  // --------------------------------------------------

  if (page !== undefined && !isValidPositiveInteger(page)) {
    return sendValidationError(res, "page must be a positive integer");
  }

  // --------------------------------------------------
  // LIMIT
  // --------------------------------------------------

  if (limit !== undefined) {
    if (!isValidPositiveInteger(limit)) {
      return sendValidationError(
        res,
        "limit must be an integer between 1 and 100",
      );
    }

    if (Number(limit) > MAX_LIMIT) {
      return sendValidationError(
        res,
        "limit must be an integer between 1 and 100",
      );
    }
  }

  // --------------------------------------------------
  // READ STATUS
  // --------------------------------------------------

  if (read !== undefined && !isValidBooleanQuery(read)) {
    return sendValidationError(res, "read must be true or false");
  }

  // --------------------------------------------------
  // NOTIFICATION TYPE
  // --------------------------------------------------

  if (type !== undefined) {
    if (
      typeof type !== "string" ||
      !ALLOWED_NOTIFICATION_TYPES.includes(type)
    ) {
      return sendValidationError(
        res,
        "type must be ALARM, CREATED, UPDATED, or DELETED",
      );
    }
  }

  // --------------------------------------------------
  // VALIDATION PASSED
  // --------------------------------------------------

  return next();
};
