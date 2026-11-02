/**
 * Support ticket display rules (the server decides; these label things and enable buttons).
 * Import-free so the Node test runner can load it.
 */

export const TICKET_CATEGORIES = ["TECHNICAL", "PAYMENT", "STUDENT", "COURSE", "OTHER"] as const;
export const TICKET_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const CATEGORY_LABEL: Record<string, string> = { TECHNICAL: "Technical", PAYMENT: "Payment", STUDENT: "Student", COURSE: "Course", OTHER: "Other" };
export const TICKET_STATUS_LABEL: Record<string, string> = { OPEN: "Open", IN_PROGRESS: "In progress", RESOLVED: "Resolved", CLOSED: "Closed" };
export const AWAITING_LABEL: Record<string, string> = { ETA: "Waiting for ETA", PARTNER: "Waiting for franchise", NONE: "—" };

export interface TicketRow {
  id: string;
  ticketNo: string;
  subject: string;
  category: string;
  status: string;
  awaiting: string;
  lastMessageAt: string;
  createdAt: string;
  franchiseCode?: string;
}

/** Status moves an admin can make: any other status, until the ticket is closed (final). */
export const adminStatusTargets = (status: string): TicketStatus[] => (status === "CLOSED" ? [] : TICKET_STATUSES.filter((s) => s !== status));

/** Partners can write on, and close, any ticket that isn't closed. */
export const partnerCanReply = (status: string) => status !== "CLOSED";

export function newTicketError(f: { subject: string; category: string; message: string }): string | null {
  if (f.subject.trim().length < 5) return "Give the ticket a subject of at least 5 characters.";
  if (f.subject.trim().length > 150) return "The subject can be at most 150 characters.";
  if (!(TICKET_CATEGORIES as readonly string[]).includes(f.category)) return "Choose a category.";
  if (!f.message.trim()) return "Describe the problem.";
  if (f.message.trim().length > 5000) return "Messages are at most 5000 characters.";
  return null;
}
