/**
 * Invitation display rules for the partner dashboard. They mirror the server (which decides); used only
 * to label things and disable buttons. Import-free so the Node test runner can load it.
 */

export const MAX_SENDS = 5;
export const RESEND_MIN_GAP_MS = 15 * 60 * 1000;

export interface InviteRow {
  id: string;
  inviteeName: string;
  email: string;
  mobile: string | null;
  status: string;
  expiresAt: string;
  sendCount: number;
  sendsLeft: number;
  lastSentAt: string;
  createdAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
}

export const INVITE_STATUS_LABEL: Record<string, string> = { OPEN: "Waiting", ACCEPTED: "Joined", REVOKED: "Cancelled", EXPIRED: "Expired" };

/** Whether "Resend" should be offered now, and if not, why. */
export function resendState(i: Pick<InviteRow, "status" | "sendCount" | "lastSentAt">, now = Date.now()): { ok: boolean; reason: string | null } {
  if (i.status !== "OPEN" && i.status !== "EXPIRED") return { ok: false, reason: null };
  if (i.sendCount >= MAX_SENDS) return { ok: false, reason: "Sent the maximum number of times" };
  const wait = new Date(i.lastSentAt).getTime() + RESEND_MIN_GAP_MS - now;
  if (wait > 0) return { ok: false, reason: `Can resend in ${Math.ceil(wait / 60000)} min` };
  return { ok: true, reason: null };
}

export const canCancel = (i: Pick<InviteRow, "status">) => i.status === "OPEN" || i.status === "EXPIRED";

/** Client-side checks before sending (the server re-checks everything). */
export function inviteFormError(f: { name: string; email: string; mobile: string }): string | null {
  if (f.name.trim().length < 2) return "Enter the student's name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) return "Enter a valid email address.";
  if (f.mobile.trim() && !/^[6-9]\d{9}$/.test(f.mobile.trim())) return "Enter a 10-digit Indian mobile number, or leave it empty.";
  return null;
}
