import { Router } from "express";
import { asyncHandler } from "../utils/http.js";
import { requireUser } from "../middleware/auth.middleware.js";
import { createOrder, orderStatus, syncOrder } from "../controllers/payment.controller.js";

// The Razorpay webhook is deliberately NOT here: it needs the raw request body for
// signature verification, so app.ts mounts it before the JSON body parser.

const router = Router();

router.post("/checkout/create-order", requireUser, asyncHandler(createOrder));
router.get("/orders/:id/status", requireUser, asyncHandler(orderStatus));
router.post("/orders/:id/sync", requireUser, asyncHandler(syncOrder));

export default router;
