/**
 * "Request more info / documents" on franchise applications: labels, the admin's request form checks, the
 * applicant's reply checks, and how documents are grouped into current and earlier versions. They mirror
 * the backend's rules (which re-checks everything). Import-free so the Node test runner can load it.
 */

export const REQUEST_KINDS = [
  { kind: "ID_PROOF", field: "idProof", label: "ID proof" },
  { kind: "PHOTO", field: "photo", label: "Photograph" },
  { kind: "ADDRESS_PROOF", field: "addressProof", label: "Address proof" },
  { kind: "BUSINESS_PLAN", field: "businessPlan", label: "Business plan" },
  { kind: "ADDITIONAL", field: "additional", label: "Other document" },
] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number]["kind"];

export const MESSAGE_MIN = 10;
export const MESSAGE_MAX = 500;
export const REPLY_MAX = 1000;
export const MAX_ADDITIONAL_FILES = 3;

export const kindLabel = (kind: string) => REQUEST_KINDS.find((k) => k.kind === kind)?.label ?? kind;
export const fieldFor = (kind: string) => REQUEST_KINDS.find((k) => k.kind === kind)?.field ?? null;

export interface DocRequest {
  id: string;
  status: "OPEN" | "FULFILLED" | "CANCELLED" | string;
  kinds: string[];
  message: string;
  createdAt: string;
  repliedAt: string | null;
  cancelledAt: string | null;
  responseText: string | null;
}

export const REQUEST_STATUS_LABEL: Record<string, string> = { OPEN: "Waiting for the applicant", FULFILLED: "Reply received", CANCELLED: "Cancelled" };

/** Admin's request: the message (shown to the applicant after sign-in) is required. */
export function requestFormError(message: string): string | null {
  const n = message.trim().length;
  if (n < MESSAGE_MIN) return `Write a message of at least ${MESSAGE_MIN} characters for the applicant.`;
  if (n > MESSAGE_MAX) return `The message is at most ${MESSAGE_MAX} characters.`;
  return null;
}

/**
 * Applicant's reply: every requested document (one file each; "Other document" 1–3 files), nothing that
 * wasn't requested, and a written reply when only a message was sent.
 */
export function replyFormError(request: { kinds: string[] }, fileCounts: Record<string, number>, text: string): string | null {
  for (const [kind, count] of Object.entries(fileCounts)) {
    if (count > 0 && !request.kinds.includes(kind)) return `${kindLabel(kind)} wasn't requested.`;
  }
  for (const kind of request.kinds) {
    const count = fileCounts[kind] ?? 0;
    if (count === 0) return `${kindLabel(kind)} is required.`;
    if (kind === "ADDITIONAL" ? count > MAX_ADDITIONAL_FILES : count > 1) return kind === "ADDITIONAL" ? `Upload at most ${MAX_ADDITIONAL_FILES} other documents.` : "Upload one file per document.";
  }
  if (request.kinds.length === 0 && !text.trim()) return "Please write a reply.";
  if (text.trim().length > REPLY_MAX) return `Your reply is at most ${REPLY_MAX} characters.`;
  return null;
}

export interface DocLike {
  id: string;
  kind: string;
  createdAt: string;
  documentRequestId?: string | null;
}

/**
 * Documents grouped for display, in the usual order: for ID proof, photo, address proof and business plan
 * the newest file is current and older ones are earlier versions; every "other document" stands alone.
 */
export function groupDocuments<T extends DocLike>(docs: T[]): { kind: string; current: T; earlier: T[] }[] {
  const sorted = [...docs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const groups: { kind: string; current: T; earlier: T[] }[] = [];
  for (const k of REQUEST_KINDS) {
    const ofKind = sorted.filter((d) => d.kind === k.kind);
    if (!ofKind.length) continue;
    if (k.kind === "ADDITIONAL") for (const d of ofKind) groups.push({ kind: d.kind, current: d, earlier: [] });
    else groups.push({ kind: k.kind, current: ofKind[ofKind.length - 1], earlier: ofKind.slice(0, -1).reverse() });
  }
  for (const d of sorted) if (!REQUEST_KINDS.some((k) => k.kind === d.kind)) groups.push({ kind: d.kind, current: d, earlier: [] });
  return groups;
}

/** History entries for requests (asked, replied, cancelled), to merge with the status history. */
export function requestEvents(requests: DocRequest[]): { at: string; title: string; detail: string | null }[] {
  const out: { at: string; title: string; detail: string | null }[] = [];
  for (const r of requests) {
    const asked = r.kinds.length ? `Asked for: ${r.kinds.map(kindLabel).join(", ")}` : null;
    out.push({ at: r.createdAt, title: "More information requested", detail: asked });
    if (r.repliedAt) out.push({ at: r.repliedAt, title: "Reply sent", detail: null });
    if (r.cancelledAt) out.push({ at: r.cancelledAt, title: "Request closed", detail: null });
  }
  return out;
}
