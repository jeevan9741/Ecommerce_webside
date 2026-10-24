import { Router } from "express";
import { asyncHandler } from "../utils/http.js";
import { requireUser } from "../middleware/auth.middleware.js";
import { forgotPassword, login, register, resetPassword, session } from "../controllers/auth.controller.js";

const router = Router();

router.post("/auth/login", asyncHandler(login));
router.post("/auth/forgot-password", asyncHandler(forgotPassword));
router.post("/auth/reset-password", asyncHandler(resetPassword));
router.get("/auth/session", requireUser, asyncHandler(session));
// Kept at its original path so existing clients keep working.
router.post("/register", asyncHandler(register));

export default router;
