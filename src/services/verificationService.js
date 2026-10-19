import bcrypt from "bcryptjs";

import { prisma } from "../config/db.js";

import { generateVerificationCode } from "../utils/generateVerificationCode.js";

// ======================================================
// CONSTANTS
// ======================================================

const CODE_EXPIRY_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_ATTEMPTS = 5;

const CODE_EXPIRY_MS = CODE_EXPIRY_MINUTES * 60 * 1000;
const RESEND_COOLDOWN_MS = RESEND_COOLDOWN_SECONDS * 1000;

const ALLOWED_TYPES = ["EMAIL_VERIFICATION", "PASSWORD_RESET", "EMAIL_CHANGE"];

// ======================================================
// HELPERS
// ======================================================

const validateVerificationType = (type) => {
  if (!ALLOWED_TYPES.includes(type)) {
    throw new Error("Invalid verification code type");
  }
};

const validateUserId = (userId) => {
  if (typeof userId !== "string" || !userId.trim()) {
    throw new Error("A valid user ID is required");
  }
};

const getLatestVerification = async (userId, type) => {
  return prisma.verificationCode.findFirst({
    where: {
      userId,
      type,
      used: false,
    },
    orderBy: {
      createdAt: "desc",
    },
  });
};

// ======================================================
// CREATE VERIFICATION CODE
// ======================================================

export const createVerificationCode = async ({
  userId,
  type,
  pendingEmail,
}) => {
  validateUserId(userId);
  validateVerificationType(type);

  if (
    type === "EMAIL_CHANGE" &&
    (typeof pendingEmail !== "string" || !pendingEmail.trim())
  ) {
    throw new Error("A new email address is required");
  }

  const latestVerification = await getLatestVerification(userId, type);

  if (latestVerification) {
    const elapsedTime =
      Date.now() - new Date(latestVerification.createdAt).getTime();

    if (elapsedTime < RESEND_COOLDOWN_MS) {
      const remainingSeconds = Math.ceil(
        (RESEND_COOLDOWN_MS - elapsedTime) / 1000,
      );

      const error = new Error(
        `Please wait ${remainingSeconds} seconds before requesting another code.`,
      );

      error.statusCode = 429;
      error.retryAfter = remainingSeconds;

      throw error;
    }
  }

  const code = generateVerificationCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + CODE_EXPIRY_MS);

  await prisma.verificationCode.deleteMany({
    where: {
      userId,
      type,
      used: false,
    },
  });

  await prisma.verificationCode.create({
    data: {
      userId,
      type,
      codeHash,
      expiresAt,
      used: false,
      pendingEmail:
        type === "EMAIL_CHANGE" ? pendingEmail.trim().toLowerCase() : null,
    },
  });

  return code;
};

// ======================================================
// VERIFY CODE
// ======================================================

export const verifyCode = async ({ userId, code, type }) => {
  validateUserId(userId);
  validateVerificationType(type);

  if (typeof code !== "string" || !/^\d{6}$/.test(code.trim())) {
    return false;
  }

  const verification = await prisma.verificationCode.findFirst({
    where: {
      userId,
      type,
      used: false,
      expiresAt: {
        gt: new Date(),
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (!verification) {
    return false;
  }

  if (verification.attempts >= MAX_ATTEMPTS) {
    return false;
  }

  const codeMatches = await bcrypt.compare(code.trim(), verification.codeHash);

  if (!codeMatches) {
    await prisma.verificationCode.updateMany({
      where: {
        id: verification.id,
        used: false,
      },
      data: {
        attempts: {
          increment: 1,
        },
      },
    });

    return false;
  }

  const result = await prisma.verificationCode.updateMany({
    where: {
      id: verification.id,
      used: false,
      expiresAt: {
        gt: new Date(),
      },
      attempts: {
        lt: MAX_ATTEMPTS,
      },
    },
    data: {
      used: true,
    },
  });

  return result.count === 1;
};
