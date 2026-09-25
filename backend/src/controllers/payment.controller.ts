import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { createOrderSchema } from "../utils/validation.js";
import { getRazorpayClient, verifyWebhookSignature, RazorpayConfigError } from "../services/razorpay.service.js";
import { markOrderPaid, markOrderFailed, reverseOrder, reconcileOrderWithRazorpay } from "../services/order.service.js";
import { markRequestPaid, reconcileRequestPayment } from "../services/partner-card.service.js";
import { currentUser } from "../middleware/auth.middleware.js";
import { HttpError, param } from "../utils/http.js";

const LOG_PREFIX = "[create-order]";

class PaymentServiceError extends Error {}
class DatabaseError extends Error {}

function describeRazorpayError(err: unknown): string {
  if (err && typeof err === "object" && "error" in err) {
    const rzpErr = (err as { error?: { code?: string; description?: string } }).error;
    if (rzpErr?.description) return `Razorpay: ${rzpErr.code ?? "ERROR"} — ${rzpErr.description}`;
  }
  if (err instanceof Error) return err.message;
  return "Unknown Razorpay error";
}

export async function createOrder(req: Request, res: Response) {
  const reqId = Math.random().toString(36).slice(2, 8);
  const log = (msg: string, extra?: unknown) =>
    console.log(`${LOG_PREFIX}[${reqId}] ${msg}`, extra !== undefined ? extra : "");

  const user = currentUser(req);
  log("start", { userId: user.id });

  try {
    const parsed = createOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      log("validation error", parsed.error.flatten());
      return res
        .status(400)
        .json({ error: "Invalid request — please refresh the page and try again.", code: "VALIDATION_ERROR" });
    }
    const { courseId, selectedLanguage, referralCode } = parsed.data;
    log("validated body", { courseId, selectedLanguage, hasReferralCode: Boolean(referralCode) });

    const course = await prisma.course
      .findUnique({ where: { id: courseId }, include: { languageVideos: { include: { language: true } } } })
      .catch((err) => {
        log("database error looking up course", err instanceof Error ? err.message : err);
        throw new DatabaseError("Failed to look up the selected course");
      });

    if (!course || !course.isActive) {
      log("course not found or inactive", { courseId, found: Boolean(course) });
      return res.status(404).json({ error: "Invalid course selected — please pick a course again.", code: "INVALID_COURSE" });
    }
    log("course found", { courseId: course.id, title: course.title, priceInPaise: course.priceInPaise });

    if (course.languageVideos.length > 0) {
      const validCodes = course.languageVideos.map((lv) => lv.language.code);
      if (!selectedLanguage || !validCodes.includes(selectedLanguage)) {
        log("invalid or missing language", { selectedLanguage, validCodes });
        return res.status(400).json({ error: "Please select a valid language for this course.", code: "INVALID_LANGUAGE" });
      }
    }

    const existingAccess = await prisma.courseAccess.findUnique({
      where: { userId_courseId: { userId: user.id, courseId } },
    });
    if (existingAccess && !existingAccess.revokedAt) {
      log("user already has access", { userId: user.id, courseId });
      return res.status(409).json({ error: "You already have access to this course.", code: "ALREADY_PURCHASED" });
    }

    let referrerUserId: string | null = null;
    if (referralCode) {
      const referrer = await prisma.user.findUnique({ where: { referralCode: referralCode.toUpperCase() } });
      if (referrer && referrer.id !== user.id) {
        referrerUserId = referrer.id;
        log("referral applied", { referrerUserId });
      }
    }

    log("creating Razorpay order", { amountInPaise: course.priceInPaise });
    const razorpay = getRazorpayClient();
    let rpOrder;
    try {
      rpOrder = await razorpay.orders.create({
        amount: course.priceInPaise,
        currency: "INR",
        receipt: `ord_${Date.now()}`,
        notes: { courseId, userId: user.id },
      });
      log("Razorpay order created", { razorpayOrderId: rpOrder.id });
    } catch (err) {
      log("Razorpay order creation failed", JSON.stringify(err));
      throw new PaymentServiceError(describeRazorpayError(err));
    }

    const order = await prisma.order
      .create({
        data: {
          userId: user.id,
          courseId,
          amountInPaise: course.priceInPaise,
          razorpayOrderId: rpOrder.id,
          selectedLanguage: selectedLanguage ?? null,
          referralCodeUsed: referrerUserId ? referralCode!.toUpperCase() : null,
          referrerUserId,
        },
      })
      .catch((err) => {
        log("database error saving order", err instanceof Error ? err.message : err);
        throw new DatabaseError("Order could not be saved after payment was created");
      });
    log("order saved", { orderId: order.id });

    res.json({
      orderId: order.id,
      razorpayOrderId: rpOrder.id,
      amountInPaise: course.priceInPaise,
      currency: "INR",
      keyId: env.razorpay.keyId,
      courseName: course.title,
    });
  } catch (err) {
    if (err instanceof RazorpayConfigError) {
      console.error(`${LOG_PREFIX} configuration error:`, err.message);
      return res.status(503).json({
        error: "Payment service is temporarily unavailable. Please try again shortly.",
        code: "PAYMENT_SERVICE_UNAVAILABLE",
      });
    }
    if (err instanceof PaymentServiceError) {
      console.error(`${LOG_PREFIX} Razorpay error:`, err.message);
      return res.status(502).json({
        error: "Payment service is temporarily unavailable. Please try again shortly.",
        code: "PAYMENT_SERVICE_UNAVAILABLE",
      });
    }
    if (
      err instanceof DatabaseError ||
      err instanceof Prisma.PrismaClientKnownRequestError ||
      err instanceof Prisma.PrismaClientInitializationError
    ) {
      console.error(`${LOG_PREFIX} database error:`, err instanceof Error ? err.message : err);
      return res.status(500).json({ error: "Database error — please try again.", code: "DATABASE_ERROR" });
    }
    console.error(`${LOG_PREFIX} unexpected error:`, err);
    return res.status(500).json({ error: "Order creation failed — please try again.", code: "ORDER_CREATION_FAILED" });
  }
}

export async function orderStatus(req: Request, res: Response) {
  const user = currentUser(req);
  const order = await prisma.order.findUnique({ where: { id: param(req, "id") } });
  if (!order || order.userId !== user.id) throw new HttpError(404, "Not found");
  res.json({ status: order.status });
}

/**
 * Customer-facing self-heal: if the checkout status poll times out before the webhook
 * arrives, the client calls this once to ask Razorpay directly.
 */
export async function syncOrder(req: Request, res: Response) {
  const user = currentUser(req);
  const order = await prisma.order.findUnique({ where: { id: param(req, "id") } });
  if (!order || order.userId !== user.id) throw new HttpError(404, "Not found");
  try {
    res.json(await reconcileOrderWithRazorpay(order));
  } catch (err) {
    if (err instanceof RazorpayConfigError) return res.status(503).json({ error: err.message });
    console.error("[PAYMENT] Customer order sync failed:", err);
    return res.status(500).json({ error: "Failed to check payment status" });
  }
}

function logAudit(action: string, metadata: Record<string, unknown>) {
  // Fire-and-forget: an audit-log failure must never block the webhook response.
  prisma.auditLog.create({ data: { action, metadata: metadata as Prisma.InputJsonValue } }).catch((err) => {
    console.error("[PAYMENT] Failed to write audit log", err);
  });
}

/**
 * Razorpay retries on non-2xx, so every path is idempotent. req.body is a raw Buffer
 * here (express.raw is mounted on this route only) — signature verification needs the
 * exact bytes Razorpay signed, not a re-serialised JSON object.
 */
export async function razorpayWebhook(req: Request, res: Response) {
  const reqId = Math.random().toString(36).slice(2, 8);
  const log = (msg: string, extra?: unknown) => console.log(`[PAYMENT][${reqId}] ${msg}`, extra ?? "");

  log("Webhook received");
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  const signatureHeader = req.headers["x-razorpay-signature"];
  const signature = typeof signatureHeader === "string" ? signatureHeader : null;

  let verified: boolean;
  try {
    verified = verifyWebhookSignature(rawBody, signature);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[PAYMENT][${reqId}] Webhook signature verification misconfigured:`, message);
    logAudit("WEBHOOK_CONFIG_ERROR", { reqId, message });
    return res.status(500).json({ error: "Server misconfiguration" });
  }

  if (!verified) {
    log("Signature verification FAILED — rejecting webhook");
    logAudit("WEBHOOK_SIGNATURE_INVALID", { reqId, hasSignatureHeader: Boolean(signature) });
    return res.status(400).json({ error: "Invalid signature" });
  }
  log("Signature verified");

  const event = JSON.parse(rawBody);
  log("Event type", event.event);

  try {
    switch (event.event) {
      case "payment.captured": {
        const payment = event.payload.payment.entity;
        log("payment.captured", { razorpayOrderId: payment.order_id, razorpayPaymentId: payment.id });
        // Partner ID card reissue fees share this webhook; they have no Order row.
        const cardRequest = await prisma.partnerCardRequest.findUnique({
          where: { razorpayOrderId: payment.order_id },
          select: { id: true },
        });
        if (cardRequest) {
          const cardResult = await markRequestPaid({
            razorpayOrderId: payment.order_id,
            razorpayPaymentId: payment.id,
            amountInPaise: Number(payment.amount),
          });
          log("partner card reissue payment", { requestId: cardRequest.id, ok: cardResult.ok });
          logAudit("WEBHOOK_PARTNER_CARD_PAYMENT_CAPTURED", { reqId, razorpayOrderId: payment.order_id, ok: cardResult.ok });
          break;
        }
        const result = await markOrderPaid({ razorpayOrderId: payment.order_id, razorpayPaymentId: payment.id });
        log("markOrderPaid result", result);
        logAudit("WEBHOOK_PAYMENT_CAPTURED", {
          reqId,
          razorpayOrderId: payment.order_id,
          razorpayPaymentId: payment.id,
          result,
        });
        if (result.ok) log("Course access granted");
        break;
      }
      case "payment.authorized": {
        // With auto-capture on, payment.captured follows and does the unlock. With it off, the
        // payment would sit here until Razorpay auto-refunds it — so reconcile, which captures an
        // authorized payment (only for the order's exact amount) and unlocks through markOrderPaid.
        const payment = event.payload.payment.entity;
        log("payment.authorized", { razorpayOrderId: payment.order_id, razorpayPaymentId: payment.id });
        const cardRequest = await prisma.partnerCardRequest.findUnique({ where: { razorpayOrderId: payment.order_id } });
        if (cardRequest) {
          const cardResult = await reconcileRequestPayment(cardRequest);
          log("partner card reissue reconcile", cardResult);
          break;
        }
        const order = await prisma.order.findUnique({
          where: { razorpayOrderId: payment.order_id },
          select: { id: true, razorpayOrderId: true, status: true, amountInPaise: true },
        });
        if (!order) {
          log("payment.authorized: no matching order — ignoring");
          break;
        }
        const result = await reconcileOrderWithRazorpay(order);
        log("payment.authorized reconcile result", result);
        logAudit("WEBHOOK_PAYMENT_AUTHORIZED", { reqId, razorpayOrderId: payment.order_id, result });
        break;
      }
      case "payment.failed": {
        const payment = event.payload.payment.entity;
        log("payment.failed", { razorpayOrderId: payment.order_id });
        await markOrderFailed(payment.order_id);
        logAudit("WEBHOOK_PAYMENT_FAILED", { reqId, razorpayOrderId: payment.order_id });
        break;
      }
      case "refund.processed": {
        const refund = event.payload.refund.entity;
        log("refund.processed", { razorpayPaymentId: refund.payment_id });
        const result = await reverseOrder(refund.payment_id, "refund_processed");
        logAudit("WEBHOOK_REFUND_PROCESSED", { reqId, razorpayPaymentId: refund.payment_id, result });
        break;
      }
      default:
        log("Ignored event (no handler)");
        break;
    }
  } catch (err) {
    console.error(`[PAYMENT][${reqId}] Webhook processing error`, err);
    logAudit("WEBHOOK_PROCESSING_ERROR", {
      reqId,
      event: event.event,
      message: err instanceof Error ? err.message : String(err),
    });
    return res.status(500).json({ error: "Processing error" });
  }

  log("Webhook handled OK");
  res.json({ ok: true });
}
