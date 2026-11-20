/**
 * Withdrawing a franchise application: an approved application is given up only on purpose (the server
 * insists on confirmApproved). Import-free so the Node test runner can load it.
 */

export const STANDARD_WARNING = "Withdraw this application? This can't be undone, though you can apply again later.";
export const APPROVED_WARNING =
  "Your application has been approved. If you withdraw, you give up this approval and the state reservation (if any) is released. Another applicant may then be approved for this state. This can't be undone.";
export const APPROVED_ACKNOWLEDGEMENT = "I understand that I'm giving up my approval.";

/** What the confirmation shows, and whether "Yes, withdraw" waits for the acknowledgement. */
export function withdrawPrompt(needsConfirmation: boolean): { warning: string; acknowledgement: string | null } {
  return needsConfirmation ? { warning: APPROVED_WARNING, acknowledgement: APPROVED_ACKNOWLEDGEMENT } : { warning: STANDARD_WARNING, acknowledgement: null };
}

/** The request body: confirmApproved only for an approved application whose applicant ticked the box. */
export function withdrawBody(needsConfirmation: boolean, acknowledged: boolean): { confirmApproved?: true } | null {
  if (!needsConfirmation) return {};
  return acknowledged ? { confirmApproved: true } : null;
}
