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
 * Query parameters that node-postgres (pg-connection-string, used by the Prisma pg adapter) lets
 * override the server a URL connects to: `?host=` beats the hostname, `?port=` the port.
 */
const CONNECTION_TARGET_PARAMS = new Set(["host", "hostaddr", "port", "service", "servicefile"]);

/** First labels of a (possibly percent-encoded, possibly comma-separated) host value. */
function firstLabels(host: string) {
  let decoded = host;
  try {
    decoded = decodeURIComponent(host); // node-postgres decodes the hostname before connecting
  } catch {
    // keep it as written
  }
  return decoded.split(",").map((h) => h.trim().split(".")[0]);
}

/**
 * Every endpoint ID a connection string can address: the first label of the hostname (as written and
 * as node-postgres decodes it), of any `host`/`hostaddr` query value, and — Neon's fallbacks for clients
 * without SNI — every `endpoint=`/`project=` inside any `options` parameter and an `endpoint=<id>$…` (or
 * `;`) password. A malformed value is kept as written, so it can never equal a production endpoint.
 */
function databaseEndpoints(databaseUrl: string) {
  const ids: string[] = [];
  try {
    let url: URL;
    try {
      url = new URL(databaseUrl);
    } catch {
      // node-postgres retries a host-less URL (postgresql://u:p@/db?host=…) with a dummy host; so do we
      url = new URL(String(databaseUrl).replace("@/", "@___DUMMY___/"));
    }
    ids.push(url.hostname.split(".")[0], ...firstLabels(url.hostname));
    for (const [key, value] of url.searchParams) {
      const k = key.toLowerCase();
      if (k === "host" || k === "hostaddr") ids.push(...firstLabels(value));
      if (k === "options") for (const m of value.matchAll(/(?:^|[\s-])(?:endpoint|project)=(\S*)/gi)) ids.push(m[1] || "(empty)");
    }
    let password = url.password;
    try {
      password = decodeURIComponent(password);
    } catch {
      // keep it as written
    }
    const inPassword = /^(?:endpoint|project)=([^$;]*)[$;]/i.exec(password);
    if (inPassword) ids.push(inPassword[1] || "(empty)");
  } catch {
    // unparseable URL: nothing to find
  }
  return ids.map(normaliseEndpoint).filter(Boolean);
}

/**
 * "Could this be the production database?" — true when ANY endpoint the URL names is a production one.
 * Used where production must be PROTECTED (TEST keys are refused against it), so doubt counts as yes —
 * including PGHOST / PGHOSTADDR / PGOPTIONS, which node-postgres falls back to when the URL omits them.
 */
export function isProductionDatabase(databaseUrl = env.databaseUrl) {
  const fromEnvironment = [...firstLabels(process.env.PGHOST ?? ""), ...firstLabels(process.env.PGHOSTADDR ?? "")];
  for (const m of (process.env.PGOPTIONS ?? "").matchAll(/(?:^|[\s-])(?:endpoint|project)=(\S*)/gi)) fromEnvironment.push(m[1]);
  return [...databaseEndpoints(databaseUrl), ...fromEnvironment.map(normaliseEndpoint)].some((id) => PRODUCTION_DATABASE_ENDPOINTS.has(id));
}

/**
 * A Neon hostname, every component checked: <endpoint>[-pooler].[c-<n>.]<region>.aws.neon.tech.
 * The endpoint must be the WHOLE first label, so look-alike hosts (ep-….neon.tech.evil.com,
 * ep-….localtest.me, a longer or shorter endpoint ID) never match.
 */
const NEON_HOST = /^(ep-[a-z0-9]+(?:-[a-z0-9]+)*?)(?:-pooler)?\.(?:c-\d+\.)?[a-z]+(?:-[a-z]+)+-\d+\.aws\.neon\.tech$/;

/**
 * "Is this certainly the production database?" — used where being production RELAXES a guard (LIVE keys
 * and the production Blob stores are only allowed there), so doubt counts as no. Requires a well-formed
 * postgres URL of printable ASCII only (no spaces, tabs or invisible characters, which node-postgres
 * would parse differently; trailing line breaks are tolerated — the URL parser drops them) whose
 * hostname is a Neon host (every component, see NEON_HOST) of a production endpoint, no query parameter
 * that could send the connection elsewhere (CONNECTION_TARGET_PARAMS), and every endpoint the URL names
 * the same one.
 */
export function isConfirmedProductionDatabase(databaseUrl: string | undefined = env.databaseUrl) {
  let value = String(databaseUrl ?? "");
  let end = value.length;
  while (end > 0 && (value[end - 1] === "\n" || value[end - 1] === "\r")) end--;
  value = value.slice(0, end);
  if (!value || /[^\x21-\x7e]/.test(value)) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") return false;
  for (const key of parsed.searchParams.keys()) if (CONNECTION_TARGET_PARAMS.has(key.toLowerCase())) return false;
  const m = NEON_HOST.exec(parsed.hostname.toLowerCase());
  if (!m) return false;
  const endpoint = normaliseEndpoint(m[1]);
  if (!PRODUCTION_DATABASE_ENDPOINTS.has(endpoint)) return false;
  return databaseEndpoints(parsed.href).every((id) => id === endpoint);
}

/** Production only with BOTH NODE_ENV=production (exactly) and a confirmed production database. */
export function isProductionEnvironment(
  nodeEnv: string | undefined = process.env.NODE_ENV,
  productionDatabase: boolean = isConfirmedProductionDatabase()
) {
  return nodeEnv === "production" && productionDatabase;
}

const PRODUCTION_REQUIREMENT =
  "live keys are only allowed in production: NODE_ENV=production AND a DATABASE_URL on a known production Neon endpoint (add its endpoint to PRODUCTION_DATABASE_ENDPOINTS if the production database moved)";

/**
 * The reverse mistake: LIVE keys anywhere but production (a developer machine or staging would take real
 * money into a database nobody reconciles). Production means NODE_ENV=production AND a confirmed
 * production database. A key that is neither rzp_test_ nor rzp_live_ can't be shown to be a test key, so
 * it is treated the same way (fail closed). The message names the condition, never the key.
 */
export function liveCredentialProblem(mode: RazorpayMode = razorpayMode(), productionEnvironment: boolean = isProductionEnvironment()): string | null {
  if (productionEnvironment) return null;
  if (mode === "live") return `RAZORPAY_KEY_ID is a LIVE key (rzp_live_) outside production — ${PRODUCTION_REQUIREMENT}.`;
  if (mode === "unknown") {
    return `RAZORPAY_KEY_ID is neither a test (rzp_test_) nor a live (rzp_live_) key outside production — refused in case it is live; ${PRODUCTION_REQUIREMENT}.`;
  }
  return null;
}

/**
 * The same check at the moment a Razorpay client is built, from the values the client itself will use
 * (read now, not at import), so every payment path — checkout, partner cards, reconciliation, captures —
 * enforces it independently of the startup check.
 */
export function liveCredentialProblemNow(keyId: string | undefined = process.env.RAZORPAY_KEY_ID): string | null {
  return liveCredentialProblem(razorpayMode(keyId ?? ""), isProductionEnvironment(process.env.NODE_ENV, isConfirmedProductionDatabase(process.env.DATABASE_URL)));
}

/** Why payments must not be processed in this configuration, or null when they may. */
export function paymentSafetyProblem(): string | null {
  const mode = razorpayMode();
  const live = liveCredentialProblem(mode);
  if (live) return live;
  if (env.isProduction && mode === "test") {
    return "RAZORPAY_KEY_ID is a TEST key (rzp_test_) in production — test payments cost nothing and would unlock real courses.";
  }
  if (mode === "test" && isProductionDatabase()) {
    return "Razorpay TEST keys are configured against the PRODUCTION database — point DATABASE_URL at a development database (e.g. a Neon dev branch) to test payments.";
  }
  return null;
}

/**
 * Startup report + hard stop. Production refuses to start with test keys; anything but production
 * (NODE_ENV=production + confirmed production database) refuses to start with live (or unrecognised)
 * keys; outside production,
 * test keys + production DB start with a loud warning (payments are then refused).
 */
export function checkPaymentModeOnStartup() {
  const mode = razorpayMode();
  const prodDb = isProductionDatabase();
  const confirmed = isConfirmedProductionDatabase();
  const prodEnv = isProductionEnvironment(process.env.NODE_ENV, confirmed);
  console.log(
    `[PAYMENT] Razorpay mode: ${mode === "live" ? "LIVE" : mode === "test" ? "TEST" : mode.toUpperCase()} · database: ${prodDb ? (confirmed ? "PRODUCTION" : "PRODUCTION? (not confirmed)") : "non-production"} (${databaseHost() || "unknown host"}) · environment: ${prodEnv ? "PRODUCTION" : "non-production"}`
  );
  const live = liveCredentialProblem(mode, prodEnv);
  if (live) {
    console.error(`[PAYMENT] FATAL: ${live} Refusing to start.`);
    process.exit(1);
  }
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
