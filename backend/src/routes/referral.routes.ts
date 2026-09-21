import { Router } from "express";
import { asyncHandler } from "../utils/http.js";
import { requireUser } from "../middleware/auth.middleware.js";
import {
  createPayoutMethod,
  createWithdrawal,
  listPayoutMethods,
  listWithdrawals,
  partnerStats,
} from "../controllers/referral.controller.js";

const router = Router();

router.get("/partner/stats", requireUser, asyncHandler(partnerStats));
router.get("/payout-methods", requireUser, asyncHandler(listPayoutMethods));
router.post("/payout-methods", requireUser, asyncHandler(createPayoutMethod));
router.get("/withdrawals", requireUser, asyncHandler(listWithdrawals));
router.post("/withdrawals", requireUser, asyncHandler(createWithdrawal));

export default router;
