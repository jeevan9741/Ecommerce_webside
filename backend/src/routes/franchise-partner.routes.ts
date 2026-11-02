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

export default router;
