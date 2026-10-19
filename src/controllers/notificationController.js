import { prisma } from "../config/db.js";

import { getOwnedNotification } from "../services/notificationService.js";

// ======================================================
// CONSTANTS
// ======================================================

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const TASK_SELECT = {
  id: true,
  title: true,
  dueDate: true,
  startTime: true,
  endTime: true,
  priority: true,
  status: true,
};

// ======================================================
// RESPONSE HELPERS
// ======================================================

const sendError = (res, statusCode, message) => {
  return res.status(statusCode).json({
    success: false,
    message,
  });
};

// ======================================================
// QUERY VALIDATION
// ======================================================

const parsePositiveInteger = (value, defaultValue, fieldName) => {
  if (value === undefined) {
    return defaultValue;
  }

  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`${fieldName} must be a positive integer`);
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${fieldName} is too large`);
  }

  return parsed;
};

const buildNotificationFilter = (userId, query) => {
  const where = {
    userId,
  };

  if (query.read !== undefined) {
    if (query.read !== "true" && query.read !== "false") {
      throw new Error("read must be true or false");
    }

    where.read = query.read === "true";
  }

  if (query.type !== undefined) {
    if (typeof query.type !== "string" || !query.type.trim()) {
      throw new Error("Invalid notification type");
    }

    where.type = query.type.trim();
  }

  return where;
};

// ======================================================
// GET ALL NOTIFICATIONS
// GET /notifications
// ======================================================

export const getNotifications = async (req, res, next) => {
  try {
    let page;
    let limit;
    let where;

    try {
      page = parsePositiveInteger(req.query.page, DEFAULT_PAGE, "page");

      limit = Math.min(
        parsePositiveInteger(req.query.limit, DEFAULT_LIMIT, "limit"),
        MAX_LIMIT,
      );

      where = buildNotificationFilter(req.user.id, req.query);
    } catch (error) {
      return sendError(res, 400, error.message);
    }

    const skip = (page - 1) * limit;

    if (!Number.isSafeInteger(skip)) {
      return sendError(res, 400, "Requested page is too large");
    }

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,

        include: {
          task: {
            select: TASK_SELECT,
          },
        },

        orderBy: [
          {
            createdAt: "desc",
          },
          {
            id: "desc",
          },
        ],

        skip,
        take: limit,
      }),

      prisma.notification.count({
        where,
      }),

      prisma.notification.count({
        where: {
          userId: req.user.id,
          read: false,
        },
      }),
    ]);

    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    return res.status(200).json({
      success: true,

      data: {
        notifications,
        unreadCount,

        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// GET UNREAD NOTIFICATION COUNT
// GET /notifications/unread-count
// ======================================================

export const getUnreadNotificationCount = async (req, res, next) => {
  try {
    const unreadCount = await prisma.notification.count({
      where: {
        userId: req.user.id,
        read: false,
      },
    });

    return res.status(200).json({
      success: true,

      data: {
        unreadCount,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// GET SINGLE NOTIFICATION
// GET /notifications/:id
// ======================================================

export const getNotification = async (req, res, next) => {
  try {
    const notification = await getOwnedNotification({
      notificationId: req.params.id,
      userId: req.user.id,
    });

    if (!notification) {
      return sendError(res, 404, "Notification not found");
    }

    return res.status(200).json({
      success: true,

      data: {
        notification,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// MARK ONE NOTIFICATION AS READ
// PATCH /notifications/:id/read
// ======================================================

export const markNotificationAsRead = async (req, res, next) => {
  try {
    // Update only a notification belonging
    // to the authenticated user.
    const result = await prisma.notification.updateMany({
      where: {
        id: req.params.id,
        userId: req.user.id,
        read: false,
      },

      data: {
        read: true,
      },
    });

    const notification = await getOwnedNotification({
      notificationId: req.params.id,
      userId: req.user.id,
    });

    if (!notification) {
      return sendError(res, 404, "Notification not found");
    }

    return res.status(200).json({
      success: true,

      message:
        result.count === 0
          ? "Notification is already marked as read"
          : "Notification marked as read",

      data: {
        notification,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// MARK ALL NOTIFICATIONS AS READ
// PATCH /notifications/read-all
// ======================================================

export const markAllNotificationsAsRead = async (req, res, next) => {
  try {
    const result = await prisma.notification.updateMany({
      where: {
        userId: req.user.id,
        read: false,
      },

      data: {
        read: true,
      },
    });

    return res.status(200).json({
      success: true,
      message: "All notifications marked as read",

      data: {
        updatedCount: result.count,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// DELETE SINGLE NOTIFICATION
// DELETE /notifications/:id
// ======================================================

export const deleteNotification = async (req, res, next) => {
  try {
    const result = await prisma.notification.deleteMany({
      where: {
        id: req.params.id,
        userId: req.user.id,
      },
    });

    if (result.count === 0) {
      return sendError(res, 404, "Notification not found");
    }

    return res.status(200).json({
      success: true,
      message: "Notification deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// CLEAR ALL NOTIFICATIONS
// DELETE /notifications
// ======================================================

export const clearNotifications = async (req, res, next) => {
  try {
    const result = await prisma.notification.deleteMany({
      where: {
        userId: req.user.id,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Notifications cleared successfully",

      data: {
        deletedCount: result.count,
      },
    });
  } catch (error) {
    next(error);
  }
};
