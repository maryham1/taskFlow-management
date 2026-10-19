import express from "express";

import {
  changePassword,
  forgotPassword,
  getCurrentUser,
  updateProfile,
  login,
  logout,
  register,
  resendVerification,
  resetPassword,
  verifyEmail,
  verifyResetCode,
  requestEmailChange,
  verifyEmailChange,
} from "../controllers/authController.js";

import {
  registerDevice,
  checkDevice,
  revokeDevice,
} from "../controllers/deviceRecognitionController.js";

import { authMiddleware } from "../middleware/authMiddleware.js";

import {
  validateChangePassword,
  validateForgotPassword,
  validateLogin,
  validateRegister,
  validateResetCode,
  validateResetPassword,
  validateUpdateProfile,
  validateVerifyEmail,
  validateRequestEmailChange,
  validateVerifyEmailChange,
} from "../validators/authValidator.js";

const router = express.Router();

// ======================================================
// REGISTRATION
// ======================================================

// Register a new account.
router.post("/register", validateRegister, register);

// Verify registration email.
router.post("/verify-email", validateVerifyEmail, verifyEmail);

// Resend email verification code.
router.post("/resend-verification", resendVerification);

// ======================================================
// LOGIN AND LOGOUT
// ======================================================

// Log in.
router.post("/login", validateLogin, login);

// Log out.
router.post("/logout", authMiddleware, logout);

// ======================================================
// CURRENT USER / EDIT PROFILE
// ======================================================

// Get authenticated user's details.
router.get("/me", authMiddleware, getCurrentUser);

// Update authenticated user's full name.
router.patch("/me", authMiddleware, validateUpdateProfile, updateProfile);

// ======================================================
// EMAIL CHANGE
// ======================================================

// Request a verification code for a new email address.
router.post(
  "/change-email/request",
  authMiddleware,
  validateRequestEmailChange,
  requestEmailChange,
);

// Verify the code and update the user's email.
router.post(
  "/change-email/verify",
  authMiddleware,
  validateVerifyEmailChange,
  verifyEmailChange,
);

// ======================================================
// PASSWORD MANAGEMENT
// ======================================================

// Request a password reset code.
router.post("/forgot-password", validateForgotPassword, forgotPassword);

// Verify password reset code.
router.post("/verify-reset-code", validateResetCode, verifyResetCode);

// Reset password.
router.post("/reset-password", validateResetPassword, resetPassword);

// Change password while authenticated.
router.patch(
  "/change-password",
  authMiddleware,
  validateChangePassword,
  changePassword,
);

// ======================================================
// DEVICE RECOGNITION
// ======================================================

// Register this device after successful login.
router.post("/device/register", authMiddleware, registerDevice);

// Check whether a recognized device still belongs
// to an existing account in PostgreSQL.
router.post("/device/check", checkDevice);

// Revoke device recognition for the current user.
router.post("/device/revoke", authMiddleware, revokeDevice);

export default router;
