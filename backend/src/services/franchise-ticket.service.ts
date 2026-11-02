import { z } from "zod";
import type { Prisma, SupportTicketCategory, SupportTicketStatus } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { HttpError } from "../utils/http.js";
import { sendEmail } from "./email.service.js";
import type { PartnerContext } from "./franchise-partner.service.js";

/**
 * Franchise support tickets (Phase 5F-3). A partner sees and writes only its own tickets (scoped by the
 * partner id resolved on the server); admins see and manage all of them. Messages and status events are
 * append-only. Emails carry the ticket number, status and a portal link — never message text.
 */

type Tx = Prisma.TransactionClient;
export const CATEGORIES = ["TECHNICAL", "PAYMENT", "STUDENT", "COURSE", "OTHER"] as const satisfies readonly SupportTicketCategory[];
export const STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const satisfies readonly SupportTicketStatus[];
const STATUS_LABEL: Record<SupportTicketStatus, string> = { OPEN: "Open", IN_PROGRESS: "In progress", RESOLVED: "Resolved", CLOSED: "Closed" };

const parse = <T extends z.ZodType>(schema: T, input: unknown): z.infer<T> => {
  const r = schema.safeParse(input ?? {});
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? "Invalid request", { code: "INVALID_REQUEST" });
  return r.data;
};
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const body = z.string().trim().min(1, "Write a message").max(5000, "Messages are at most 5000 characters");

/** Admin reads and writes re-check the role in the database (the session token's role can be stale). */
async function requireAdmin(db: Tx | typeof prisma, actorId: string, lock = false) {
  const role = lock
    ? (await (db as Tx).$queryRaw<{ role: string }[]>`SELECT "role"::text AS "role" FROM "User" WHERE "id" = ${actorId} FOR SHARE`)[0]?.role
    : (await db.user.findUnique({ where: { id: actorId }, select: { role: true } }))?.role;
  if (role !== "ADMIN") throw new HttpError(403, "Admin access required");
}

async function nextTicketNo(tx: Tx, now: Date) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('eta-support-ticket-no'))`;
  const prefix = `FT-${now.getUTCFullYear()}-`;
  const last = await tx.supportTicket.findFirst({ where: { ticketNo: { startsWith: prefix } }, orderBy: { ticketNo: "desc" }, select: { ticketNo: true } });
  return `${prefix}${String((last ? Number(last.ticketNo.slice(prefix.length)) : 0) + 1).padStart(6, "0")}`;
}

/** Locks one ticket; with a partner context, only that franchise's ticket is found (anything else is 404). */
async function lockTicket(tx: Tx, id: string, ctx?: PartnerContext) {
  const rows = ctx
    ? await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "SupportTicket" WHERE "id" = ${id} AND "partnerId" = ${ctx.partnerId} FOR UPDATE`
    : await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "SupportTicket" WHERE "id" = ${id} FOR UPDATE`;
  if (!rows.length) throw new HttpError(404, "Not found");
  return tx.supportTicket.findUniqueOrThrow({ where: { id } });
}

/** After the commit: the partner owner hears about ETA's replies and decisions (status + link only). */
async function notifyPartner(ticketId: string, kind: "REPLY" | "STATUS") {
  const t = await prisma.supportTicket.findUnique({ where: { id: ticketId }, select: { ticketNo: true, status: true, partner: { select: { user: { select: { email: true } } } } } });
  if (!t) return;
  const link = `${env.siteUrl}/franchise-partner/support/${ticketId}`;
  let result = "SENT";
  try {
    await sendEmail({
      to: t.partner.user.email,
      subject: `Support ticket ${t.ticketNo}: ${kind === "REPLY" ? "new reply from ETA" : STATUS_LABEL[t.status]}`,
      html:
        `<p>Your support ticket <strong>${escapeHtml(t.ticketNo)}</strong> ${kind === "REPLY" ? "has a new reply from ETA" : `is now <strong>${escapeHtml(STATUS_LABEL[t.status])}</strong>`}.</p>` +
        `<p>Sign in to read it: <a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`,
    });
  } catch (e) {
    result = "FAILED";
    console.error("[FRANCHISE] ticket notification failed", { ticketId, error: e instanceof Error ? e.name : "Error" });
  }
  await prisma.auditLog.create({ data: { actorId: null, action: "FRANCHISE_TICKET_NOTIFIED", target: ticketId, metadata: { kind, result } } }).catch(() => {});
}

// ---------- Partner ----------

const createSchema = z
  .object({
    subject: z.string().trim().min(5, "Give the ticket a subject of at least 5 characters").max(150),
    category: z.enum(CATEGORIES),
    message: body,
  })
  .strict();

export async function partnerCreateTicket(ctx: PartnerContext, actorId: string, input: unknown) {
  const v = parse(createSchema, input);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const ticket = await tx.supportTicket.create({
      data: { ticketNo: await nextTicketNo(tx, now), partnerId: ctx.partnerId, openedById: actorId, subject: v.subject, category: v.category, awaiting: "ETA", lastMessageAt: now, createdAt: now },
    });
    const msg = await tx.supportTicketMessage.create({ data: { ticketId: ticket.id, authorId: actorId, authorRole: "PARTNER", body: v.message, createdAt: now } });
    await tx.auditLog.create({ data: { actorId, action: "FRANCHISE_TICKET_CREATED", target: ticket.id, metadata: { partnerId: ctx.partnerId, category: v.category, messageId: msg.id } } });
    return { id: ticket.id, ticketNo: ticket.ticketNo, status: ticket.status };
  });
}

const listSchema = z.object({ status: z.enum(STATUSES).optional() });
const ticketRow = (t: { id: string; ticketNo: string; subject: string; category: string; status: string; awaiting: string; lastMessageAt: Date; createdAt: Date }) => ({
  id: t.id,
  ticketNo: t.ticketNo,
  subject: t.subject,
  category: t.category,
  status: t.status,
  awaiting: t.awaiting,
  lastMessageAt: t.lastMessageAt,
  createdAt: t.createdAt,
});

export async function partnerListTickets(ctx: PartnerContext, query: unknown) {
  const f = parse(listSchema, query);
  const rows = await prisma.supportTicket.findMany({ where: { partnerId: ctx.partnerId, ...(f.status ? { status: f.status } : {}) }, orderBy: { lastMessageAt: "desc" }, take: 200 });
  return rows.map(ticketRow);
}

/** One of the franchise's own tickets, without ETA's internal notes. */
export async function partnerTicketDetail(ctx: PartnerContext, id: string) {
  const t = await prisma.supportTicket.findFirst({
    where: { id, partnerId: ctx.partnerId },
    include: {
      messages: { where: { internal: false }, orderBy: { createdAt: "asc" }, select: { id: true, authorRole: true, body: true, createdAt: true } },
      events: { orderBy: { createdAt: "asc" }, select: { id: true, actorRole: true, fromStatus: true, toStatus: true, createdAt: true } },
    },
  });
  if (!t) throw new HttpError(404, "Not found");
  return { ...ticketRow(t), version: t.version, messages: t.messages, events: t.events };
}

/** A partner reply; replying to a RESOLVED ticket re-opens it. */
export async function partnerReply(ctx: PartnerContext, actorId: string, id: string, input: unknown) {
  const v = parse(z.object({ body }).strict(), input);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const t = await lockTicket(tx, id, ctx);
    if (t.status === "CLOSED") throw new HttpError(409, "This ticket is closed. Open a new ticket instead.", { code: "TICKET_CLOSED" });
    const msg = await tx.supportTicketMessage.create({ data: { ticketId: id, authorId: actorId, authorRole: "PARTNER", body: v.body, createdAt: now } });
    const reopen = t.status === "RESOLVED";
    await tx.supportTicket.update({ where: { id }, data: { lastMessageAt: now, awaiting: "ETA", version: { increment: 1 }, ...(reopen ? { status: "OPEN", resolvedAt: null } : {}) } });
    if (reopen) await tx.supportTicketEvent.create({ data: { ticketId: id, actorId, actorRole: "PARTNER", fromStatus: "RESOLVED", toStatus: "OPEN", note: "Re-opened by a reply" } });
    await tx.auditLog.create({ data: { actorId, action: "FRANCHISE_TICKET_REPLIED", target: id, metadata: { messageId: msg.id, by: "PARTNER", reopened: reopen } } });
    return { messageId: msg.id, status: reopen ? "OPEN" : t.status };
  });
}

/** The partner closes its own ticket (version-guarded). */
export async function partnerClose(ctx: PartnerContext, actorId: string, id: string, input: unknown) {
  const v = parse(z.object({ expectedVersion: z.number().int().min(0) }).strict(), input);
  return prisma.$transaction(async (tx) => {
    const t = await lockTicket(tx, id, ctx);
    return changeStatus(tx, t, "CLOSED", v.expectedVersion, actorId, "PARTNER", null);
  });
}

// ---------- Shared status change ----------

async function changeStatus(tx: Tx, t: { id: string; status: SupportTicketStatus; version: number }, to: SupportTicketStatus, expectedVersion: number, actorId: string, role: "PARTNER" | "ADMIN", note: string | null) {
  if (t.status === "CLOSED") throw new HttpError(409, "This ticket is closed.", { code: "TICKET_CLOSED" });
  if (t.status === to) throw new HttpError(409, `This ticket is already ${STATUS_LABEL[to].toLowerCase()}.`, { code: "NO_CHANGE" });
  if (t.version !== expectedVersion) throw new HttpError(409, "This ticket changed since you opened it — reload and try again.", { code: "STALE" });
  const now = new Date();
  const { count } = await tx.supportTicket.updateMany({
    where: { id: t.id, version: expectedVersion, status: t.status },
    data: {
      status: to,
      version: { increment: 1 },
      // Resolved and closed tickets wait on nobody; open or in-progress ones wait on ETA.
      awaiting: to === "RESOLVED" || to === "CLOSED" ? "NONE" : "ETA",
      resolvedAt: to === "RESOLVED" ? now : to === "OPEN" || to === "IN_PROGRESS" ? null : undefined,
      ...(to === "CLOSED" ? { closedAt: now, closedById: actorId } : {}),
    },
  });
  if (count !== 1) throw new HttpError(409, "This ticket changed since you opened it — reload and try again.", { code: "STALE" });
  await tx.supportTicketEvent.create({ data: { ticketId: t.id, actorId, actorRole: role, fromStatus: t.status, toStatus: to, note } });
  await tx.auditLog.create({ data: { actorId, action: "FRANCHISE_TICKET_STATUS_CHANGED", target: t.id, metadata: { from: t.status, to, by: role } } });
  return { id: t.id, status: to, version: expectedVersion + 1 };
}

// ---------- Admin ----------

const adminListSchema = z.object({
  status: z.enum(STATUSES).optional(),
  category: z.enum(CATEGORIES).optional(),
  awaiting: z.enum(["ETA", "PARTNER", "NONE"]).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

export async function adminListTickets(actorId: string, query: unknown) {
  await requireAdmin(prisma, actorId);
  const f = parse(adminListSchema, query);
  const where: Prisma.SupportTicketWhereInput = {
    ...(f.status ? { status: f.status } : {}),
    ...(f.category ? { category: f.category } : {}),
    ...(f.awaiting ? { awaiting: f.awaiting } : {}),
    ...(f.q ? { OR: [{ ticketNo: { contains: f.q, mode: "insensitive" } }, { subject: { contains: f.q, mode: "insensitive" } }, { partner: { franchiseCode: { contains: f.q, mode: "insensitive" } } }] } : {}),
  };
  const pageSize = 25;
  const [total, rows, awaitingEta] = await Promise.all([
    prisma.supportTicket.count({ where }),
    prisma.supportTicket.findMany({ where, orderBy: { lastMessageAt: "desc" }, skip: (f.page - 1) * pageSize, take: pageSize, include: { partner: { select: { franchiseCode: true } } } }),
    prisma.supportTicket.count({ where: { awaiting: "ETA" } }),
  ]);
  return { page: f.page, pageSize, total, awaitingEta, tickets: rows.map((t) => ({ ...ticketRow(t), franchiseCode: t.partner.franchiseCode })) };
}

/** Any ticket, including internal notes. Every view is audited. */
export async function adminTicketDetail(actorId: string, id: string) {
  await requireAdmin(prisma, actorId);
  const t = await prisma.supportTicket.findUnique({
    where: { id },
    include: {
      partner: { select: { id: true, franchiseCode: true, status: true, user: { select: { name: true } }, district: { select: { name: true } } } },
      messages: { orderBy: { createdAt: "asc" }, select: { id: true, authorRole: true, body: true, internal: true, createdAt: true, author: { select: { name: true } } } },
      events: { orderBy: { createdAt: "asc" }, select: { id: true, actorRole: true, fromStatus: true, toStatus: true, note: true, createdAt: true, actor: { select: { name: true } } } },
    },
  });
  if (!t) throw new HttpError(404, "Not found");
  await prisma.auditLog.create({ data: { actorId, action: "FRANCHISE_TICKET_VIEWED", target: id, metadata: { ticketNo: t.ticketNo } } });
  return {
    ...ticketRow(t),
    version: t.version,
    partner: { id: t.partner.id, franchiseCode: t.partner.franchiseCode, status: t.partner.status, ownerName: t.partner.user.name, district: t.partner.district.name },
    messages: t.messages.map((m) => ({ id: m.id, authorRole: m.authorRole, authorName: m.author.name, body: m.body, internal: m.internal, createdAt: m.createdAt })),
    events: t.events.map((e) => ({ id: e.id, actorRole: e.actorRole, actorName: e.actor.name, fromStatus: e.fromStatus, toStatus: e.toStatus, note: e.note, createdAt: e.createdAt })),
  };
}

/** A reply to the partner, or an internal note (never shown to the partner, no email). */
export async function adminReply(actorId: string, id: string, input: unknown) {
  const v = parse(z.object({ body, internal: z.boolean().default(false) }).strict(), input);
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    await requireAdmin(tx, actorId, true);
    const t = await lockTicket(tx, id);
    if (t.status === "CLOSED") throw new HttpError(409, "This ticket is closed.", { code: "TICKET_CLOSED" });
    const msg = await tx.supportTicketMessage.create({ data: { ticketId: id, authorId: actorId, authorRole: "ADMIN", body: v.body, internal: v.internal, createdAt: now } });
    if (!v.internal) {
      // A public reply hands the ticket back to the partner (unless it's already resolved).
      await tx.supportTicket.update({ where: { id }, data: { lastMessageAt: now, version: { increment: 1 }, ...(t.status === "RESOLVED" ? {} : { awaiting: "PARTNER" }) } });
    }
    await tx.auditLog.create({ data: { actorId, action: "FRANCHISE_TICKET_REPLIED", target: id, metadata: { messageId: msg.id, by: "ADMIN", internal: v.internal } } });
    return { messageId: msg.id, internal: v.internal };
  });
  if (!result.internal) await notifyPartner(id, "REPLY");
  return result;
}

export async function adminChangeStatus(actorId: string, id: string, input: unknown) {
  const v = parse(z.object({ to: z.enum(STATUSES), expectedVersion: z.number().int().min(0), note: z.string().trim().max(1000).optional() }).strict(), input);
  const result = await prisma.$transaction(async (tx) => {
    await requireAdmin(tx, actorId, true);
    const t = await lockTicket(tx, id);
    return changeStatus(tx, t, v.to, v.expectedVersion, actorId, "ADMIN", v.note || null);
  });
  if (v.to === "RESOLVED" || v.to === "CLOSED") await notifyPartner(id, "STATUS");
  return result;
}
