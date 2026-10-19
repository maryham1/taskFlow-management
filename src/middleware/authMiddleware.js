import jwt from "jsonwebtoken";

import { prisma } from "../config/db.js";

// ======================================================
// AUTHENTICATION ERROR RESPONSE
// ======================================================

const sendAuthError = (res, statusCode, message) => {
  return res.status(statusCode).json({
    success: false,
    message,
  });
};

// ======================================================
// EXTRACT BEARER TOKEN
// ======================================================

const extractBearerToken = (authorization) => {
  if (typeof authorization !== "string") {
    return null;
  }

  const match = /^Bearer ([^\s]+)$/i.exec(authorization.trim());

  if (!match) {
    return null;
  }

  return match[1];
};

// ======================================================
// AUTHENTICATION MIDDLEWARE
// ======================================================

export const authMiddleware = async (req, res, next) => {
  try {
    // --------------------------------------------------
    // 1. EXTRACT ACCESS TOKEN
    // --------------------------------------------------

    const token = extractBearerToken(req.headers.authorization);

    if (!token) {
      return sendAuthError(res, 401, "Authentication required");
    }

    // --------------------------------------------------
    // 2. VERIFY SERVER CONFIGURATION
    // --------------------------------------------------

    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      throw new Error("JWT_SECRET is not configured");
    }

    // --------------------------------------------------
    // 3. VERIFY JWT
    // --------------------------------------------------

    const decoded = jwt.verify(token, jwtSecret, {
      algorithms: ["HS256"],
    });

    if (
      !decoded ||
      typeof decoded !== "object" ||
      Array.isArray(decoded) ||
      typeof decoded.id !== "string" ||
      !decoded.id.trim()
    ) {
      return sendAuthError(res, 401, "Invalid authentication token");
    }

    // --------------------------------------------------
    // 4. FIND AUTHENTICATED USER
    // --------------------------------------------------

    const user = await prisma.user.findUnique({
      where: {
        id: decoded.id,
      },

      select: {
        id: true,
        fullName: true,
        email: true,
        emailVerified: true,
        termsAcceptedAt: true,
        createdAt: true,
        updatedAt: true,
        preference: true,
      },
    });

    if (!user) {
      return sendAuthError(res, 404, "User no longer exists");
    }

    // --------------------------------------------------
    // 5. REQUIRE EMAIL VERIFICATION
    // --------------------------------------------------

    if (!user.emailVerified) {
      return sendAuthError(res, 403, "Please verify your email");
    }

    // --------------------------------------------------
    // 6. ATTACH USER TO REQUEST
    // --------------------------------------------------

    req.user = user;

    // --------------------------------------------------
    // 7. CONTINUE TO PROTECTED ROUTE
    // --------------------------------------------------

    return next();
  } catch (error) {
    // --------------------------------------------------
    // EXPIRED JWT
    // --------------------------------------------------

    if (error instanceof jwt.TokenExpiredError) {
      return sendAuthError(res, 401, "Authentication token has expired");
    }

    // --------------------------------------------------
    // INVALID JWT
    // --------------------------------------------------

    if (error instanceof jwt.JsonWebTokenError) {
      return sendAuthError(res, 401, "Invalid authentication token");
    }

    // --------------------------------------------------
    // UNEXPECTED SERVER ERROR
    // --------------------------------------------------

    return next(error);
  }
};
