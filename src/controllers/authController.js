import bcrypt from "bcryptjs";

import { prisma } from "../config/db.js";

import {
  sendFirstLoginEmail,
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
  sendRegistrationEmail,
} from "../services/emailService.js";

import {
  createVerificationCode,
  verifyCode,
} from "../services/verificationService.js";

import { generateToken } from "../utils/generateToken.js";

// ======================================================
// CONSTANTS
// ======================================================

const EMAIL_VERIFICATION = "EMAIL_VERIFICATION";
const PASSWORD_RESET = "PASSWORD_RESET";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const RESET_MESSAGE =
  "If an account exists with this email, a password reset code has been sent.";

const INVALID_RESET_CODE_MESSAGE = "Invalid or expired reset code";

// ======================================================
// HELPERS
// ======================================================

const normalizeEmail = (email) => {
  return email.trim().toLowerCase();
};

const isValidEmail = (email) => {
  return typeof email === "string" && EMAIL_REGEX.test(email.trim());
};

const publicUser = (user) => {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    emailVerified: user.emailVerified,
    termsAcceptedAt: user.termsAcceptedAt,
    createdAt: user.createdAt,
    preference: user.preference,
  };
};

const sendEmailSafely = async (sendEmail, context) => {
  try {
    await sendEmail();
    return true;
  } catch (error) {
    console.error(`${context}:`, error);
    return false;
  }
};

// ======================================================
// REGISTER
// POST /auth/register
// ======================================================

export const register = async (req, res, next) => {
  try {
    const { fullName, email, password, confirmPassword, agreeToTerms } =
      req.body ?? {};

    if (
      typeof fullName !== "string" ||
      fullName.trim().length < 2 ||
      !isValidEmail(email) ||
      typeof password !== "string" ||
      password.length < 8 ||
      password !== confirmPassword ||
      agreeToTerms !== true
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid registration details or Terms and Conditions not accepted",
      });
    }

    const normalizedEmail = normalizeEmail(email);

    const existingUser = await prisma.user.findUnique({
      where: {
        email: normalizedEmail,
      },
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "Email is already registered",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        fullName: fullName.trim(),
        email: normalizedEmail,
        password: hashedPassword,
        termsAcceptedAt: new Date(),

        preference: {
          create: {
            pushNotifications: true,
            alarmReminders: true,
            dailyReminderEnabled: true,
            dailyReminderTime: "08:00",
            timezone: "UTC",
            completionMode: "STRICT",
          },
        },
      },

      include: {
        preference: true,
      },
    });

    const verificationCode = await createVerificationCode({
      userId: user.id,
      type: EMAIL_VERIFICATION,
    });

    const emailSent = await sendEmailSafely(
      () =>
        sendRegistrationEmail({
          email: user.email,
          fullName: user.fullName,
          verificationCode,
        }),
      `Registration email failed for user ${user.id}`,
    );

    return res.status(201).json({
      success: true,

      message: emailSent
        ? "Account created successfully. Please check your email for your verification code."
        : "Account created successfully, but we could not send your verification email. Please request a new code.",

      data: {
        user: publicUser(user),
        verificationEmailSent: emailSent,
      },
    });
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({
        success: false,
        message: "Email is already registered",
      });
    }

    next(error);
  }
};

// ======================================================
// VERIFY EMAIL
// POST /auth/verify-email
// ======================================================

export const verifyEmail = async (req, res, next) => {
  try {
    const { email, code } = req.body ?? {};

    if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
      return res.status(400).json({
        success: false,
        message: "Valid email and six-digit code are required",
      });
    }

    const user = await prisma.user.findUnique({
      where: {
        email: normalizeEmail(email),
      },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired verification code",
      });
    }

    if (user.emailVerified) {
      return res.status(400).json({
        success: false,
        message: "Email is already verified",
      });
    }

    const isValidCode = await verifyCode({
      userId: user.id,
      code: code.trim(),
      type: EMAIL_VERIFICATION,
    });

    if (!isValidCode) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired verification code",
      });
    }

    await prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        emailVerified: true,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Email verified successfully",
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// RESEND VERIFICATION CODE
// POST /auth/resend-verification
// ======================================================

export const resendVerification = async (req, res, next) => {
  try {
    const { email } = req.body ?? {};

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: "Valid email is required",
      });
    }

    const user = await prisma.user.findUnique({
      where: {
        email: normalizeEmail(email),
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (user.emailVerified) {
      return res.status(400).json({
        success: false,
        message: "Email is already verified",
      });
    }

    const verificationCode = await createVerificationCode({
      userId: user.id,
      type: EMAIL_VERIFICATION,
    });

    const emailSent = await sendEmailSafely(
      () =>
        sendRegistrationEmail({
          email: user.email,
          fullName: user.fullName,
          verificationCode,
        }),
      `Verification email resend failed for user ${user.id}`,
    );

    if (!emailSent) {
      return res.status(503).json({
        success: false,
        message:
          "Unable to send verification email right now. Please try again later.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "A new verification code has been sent to your email",
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// LOGIN
// POST /auth/login
// ======================================================

export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};

    if (!isValidEmail(email) || typeof password !== "string" || !password) {
      return res.status(400).json({
        success: false,
        message: "Valid email and password are required",
      });
    }

    const user = await prisma.user.findUnique({
      where: {
        email: normalizeEmail(email),
      },

      include: {
        preference: true,
      },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const passwordMatches = await bcrypt.compare(password, user.password);

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    if (!user.emailVerified) {
      return res.status(403).json({
        success: false,
        message: "Please verify your email before logging in",
      });
    }

    const token = generateToken(user.id);

    // The current Prisma User model does not contain a
    // firstLoginCompleted field.
    //
    // A first-login welcome email must only be triggered
    // after a persistent first-login marker is introduced.
    // Calling it on every login would send duplicate emails.

    return res.status(200).json({
      success: true,
      message: "Login successful",

      data: {
        user: publicUser(user),
        token,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// GET CURRENT USER
// GET /auth/me
// ======================================================

export const getCurrentUser = async (req, res, next) => {
  try {
    return res.status(200).json({
      success: true,

      data: {
        user: req.user,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// UPDATE PROFILE
// PATCH /auth/me
// ======================================================

export const updateProfile = async (req, res, next) => {
  try {
    const { fullName, email } = req.body ?? {};

    // --------------------------------------------------
    // VALIDATE FULL NAME
    // --------------------------------------------------

    if (typeof fullName !== "string" || fullName.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: "Full name must contain at least 2 characters",
      });
    }

    if (fullName.trim().length > 100) {
      return res.status(400).json({
        success: false,
        message: "Full name cannot exceed 100 characters",
      });
    }

    // --------------------------------------------------
    // PREVENT UNSUPPORTED PROFILE UPDATES
    // --------------------------------------------------

    if (email !== undefined) {
      return res.status(400).json({
        success: false,
        message: "Email changes are not supported yet",
      });
    }

    const invalidFields = Object.keys(req.body ?? {}).filter(
      (field) => field !== "fullName",
    );

    if (invalidFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Only your full name can be updated at this time",
      });
    }

    // --------------------------------------------------
    // UPDATE AUTHENTICATED USER
    // --------------------------------------------------

    const updatedUser = await prisma.user.update({
      where: {
        id: req.user.id,
      },

      data: {
        fullName: fullName.trim(),
      },

      include: {
        preference: true,
      },
    });

    // --------------------------------------------------
    // RETURN UPDATED PROFILE
    // --------------------------------------------------

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",

      data: {
        user: publicUser(updatedUser),
      },
    });
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    next(error);
  }
};

// ======================================================
// FORGOT PASSWORD
// POST /auth/forgot-password
// ======================================================

export const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body ?? {};

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: "Valid email is required",
      });
    }

    const user = await prisma.user.findUnique({
      where: {
        email: normalizeEmail(email),
      },
    });

    if (user) {
      const resetCode = await createVerificationCode({
        userId: user.id,
        type: PASSWORD_RESET,
      });

      await sendEmailSafely(
        () =>
          sendPasswordResetEmail({
            email: user.email,
            fullName: user.fullName,
            resetCode,
          }),
        `Password reset email failed for user ${user.id}`,
      );
    }

    return res.status(200).json({
      success: true,
      message: RESET_MESSAGE,
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// VERIFY PASSWORD RESET CODE
// POST /auth/verify-reset-code
// ======================================================

export const verifyResetCode = async (req, res, next) => {
  try {
    const { email, code } = req.body ?? {};

    if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
      return res.status(400).json({
        success: false,
        message: INVALID_RESET_CODE_MESSAGE,
      });
    }

    const user = await prisma.user.findUnique({
      where: {
        email: normalizeEmail(email),
      },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: INVALID_RESET_CODE_MESSAGE,
      });
    }

    const resetCode = await prisma.verificationCode.findFirst({
      where: {
        userId: user.id,
        type: PASSWORD_RESET,
        used: false,

        expiresAt: {
          gt: new Date(),
        },
      },

      orderBy: {
        createdAt: "desc",
      },
    });

    if (!resetCode) {
      return res.status(400).json({
        success: false,
        message: INVALID_RESET_CODE_MESSAGE,
      });
    }

    const codeMatches = await bcrypt.compare(code.trim(), resetCode.codeHash);

    if (!codeMatches) {
      return res.status(400).json({
        success: false,
        message: INVALID_RESET_CODE_MESSAGE,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Reset code verified successfully",
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// RESET PASSWORD
// POST /auth/reset-password
// ======================================================

export const resetPassword = async (req, res, next) => {
  try {
    const { email, code, newPassword, confirmPassword } = req.body ?? {};

    if (
      !isValidEmail(email) ||
      typeof code !== "string" ||
      !/^\d{6}$/.test(code.trim()) ||
      typeof newPassword !== "string" ||
      newPassword.length < 8 ||
      newPassword !== confirmPassword
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid password reset details",
      });
    }

    const user = await prisma.user.findUnique({
      where: {
        email: normalizeEmail(email),
      },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: INVALID_RESET_CODE_MESSAGE,
      });
    }

    // Verify the password reset code before updating the password.

    const isValidCode = await verifyCode({
      userId: user.id,
      code: code.trim(),
      type: PASSWORD_RESET,
    });

    if (!isValidCode) {
      return res.status(400).json({
        success: false,
        message: INVALID_RESET_CODE_MESSAGE,
      });
    }

    // Password reuse is allowed in the Forgot Password flow.
    // The previous password is not compared with the new password.

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await prisma.user.update({
      where: {
        id: user.id,
      },

      data: {
        password: hashedPassword,
      },
    });

    await sendEmailSafely(
      () =>
        sendPasswordChangedEmail({
          email: user.email,
          fullName: user.fullName,
        }),
      `Password reset confirmation email failed for user ${user.id}`,
    );

    return res.status(200).json({
      success: true,
      message:
        "Password reset successfully. You can now sign in with your password.",
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// CHANGE PASSWORD
// PATCH /auth/change-password
// ======================================================

export const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body ?? {};

    if (
      typeof currentPassword !== "string" ||
      !currentPassword ||
      typeof newPassword !== "string" ||
      newPassword.length < 8
    ) {
      return res.status(400).json({
        success: false,
        message: "Valid current and new passwords are required",
      });
    }

    const user = await prisma.user.findUnique({
      where: {
        id: req.user.id,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const currentPasswordMatches = await bcrypt.compare(
      currentPassword,
      user.password,
    );

    if (!currentPasswordMatches) {
      return res.status(400).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    const isSamePassword = await bcrypt.compare(newPassword, user.password);

    if (isSamePassword) {
      return res.status(400).json({
        success: false,
        message: "New password must be different from your current password",
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await prisma.user.update({
      where: {
        id: user.id,
      },

      data: {
        password: hashedPassword,
      },
    });

    await sendEmailSafely(
      () =>
        sendPasswordChangedEmail({
          email: user.email,
          fullName: user.fullName,
        }),
      `Password change email failed for user ${user.id}`,
    );

    return res.status(200).json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// LOGOUT
// POST /auth/logout
// ======================================================

export const logout = async (req, res, next) => {
  try {
    return res.status(200).json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// REQUEST EMAIL CHANGE
// POST /auth/change-email/request
// ======================================================

export const requestEmailChange = async (req, res, next) => {
  try {
    const { newEmail, currentPassword } = req.body ?? {};

    const normalizedEmail = normalizeEmail(newEmail);

    const user = await prisma.user.findUnique({
      where: {
        id: req.user.id,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const passwordMatches = await bcrypt.compare(
      currentPassword,
      user.password,
    );

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    if (normalizedEmail === user.email.toLowerCase()) {
      return res.status(400).json({
        success: false,
        message: "Your new email must be different from your current email",
      });
    }

    const existingUser = await prisma.user.findUnique({
      where: {
        email: normalizedEmail,
      },
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "This email address is already registered",
      });
    }

    const verificationCode = await createVerificationCode({
      userId: user.id,
      type: "EMAIL_CHANGE",
      pendingEmail: normalizedEmail,
    });

    // Reuse your existing email delivery configuration.
    // Add the dedicated template in emailService.js.
    const { sendEmailChangeVerificationEmail } =
      await import("../services/emailService.js");

    const emailSent = await sendEmailSafely(
      () =>
        sendEmailChangeVerificationEmail({
          email: normalizedEmail,
          fullName: user.fullName,
          verificationCode,
        }),
      `Email change verification failed for user ${user.id}`,
    );

    if (!emailSent) {
      return res.status(503).json({
        success: false,
        message: "Unable to send verification code. Please try again.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Verification code sent to your new email address",
      data: {
        newEmail: normalizedEmail,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// VERIFY EMAIL CHANGE
// POST /auth/change-email/verify
// ======================================================

export const verifyEmailChange = async (req, res, next) => {
  try {
    const { code } = req.body ?? {};

    const verification = await prisma.verificationCode.findFirst({
      where: {
        userId: req.user.id,
        type: "EMAIL_CHANGE",
        used: false,
        expiresAt: {
          gt: new Date(),
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!verification?.pendingEmail) {
      return res.status(400).json({
        success: false,
        message: "No pending email change request found",
      });
    }

    const pendingEmail = verification.pendingEmail;

    const isValidCode = await verifyCode({
      userId: req.user.id,
      code,
      type: "EMAIL_CHANGE",
    });

    if (!isValidCode) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired verification code",
      });
    }

    const updatedUser = await prisma.user.update({
      where: {
        id: req.user.id,
      },
      data: {
        email: pendingEmail,
        emailVerified: true,
      },
      include: {
        preference: true,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Email address updated successfully",
      data: {
        user: publicUser(updatedUser),
      },
    });
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({
        success: false,
        message: "This email address is already registered",
      });
    }

    next(error);
  }
};
