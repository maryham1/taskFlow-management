import express from "express";

import {
  getPreferences,
  updatePreferences,
} from "../controllers/preferenceController.js";

import { authMiddleware } from "../middleware/authMiddleware.js";

import { validateUpdatePreferences } from "../validators/preferenceValidator.js";

const router = express.Router();

// ======================================================
// PROTECT ALL PREFERENCE ROUTES
// ======================================================

router.use(authMiddleware);

// ======================================================
// GET USER PREFERENCES
// GET /preferences
// ======================================================

router.get("/", getPreferences);

// ======================================================
// UPDATE USER PREFERENCES
// PATCH /preferences
// ======================================================

router.patch("/", validateUpdatePreferences, updatePreferences);

export default router;
