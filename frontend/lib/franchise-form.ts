/**
 * Client-side checks for the franchise application form. They mirror the backend's rules so people
 * see mistakes before uploading; the backend re-checks everything (including the file bytes).
 * Import-free so the Node test runner can load it.
 */

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_TYPES = ["application/pdf", "image/jpeg", "image/png"];
export const ACCEPT_ATTR = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";

export type DocumentRequirement = "REQUIRED" | "OPTIONAL" | "NOT_REQUESTED";
export type DocumentRequirements = Record<"PHOTO" | "ADDRESS_PROOF" | "BUSINESS_PLAN", DocumentRequirement>;

export const DOCUMENT_FIELDS = [
  { field: "idProof", kind: "ID_PROOF", label: "ID proof" },
  { field: "photo", kind: "PHOTO", label: "Recent photograph" },
  { field: "addressProof", kind: "ADDRESS_PROOF", label: "Address proof" },
  { field: "businessPlan", kind: "BUSINESS_PLAN", label: "Business plan" },
] as const;

export const DOCUMENT_KIND_LABEL: Record<string, string> = {
  ID_PROOF: "ID proof",
  PHOTO: "Photograph",
  ADDRESS_PROOF: "Address proof",
  BUSINESS_PLAN: "Business plan",
  ADDITIONAL: "Additional document",
};

/** ID proof is always required; the others follow the published requirements. */
export function requirementFor(kind: string, reqs: DocumentRequirements | null): DocumentRequirement {
  if (kind === "ID_PROOF") return "REQUIRED";
  return reqs?.[kind as keyof DocumentRequirements] ?? "NOT_REQUESTED";
}

export function isValidMobile(v: string): boolean {
  return /^[6-9]\d{9}$/.test(v.trim());
}

/** Whole rupees, 0 to ₹1,00,00,00,000; commas and a leading ₹ are allowed. Empty means not given. */
export function parseInvestment(v: string): { ok: true; value: string | null } | { ok: false } {
  const s = v.replace(/[₹,\s]/g, "");
  if (s === "") return { ok: true, value: null };
  if (!/^\d{1,10}$/.test(s) || Number(s) > 1_000_000_000) return { ok: false };
  return { ok: true, value: String(Number(s)) };
}

export function checkFile(f: { size: number; type: string; name: string }): string | null {
  if (f.size === 0) return `${f.name} is empty.`;
  if (f.size > MAX_DOCUMENT_BYTES) return `${f.name} is larger than 5 MB.`;
  if (!ACCEPTED_TYPES.includes(f.type === "image/jpg" ? "image/jpeg" : f.type)) return `${f.name} must be a PDF, JPEG or PNG file.`;
  return null;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** "500000" → "₹5,00,000" (Indian grouping; whole rupees). */
export function formatRupees(v: number | string): string {
  const s = String(v);
  if (!/^\d+$/.test(s)) return "—";
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `₹${rest ? `${rest},${last3}` : last3}`;
}

/** Applicant-facing order of the journey; REJECTED is shown separately. */
export const STATUS_STEPS = [
  { status: "APPLICATION_SUBMITTED", label: "Application submitted" },
  { status: "UNDER_REVIEW", label: "Under review" },
  { status: "INTERVIEW_DISCUSSION", label: "Interview / discussion" },
  { status: "APPROVED", label: "Approved" },
  { status: "PAYMENT_PENDING", label: "Payment pending" },
  { status: "AGREEMENT_PENDING", label: "Agreement pending" },
  { status: "ACTIVE_FRANCHISE", label: "Active franchise" },
] as const;

export function stepIndex(status: string): number {
  return STATUS_STEPS.findIndex((s) => s.status === status);
}
