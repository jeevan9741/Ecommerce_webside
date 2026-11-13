import { Router } from "express";
import { asyncHandler } from "../utils/http.js";
import { requireUser } from "../middleware/auth.middleware.js";
import { forgotPassword, login, register, resetPassword, session } from "../controllers/auth.controller.js";
import * as mfa from "../controllers/admin-mfa.controller.js";

const router = Router();

router.post("/auth/login", asyncHandler(login));
router.post("/auth/forgot-password", asyncHandler(forgotPassword));
router.post("/auth/reset-password", asyncHandler(resetPassword));
router.get("/auth/session", requireUser, asyncHandler(session));
// Admin two-step verification: the sign-in second step, and an admin's own enrolment (the service checks
// the ADMIN role in the database; enrolment needs the password again).
router.post("/auth/mfa/verify", asyncHandler(mfa.postVerify));
router.get("/auth/mfa/status", requireUser, asyncHandler(mfa.getStatus));
router.post("/auth/mfa/enroll/start", requireUser, asyncHandler(mfa.postEnrollStart));
router.post("/auth/mfa/enroll/confirm", requireUser, asyncHandler(mfa.postEnrollConfirm));
// Kept at its original path so existing clients keep working.
router.post("/register", asyncHandler(register));

export default router;
