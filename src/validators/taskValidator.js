const VALID_PRIORITIES = ["LOW", "MEDIUM", "HIGH"];

const VALID_COMPLETION_MODES = ["STRICT", "FLEXIBLE"];

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// ======================================================
// ERROR RESPONSE
// ======================================================

const sendValidationError = (res, field, message) => {
  return res.status(400).json({
    success: false,
    message,
    errors: [
      {
        field,
        message,
        description: message,
      },
    ],
  });
};

// ======================================================
// VALIDATION HELPERS
// ======================================================

const isValidDate = (value) => {
  if (typeof value !== "string" || !DATE_REGEX.test(value)) {
    return false;
  }

  const parsedDate = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(parsedDate.getTime())) {
    return false;
  }

  return parsedDate.toISOString().slice(0, 10) === value;
};

const isValidTime = (value) => {
  return typeof value === "string" && TIME_REGEX.test(value);
};

const isValidPriority = (value) => {
  return VALID_PRIORITIES.includes(value);
};

const isValidCompletionMode = (value) => {
  return VALID_COMPLETION_MODES.includes(value);
};

/**
 * Compare full calendar dates and times.
 *
 * Dates use YYYY-MM-DD.
 * Times use HH:mm.
 *
 * The comparison uses UTC only to establish ordering
 * of calendar date/time values. Actual task timezone
 * conversion remains the controller's responsibility.
 */
const isEndAfterStart = ({ dueDate, endDate, startTime, endTime }) => {
  const start = Date.parse(`${dueDate}T${startTime}:00.000Z`);

  const end = Date.parse(`${endDate}T${endTime}:00.000Z`);

  return Number.isFinite(start) && Number.isFinite(end) && end > start;
};

const validateDateTimeOrder = (
  res,
  { dueDate, endDate, startTime, endTime },
) => {
  if (
    !isEndAfterStart({
      dueDate,
      endDate,
      startTime,
      endTime,
    })
  ) {
    return sendValidationError(
      res,
      "endDate",
      "The task end date and time must be later than its start date and time",
    );
  }

  return null;
};

// ======================================================
// CREATE TASK VALIDATION
// ======================================================

export const validateCreateTask = (req, res, next) => {
  const {
    title,
    description,
    dueDate,
    endDate,
    startTime,
    endTime,
    priority,
    completionMode,
  } = req.body ?? {};

  // ----------------------------------------------------
  // TITLE
  // ----------------------------------------------------

  if (typeof title !== "string" || !title.trim()) {
    return sendValidationError(res, "title", "Task title is required");
  }

  // ----------------------------------------------------
  // DESCRIPTION
  // ----------------------------------------------------

  if (
    description !== undefined &&
    description !== null &&
    typeof description !== "string"
  ) {
    return sendValidationError(
      res,
      "description",
      "Description must be a string",
    );
  }

  // ----------------------------------------------------
  // START DATE
  // ----------------------------------------------------

  if (!dueDate) {
    return sendValidationError(res, "dueDate", "Due date is required");
  }

  if (!isValidDate(dueDate)) {
    return sendValidationError(
      res,
      "dueDate",
      "Due date must be a valid date in YYYY-MM-DD format",
    );
  }

  // ----------------------------------------------------
  // END DATE
  // ----------------------------------------------------

  // Existing clients may omit endDate for same-day tasks.
  if (endDate !== undefined && !isValidDate(endDate)) {
    return sendValidationError(
      res,
      "endDate",
      "End date must be a valid date in YYYY-MM-DD format",
    );
  }

  const finalEndDate = endDate ?? dueDate;

  // ----------------------------------------------------
  // START TIME
  // ----------------------------------------------------

  if (!startTime) {
    return sendValidationError(res, "startTime", "Start time is required");
  }

  if (!isValidTime(startTime)) {
    return sendValidationError(
      res,
      "startTime",
      "Start time must use HH:mm format",
    );
  }

  // ----------------------------------------------------
  // END TIME
  // ----------------------------------------------------

  if (!endTime) {
    return sendValidationError(res, "endTime", "End time is required");
  }

  if (!isValidTime(endTime)) {
    return sendValidationError(
      res,
      "endTime",
      "End time must use HH:mm format",
    );
  }

  // ----------------------------------------------------
  // COMPLETE DATE/TIME ORDER
  // ----------------------------------------------------

  const scheduleError = validateDateTimeOrder(res, {
    dueDate,
    endDate: finalEndDate,
    startTime,
    endTime,
  });

  if (scheduleError) {
    return scheduleError;
  }

  // ----------------------------------------------------
  // PRIORITY
  // ----------------------------------------------------

  if (!priority) {
    return sendValidationError(
      res,
      "priority",
      "Please select a task priority",
    );
  }

  if (!isValidPriority(priority)) {
    return sendValidationError(
      res,
      "priority",
      "Priority must be LOW, MEDIUM or HIGH",
    );
  }

  // ----------------------------------------------------
  // COMPLETION MODE
  // ----------------------------------------------------

  if (!completionMode) {
    return sendValidationError(
      res,
      "completionMode",
      "Please select STRICT or FLEXIBLE completion mode",
    );
  }

  if (!isValidCompletionMode(completionMode)) {
    return sendValidationError(
      res,
      "completionMode",
      "Completion mode must be STRICT or FLEXIBLE",
    );
  }

  return next();
};

// ======================================================
// UPDATE TASK VALIDATION
// ======================================================

export const validateUpdateTask = (req, res, next) => {
  const {
    title,
    description,
    dueDate,
    endDate,
    startTime,
    endTime,
    priority,
    completionMode,
  } = req.body ?? {};

  // ----------------------------------------------------
  // TITLE
  // ----------------------------------------------------

  if (title !== undefined && (typeof title !== "string" || !title.trim())) {
    return sendValidationError(res, "title", "Task title cannot be empty");
  }

  // ----------------------------------------------------
  // DESCRIPTION
  // ----------------------------------------------------

  if (
    description !== undefined &&
    description !== null &&
    typeof description !== "string"
  ) {
    return sendValidationError(
      res,
      "description",
      "Description must be a string",
    );
  }

  // ----------------------------------------------------
  // START DATE
  // ----------------------------------------------------

  if (dueDate !== undefined && !isValidDate(dueDate)) {
    return sendValidationError(
      res,
      "dueDate",
      "Due date must be a valid date in YYYY-MM-DD format",
    );
  }

  // ----------------------------------------------------
  // END DATE
  // ----------------------------------------------------

  if (endDate !== undefined && !isValidDate(endDate)) {
    return sendValidationError(
      res,
      "endDate",
      "End date must be a valid date in YYYY-MM-DD format",
    );
  }

  // ----------------------------------------------------
  // START TIME
  // ----------------------------------------------------

  if (startTime !== undefined && !isValidTime(startTime)) {
    return sendValidationError(
      res,
      "startTime",
      "Start time must use HH:mm format",
    );
  }

  // ----------------------------------------------------
  // END TIME
  // ----------------------------------------------------

  if (endTime !== undefined && !isValidTime(endTime)) {
    return sendValidationError(
      res,
      "endTime",
      "End time must use HH:mm format",
    );
  }

  // ----------------------------------------------------
  // DATE/TIME ORDER
  // ----------------------------------------------------

  /**
   * Validate the complete schedule when all four
   * values are available in the request.
   *
   * For partial PATCH requests, the controller
   * combines incoming fields with the existing
   * task's saved fields and validates the result.
   */
  if (
    dueDate !== undefined &&
    endDate !== undefined &&
    startTime !== undefined &&
    endTime !== undefined
  ) {
    const scheduleError = validateDateTimeOrder(res, {
      dueDate,
      endDate,
      startTime,
      endTime,
    });

    if (scheduleError) {
      return scheduleError;
    }
  }

  // ----------------------------------------------------
  // PRIORITY
  // ----------------------------------------------------

  if (priority !== undefined && !isValidPriority(priority)) {
    return sendValidationError(
      res,
      "priority",
      "Priority must be LOW, MEDIUM or HIGH",
    );
  }

  // ----------------------------------------------------
  // COMPLETION MODE
  // ----------------------------------------------------

  if (completionMode !== undefined && !isValidCompletionMode(completionMode)) {
    return sendValidationError(
      res,
      "completionMode",
      "Completion mode must be STRICT or FLEXIBLE",
    );
  }

  return next();
};
