import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyWebhookSignature, RazorpayConfigError } from "@/lib/razorpay";
import { markOrderPaid, markOrderFailed, reverseOrder } from "@/lib/order-processing";

function logAudit(action: string, metadata: Record<string, unknown>) {
  // Fire-and-forget: an audit-log failure must never block the webhook response, and
  // Vercel's runtime logs are short-lived, so this is the durable record for support/debugging.
  prisma.auditLog.create({ data: { action, metadata: metadata as Prisma.InputJsonValue } }).catch((err) => {
    console.error("[PAYMENT] Failed to write audit log", err);
  });
}

// Razorpay retries webhooks on non-2xx responses, so every path below must be idempotent.
export async function POST(req: NextRequest) {
  const reqId = Math.random().toString(36).slice(2, 8);
  const log = (msg: string, extra?: unknown) => console.log(`[PAYMENT][${reqId}] ${msg}`, extra ?? "");

  log("Webhook received");
  const rawBody = await req.text();
  const signature = req.headers.get("x-razorpay-signature");

  let verified: boolean;
  try {
    verified = verifyWebhookSignature(rawBody, signature);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[PAYMENT][${reqId}] Webhook signature verification misconfigured:`, message);
    logAudit("WEBHOOK_CONFIG_ERROR", { reqId, message });
    const status = err instanceof RazorpayConfigError ? 500 : 500;
    return NextResponse.json({ error: "Server misconfiguration" }, { status });
  }

  if (!verified) {
    log("Signature verification FAILED — rejecting webhook");
    logAudit("WEBHOOK_SIGNATURE_INVALID", { reqId, hasSignatureHeader: Boolean(signature) });
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }
  log("Signature verified");

  const event = JSON.parse(rawBody);
  log("Event type", event.event);

  try {
    switch (event.event) {
      case "payment.captured": {
        const payment = event.payload.payment.entity;
        log("payment.captured", { razorpayOrderId: payment.order_id, razorpayPaymentId: payment.id });
        const result = await markOrderPaid({
          razorpayOrderId: payment.order_id,
          razorpayPaymentId: payment.id,
        });
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
        // Auto-capture is enabled on this account (payments unlock on payment.captured), so
        // this event is informational only — logged for visibility, no state change needed.
        const payment = event.payload.payment.entity;
        log("payment.authorized (informational only)", { razorpayOrderId: payment.order_id, razorpayPaymentId: payment.id });
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
    logAudit("WEBHOOK_PROCESSING_ERROR", { reqId, event: event.event, message: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "Processing error" }, { status: 500 });
  }

  log("Webhook handled OK");
  return NextResponse.json({ ok: true });
}
