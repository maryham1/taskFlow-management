import express from "express";

import {
  clearNotifications,
  deleteNotification,
  getNotification,
  getNotifications,
  getUnreadNotificationCount,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from "../controllers/notificationController.js";

import { authMiddleware } from "../middleware/authMiddleware.js";

import { validateNotificationQuery } from "../validators/notificationValidator.js";

const router = express.Router();

// ======================================================
// PROTECT ALL NOTIFICATION ROUTES
// ======================================================

router.use(authMiddleware);

// ======================================================
// GET NOTIFICATION HISTORY
// GET /notifications
// ======================================================

router.get("/", validateNotificationQuery, getNotifications);

// ======================================================
// GET UNREAD NOTIFICATION COUNT
// GET /notifications/unread-count
// ======================================================

router.get("/unread-count", getUnreadNotificationCount);

// ======================================================
// MARK ALL NOTIFICATIONS AS READ
// PATCH /notifications/read-all
// ======================================================

router.patch("/read-all", markAllNotificationsAsRead);

// ======================================================
// CLEAR ALL NOTIFICATIONS
// DELETE /notifications
// ======================================================

router.delete("/", clearNotifications);

// ======================================================
// GET SINGLE NOTIFICATION
// GET /notifications/:id
// ======================================================

router.get("/:id", getNotification);

// ======================================================
// MARK SINGLE NOTIFICATION AS READ
// PATCH /notifications/:id/read
// ======================================================

router.patch("/:id/read", markNotificationAsRead);

// ======================================================
// DELETE SINGLE NOTIFICATION
// DELETE /notifications/:id
// ======================================================

router.delete("/:id", deleteNotification);

export default router;
