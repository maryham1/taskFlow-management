import express from "express";

import {
  registerPushToken,
  removePushToken,
} from "../controllers/pushTokenController.js";

import { authMiddleware } from "../middleware/authMiddleware.js";

const router = express.Router();

// ======================================================
// PROTECT ALL PUSH TOKEN ROUTES
// ======================================================

router.use(authMiddleware);

// ======================================================
// REGISTER DEVICE PUSH TOKEN
// POST /push-tokens
// ======================================================

router.post("/", registerPushToken);

// ======================================================
// REMOVE DEVICE PUSH TOKEN
// DELETE /push-tokens
// ======================================================

router.delete("/", removePushToken);

export default router;
