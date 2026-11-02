import { Router } from "express";
import { asyncHandler } from "../utils/http.js";
import { requireUser } from "../middleware/auth.middleware.js";
import { partnerFeatureGate, requireFranchisePartner } from "../middleware/franchise-partner.middleware.js";
import * as partner from "../controllers/franchise-partner.controller.js";

const router = Router();

// The partner switch comes first: while it's off nothing below exists.
router.use("/franchise-partner", partnerFeatureGate);
router.get("/franchise-partner/access", requireUser, asyncHandler(partner.partnerAccess));
router.get("/franchise-partner/me", requireFranchisePartner, asyncHandler(partner.partnerMe));
router.get("/franchise-partner/invites", requireFranchisePartner, asyncHandler(partner.partnerListInvites));
router.post("/franchise-partner/invites", requireFranchisePartner, asyncHandler(partner.partnerCreateInvite));
router.post("/franchise-partner/invites/:id/resend", requireFranchisePartner, asyncHandler(partner.partnerResendInvite));
router.post("/franchise-partner/invites/:id/cancel", requireFranchisePartner, asyncHandler(partner.partnerCancelInvite));
router.get("/franchise-partner/students", requireFranchisePartner, asyncHandler(partner.partnerListStudents));
router.get("/franchise-partner/students/:id", requireFranchisePartner, asyncHandler(partner.partnerStudentDetail));

// A student opening an invitation sent to them: their own signed-in account, behind the same switch.
router.use("/franchise-invites", partnerFeatureGate);
router.get("/franchise-invites/:token", requireUser, asyncHandler(partner.studentPreviewInvite));
router.post("/franchise-invites/:token/accept", requireUser, asyncHandler(partner.studentAcceptInvite));

export default router;
