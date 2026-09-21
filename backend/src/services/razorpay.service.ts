import Razorpay from "razorpay";
import crypto from "crypto";

export class RazorpayConfigError extends Error {}

/** Catches the .env.example placeholders (and obvious lookalikes) so a checkout
 * attempt fails with a clear config error instead of an opaque Razorpay 401. */
function looksLikePlaceholder(value: string): boolean {
  return /x{6,}/i.test(value) || value.includes("your_") || value.includes("changeme");
}

export function getRazorpayClient() {
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key_id || !key_secret) {
    throw new RazorpayConfigError("RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not configured");
  }
  if (looksLikePlaceholder(key_id) || looksLikePlaceholder(key_secret)) {
    throw new RazorpayConfigError(
      "RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are still set to placeholder values — replace them with real keys from https://dashboard.razorpay.com/app/keys"
    );
  }
  if (!key_id.startsWith("rzp_")) {
    throw new RazorpayConfigError(`RAZORPAY_KEY_ID does not look like a Razorpay key (got: "${key_id.slice(0, 8)}...")`);
  }
  return new Razorpay({ key_id, key_secret });
}

/** Verifies the Razorpay webhook signature (HMAC-SHA256). This is the ONLY trusted
 * signal for payment success — never trust the client-side checkout callback alone. */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) throw new RazorpayConfigError("RAZORPAY_WEBHOOK_SECRET is not configured");
  if (looksLikePlaceholder(secret)) {
    // A placeholder secret computes a signature that can never match Razorpay's real one —
    // every webhook would silently fail verification forever. Fail loudly instead.
    throw new RazorpayConfigError(
      "RAZORPAY_WEBHOOK_SECRET is still a placeholder value — set the real signing secret from the webhook's settings in the Razorpay Dashboard (Settings → Webhooks)."
    );
  }
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

/** Verifies the checkout.js success payload signature — used only for optimistic UI,
 * never to grant access. Actual unlock happens from the verified webhook. */
export function verifyCheckoutSignature(
  orderId: string,
  paymentId: string,
  signature: string
): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) throw new Error("RAZORPAY_KEY_SECRET is not configured");
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
