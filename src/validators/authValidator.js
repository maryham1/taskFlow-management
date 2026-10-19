const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const error = (res, message) =>
  res.status(400).json({
    success: false,
    message,
  });

const validEmail = (email) =>
  typeof email === "string" && emailRegex.test(email.trim());

const validCode = (code) =>
  typeof code === "string" && /^\d{6}$/.test(code.trim());

// ======================================================
// REGISTER
// ======================================================

export const validateRegister = (req, res, next) => {
  const { fullName, email, password, confirmPassword, agreeToTerms } =
    req.body ?? {};

  if (
    typeof fullName !== "string" ||
    !fullName.trim() ||
    !validEmail(email) ||
    typeof password !== "string" ||
    !password ||
    typeof confirmPassword !== "string" ||
    !confirmPassword
  ) {
    return error(
      res,
      "Full name, valid email, password and confirmation are required",
    );
  }

  if (fullName.trim().length < 2) {
    return error(res, "Full name must be at least 2 characters");
  }

  if (password.length < 8) {
    return error(res, "Password must be at least 8 characters");
  }

  if (password !== confirmPassword) {
    return error(res, "Passwords do not match");
  }

  if (agreeToTerms !== true) {
    return error(res, "You must agree to the Terms and Conditions");
  }

  next();
};

// ======================================================
// VERIFY EMAIL
// ======================================================

export const validateVerifyEmail = (req, res, next) => {
  const { email, code } = req.body ?? {};

  if (!validEmail(email)) {
    return error(res, "Please provide a valid email address");
  }

  if (!validCode(code)) {
    return error(res, "Verification code must be 6 digits");
  }

  next();
};

// ======================================================
// LOGIN
// ======================================================

export const validateLogin = (req, res, next) => {
  const { email, password } = req.body ?? {};

  if (!validEmail(email) || typeof password !== "string" || !password) {
    return error(res, "Valid email and password are required");
  }

  next();
};

// ======================================================
// FORGOT PASSWORD
// ======================================================

export const validateForgotPassword = (req, res, next) => {
  if (!validEmail(req.body?.email)) {
    return error(res, "Please provide a valid email address");
  }

  next();
};

// ======================================================
// VERIFY RESET CODE
// ======================================================

export const validateResetCode = (req, res, next) => {
  if (!validEmail(req.body?.email)) {
    return error(res, "Please provide a valid email address");
  }

  if (!validCode(req.body?.code)) {
    return error(res, "Reset code must be 6 digits");
  }

  next();
};

// ======================================================
// RESET PASSWORD
// ======================================================

export const validateResetPassword = (req, res, next) => {
  const { email, code, newPassword, confirmPassword } = req.body ?? {};

  if (!validEmail(email)) {
    return error(res, "Please provide a valid email address");
  }

  if (!validCode(code)) {
    return error(res, "Reset code must be 6 digits");
  }

  if (typeof newPassword !== "string" || newPassword.length < 8) {
    return error(res, "New password must be at least 8 characters");
  }

  if (newPassword !== confirmPassword) {
    return error(res, "New password and confirmation do not match");
  }

  next();
};

// ======================================================
// CHANGE PASSWORD
// ======================================================

export const validateChangePassword = (req, res, next) => {
  const { currentPassword, newPassword, confirmPassword } = req.body ?? {};

  if (
    typeof currentPassword !== "string" ||
    !currentPassword ||
    typeof newPassword !== "string" ||
    typeof confirmPassword !== "string" ||
    !confirmPassword
  ) {
    return error(
      res,
      "Current password, new password and confirmation are required",
    );
  }

  if (newPassword.length < 8) {
    return error(res, "New password must be at least 8 characters");
  }

  if (newPassword !== confirmPassword) {
    return error(res, "New password and confirmation do not match");
  }

  if (currentPassword === newPassword) {
    return error(
      res,
      "New password must be different from your current password",
    );
  }

  next();
};

// ======================================================
// UPDATE PROFILE
// PATCH /auth/me
// ======================================================

export const validateUpdateProfile = (req, res, next) => {
  const { fullName, email } = req.body ?? {};

  if (typeof fullName !== "string" || fullName.trim().length < 2) {
    return error(res, "Full name must contain at least 2 characters");
  }

  if (fullName.trim().length > 100) {
    return error(res, "Full name cannot exceed 100 characters");
  }

  // Email editing requires a separate verification flow.
  // Reject email updates instead of silently ignoring them.
  if (email !== undefined) {
    return error(res, "Email changes are not supported yet");
  }

  // Only the full name can be updated.
  const allowedFields = ["fullName"];

  const invalidFields = Object.keys(req.body ?? {}).filter(
    (field) => !allowedFields.includes(field),
  );

  if (invalidFields.length > 0) {
    return error(res, "Only your full name can be updated at this time");
  }

  req.body.fullName = fullName.trim();

  next();
};

// ======================================================
// REQUEST EMAIL CHANGE
// ======================================================

export const validateRequestEmailChange = (req, res, next) => {
  const { newEmail, currentPassword } = req.body ?? {};

  if (!validEmail(newEmail)) {
    return error(res, "Please provide a valid new email address");
  }

  if (typeof currentPassword !== "string" || !currentPassword) {
    return error(res, "Your current password is required");
  }

  next();
};

// ======================================================
// VERIFY EMAIL CHANGE
// ======================================================

export const validateVerifyEmailChange = (req, res, next) => {
  const { code } = req.body ?? {};

  if (!validCode(code)) {
    return error(res, "Verification code must be 6 digits");
  }

  next();
};
