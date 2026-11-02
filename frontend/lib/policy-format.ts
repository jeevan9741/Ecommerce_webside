// BigInt() calls instead of literals: the frontend's TypeScript target predates `100n` syntax.
const N0 = BigInt(0);
const N100 = BigInt(100);

/**
 * Display and input helpers for franchise policy values. Money is integer paise carried as a decimal
 * string and handled with BigInt only — never a JavaScript Number, never floating point. Import-free
 * so the Node test runner can load it.
 */

export const PENDING = { status: "PENDING" } as const;

export function isPending(v: unknown): boolean {
  return typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length === 1 && (v as { status?: unknown }).status === "PENDING";
}

/** "10000000" → "₹1,00,000.00" (Indian digit grouping), using BigInt arithmetic only. */
export function formatPaise(paise: string): string {
  if (!/^-?\d+$/.test(paise)) return "—";
  const value = BigInt(paise);
  const negative = value < N0;
  const abs = negative ? -value : value;
  const rupees = (abs / N100).toString();
  const fraction = (abs % N100).toString().padStart(2, "0");
  const last3 = rupees.slice(-3);
  const rest = rupees.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}` : last3;
  return `${negative ? "-" : ""}₹${grouped}.${fraction}`;
}

/**
 * Admin input in rupees ("1,00,000", "100000.5", "₹ 500") → paise as a decimal string, or null when it
 * isn't a valid amount. Pure string parsing: no float conversion, at most two decimal places.
 */
export function rupeesToPaise(input: string): string | null {
  const cleaned = input.replace(/[₹,\s]/g, "");
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!m) return null;
  const paise = BigInt(m[1]) * N100 + BigInt((m[2] ?? "").padEnd(2, "0") || "0");
  return paise.toString();
}

/** Paise string → rupees text for an input field ("10000050" → "100000.50"). */
export function paiseToRupeesInput(paise: string): string {
  if (!/^\d+$/.test(paise)) return "";
  const v = BigInt(paise);
  const fraction = v % N100;
  return fraction === N0 ? (v / N100).toString() : `${v / N100}.${fraction.toString().padStart(2, "0")}`;
}

/** 8000 → "80.00%" (integer arithmetic). */
export function formatBps(bps: number): string {
  if (!Number.isSafeInteger(bps)) return "—";
  return `${Math.trunc(bps / 100)}.${String(Math.abs(bps % 100)).padStart(2, "0")}%`;
}

export const shortSha = (sha: string | null | undefined) => (sha ? `${sha.slice(0, 12)}…` : "—");

export const DOMAIN_LABEL: Record<string, string> = {
  COMMERCIAL: "Commercial",
  REVENUE_SHARE: "Revenue share",
  SETTLEMENT: "Settlement",
  TAX: "Tax",
  GST_INVOICE: "GST invoices",
  NOTIFICATION: "Notifications",
};

export const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Awaiting approval",
  PUBLISHED: "Published",
  SUPERSEDED: "Superseded",
  REJECTED: "Rejected / withdrawn",
};

/** Human-readable value for the policy tables and diffs. */
export function describeValue(kind: string, value: unknown): string {
  if (value === undefined) return "—";
  if (isPending(value)) return "PENDING (decision not made)";
  switch (kind) {
    case "paise":
      return typeof value === "string" ? formatPaise(value) : "—";
    case "bps":
      return typeof value === "number" ? `${value} bps (${formatBps(value)})` : "—";
    case "gst": {
      const g = value as { mode?: string; rateBps?: number };
      return `${g.mode ?? "?"} @ ${typeof g.rateBps === "number" ? formatBps(g.rateBps) : "?"}`;
    }
    case "text":
      return typeof (value as { text?: unknown }).text === "string" ? (value as { text: string }).text : "—";
    case "channels":
      return Array.isArray(value) ? value.join(" + ") : "—";
    case "documents": {
      const d = value as Record<string, string>;
      return ["PHOTO", "ADDRESS_PROOF", "BUSINESS_PLAN"].map((k) => `${k}: ${d[k] ?? "?"}`).join(", ");
    }
    case "tds": {
      const t = value as { applicable?: boolean; rateBps?: number; timing?: string; provisionReference?: string };
      return t.applicable ? `${formatBps(t.rateBps ?? 0)} ${t.timing ?? ""} — ${t.provisionReference ?? ""}` : "Not applicable (CA-confirmed)";
    }
    default:
      return typeof value === "object" ? JSON.stringify(value) : String(value);
  }
}
