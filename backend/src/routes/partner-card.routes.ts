import { Router } from "express";
import { asyncHandler } from "../utils/http.js";
import { requireCourseAccess, requireUser } from "../middleware/auth.middleware.js";
import {
  cancelPartnerCardRequest,
  confirmPartnerCardPayment,
  getMyPartnerCard,
  getPartnerCardForRender,
  payPartnerCardRequest,
  requestPartnerCard,
  requestPartnerCardReissue,
  updateMyPartnerCardPhoto,
  verifyPartnerCard,
} from "../controllers/partner-card.controller.js";

const router = Router();

// The card lives in the student dashboard, so requesting one needs the same purchase gate.
router.get("/partner-card", requireUser, asyncHandler(getMyPartnerCard));
router.post("/partner-card", requireCourseAccess, asyncHandler(requestPartnerCard));
router.put("/partner-card/photo", requireUser, asyncHandler(updateMyPartnerCardPhoto));
router.post("/partner-card/reissue", requireCourseAccess, asyncHandler(requestPartnerCardReissue));
router.post("/partner-card/requests/:requestId/pay", requireUser, asyncHandler(payPartnerCardRequest));
router.post("/partner-card/requests/:requestId/confirm", requireUser, asyncHandler(confirmPartnerCardPayment));
router.post("/partner-card/requests/:requestId/cancel", requireUser, asyncHandler(cancelPartnerCardRequest));
// Owner or admin — used by the frontend's PNG/PDF export route.
router.get("/partner-cards/:partnerId", requireUser, asyncHandler(getPartnerCardForRender));

// Public: what a QR scan / verification page shows.
router.get("/public/partner-cards/:partnerId", asyncHandler(verifyPartnerCard));

export default router;
