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

const normaliseEndpoint = (id: string) => id.trim().toLowerCase().replace(/-pooler$/, "");

/**
 * Neon endpoint IDs of databases holding real customer data: ep-rapid-fog is the live production
 * database; ep-frosty-resonance is an older copy of it. PRODUCTION_DATABASE_ENDPOINTS (comma-separated)
 * ADDS endpoints, e.g. when the database moves. It can't remove these two, so an empty, stale or
 * mistyped value never switches the guard off for the live database.
 */
const PRODUCTION_DATABASE_ENDPOINTS = new Set(
  ["ep-rapid-fog-ar2sy1xy", "ep-frosty-resonance-arjo65c1", ...(process.env.PRODUCTION_DATABASE_ENDPOINTS ?? "").split(",")]
    .map(normaliseEndpoint)
    .filter(Boolean)
);

export function databaseHost(databaseUrl = env.databaseUrl) {
  try {
    return new URL(databaseUrl).hostname;
  } catch {
    return "";
  }
}

/**
 * Endpoint IDs a connection string can address: the first label of the hostname, and — Neon's
 * fallback for clients without SNI — an `endpoint=` inside the `options` parameter.
 */
function databaseEndpoints(databaseUrl: string) {
  const ids = [databaseHost(databaseUrl).split(".")[0]];
  try {
    const options = new URL(databaseUrl).searchParams.get("options") ?? "";
    const m = /(?:^|\s)endpoint=([a-z0-9-]+)/i.exec(options);
    if (m) ids.push(m[1]);
  } catch {
    // unparseable URL: nothing more to find
  }
  return ids.map(normaliseEndpoint).filter(Boolean);
}

export function isProductionDatabase(databaseUrl = env.databaseUrl) {
  return databaseEndpoints(databaseUrl).some((id) => PRODUCTION_DATABASE_ENDPOINTS.has(id));
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
