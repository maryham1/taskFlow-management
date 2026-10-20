import express from "express";

import authRoutes from "./routes/authRoutes.js";
import taskRoutes from "./routes/taskRoutes.js";
import pushTokenRoutes from "./routes/pushTokenRoutes.js";
import preferenceRoutes from "./routes/preferenceRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";

import {
  notFoundMiddleware,
  errorMiddleware,
} from "./middleware/errorMiddleware.js";

const app = express();

// ======================================================
// GLOBAL MIDDLEWARE
// ======================================================

// Parse JSON requests and limit request body size.
app.use(
  express.json({
    limit: "1mb",
  }),
);

// ======================================================
// HEALTH CHECK
// ======================================================

app.get("/api/health", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "TaskFlow API is running",
    timestamp: new Date().toISOString(),
  });
});

// ======================================================
// AUTHENTICATION ROUTES
// ======================================================

app.use("/auth", authRoutes);

// ======================================================
// TASK ROUTES
// ======================================================

app.use("/tasks", taskRoutes);

// ======================================================
// PUSH NOTIFICATION DEVICE ROUTES
// ======================================================

app.use("/push-tokens", pushTokenRoutes);

// ======================================================
// USER PREFERENCE ROUTES
// ======================================================

app.use("/preferences", preferenceRoutes);

// ======================================================
// IN-APP NOTIFICATION ROUTES
// ======================================================

app.use("/notifications", notificationRoutes);

// ======================================================
// UNKNOWN ROUTES
// ======================================================

app.use(notFoundMiddleware);

// ======================================================
// GLOBAL ERROR HANDLER
// Must remain after all routes.
// ======================================================

app.use(errorMiddleware);

export default app;


//fix email to sendgrid