/**
 * Admin review helpers for franchise applications. The backend is the authority on which moves are
 * allowed (it returns `allowedTransitions`); these only describe them. Import-free so the Node test
 * runner can load it.
 */

export const REVIEW_STATUSES = [
  "APPLICATION_SUBMITTED",
  "UNDER_REVIEW",
  "INTERVIEW_DISCUSSION",
  "APPROVED",
  "PAYMENT_PENDING",
  "AGREEMENT_PENDING",
  "ACTIVE_FRANCHISE",
  "REJECTED",
  "WITHDRAWN",
] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const STATUS_LABEL: Record<ReviewStatus, string> = {
  APPLICATION_SUBMITTED: "Application submitted",
  UNDER_REVIEW: "Under review",
  INTERVIEW_DISCUSSION: "Interview / discussion",
  APPROVED: "Approved",
  PAYMENT_PENDING: "Payment pending",
  AGREEMENT_PENDING: "Agreement pending",
  ACTIVE_FRANCHISE: "Active franchise",
  REJECTED: "Not approved",
  WITHDRAWN: "Withdrawn by applicant",
};

/** The button for each move an admin can make in this phase. */
export const ACTION: Record<"UNDER_REVIEW" | "INTERVIEW_DISCUSSION" | "APPROVED" | "REJECTED", { label: string; tone: "neutral" | "good" | "bad"; confirm: string }> = {
  UNDER_REVIEW: { label: "Start review", tone: "neutral", confirm: "Move this application to Under review?" },
  INTERVIEW_DISCUSSION: { label: "Move to interview / discussion", tone: "neutral", confirm: "Move this application to Interview / discussion?" },
  APPROVED: { label: "Approve", tone: "good", confirm: "Approve this application? Approval doesn't reserve or close the state, and doesn't activate a franchise." },
  REJECTED: { label: "Reject", tone: "bad", confirm: "Reject this application? The applicant will see the reason after signing in." },
};

export type ReviewAction = keyof typeof ACTION;

export const isReviewAction = (s: string): s is ReviewAction => s in ACTION;

export const REJECTION_REASON_MIN = 10;
export const REJECTION_REASON_MAX = 1000;

/** Mirrors the server: a trimmed reason of 10–1000 characters. Returns an error message or null. */
export function rejectionReasonError(reason: string): string | null {
  const n = reason.trim().length;
  if (n < REJECTION_REASON_MIN) return `Give the applicant a reason of at least ${REJECTION_REASON_MIN} characters.`;
  if (n > REJECTION_REASON_MAX) return `The reason can be at most ${REJECTION_REASON_MAX} characters.`;
  return null;
}

/** Badge colours by status. */
export function statusTone(status: string): "neutral" | "info" | "good" | "bad" {
  if (status === "REJECTED") return "bad";
  if (status === "APPROVED" || status === "ACTIVE_FRANCHISE") return "good";
  if (status === "APPLICATION_SUBMITTED") return "info";
  return "neutral";
}

/** Query string for the list page; empty filters are left out. */
export function listQuery(f: { status?: string; q?: string; stateId?: string; districtId?: string; from?: string; to?: string; page?: number; pageSize?: number }): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === null || v === "") continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const pageCount = (total: number, pageSize: number) => Math.max(1, Math.ceil(total / pageSize));
