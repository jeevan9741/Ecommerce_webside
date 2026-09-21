import { Router } from "express";
import { asyncHandler } from "../utils/http.js";
import { sendOtp, verifiedStatus, verifyOtp } from "../controllers/email.controller.js";

const router = Router();

router.post("/email/send-otp", asyncHandler(sendOtp));
router.post("/email/verify-otp", asyncHandler(verifyOtp));
router.get("/email/verified-status", asyncHandler(verifiedStatus));

export default router;
