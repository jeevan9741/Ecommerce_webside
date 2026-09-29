import { env } from "../config/env.js";

/**
 * Guards against mixing Razorpay TEST mode with real data. In test mode Razorpay approves payments
 * (Google Pay / UPI included) without any money moving, so a backend running test keys against the
 * production database would unlock real courses for free — which happened from a local dev setup.
 */

export type RazorpayMode = "live" | "test" | "unset" | "unknown";

export function razorpayMode(keyId = env.razorpay.keyId): RazorpayMode {
  if (!keyId) return "unset";
  if (keyId.startsWith("rzp_live_")) return "live";
  if (keyId.startsWith("rzp_test_")) return "test";
  return "unknown";
}

/**
 * Neon endpoint IDs of the live database (the first label of its hostname, without "-pooler").
 * Override with PRODUCTION_DATABASE_ENDPOINTS (comma-separated) if the database moves.
 */
const PRODUCTION_DATABASE_ENDPOINTS = (process.env.PRODUCTION_DATABASE_ENDPOINTS ?? "ep-frosty-resonance-arjo65c1")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export function databaseHost(databaseUrl = env.databaseUrl) {
  try {
    return new URL(databaseUrl).hostname;
  } catch {
    return "";
  }
}

export function isProductionDatabase(databaseUrl = env.databaseUrl) {
  const endpoint = databaseHost(databaseUrl).split(".")[0].replace(/-pooler$/, "");
  return PRODUCTION_DATABASE_ENDPOINTS.includes(endpoint);
}

/** Why payments must not be processed in this configuration, or null when they may. */
export function paymentSafetyProblem(): string | null {
  const mode = razorpayMode();
  if (env.isProduction && mode === "test") {
    return "RAZORPAY_KEY_ID is a TEST key (rzp_test_) in production — test payments cost nothing and would unlock real courses.";
  }
  if (mode === "test" && isProductionDatabase()) {
    return "Razorpay TEST keys are configured against the PRODUCTION database — point DATABASE_URL at a development database (e.g. a Neon dev branch) to test payments.";
  }
  return null;
}

/**
 * Startup report + hard stop. Production refuses to start with test keys; any environment logs
 * which mode it's in and warns loudly (payments are then refused) for test keys + production DB.
 */
export function checkPaymentModeOnStartup() {
  const mode = razorpayMode();
  const prodDb = isProductionDatabase();
  console.log(
    `[PAYMENT] Razorpay mode: ${mode === "live" ? "LIVE" : mode === "test" ? "TEST" : mode.toUpperCase()} · database: ${prodDb ? "PRODUCTION" : "non-production"} (${databaseHost() || "unknown host"})`
  );
  const problem = paymentSafetyProblem();
  if (!problem) return;
  if (env.isProduction) {
    console.error(`[PAYMENT] FATAL: ${problem} Refusing to start.`);
    process.exit(1);
  }
  console.error(`[PAYMENT] WARNING: ${problem} Checkout and course unlocking are DISABLED until this is fixed.`);
}

export interface RazorpayPaymentFacts {
  id: string;
  orderId: string;
  amountInPaise: number;
  currency: string;
  status: string;
}

/** Checks a Razorpay payment against the order it claims to pay for; returns the mismatch, if any. */
export function paymentMismatch(
  payment: RazorpayPaymentFacts,
  order: { razorpayOrderId: string; amountInPaise: number }
): string | null {
  if (payment.status !== "captured") return `payment status is "${payment.status}", not "captured"`;
  if (payment.orderId !== order.razorpayOrderId) return `payment belongs to Razorpay order ${payment.orderId}, not ${order.razorpayOrderId}`;
  if (payment.currency !== "INR") return `currency is ${payment.currency}, not INR`;
  if (payment.amountInPaise !== order.amountInPaise) return `amount is ${payment.amountInPaise} paise, order is ${order.amountInPaise} paise`;
  return null;
}
