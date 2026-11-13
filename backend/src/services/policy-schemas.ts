import { z } from "zod";
import type { PolicyDomain } from "@prisma/client";

/**
 * Franchise policy payloads, one schema per domain. Money is integer paise written as a decimal
 * string; rates are integer basis points. A business decision that has not been made is stored as
 * the explicit marker {"status":"PENDING"} — never as an invented default.
 *
 * Fields marked `pendingOnly` are decisions whose shape is not defined yet (e.g. the net
 * distributable revenue formula): in this version they can ONLY be PENDING. Their structure is added
 * in a later schema version once the decision is approved.
 */

/**
 * 2: COMMERCIAL gains applicationIntake and documentRequirements (Phase 4).
 * 3: COMMERCIAL gains privacyNotice — the versioned applicant privacy notice that must be accepted
 *    before an application is accepted. Older payloads are upgraded with it PENDING (form stays closed).
 * 4: territory rule becomes ONE_PRIMARY_PER_STATE (state-level exclusivity); older payloads' district rule
 *    is upgraded to it. The fee refund policy is no longer required to open applications.
 */
export const POLICY_SCHEMA_VERSION = 4;
export const PENDING = { status: "PENDING" } as const;
export type Pending = typeof PENDING;

const pending = z.object({ status: z.literal("PENDING") }).strict();
const pendingOr = <T extends z.ZodType>(schema: T) => z.union([pending, schema]);
/** Positive integer paise as a decimal string (no floats, no Number), at most ₹1,00,00,00,000.00. */
const paise = z
  .string()
  .regex(/^[1-9]\d*$/, "Amounts are whole paise written as digits, e.g. \"10000000\" for ₹1,00,000")
  // Zod 4 runs refinements even after the regex failed: only convert strings that are digits.
  .refine((s) => !/^[1-9]\d*$/.test(s) || BigInt(s) <= 10_000_000_000n * 100n, "Amount is too large");
const bps = z.number().int("Basis points are whole numbers").min(0).max(10_000);

const commercial = z
  .object({
    franchiseFeeInPaise: paise,
    franchiseFeeGst: pendingOr(z.object({ mode: z.enum(["INCLUSIVE", "EXCLUSIVE"]), rateBps: z.number().int().min(0).max(2_800) }).strict()),
    agreementTermMonths: z.number().int().min(1).max(600),
    agreementTemplate: pending,
    eSignProvider: pending,
    feeRefundPolicy: pendingOr(z.object({ text: z.string().trim().min(20).max(20_000) }).strict()),
    /** Applicant privacy notice, shown in full and explicitly accepted before applying. PENDING until approved. */
    privacyNotice: pendingOr(z.object({ text: z.string().trim().min(20).max(20_000) }).strict()),
    /** Whether new franchise applications are accepted. PENDING or CLOSED keeps the form closed. */
    applicationIntake: pendingOr(z.enum(["OPEN", "CLOSED"])),
    /** ID proof is always required; these three are configurable by admins (PENDING until decided). */
    documentRequirements: pendingOr(
      z
        .object({
          PHOTO: z.enum(["REQUIRED", "OPTIONAL", "NOT_REQUESTED"]),
          ADDRESS_PROOF: z.enum(["REQUIRED", "OPTIONAL", "NOT_REQUESTED"]),
          BUSINESS_PLAN: z.enum(["REQUIRED", "OPTIONAL", "NOT_REQUESTED"]),
        })
        .strict()
    ),
    /** The territory rule (key kept for history): one primary franchise per Indian state. */
    districtAllocation: z.literal("ONE_PRIMARY_PER_STATE"),
    districtReservationAndReassignment: pending,
    renewalTerms: pending,
  })
  .strict();

const revenueShare = z
  .object({
    partnerShareBps: bps,
    etaShareBps: bps,
    netDistributableRevenueFormula: pending,
    courseSaleGstTreatment: pending,
    referralOverlap: pending,
    studentAttributionScope: pending,
    refundChargebackDebtRecovery: pending,
  })
  .strict()
  .refine((p) => p.partnerShareBps + p.etaShareBps === 10_000, { message: "Partner and ETA shares must add up to 10000 basis points (100%)", path: ["etaShareBps"] });

const settlement = z
  .object({
    earningsHoldDays: z.number().int().min(0).max(365),
    rollingReserveBps: bps,
    reserveReleaseDays: pendingOr(z.number().int().min(1).max(3_650)),
    minimumPayoutInPaise: paise,
    frequency: z.literal("WEEKLY"),
    /** ISO day of week: 1 = Monday … 5 = Friday … 7 = Sunday. */
    dayOfWeek: z.number().int().min(1).max(7),
    timezone: z.literal("Asia/Kolkata"),
    executionTime: pendingOr(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM")),
    channels: z.array(z.enum(["BANK", "UPI"])).min(1).refine((c) => new Set(c).size === c.length, "Channels must be unique"),
    payoutProvider: pendingOr(z.enum(["RAZORPAYX", "CASHFREE"])),
    providerFeesPaidBy: z.literal("ETA"),
    suspendedPartnerPayouts: pendingOr(z.enum(["PAUSED_UNTIL_REINSTATEMENT", "CONTINUE_AFTER_REVIEW"])),
  })
  .strict();

const tax = z
  .object({
    tds: pendingOr(
      z
        .object({
          applicable: z.boolean(),
          rateBps: bps,
          thresholdInPaise: z.string().regex(/^\d+$/),
          timing: z.enum(["ON_CREDIT", "ON_PAYOUT"]),
          /** Provision under the Income-tax Act, 2025 as confirmed by the CA (text, not hard-coded). */
          provisionReference: z.string().trim().min(3).max(200),
          confirmedBy: z.string().trim().min(3).max(200),
        })
        .strict()
    ),
    panCollection: pending,
    gstinCollection: pending,
  })
  .strict();

const gstInvoice = z.object({ invoiceConfiguration: pending }).strict();

const notification = z.object({ channels: z.tuple([z.literal("EMAIL")]) }).strict();

export const POLICY_SCHEMAS: Record<PolicyDomain, z.ZodType> = {
  COMMERCIAL: commercial,
  REVENUE_SHARE: revenueShare,
  SETTLEMENT: settlement,
  TAX: tax,
  GST_INVOICE: gstInvoice,
  NOTIFICATION: notification,
};

export const POLICY_DOMAINS = Object.keys(POLICY_SCHEMAS) as PolicyDomain[];

// ---------- Field descriptions (drive the admin form and the readiness report) ----------

export type FieldKind = "paise" | "bps" | "int" | "enum" | "time" | "text" | "fixed" | "channels" | "gst" | "tds" | "documents" | "pendingOnly";
export interface FieldDescriptor {
  key: string;
  label: string;
  kind: FieldKind;
  /** Can be recorded as PENDING (a decision not yet made). */
  pendingAllowed: boolean;
  /** Can ONLY be PENDING in this schema version. */
  pendingOnly?: boolean;
  options?: string[];
  min?: number;
  max?: number;
  help?: string;
}

const d = (key: string, label: string, kind: FieldKind, extra: Partial<FieldDescriptor> = {}): FieldDescriptor => ({
  key,
  label,
  kind,
  pendingAllowed: kind === "pendingOnly",
  pendingOnly: kind === "pendingOnly",
  ...extra,
});

export const POLICY_FIELDS: Record<PolicyDomain, FieldDescriptor[]> = {
  COMMERCIAL: [
    d("franchiseFeeInPaise", "Franchise fee", "paise"),
    d("franchiseFeeGst", "Franchise fee GST treatment", "gst", { pendingAllowed: true, help: "Pending CA approval" }),
    d("agreementTermMonths", "Agreement duration (months)", "int", { min: 1, max: 600 }),
    d("agreementTemplate", "Agreement template", "pendingOnly", { help: "Pending legal approval" }),
    d("eSignProvider", "E-sign provider", "pendingOnly"),
    d("feeRefundPolicy", "Franchise fee refund policy (shown before application and payment)", "text", { pendingAllowed: true }),
    d("privacyNotice", "Applicant privacy notice (read and accepted before applying)", "text", { pendingAllowed: true, help: "Pending legal approval" }),
    d("applicationIntake", "New franchise applications", "enum", { pendingAllowed: true, options: ["OPEN", "CLOSED"], help: "The application form stays closed unless this is OPEN" }),
    d("documentRequirements", "Application documents (ID proof is always required)", "documents", { pendingAllowed: true, options: ["REQUIRED", "OPTIONAL", "NOT_REQUESTED"] }),
    d("districtAllocation", "Territory rule (one primary franchise per state)", "fixed", { options: ["ONE_PRIMARY_PER_STATE"] }),
    d("districtReservationAndReassignment", "District reservation and reassignment policy", "pendingOnly"),
    d("renewalTerms", "Renewal terms", "pendingOnly"),
  ],
  REVENUE_SHARE: [
    d("partnerShareBps", "Franchise partner share (basis points)", "bps"),
    d("etaShareBps", "ETA Head Office share (basis points)", "bps"),
    d("netDistributableRevenueFormula", "Net distributable revenue formula", "pendingOnly"),
    d("courseSaleGstTreatment", "Course-sale GST treatment", "pendingOnly", { help: "Pending CA approval" }),
    d("referralOverlap", "Referral commission overlap policy", "pendingOnly"),
    d("studentAttributionScope", "Student attribution scope and transfer rules", "pendingOnly"),
    d("refundChargebackDebtRecovery", "Refund, chargeback and debt recovery rules", "pendingOnly"),
  ],
  SETTLEMENT: [
    d("earningsHoldDays", "Earnings hold (calendar days after verified capture)", "int", { min: 0, max: 365 }),
    d("rollingReserveBps", "Rolling reserve (basis points of the partner share)", "bps"),
    d("reserveReleaseDays", "Reserve release period (days)", "int", { pendingAllowed: true, min: 1, max: 3650 }),
    d("minimumPayoutInPaise", "Minimum payout", "paise"),
    d("frequency", "Settlement frequency", "fixed", { options: ["WEEKLY"] }),
    d("dayOfWeek", "Settlement day (1 = Monday … 7 = Sunday)", "int", { min: 1, max: 7 }),
    d("timezone", "Timezone", "fixed", { options: ["Asia/Kolkata"] }),
    d("executionTime", "Settlement execution time (IST, HH:MM)", "time", { pendingAllowed: true }),
    d("channels", "Payout channels", "channels", { options: ["BANK", "UPI"] }),
    d("payoutProvider", "Payout provider", "enum", { pendingAllowed: true, options: ["RAZORPAYX", "CASHFREE"] }),
    d("providerFeesPaidBy", "Provider transaction fees paid by", "fixed", { options: ["ETA"] }),
    d("suspendedPartnerPayouts", "Payouts while a partner is suspended", "enum", { pendingAllowed: true, options: ["PAUSED_UNTIL_REINSTATEMENT", "CONTINUE_AFTER_REVIEW"] }),
  ],
  TAX: [
    d("tds", "TDS treatment (CA-confirmed)", "tds", { pendingAllowed: true, help: "Income-tax Act, 2025 provisions for transactions from 1 April 2026" }),
    d("panCollection", "Partner PAN collection rules", "pendingOnly"),
    d("gstinCollection", "Partner GSTIN collection rules", "pendingOnly"),
  ],
  GST_INVOICE: [d("invoiceConfiguration", "GST invoice and credit-note configuration", "pendingOnly", { help: "Pending CA approval" })],
  NOTIFICATION: [d("channels", "Notification channels", "fixed", { options: ["EMAIL"] })],
};

/**
 * The business configuration the customer approved on 2026-10-31, as a STARTING POINT for a draft.
 * Every undecided item stays PENDING. Nothing takes effect until two admins publish it.
 */
export const APPROVED_STARTING_VALUES: Record<PolicyDomain, Record<string, unknown>> = {
  COMMERCIAL: {
    franchiseFeeInPaise: "10000000",
    franchiseFeeGst: PENDING,
    agreementTermMonths: 60,
    agreementTemplate: PENDING,
    eSignProvider: PENDING,
    feeRefundPolicy: PENDING,
    privacyNotice: PENDING,
    applicationIntake: PENDING,
    documentRequirements: PENDING,
    districtAllocation: "ONE_PRIMARY_PER_STATE",
    districtReservationAndReassignment: PENDING,
    renewalTerms: PENDING,
  },
  REVENUE_SHARE: {
    partnerShareBps: 8000,
    etaShareBps: 2000,
    netDistributableRevenueFormula: PENDING,
    courseSaleGstTreatment: PENDING,
    referralOverlap: PENDING,
    studentAttributionScope: PENDING,
    refundChargebackDebtRecovery: PENDING,
  },
  SETTLEMENT: {
    earningsHoldDays: 7,
    rollingReserveBps: 1000,
    reserveReleaseDays: PENDING,
    minimumPayoutInPaise: "50000",
    frequency: "WEEKLY",
    dayOfWeek: 5,
    timezone: "Asia/Kolkata",
    executionTime: PENDING,
    channels: ["BANK", "UPI"],
    payoutProvider: PENDING,
    providerFeesPaidBy: "ETA",
    suspendedPartnerPayouts: PENDING,
  },
  TAX: { tds: PENDING, panCollection: PENDING, gstinCollection: PENDING },
  GST_INVOICE: { invoiceConfiguration: PENDING },
  NOTIFICATION: { channels: ["EMAIL"] },
};

export const isPending = (v: unknown): v is Pending =>
  typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length === 1 && (v as { status?: unknown }).status === "PENDING";

/** Top-level fields of a payload that are still PENDING. */
export function pendingFields(payload: Record<string, unknown>) {
  return Object.entries(payload)
    .filter(([, v]) => isPending(v))
    .map(([k]) => k);
}

export type PolicyValidation = { ok: true; payload: Record<string, unknown> } | { ok: false; issues: { path: string; message: string }[] };

/** Validates a payload for its domain (strict: unknown keys, floats and wrong types are refused). */
export function validatePolicyPayload(domain: PolicyDomain, payload: unknown): PolicyValidation {
  const result = POLICY_SCHEMAS[domain].safeParse(payload);
  if (result.success) return { ok: true, payload: result.data as Record<string, unknown> };
  return { ok: false, issues: result.error.issues.map((i) => ({ path: i.path.join(".") || "(payload)", message: i.message })) };
}

// ---------- Features gated by policy (none of them is implemented or activated in Phase 3) ----------

export type GatedFeature = "FRANCHISE_APPLICATIONS" | "FRANCHISE_FEE_PAYMENT" | "REVENUE_SHARE_POSTING" | "WEEKLY_SETTLEMENT" | "GST_INVOICING";

export const FEATURE_REQUIREMENTS: Record<GatedFeature, { domain: PolicyDomain; fields: string[] }[]> = {
  // Also needs applicationIntake === "OPEN" (checked by the application service).
  FRANCHISE_APPLICATIONS: [{ domain: "COMMERCIAL", fields: ["applicationIntake", "documentRequirements", "privacyNotice"] }],
  FRANCHISE_FEE_PAYMENT: [{ domain: "COMMERCIAL", fields: ["franchiseFeeInPaise", "franchiseFeeGst", "feeRefundPolicy", "agreementTemplate"] }],
  REVENUE_SHARE_POSTING: [
    { domain: "REVENUE_SHARE", fields: ["partnerShareBps", "etaShareBps", "netDistributableRevenueFormula", "courseSaleGstTreatment", "referralOverlap", "studentAttributionScope", "refundChargebackDebtRecovery"] },
  ],
  WEEKLY_SETTLEMENT: [
    { domain: "SETTLEMENT", fields: ["earningsHoldDays", "rollingReserveBps", "reserveReleaseDays", "minimumPayoutInPaise", "dayOfWeek", "executionTime", "channels", "payoutProvider", "suspendedPartnerPayouts"] },
    { domain: "TAX", fields: ["tds", "panCollection"] },
    { domain: "REVENUE_SHARE", fields: ["refundChargebackDebtRecovery"] },
  ],
  GST_INVOICING: [
    { domain: "GST_INVOICE", fields: ["invoiceConfiguration"] },
    { domain: "COMMERCIAL", fields: ["franchiseFeeGst"] },
  ],
};

/**
 * Brings a payload written under an older schema version up to the current one by adding any NEW
 * pending-capable field as PENDING. Never fills a business value; existing values are untouched.
 */
export function upgradePayload(domain: PolicyDomain, payload: Record<string, unknown>) {
  const upgraded: Record<string, unknown> = { ...payload };
  // Schema 4: the territory rule moved from districts to states.
  if (domain === "COMMERCIAL" && upgraded.districtAllocation === "ONE_PRIMARY_PER_DISTRICT") upgraded.districtAllocation = "ONE_PRIMARY_PER_STATE";
  for (const f of POLICY_FIELDS[domain]) if (!(f.key in upgraded) && f.pendingAllowed) upgraded[f.key] = PENDING;
  return upgraded;
}
