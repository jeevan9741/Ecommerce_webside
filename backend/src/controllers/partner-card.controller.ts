import type { Request, Response } from "express";
import { randomBytes } from "node:crypto";
import type { PartnerCard, PartnerCardRequest, PartnerCardStatus, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { currentUser } from "../middleware/auth.middleware.js";
import { HttpError, param } from "../utils/http.js";
import { rateLimit } from "../utils/rate-limit.js";
import { getRazorpayClient, RazorpayConfigError } from "../services/razorpay.service.js";
import {
  PARTNER_CARD_SETTINGS_KEY,
  formatPartnerId,
  getPartnerCardSettings,
  issueCard,
  newQrToken,
  qrPath,
  quoteNextCard,
  reconcileRequestPayment,
} from "../services/partner-card.service.js";
import {
  partnerCardAdminIssueSchema,
  partnerCardAdminUpdateSchema,
  partnerCardPhotoSchema,
  partnerCardReissueSchema,
  partnerCardRequestSchema,
  partnerCardReviewSchema,
  partnerCardSettingsSchema,
  partnerCardStatusSchema,
} from "../utils/validation.js";

const DEFAULT_ROLE = "Authorized Business Partner";
const FREE_CARD_USED = "You have already received your free Partner ID Card. Reissue charges apply.";

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

async function audit(actorId: string, action: string, target: string, metadata?: Prisma.InputJsonValue) {
  await prisma.auditLog.create({ data: { actorId, action, target, metadata } });
}

/** The partial unique index allows one open request per card; a concurrent duplicate lands here. */
function duplicateOpenRequest(err: unknown): never {
  if ((err as { code?: string }).code === "P2002") {
    throw new HttpError(409, "You already have a Partner ID card request in progress.");
  }
  throw err;
}

/** Request rows without the (large) photo, for history lists. */
const requestSummarySelect = {
  id: true,
  kind: true,
  status: true,
  paymentStatus: true,
  feeInPaise: true,
  fullName: true,
  location: true,
  phone: true,
  reason: true,
  razorpayPaymentId: true,
  paidAt: true,
  adminNote: true,
  reviewedAt: true,
  issueNumber: true,
  createdAt: true,
} satisfies Prisma.PartnerCardRequestSelect;

const OPEN: PartnerCardRequest["status"][] = ["AWAITING_PAYMENT", "PENDING"];

/** Serialises review/reissue of one card, so two admins acting at once can't both issue it. */
async function lockCard(tx: Prisma.TransactionClient, cardId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`partner-card:${cardId}`}))`;
}

function findOpenRequest(cardId: string, tx: Prisma.TransactionClient = prisma) {
  return tx.partnerCardRequest.findFirst({ where: { cardId, status: { in: OPEN } } });
}

/**
 * Creates the card (partner ID from the row's own sequence number) together with its first
 * request, in one transaction so a failure can't leave a card with the placeholder ID.
 */
async function createCardWithRequest(
  card: Omit<Prisma.PartnerCardUncheckedCreateInput, "partnerId" | "qrToken" | "qrCodeUrl">,
  request: Pick<PartnerCardRequest, "status"> & Partial<Pick<PartnerCardRequest, "reviewedAt" | "reviewedById" | "issueNumber">>
) {
  return prisma.$transaction(async (tx) => {
    const placeholder = `tmp-${randomBytes(8).toString("hex")}`;
    const qrToken = newQrToken();
    const created = await tx.partnerCard.create({ data: { ...card, partnerId: placeholder, qrToken, qrCodeUrl: "" } });
    const partnerId = formatPartnerId(created.number);
    const saved = await tx.partnerCard.update({
      where: { id: created.id },
      data: { partnerId, qrCodeUrl: qrPath(partnerId, qrToken) },
    });
    await tx.partnerCardRequest.create({
      data: {
        cardId: saved.id,
        userId: saved.userId,
        kind: "FREE",
        paymentStatus: "NOT_REQUIRED",
        fullName: saved.fullName,
        location: saved.location,
        phone: saved.phone,
        photo: saved.photo,
        ...request,
      },
    });
    return saved;
  });
}

/** Everything the partner's page needs: card, policy position, open request and history. */
async function partnerView(userId: string) {
  const [card, settings] = await Promise.all([
    prisma.partnerCard.findUnique({ where: { userId } }),
    getPartnerCardSettings(),
  ]);
  const quote = quoteNextCard(card, settings);
  const [openRequest, history] = card
    ? await Promise.all([
        findOpenRequest(card.id),
        prisma.partnerCardRequest.findMany({ where: { cardId: card.id }, select: requestSummarySelect, orderBy: { createdAt: "desc" }, take: 20 }),
      ])
    : [null, []];
  return {
    card,
    openRequest,
    history,
    policy: {
      issued: card?.issued ?? false,
      firstIssuedAt: card?.firstIssuedAt ?? null,
      issueCount: card?.issueCount ?? 0,
      freeCardsAllowed: settings.freeCardsAllowed,
      freeCardsRemaining: quote.freeCardsRemaining,
      nextCardFree: quote.free,
      reissueFeeInPaise: quote.free ? 0 : quote.feeInPaise,
      paymentRequired: quote.paymentRequired,
    },
  };
}

// ---------- Partner (signed-in user) ----------

export async function getMyPartnerCard(req: Request, res: Response) {
  const session = currentUser(req);
  const [view, user] = await Promise.all([
    partnerView(session.id),
    prisma.user.findUniqueOrThrow({ where: { id: session.id }, select: { name: true, email: true, phone: true } }),
  ]);
  res.json({ ...view, defaults: { fullName: user.name, email: user.email, phone: user.phone ?? "" } });
}

/**
 * The free card request: the first submission, or a resubmission after a rejection. Once a card
 * has been issued this is locked — further cards go through the (paid) reissue flow.
 */
export async function requestPartnerCard(req: Request, res: Response) {
  const session = currentUser(req);
  if (!rateLimit(`partner-card-request:${session.id}`, 10, 60 * 60 * 1000)) {
    throw new HttpError(429, "Too many requests. Try again later.");
  }
  const body = firstIssue(partnerCardRequestSchema.safeParse(req.body));
  const [user, existing, settings] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: session.id }, select: { email: true } }),
    prisma.partnerCard.findUnique({ where: { userId: session.id } }),
    getPartnerCardSettings(),
  ]);

  if (existing?.issued || (existing && !quoteNextCard(existing, settings).free)) throw new HttpError(409, FREE_CARD_USED);
  if (existing && existing.status !== "REJECTED") {
    throw new HttpError(409, "Your Partner ID card request is already being reviewed.");
  }

  let card: PartnerCard;
  if (existing) {
    card = await prisma
      .$transaction(async (tx) => {
        const updated = await tx.partnerCard.update({
          where: { id: existing.id },
          data: { ...body, email: user.email, status: "PENDING", adminNote: null },
        });
        await tx.partnerCardRequest.create({
          data: { cardId: existing.id, userId: session.id, kind: "FREE", status: "PENDING", paymentStatus: "NOT_REQUIRED", ...body },
        });
        return updated;
      })
      .catch(duplicateOpenRequest);
  } else {
    card = await createCardWithRequest(
      { userId: session.id, ...body, email: user.email, role: DEFAULT_ROLE, status: "PENDING" },
      { status: "PENDING" }
    ).catch((err) => {
      // Two first requests at once: the second hits PartnerCard.userId's unique index.
      if ((err as { code?: string }).code === "P2002") throw new HttpError(409, "Your Partner ID card request is already being reviewed.");
      throw err;
    });
  }

  await audit(session.id, existing ? "PARTNER_CARD_RESUBMITTED" : "PARTNER_CARD_REQUESTED", card.id);
  res.status(existing ? 200 : 201).json(await partnerView(session.id));
}

/** Photo changes are part of the request while it's under review; after issue they need a reissue. */
export async function updateMyPartnerCardPhoto(req: Request, res: Response) {
  const session = currentUser(req);
  if (!rateLimit(`partner-card-photo:${session.id}`, 20, 60 * 60 * 1000)) {
    throw new HttpError(429, "Too many photo changes. Try again later.");
  }
  const { photo } = firstIssue(partnerCardPhotoSchema.safeParse(req.body));
  const existing = await prisma.partnerCard.findUnique({ where: { userId: session.id } });
  if (!existing) throw new HttpError(404, "Request your Partner ID card first.");
  if (existing.status !== "PENDING") {
    throw new HttpError(409, "Your card has been issued — request a reissue to change the photo.");
  }

  await prisma.$transaction([
    prisma.partnerCard.update({ where: { id: existing.id }, data: { photo } }),
    prisma.partnerCardRequest.updateMany({ where: { cardId: existing.id, kind: "FREE", status: "PENDING" }, data: { photo } }),
  ]);
  await audit(session.id, "PARTNER_CARD_PHOTO_UPDATED", existing.id);
  res.json(await partnerView(session.id));
}

/** A further card after the free one: needs a reason, the fee (when payment is on) and admin approval. */
export async function requestPartnerCardReissue(req: Request, res: Response) {
  const session = currentUser(req);
  if (!rateLimit(`partner-card-reissue:${session.id}`, 10, 60 * 60 * 1000)) {
    throw new HttpError(429, "Too many requests. Try again later.");
  }
  const body = firstIssue(partnerCardReissueSchema.safeParse(req.body));
  const [card, settings] = await Promise.all([
    prisma.partnerCard.findUnique({ where: { userId: session.id } }),
    getPartnerCardSettings(),
  ]);
  if (!card?.issued) throw new HttpError(409, "Submit your Partner ID Card request first — your first card is free.");
  if (card.status === "INACTIVE") throw new HttpError(409, "This card is deactivated. Contact the academy.");

  const quote = quoteNextCard(card, settings);
  const request = await prisma.partnerCardRequest
    .create({
      data: {
        cardId: card.id,
        userId: session.id,
        kind: "REISSUE",
        status: quote.paymentRequired ? "AWAITING_PAYMENT" : "PENDING",
        paymentStatus: quote.paymentRequired ? "PENDING" : "NOT_REQUIRED",
        feeInPaise: quote.paymentRequired ? quote.feeInPaise : 0,
        fullName: body.fullName,
        location: body.location,
        phone: body.phone,
        photo: body.photo ?? null,
        reason: body.reason,
      },
    })
    .catch(duplicateOpenRequest);

  await audit(session.id, "PARTNER_CARD_REISSUE_REQUESTED", request.id, { feeInPaise: request.feeInPaise });
  res.status(201).json(await partnerView(session.id));
}

async function ownRequest(req: Request) {
  const session = currentUser(req);
  const request = await prisma.partnerCardRequest.findUnique({ where: { id: param(req, "requestId") } });
  if (!request || request.userId !== session.id) throw new HttpError(404, "Request not found");
  return { session, request };
}

/** Starts (or resumes) Razorpay checkout for a reissue fee. */
export async function payPartnerCardRequest(req: Request, res: Response) {
  const { session, request } = await ownRequest(req);
  if (request.status !== "AWAITING_PAYMENT" || request.paymentStatus !== "PENDING") {
    throw new HttpError(409, "This request doesn't need a payment.");
  }

  let razorpayOrderId = request.razorpayOrderId;
  try {
    if (!razorpayOrderId) {
      const order = await getRazorpayClient().orders.create({
        amount: request.feeInPaise,
        currency: "INR",
        receipt: `pcr_${request.id}`.slice(0, 40),
        notes: { purpose: "partner_card_reissue", requestId: request.id, userId: session.id },
      });
      razorpayOrderId = order.id;
      // Conditional so a double click can't attach two orders to one request.
      const { count } = await prisma.partnerCardRequest.updateMany({
        where: { id: request.id, razorpayOrderId: null },
        data: { razorpayOrderId },
      });
      if (count === 0) {
        razorpayOrderId = (await prisma.partnerCardRequest.findUniqueOrThrow({ where: { id: request.id } })).razorpayOrderId;
      }
    }
  } catch (err) {
    if (err instanceof RazorpayConfigError) throw new HttpError(503, "Payment service is temporarily unavailable. Please try again shortly.");
    console.error("[PARTNER_CARD] Razorpay order creation failed", err);
    throw new HttpError(502, "Payment service is temporarily unavailable. Please try again shortly.");
  }

  res.json({
    razorpayOrderId,
    amountInPaise: request.feeInPaise,
    currency: "INR",
    keyId: env.razorpay.keyId,
    description: "Partner ID Card reissue",
  });
}

/** Called after checkout succeeds; asks Razorpay directly, so the client's word is never trusted. */
export async function confirmPartnerCardPayment(req: Request, res: Response) {
  const { session, request } = await ownRequest(req);
  try {
    const result = await reconcileRequestPayment(request);
    res.json({ ...result, ...(await partnerView(session.id)) });
  } catch (err) {
    if (err instanceof RazorpayConfigError) throw new HttpError(503, "Payment service is temporarily unavailable.");
    console.error("[PARTNER_CARD] Payment confirmation failed", err);
    throw new HttpError(502, "Could not confirm the payment yet. Please try again in a minute.");
  }
}

export async function cancelPartnerCardRequest(req: Request, res: Response) {
  const { session, request } = await ownRequest(req);
  // A paid request stays with the admin (who can refund); only unpaid ones can be withdrawn.
  const { count } = await prisma.partnerCardRequest.updateMany({
    where: { id: request.id, kind: "REISSUE", status: { in: OPEN }, paymentStatus: { in: ["PENDING", "NOT_REQUIRED"] } },
    data: { status: "CANCELLED" },
  });
  if (count === 0) throw new HttpError(409, "This request can no longer be cancelled.");
  await audit(session.id, "PARTNER_CARD_REQUEST_CANCELLED", request.id);
  res.json(await partnerView(session.id));
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
  // Cards that were never issued aren't part of the public register.
  if (!card || !card.issued || card.status === "PENDING" || card.status === "REJECTED") {
    throw new HttpError(404, "Partner not found");
  }

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
      // "superseded" = scanned from a card printed before the card was reissued.
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
  issued: true,
  firstIssuedAt: true,
  issueCount: true,
  issuedAt: true,
  reissueFeeInPaise: true,
  createdAt: true,
  updatedAt: true,
  requests: {
    where: { status: { in: OPEN } },
    select: { id: true, kind: true, status: true, paymentStatus: true, feeInPaise: true },
    take: 1,
  },
} satisfies Prisma.PartnerCardSelect;

export async function adminListPartnerCards(req: Request, res: Response) {
  const filter = typeof req.query.status === "string" ? req.query.status.toUpperCase() : "";
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const statuses: PartnerCardStatus[] = ["PENDING", "ACTIVE", "REJECTED", "INACTIVE"];

  const where: Prisma.PartnerCardWhereInput = {
    ...(statuses.includes(filter as PartnerCardStatus) ? { status: filter as PartnerCardStatus } : {}),
    // "REISSUE" = cards with an open reissue request (paid or awaiting payment).
    ...(filter === "REISSUE" ? { requests: { some: { kind: "REISSUE", status: { in: OPEN } } } } : {}),
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

  const [cards, counts, reissues] = await Promise.all([
    prisma.partnerCard.findMany({ where, select: listSelect, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 200 }),
    prisma.partnerCard.groupBy({ by: ["status"], _count: true }),
    prisma.partnerCardRequest.count({ where: { kind: "REISSUE", status: { in: OPEN } } }),
  ]);
  res.json({
    cards: cards.map(({ requests, ...card }) => ({ ...card, openRequest: requests[0] ?? null })),
    counts: {
      ...Object.fromEntries(statuses.map((s) => [s, counts.find((c) => c.status === s)?._count ?? 0])),
      REISSUE: reissues,
    },
  });
}

export async function adminGetPartnerCard(req: Request, res: Response) {
  const card = await prisma.partnerCard.findUnique({ where: { id: param(req, "id") } });
  if (!card) throw new HttpError(404, "Card not found");
  const [openRequest, history, settings] = await Promise.all([
    findOpenRequest(card.id),
    prisma.partnerCardRequest.findMany({ where: { cardId: card.id }, select: requestSummarySelect, orderBy: { createdAt: "desc" } }),
    getPartnerCardSettings(),
  ]);
  res.json({ card, openRequest, history, quote: quoteNextCard(card, settings) });
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

  const now = new Date();
  const card = await createCardWithRequest(
    {
      userId: user.id,
      // Card text must be Latin (see validation); the admin can correct the name afterwards.
      fullName: user.name.replace(/[^A-Za-z .'-]/g, "").trim().slice(0, 40) || "Partner",
      email: user.email,
      phone: user.phone ?? "",
      location: body.location,
      role: DEFAULT_ROLE,
      status: "ACTIVE",
      validFrom: body.validFrom ? parseDay(body.validFrom) : today(),
      issued: true,
      firstIssuedAt: now,
      issuedAt: now,
      issueCount: 1,
    },
    { status: "ISSUED", reviewedAt: now, reviewedById: admin.id, issueNumber: 1 }
  );
  await audit(admin.id, "PARTNER_CARD_ISSUED", card.id);
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
  await audit(admin.id, "PARTNER_CARD_UPDATED", card.id, { fields: Object.keys(body) });
  res.json({ card });
}

/**
 * Approves or rejects the card's open request. Approval generates the card (first issue or
 * reissue) in the same transaction; a reissue can only be approved once its fee is settled.
 */
export async function adminReviewPartnerCard(req: Request, res: Response) {
  const admin = currentUser(req);
  const body = firstIssue(partnerCardReviewSchema.safeParse(req.body));
  const cardId = param(req, "id");
  const approve = body.action === "APPROVE";
  const note = body.adminNote || null;

  const card = await prisma.$transaction(async (tx) => {
    await lockCard(tx, cardId);
    const card = await tx.partnerCard.findUnique({ where: { id: cardId } });
    if (!card) throw new HttpError(404, "Card not found");
    const request = await findOpenRequest(cardId, tx);
    if (!request) throw new HttpError(409, "There is no request waiting for review — it may already have been reviewed.");
    if (approve && request.status === "AWAITING_PAYMENT") {
      throw new HttpError(409, "The reissue fee hasn't been paid yet. Waive it or wait for the payment.");
    }

    if (!approve) {
      await tx.partnerCardRequest.update({
        where: { id: request.id },
        data: { status: "REJECTED", adminNote: note, reviewedAt: new Date(), reviewedById: admin.id },
      });
      // A rejected first request leaves the card unissued; a rejected reissue keeps the current card.
      return request.kind === "FREE"
        ? tx.partnerCard.update({ where: { id: cardId }, data: { status: "REJECTED", adminNote: note } })
        : card;
    }
    const validFrom = body.validFrom ? parseDay(body.validFrom) : request.kind === "FREE" ? today() : undefined;
    return issueCard(tx, card, request, { adminId: admin.id, validFrom, adminNote: note });
  });

  await audit(admin.id, approve ? "PARTNER_CARD_APPROVED" : "PARTNER_CARD_REJECTED", card.id, { issueCount: card.issueCount });
  res.json({ card });
}

/** Lets an admin settle a reissue fee offline (cash, UPI outside the site) or waive it. */
export async function adminWaivePartnerCardFee(req: Request, res: Response) {
  const admin = currentUser(req);
  const cardId = param(req, "id");
  const { count } = await prisma.partnerCardRequest.updateMany({
    where: { cardId, status: "AWAITING_PAYMENT", paymentStatus: "PENDING" },
    data: { status: "PENDING", paymentStatus: "WAIVED" },
  });
  if (count === 0) throw new HttpError(409, "There is no unpaid reissue request on this card.");
  await audit(admin.id, "PARTNER_CARD_FEE_WAIVED", cardId);
  res.json({ ok: true });
}

export async function adminSetPartnerCardStatus(req: Request, res: Response) {
  const admin = currentUser(req);
  const body = firstIssue(partnerCardStatusSchema.safeParse(req.body));
  const id = param(req, "id");

  // Activate/deactivate only toggles issued cards; pending requests go through review instead.
  const { count } = await prisma.partnerCard.updateMany({
    where: { id, issued: true, status: { in: ["ACTIVE", "INACTIVE"] } },
    data: { status: body.status, ...(body.adminNote !== undefined ? { adminNote: body.adminNote || null } : {}) },
  });
  if (count === 0) throw new HttpError(409, "Only issued cards can be activated or deactivated.");
  const card = await prisma.partnerCard.findUniqueOrThrow({ where: { id } });
  await audit(admin.id, body.status === "ACTIVE" ? "PARTNER_CARD_ACTIVATED" : "PARTNER_CARD_DEACTIVATED", card.id);
  res.json({ card });
}

/**
 * Admin-initiated reissue (e.g. a card printed wrongly): generates a new issue with the current
 * details at no charge, recorded in the reissue history with the fee waived.
 */
export async function adminReissuePartnerCard(req: Request, res: Response) {
  const admin = currentUser(req);
  const cardId = param(req, "id");

  const card = await prisma.$transaction(async (tx) => {
    await lockCard(tx, cardId);
    const existing = await tx.partnerCard.findUnique({ where: { id: cardId } });
    if (!existing) throw new HttpError(404, "Card not found");
    if (!existing.issued) throw new HttpError(409, "Approve the first request before reissuing the card.");
    if (await findOpenRequest(cardId, tx)) throw new HttpError(409, "Review the partner's open request first.");
    const request = await tx.partnerCardRequest.create({
      data: {
        cardId,
        userId: existing.userId,
        kind: "REISSUE",
        status: "PENDING",
        paymentStatus: "WAIVED",
        fullName: existing.fullName,
        location: existing.location,
        phone: existing.phone,
        reason: "Reissued by the academy",
      },
    });
    return issueCard(tx, existing, request, { adminId: admin.id });
  });
  await audit(admin.id, "PARTNER_CARD_REISSUED", card.id, { issueCount: card.issueCount });
  res.json({ card });
}

// ---------- Settings ----------

export async function adminGetPartnerCardSettings(_req: Request, res: Response) {
  res.json({ settings: await getPartnerCardSettings() });
}

export async function adminSavePartnerCardSettings(req: Request, res: Response) {
  const admin = currentUser(req);
  const settings = firstIssue(partnerCardSettingsSchema.safeParse(req.body));
  await prisma.siteSetting.upsert({
    where: { key: PARTNER_CARD_SETTINGS_KEY },
    update: { value: settings },
    create: { key: PARTNER_CARD_SETTINGS_KEY, value: settings },
  });
  await audit(admin.id, "PARTNER_CARD_SETTINGS_UPDATED", PARTNER_CARD_SETTINGS_KEY, { ...settings });
  res.json({ settings });
}
