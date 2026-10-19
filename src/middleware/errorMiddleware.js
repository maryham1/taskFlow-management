import { Prisma } from "@prisma/client";

// ======================================================
// HANDLE UNKNOWN ROUTES
// ======================================================

export const notFoundMiddleware = (req, res) => {
  return res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.path} not found`,
  });
};

// ======================================================
// GLOBAL ERROR HANDLER
// ======================================================

export const errorMiddleware = (err, req, res, next) => {
  const isProduction = process.env.NODE_ENV === "production";

  console.error("API Error:", {
    method: req.method,
    path: req.originalUrl,
    message: err.message,
    ...(!isProduction && { stack: err.stack }),
  });

  // Invalid JSON request body
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({
      success: false,
      message: "Invalid JSON request body",
    });
  }

  // Prisma: Unique constraint violation
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    return res.status(409).json({
      success: false,
      message: "A record with these details already exists",
    });
  }

  // Prisma: Record not found
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2025"
  ) {
    return res.status(404).json({
      success: false,
      message: "Requested record not found",
    });
  }

  // Prisma: Foreign key constraint violation
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2003"
  ) {
    return res.status(400).json({
      success: false,
      message: "Invalid related record",
    });
  }

  // Prisma: Invalid query data
  if (err instanceof Prisma.PrismaClientValidationError) {
    return res.status(400).json({
      success: false,
      message: "Invalid request data",
    });
  }

  // Request body too large
  if (err.status === 413) {
    return res.status(413).json({
      success: false,
      message: "Request body is too large",
    });
  }

  // Explicit HTTP errors from middleware/controllers
  const statusCode =
    Number.isInteger(err.statusCode) &&
    err.statusCode >= 400 &&
    err.statusCode < 600
      ? err.statusCode
      : Number.isInteger(err.status) && err.status >= 400 && err.status < 600
        ? err.status
        : 500;

  return res.status(statusCode).json({
    success: false,
    message:
      statusCode === 500 && isProduction
        ? "An unexpected server error occurred"
        : err.message || "An unexpected server error occurred",
  });
};
