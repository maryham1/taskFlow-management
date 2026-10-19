import express from "express";

import {
  createTask,
  deleteTask,
  getTask,
  getTasks,
  updateTask,
  updateTaskStatus,
} from "../controllers/taskController.js";

import { authMiddleware } from "../middleware/authMiddleware.js";

import {
  validateCreateTask,
  validateUpdateTask,
} from "../validators/taskValidator.js";

const router = express.Router();

router.use(authMiddleware);

router.post("/", validateCreateTask, createTask);

router.get("/", getTasks);

router.get("/:id", getTask);

router.patch("/:id", validateUpdateTask, updateTask);

router.patch("/:id/status", updateTaskStatus);

router.delete("/:id", deleteTask);

export default router;
