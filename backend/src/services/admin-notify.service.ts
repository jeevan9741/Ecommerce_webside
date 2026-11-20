import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { sendEmail } from "./email.service.js";
import { adminNotifyRecipients } from "../utils/admin-notify-config.js";

/**
 * Admin notification emails (to ADMIN_NOTIFY_EMAIL) for events that need an admin's attention.
 * Sent only after the change is committed, never awaited by the request that caused it, and never
 * thrown: a mail problem can't affect a payment, an application or anything else. The emails carry
 * only what an admin needs to recognise the event plus a link to the admin page (which needs an admin
 * sign-in) — no documents or document links, phone numbers, addresses, PIN codes, bank/UPI details,
 * payment references of customers' banks, or customer email addresses.
 */

export type AdminEvent =
  | { kind: "FRANCHISE_APPLICATION"; applicationId: string; applicationNo: string; applicantName: string; state: string; district: string; submittedAt: Date; documents: number }
  | { kind: "FRANCHISE_DOCUMENTS_RECEIVED"; applicationId: string; applicationNo: string; applicantName: string; documentKinds: string[]; withMessage: boolean; receivedAt: Date }
  | { kind: "COURSE_PAID"; orderId: string; invoiceNumber: string; courseTitle: string; amountInPaise: number; customerName: string; paidAt: Date }
  | { kind: "ORDER_REFUNDED"; orderId: string; invoiceNumber: string; courseTitle: string; amountInPaise: number; customerName: string }
  | { kind: "WITHDRAWAL_REQUESTED"; withdrawalId: string; userName: string; amountInPaise: number; requestedAt: Date }
  | { kind: "REFERRAL_CLAIM"; claimId: string; partnerName: string; courseTitle: string; submittedAt: Date }
  | { kind: "PARTNER_CARD_REQUEST"; userName: string; request: "NEW" | "RESUBMITTED" | "REISSUE" | "REISSUE_PAID"; feeInPaise?: number | null }
  | { kind: "JOB_APPLICATION"; applicationId: string; jobTitle: string; applicantName: string; hasResume: boolean }
  | { kind: "TEST"; adminName: string };

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const inr = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0 })}`;
const ist = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) + " IST";
const admin = (path: string) => `${env.siteUrl}${path}`;

interface Built {
  subject: string;
  heading: string;
  rows: [string, string][];
  link: { href: string; label: string } | null;
}

const CARD_REQUEST_LABEL = { NEW: "New partner ID card request", RESUBMITTED: "Partner ID card request resubmitted", REISSUE: "Partner ID card reissue requested", REISSUE_PAID: "Partner ID card reissue fee paid" } as const;

/** What each event says. Pure, so the content rules are unit-tested. */
export function describeAdminEvent(e: AdminEvent): Built {
  switch (e.kind) {
    case "FRANCHISE_APPLICATION":
      return {
        subject: `New franchise application ${e.applicationNo}`,
        heading: "A new franchise application was submitted",
        rows: [["Application", e.applicationNo], ["Applicant", e.applicantName], ["State", e.state], ["Training centre district", e.district], ["Submitted", ist(e.submittedAt)], ["Documents attached", String(e.documents)]],
        link: { href: admin(`/admin/franchise-applications/${encodeURIComponent(e.applicationId)}`), label: "Review the application" },
      };
    case "FRANCHISE_DOCUMENTS_RECEIVED":
      return {
        subject: `Reply received — ${e.applicationNo}`,
        heading: "An applicant replied to your request for more information",
        rows: [
          ["Application", e.applicationNo],
          ["Applicant", e.applicantName],
          ["Files sent", e.documentKinds.length ? `${e.documentKinds.length} (${[...new Set(e.documentKinds)].join(", ")})` : "None"],
          ["Written reply", e.withMessage ? "Yes (shown after sign-in)" : "No"],
          ["Received", ist(e.receivedAt)],
        ],
        link: { href: admin(`/admin/franchise-applications/${encodeURIComponent(e.applicationId)}`), label: "Review the reply" },
      };
    case "COURSE_PAID":
      return {
        subject: `Payment received ${inr(e.amountInPaise)} — ${e.courseTitle}`,
        heading: "A course payment was completed",
        rows: [["Course", e.courseTitle], ["Amount", inr(e.amountInPaise)], ["Invoice", e.invoiceNumber], ["Customer", e.customerName], ["Paid", ist(e.paidAt)]],
        link: { href: admin("/admin/orders"), label: "Open orders" },
      };
    case "ORDER_REFUNDED":
      return {
        subject: `Refund processed ${inr(e.amountInPaise)} — ${e.courseTitle}`,
        heading: "A course payment was refunded",
        rows: [["Course", e.courseTitle], ["Amount", inr(e.amountInPaise)], ["Invoice", e.invoiceNumber], ["Customer", e.customerName]],
        link: { href: admin("/admin/orders"), label: "Open orders" },
      };
    case "WITHDRAWAL_REQUESTED":
      return {
        subject: `Withdrawal request ${inr(e.amountInPaise)}`,
        heading: "A referral earnings withdrawal was requested",
        rows: [["Requested by", e.userName], ["Amount", inr(e.amountInPaise)], ["Requested", ist(e.requestedAt)]],
        link: { href: admin("/admin/withdrawals"), label: "Review withdrawals" },
      };
    case "REFERRAL_CLAIM":
      return {
        subject: `Referral commission claim — ${e.courseTitle}`,
        heading: "A referral commission claim was submitted",
        rows: [["Partner", e.partnerName], ["Package", e.courseTitle], ["Submitted", ist(e.submittedAt)]],
        link: { href: admin("/admin/referral-claims"), label: "Review referral claims" },
      };
    case "PARTNER_CARD_REQUEST":
      return {
        subject: CARD_REQUEST_LABEL[e.request],
        heading: `${CARD_REQUEST_LABEL[e.request]} — waiting for review`,
        rows: [["Partner", e.userName], ...(e.feeInPaise ? ([["Fee", inr(e.feeInPaise)]] as [string, string][]) : [])],
        link: { href: admin("/admin/partner-cards"), label: "Review partner ID cards" },
      };
    case "JOB_APPLICATION":
      return {
        subject: `Job application — ${e.jobTitle}`,
        heading: "A new job application was received",
        rows: [["Position", e.jobTitle], ["Applicant", e.applicantName], ["Résumé attached", e.hasResume ? "Yes" : "No"]],
        link: { href: admin("/admin/jobs"), label: "Open job applications" },
      };
    case "TEST":
      return {
        subject: "Test notification",
        heading: "Admin notifications are working",
        rows: [["Sent by", e.adminName], ["Sent", ist(new Date())]],
        link: null,
      };
  }
}

/** The email for an event: "[ETA admin] …" subject and a plain, escaped layout. */
export function adminEmail(e: AdminEvent): { subject: string; html: string } {
  const b = describeAdminEvent(e);
  const rows = b.rows
    .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#475569;">${escapeHtml(k)}</td><td style="padding:4px 0;font-weight:600;">${escapeHtml(v)}</td></tr>`)
    .join("");
  const link = b.link ? `<p style="margin-top:16px;"><a href="${escapeHtml(b.link.href)}">${escapeHtml(b.link.label)}</a> (admin sign-in required)</p>` : "";
  return {
    subject: `[ETA admin] ${b.subject}`,
    html:
      `<div style="font-family:Arial,sans-serif;max-width:520px;color:#0f172a;">` +
      `<h2 style="font-size:17px;color:#2563eb;">${escapeHtml(b.heading)}</h2>` +
      `<table style="font-size:14px;border-collapse:collapse;">${rows}</table>${link}` +
      `<p style="margin-top:20px;font-size:12px;color:#64748b;">Automatic notice from E-Commerce Training Academy. Details stay in the admin area.</p>` +
      `</div>`,
  };
}

/** Sends now; for the admin test button and tests. Never throws for a per-recipient failure. */
export async function sendAdminNotification(e: AdminEvent): Promise<{ recipients: number; sent: number }> {
  const recipients = adminNotifyRecipients();
  if (!recipients.length) return { recipients: 0, sent: 0 };
  const { subject, html } = adminEmail(e);
  let sent = 0;
  for (const to of recipients) {
    try {
      await sendEmail({ to, subject, html });
      sent++;
    } catch (err) {
      console.error("[ADMIN_NOTIFY] email failed", { kind: e.kind, error: err instanceof Error ? err.name : "Error" });
    }
  }
  if (sent) console.log("[ADMIN_NOTIFY] sent", { kind: e.kind, sent });
  return { recipients: recipients.length, sent };
}

const inFlight = new Set<Promise<unknown>>();

/** Fire-and-forget: call after the change is committed. Never awaited, never throws. */
export function notifyAdmins(e: AdminEvent | (() => Promise<AdminEvent | null>)): void {
  if (!adminNotifyRecipients().length) return;
  const p = (async () => {
    const event = typeof e === "function" ? await e() : e;
    if (event) await sendAdminNotification(event);
  })()
    .catch((err) => console.error("[ADMIN_NOTIFY] failed", { error: err instanceof Error ? err.name : "Error" }))
    .finally(() => inFlight.delete(p));
  inFlight.add(p);
}

/** Tests: wait for notifications already started. */
export async function flushAdminNotifications() {
  while (inFlight.size) await Promise.all([...inFlight]);
}

/** Payment and refund notices read the order themselves (after the commit). */
export function notifyOrderEvent(kind: "COURSE_PAID" | "ORDER_REFUNDED", orderId: string, invoiceNumberOf: (o: { id: string; paidAt: Date | null; createdAt: Date }) => string) {
  notifyAdmins(async () => {
    const o = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, amountInPaise: true, paidAt: true, createdAt: true, user: { select: { name: true } }, course: { select: { title: true } } } });
    if (!o) return null;
    const common = { orderId: o.id, invoiceNumber: invoiceNumberOf(o), courseTitle: o.course.title, amountInPaise: o.amountInPaise, customerName: o.user.name };
    return kind === "COURSE_PAID" ? { kind, ...common, paidAt: o.paidAt ?? new Date() } : { kind, ...common };
  });
}
