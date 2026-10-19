import { prisma } from "../config/db.js";

import { isExpoPushToken } from "../services/pushNotificationService.js";

// ======================================================
// HELPERS
// ======================================================

const sendError = (res, statusCode, message) => {
  return res.status(statusCode).json({
    success: false,
    message,
  });
};

const normalizePushToken = (token) => {
  if (typeof token !== "string") {
    return null;
  }

  const normalizedToken = token.trim();

  if (!normalizedToken) {
    return null;
  }

  return normalizedToken;
};

// ======================================================
// REGISTER PUSH TOKEN
// ======================================================

export const registerPushToken = async (req, res, next) => {
  try {
    const normalizedToken = normalizePushToken(req.body?.token);

    if (!normalizedToken) {
      return sendError(res, 400, "Push token is required");
    }

    if (!isExpoPushToken(normalizedToken)) {
      return sendError(res, 400, "Please provide a valid Expo push token");
    }

    // Each Expo push token represents a device/app
    // installation and must have one current owner.
    //
    // If a different user logs in on the same device,
    // transfer the token to the authenticated user.
    const pushToken = await prisma.pushToken.upsert({
      where: {
        token: normalizedToken,
      },

      update: {
        userId: req.user.id,
      },

      create: {
        token: normalizedToken,
        userId: req.user.id,
      },
    });

    return res.status(200).json({
      success: true,

      message: "Push notification device registered successfully",

      data: {
        pushToken,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// REMOVE PUSH TOKEN
// ======================================================

export const removePushToken = async (req, res, next) => {
  try {
    const normalizedToken = normalizePushToken(req.body?.token);

    if (!normalizedToken) {
      return sendError(res, 400, "Push token is required");
    }

    if (!isExpoPushToken(normalizedToken)) {
      return sendError(res, 400, "Please provide a valid Expo push token");
    }

    // Only remove tokens owned by the authenticated
    // user. This prevents deleting another user's
    // registered device.
    const result = await prisma.pushToken.deleteMany({
      where: {
        token: normalizedToken,
        userId: req.user.id,
      },
    });

    return res.status(200).json({
      success: true,

      message: "Push notification device removed successfully",

      data: {
        removed: result.count > 0,
      },
    });
  } catch (error) {
    next(error);
  }
};
