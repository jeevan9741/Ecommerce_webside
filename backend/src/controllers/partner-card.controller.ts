import type { Request, Response } from "express";
import { randomBytes } from "node:crypto";
import type { PartnerCard, PartnerCardStatus, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { currentUser } from "../middleware/auth.middleware.js";
import { HttpError, param } from "../utils/http.js";
import { rateLimit } from "../utils/rate-limit.js";
import {
  partnerCardAdminIssueSchema,
  partnerCardAdminUpdateSchema,
  partnerCardPhotoSchema,
  partnerCardRequestSchema,
  partnerCardReviewSchema,
  partnerCardStatusSchema,
} from "../utils/validation.js";

const DEFAULT_ROLE = "Authorized Business Partner";

/** ECTA-BP001, ECTA-BP002, … — padded to three digits, growing past 999 naturally. */
function formatPartnerId(number: number) {
  return `ECTA-BP${String(number).padStart(3, "0")}`;
}

/** Unguessable per-issue token carried in the QR link; rotating it marks older prints as superseded. */
function newQrToken() {
  return randomBytes(9).toString("base64url");
}

/**
 * Site-relative so the frontend can prefix the public origin — the backend doesn't know which one
 * serves the pages. `t` identifies the print, so the page can flag a superseded card.
 */
function qrPath(partnerId: string, qrToken: string) {
  return `/verify/${partnerId}?t=${qrToken}`;
}

/** Stores a YYYY-MM-DD form value as UTC midnight so it prints as the same calendar day everywhere. */
function parseDay(day: string) {
  return new Date(`${day}T00:00:00.000Z`);
}

function today() {
  return parseDay(new Date().toISOString().slice(0, 10));
}

function firstIssue<T>(result: { success: true; data: T } | { success: false; error: { issues: { message: string }[] } }): T {
  if (!result.success) throw new HttpError(400, result.error.issues[0]?.message ?? "Invalid request");
  return result.data;
}

async function audit(actorId: string, action: string, card: PartnerCard, metadata?: Prisma.InputJsonValue) {
  await prisma.auditLog.create({ data: { actorId, action, target: card.id, metadata } });
}

/**
 * Creates the card and assigns its partner ID from the row's own sequence number, inside one
 * transaction so a failure can never leave a card behind with the placeholder ID.
 */
async function createCard(data: Omit<Prisma.PartnerCardUncheckedCreateInput, "partnerId" | "qrToken" | "qrCodeUrl">) {
  return prisma.$transaction(async (tx) => {
    const placeholder = `tmp-${randomBytes(8).toString("hex")}`;
    const qrToken = newQrToken();
    const created = await tx.partnerCard.create({ data: { ...data, partnerId: placeholder, qrToken, qrCodeUrl: "" } });
    const partnerId = formatPartnerId(created.number);
    return tx.partnerCard.update({
      where: { id: created.id },
      data: { partnerId, qrCodeUrl: qrPath(partnerId, qrToken) },
    });
  });
}

async function findOwnCard(userId: string) {
  return prisma.partnerCard.findUnique({ where: { userId } });
}

// ---------- Partner (signed-in user) ----------

export async function getMyPartnerCard(req: Request, res: Response) {
  const session = currentUser(req);
  const [card, user] = await Promise.all([
    findOwnCard(session.id),
    prisma.user.findUniqueOrThrow({ where: { id: session.id }, select: { name: true, email: true, phone: true } }),
  ]);
  res.json({ card, defaults: { fullName: user.name, email: user.email, phone: user.phone ?? "" } });
}

/** First request, or a resubmission after rejection. Every other state is managed by an admin. */
export async function requestPartnerCard(req: Request, res: Response) {
  const session = currentUser(req);
  if (!rateLimit(`partner-card-request:${session.id}`, 10, 60 * 60 * 1000)) {
    throw new HttpError(429, "Too many requests. Try again later.");
  }
  const body = firstIssue(partnerCardRequestSchema.safeParse(req.body));
  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.id }, select: { email: true } });
  const existing = await findOwnCard(session.id);

  if (existing && existing.status !== "REJECTED") {
    throw new HttpError(409, "You already have a Partner ID card request on file.");
  }

  const card = existing
    ? await prisma.partnerCard.update({
        where: { id: existing.id },
        data: { ...body, email: user.email, status: "PENDING", adminNote: null },
      })
    : await createCard({ userId: session.id, ...body, email: user.email, role: DEFAULT_ROLE, status: "PENDING" });

  await audit(session.id, existing ? "PARTNER_CARD_RESUBMITTED" : "PARTNER_CARD_REQUESTED", card);
  res.status(existing ? 200 : 201).json({ card });
}

export async function updateMyPartnerCardPhoto(req: Request, res: Response) {
  const session = currentUser(req);
  if (!rateLimit(`partner-card-photo:${session.id}`, 20, 60 * 60 * 1000)) {
    throw new HttpError(429, "Too many photo changes. Try again later.");
  }
  const { photo } = firstIssue(partnerCardPhotoSchema.safeParse(req.body));
  const existing = await findOwnCard(session.id);
  if (!existing) throw new HttpError(404, "Request your Partner ID card first.");
  if (existing.status === "INACTIVE") throw new HttpError(409, "This card is deactivated. Contact the academy.");

  const card = await prisma.partnerCard.update({ where: { id: existing.id }, data: { photo } });
  await audit(session.id, "PARTNER_CARD_PHOTO_UPDATED", card);
  res.json({ card });
}

export async function regenerateMyPartnerCardQr(req: Request, res: Response) {
  const session = currentUser(req);
  if (!rateLimit(`partner-card-qr:${session.id}`, 5, 60 * 60 * 1000)) {
    throw new HttpError(429, "QR code was regenerated too many times. Try again later.");
  }
  const existing = await findOwnCard(session.id);
  if (!existing) throw new HttpError(404, "Request your Partner ID card first.");
  if (existing.status !== "ACTIVE") throw new HttpError(409, "The QR code can be regenerated once your card is active.");

  const qrToken = newQrToken();
  const card = await prisma.partnerCard.update({
    where: { id: existing.id },
    data: { qrToken, qrCodeUrl: qrPath(existing.partnerId, qrToken) },
  });
  await audit(session.id, "PARTNER_CARD_QR_REGENERATED", card);
  res.json({ card });
}

/** Full card for rendering exports: the owner's own card, or any card for an admin. */
export async function getPartnerCardForRender(req: Request, res: Response) {
  const session = currentUser(req);
  const card = await prisma.partnerCard.findUnique({ where: { partnerId: param(req, "partnerId") } });
  if (!card || (card.userId !== session.id && session.role !== "ADMIN")) throw new HttpError(404, "Card not found");
  res.json({ card });
}

// ---------- Public verification ----------

export type VerificationState = "VERIFIED" | "NOT_YET_VALID" | "INACTIVE";

export async function verifyPartnerCard(req: Request, res: Response) {
  // Partner IDs are sequential, so throttle scraping the whole register.
  // Generous, since server-rendered lookups from the frontend can share an egress IP.
  if (!rateLimit(`partner-verify:${req.ip}`, 300, 60 * 1000)) {
    throw new HttpError(429, "Too many lookups. Please wait a minute.");
  }
  const partnerId = param(req, "partnerId").toUpperCase();
  const card = await prisma.partnerCard.findUnique({ where: { partnerId } });
  // Requests that were never approved aren't part of the public register.
  if (!card || card.status === "PENDING" || card.status === "REJECTED") throw new HttpError(404, "Partner not found");

  const state: VerificationState =
    card.status === "INACTIVE" ? "INACTIVE" : card.validFrom && card.validFrom > new Date() ? "NOT_YET_VALID" : "VERIFIED";
  const token = typeof req.query.t === "string" ? req.query.t : null;

  res.json({
    partner: {
      partnerId: card.partnerId,
      fullName: card.fullName,
      role: card.role,
      location: card.location,
      validFrom: card.validFrom,
      issuedAt: card.issuedAt,
      status: card.status,
      state,
      // Only an active partner's face is shown publicly; a deactivated card shouldn't keep vouching for anyone.
      photo: card.status === "ACTIVE" ? card.photo : null,
      // "superseded" = scanned from a card printed before the QR was regenerated or the card reissued.
      qr: token === null ? "none" : token === card.qrToken ? "current" : "superseded",
    },
  });
}

// ---------- Admin ----------

const listSelect = {
  id: true,
  userId: true,
  partnerId: true,
  fullName: true,
  role: true,
  location: true,
  email: true,
  phone: true,
  validFrom: true,
  status: true,
  adminNote: true,
  issueCount: true,
  issuedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PartnerCardSelect;

export async function adminListPartnerCards(req: Request, res: Response) {
  const status = typeof req.query.status === "string" ? req.query.status.toUpperCase() : "";
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const statuses: PartnerCardStatus[] = ["PENDING", "ACTIVE", "REJECTED", "INACTIVE"];

  const where: Prisma.PartnerCardWhereInput = {
    ...(statuses.includes(status as PartnerCardStatus) ? { status: status as PartnerCardStatus } : {}),
    ...(q
      ? {
          OR: [
            { fullName: { contains: q, mode: "insensitive" } },
            { partnerId: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            { phone: { contains: q } },
          ],
        }
      : {}),
  };

  const [cards, counts] = await Promise.all([
    prisma.partnerCard.findMany({ where, select: listSelect, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 200 }),
    prisma.partnerCard.groupBy({ by: ["status"], _count: true }),
  ]);
  res.json({
    cards,
    counts: Object.fromEntries(statuses.map((s) => [s, counts.find((c) => c.status === s)?._count ?? 0])),
  });
}

export async function adminGetPartnerCard(req: Request, res: Response) {
  const card = await prisma.partnerCard.findUnique({ where: { id: param(req, "id") } });
  if (!card) throw new HttpError(404, "Card not found");
  res.json({ card });
}

/** Issues an active card straight away for an existing account (no partner request needed). */
export async function adminIssuePartnerCard(req: Request, res: Response) {
  const admin = currentUser(req);
  const body = firstIssue(partnerCardAdminIssueSchema.safeParse(req.body));
  const user = await prisma.user.findUnique({
    where: { email: body.email },
    select: { id: true, name: true, email: true, phone: true, partnerCard: { select: { id: true } } },
  });
  if (!user) throw new HttpError(404, "No account uses that email address.");
  if (user.partnerCard) throw new HttpError(409, "This account already has a Partner ID card.");

  const card = await createCard({
    userId: user.id,
    // Card text must be Latin (see validation); the admin can correct the name afterwards.
    fullName: user.name.replace(/[^A-Za-z .'-]/g, "").trim().slice(0, 40) || "Partner",
    email: user.email,
    phone: user.phone ?? "",
    location: body.location,
    role: DEFAULT_ROLE,
    status: "ACTIVE",
    validFrom: body.validFrom ? parseDay(body.validFrom) : today(),
    issuedAt: new Date(),
  });
  await audit(admin.id, "PARTNER_CARD_ISSUED", card);
  res.status(201).json({ card });
}

export async function adminUpdatePartnerCard(req: Request, res: Response) {
  const admin = currentUser(req);
  const body = firstIssue(partnerCardAdminUpdateSchema.safeParse(req.body));
  const existing = await prisma.partnerCard.findUnique({ where: { id: param(req, "id") } });
  if (!existing) throw new HttpError(404, "Card not found");

  const { validFrom, ...rest } = body;
  const card = await prisma.partnerCard.update({
    where: { id: existing.id },
    data: { ...rest, ...(validFrom !== undefined ? { validFrom: validFrom ? parseDay(validFrom) : null } : {}) },
  });
  await audit(admin.id, "PARTNER_CARD_UPDATED", card, { fields: Object.keys(body) });
  res.json({ card });
}

export async function adminReviewPartnerCard(req: Request, res: Response) {
  const admin = currentUser(req);
  const body = firstIssue(partnerCardReviewSchema.safeParse(req.body));
  const id = param(req, "id");
  const approve = body.action === "APPROVE";

  // Conditional on PENDING so two admins reviewing at once can't both apply.
  const { count } = await prisma.partnerCard.updateMany({
    where: { id, status: "PENDING" },
    data: approve
      ? {
          status: "ACTIVE",
          adminNote: body.adminNote || null,
          validFrom: body.validFrom ? parseDay(body.validFrom) : today(),
          issuedAt: new Date(),
        }
      : { status: "REJECTED", adminNote: body.adminNote || null },
  });
  if (count === 0) {
    const exists = await prisma.partnerCard.count({ where: { id } });
    throw exists ? new HttpError(409, "This request has already been reviewed.") : new HttpError(404, "Card not found");
  }
  const card = await prisma.partnerCard.findUniqueOrThrow({ where: { id } });
  await audit(admin.id, approve ? "PARTNER_CARD_APPROVED" : "PARTNER_CARD_REJECTED", card);
  res.json({ card });
}

export async function adminSetPartnerCardStatus(req: Request, res: Response) {
  const admin = currentUser(req);
  const body = firstIssue(partnerCardStatusSchema.safeParse(req.body));
  const id = param(req, "id");

  // Activate/deactivate only toggles issued cards; pending requests go through review instead.
  const { count } = await prisma.partnerCard.updateMany({
    where: { id, status: { in: ["ACTIVE", "INACTIVE"] } },
    data: { status: body.status, ...(body.adminNote !== undefined ? { adminNote: body.adminNote || null } : {}) },
  });
  if (count === 0) throw new HttpError(409, "Only approved cards can be activated or deactivated.");
  const card = await prisma.partnerCard.findUniqueOrThrow({ where: { id } });
  await audit(admin.id, body.status === "ACTIVE" ? "PARTNER_CARD_ACTIVATED" : "PARTNER_CARD_DEACTIVATED", card);
  res.json({ card });
}

/** New issue of the same card: fresh QR token (old prints show as superseded) and an active status. */
export async function adminReissuePartnerCard(req: Request, res: Response) {
  const admin = currentUser(req);
  const existing = await prisma.partnerCard.findUnique({ where: { id: param(req, "id") } });
  if (!existing) throw new HttpError(404, "Card not found");
  if (existing.status === "PENDING" || existing.status === "REJECTED") {
    throw new HttpError(409, "Approve the request before reissuing the card.");
  }

  const qrToken = newQrToken();
  const card = await prisma.partnerCard.update({
    where: { id: existing.id },
    data: {
      qrToken,
      qrCodeUrl: qrPath(existing.partnerId, qrToken),
      status: "ACTIVE",
      issueCount: { increment: 1 },
      issuedAt: new Date(),
    },
  });
  await audit(admin.id, "PARTNER_CARD_REISSUED", card, { issueCount: card.issueCount });
  res.json({ card });
}
