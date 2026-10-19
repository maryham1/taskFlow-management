import crypto from "node:crypto";
import { prisma } from "../config/db.js";

// ======================================================
// DEVICE RECOGNITION CONFIGURATION
// ======================================================

const DEVICE_TOKEN_EXPIRY_DAYS = 365;

const DEVICE_TOKEN_REGEX = /^[a-f0-9]{64}$/i;

// ======================================================
// HELPER FUNCTIONS
// ======================================================

// Generate a cryptographically secure device token.
const generateDeviceToken = () => {
  return crypto.randomBytes(32).toString("hex");
};

// Store only a hash of the device token in PostgreSQL.
const hashDeviceToken = (token) => {
  return crypto.createHash("sha256").update(token).digest("hex");
};

// Calculate the device recognition expiry date.
const getExpiryDate = () => {
  return new Date(Date.now() + DEVICE_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
};

// ======================================================
// REGISTER DEVICE
// POST /auth/device/register
// PROTECTED ROUTE
// ======================================================

export const registerDevice = async (req, res, next) => {
  try {
    // User is authenticated by authMiddleware.
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Generate a unique recognition token.
    const deviceToken = generateDeviceToken();

    // Hash token before saving it to PostgreSQL.
    const tokenHash = hashDeviceToken(deviceToken);

    // Save device recognition record.
    const device = await prisma.deviceRecognition.create({
      data: {
        userId,
        tokenHash,
        expiresAt: getExpiryDate(),
      },

      select: {
        id: true,
        expiresAt: true,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Device registered successfully",

      data: {
        deviceToken,
        expiresAt: device.expiresAt,
      },
    });
  } catch (error) {
    return next(error);
  }
};

// ======================================================
// CHECK DEVICE
// POST /auth/device/check
// PUBLIC ROUTE (REQUIRES DEVICE TOKEN)
// ======================================================

export const checkDevice = async (req, res, next) => {
  try {
    const { deviceToken } = req.body ?? {};

    // Validate incoming device token.
    if (
      typeof deviceToken !== "string" ||
      !DEVICE_TOKEN_REGEX.test(deviceToken)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid device recognition token",
      });
    }

    const tokenHash = hashDeviceToken(deviceToken);

    // Query PostgreSQL for the recognized device.
    const device = await prisma.deviceRecognition.findUnique({
      where: {
        tokenHash,
      },

      select: {
        id: true,
        expiresAt: true,

        user: {
          select: {
            id: true,
          },
        },
      },
    });

    // Device was not found.
    if (!device) {
      return res.status(200).json({
        success: true,
        message: "Device is not recognized",

        data: {
          recognized: false,
        },
      });
    }

    // Device recognition has expired.
    if (device.expiresAt <= new Date()) {
      await prisma.deviceRecognition.deleteMany({
        where: {
          tokenHash,
        },
      });

      return res.status(200).json({
        success: true,
        message: "Device recognition has expired",

        data: {
          recognized: false,
        },
      });
    }

    // Device record exists but associated user is missing.
    if (!device.user) {
      return res.status(200).json({
        success: true,
        message: "Associated account no longer exists",

        data: {
          recognized: false,
        },
      });
    }

    // Device and user both exist in PostgreSQL.
    return res.status(200).json({
      success: true,
      message: "Device recognized successfully",

      data: {
        recognized: true,
      },
    });
  } catch (error) {
    return next(error);
  }
};

// ======================================================
// REVOKE DEVICE
// POST /auth/device/revoke
// PROTECTED ROUTE
// ======================================================

export const revokeDevice = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const { deviceToken } = req.body ?? {};

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    if (
      typeof deviceToken !== "string" ||
      !DEVICE_TOKEN_REGEX.test(deviceToken)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid device recognition token",
      });
    }

    // Only revoke a device belonging to the logged-in user.
    await prisma.deviceRecognition.deleteMany({
      where: {
        userId,
        tokenHash: hashDeviceToken(deviceToken),
      },
    });

    return res.status(200).json({
      success: true,
      message: "Device recognition revoked successfully",
    });
  } catch (error) {
    return next(error);
  }
};
