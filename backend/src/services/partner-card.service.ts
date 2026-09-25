import { randomBytes } from "node:crypto";
import type { PartnerCard, PartnerCardRequest, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { getRazorpayClient } from "./razorpay.service.js";

// ---------- policy settings ----------

export const PARTNER_CARD_SETTINGS_KEY = "partnerCardPolicy";

export interface PartnerCardSettings {
  /** Cards a partner receives without paying (the first card counts). */
  freeCardsAllowed: number;
  reissueFeeInPaise: number;
  /** When off, reissues still need admin approval but no payment. */
  reissuePaymentEnabled: boolean;
}

export const DEFAULT_PARTNER_CARD_SETTINGS: PartnerCardSettings = {
  freeCardsAllowed: 1,
  reissueFeeInPaise: 9900,
  reissuePaymentEnabled: true,
};

export async function getPartnerCardSettings(): Promise<PartnerCardSettings> {
  const row = await prisma.siteSetting.findUnique({ where: { key: PARTNER_CARD_SETTINGS_KEY } });
  const saved = (row?.value ?? {}) as Partial<PartnerCardSettings>;
  return { ...DEFAULT_PARTNER_CARD_SETTINGS, ...saved };
}

export interface CardQuote {
  /** The next card is within the free allowance. */
  free: boolean;
  feeInPaise: number;
  paymentRequired: boolean;
  freeCardsRemaining: number;
}

/** What the partner's next card costs. Decided on the server from cards actually issued. */
export function quoteNextCard(card: Pick<PartnerCard, "issueCount" | "reissueFeeInPaise"> | null, settings: PartnerCardSettings): CardQuote {
  const issued = card?.issueCount ?? 0;
  const free = issued < settings.freeCardsAllowed;
  const feeInPaise = free ? 0 : card?.reissueFeeInPaise ?? settings.reissueFeeInPaise;
  return {
    free,
    feeInPaise,
    paymentRequired: !free && settings.reissuePaymentEnabled && feeInPaise > 0,
    freeCardsRemaining: Math.max(0, settings.freeCardsAllowed - issued),
  };
}

// ---------- issuing ----------

export function formatPartnerId(number: number) {
  return `ECTA-BP${String(number).padStart(3, "0")}`;
}

/** Unguessable per-issue token carried in the QR link; rotating it marks older prints as superseded. */
export function newQrToken() {
  return randomBytes(9).toString("base64url");
}

/**
 * Site-relative so the frontend can prefix the public origin — the backend doesn't know which one
 * serves the pages. `t` identifies the print, so the page can flag a superseded card.
 */
export function qrPath(partnerId: string, qrToken: string) {
  return `/verify/${partnerId}?t=${qrToken}`;
}

/**
 * Generates a new issue of the card from an approved request: applies the requested details,
 * rotates the QR token (older prints then verify as superseded), bumps the issue count and
 * marks the request ISSUED. Runs inside the caller's transaction.
 */
export async function issueCard(
  tx: Prisma.TransactionClient,
  card: PartnerCard,
  request: PartnerCardRequest | null,
  opts: { adminId: string; validFrom?: Date | null; adminNote?: string | null }
) {
  const now = new Date();
  const qrToken = newQrToken();
  const issueNumber = card.issueCount + 1;
  const updated = await tx.partnerCard.update({
    where: { id: card.id },
    data: {
      ...(request
        ? {
            fullName: request.fullName,
            location: request.location,
            phone: request.phone,
            ...(request.photo ? { photo: request.photo } : {}),
          }
        : {}),
      status: "ACTIVE",
      issued: true,
      firstIssuedAt: card.firstIssuedAt ?? now,
      issuedAt: now,
      issueCount: issueNumber,
      qrToken,
      qrCodeUrl: qrPath(card.partnerId, qrToken),
      ...(opts.validFrom !== undefined ? { validFrom: opts.validFrom } : {}),
      ...(opts.adminNote !== undefined ? { adminNote: opts.adminNote } : {}),
    },
  });
  if (request) {
    await tx.partnerCardRequest.update({
      where: { id: request.id },
      data: { status: "ISSUED", issueNumber, reviewedAt: now, reviewedById: opts.adminId, adminNote: opts.adminNote ?? request.adminNote },
    });
  }
  return updated;
}

// ---------- reissue payments ----------

/**
 * Records a captured reissue payment. Idempotent and conditional, so the webhook and the
 * checkout confirmation can race safely; the amount must match the fee that was quoted.
 */
export async function markRequestPaid(params: { razorpayOrderId: string; razorpayPaymentId: string; amountInPaise: number }) {
  const request = await prisma.partnerCardRequest.findUnique({ where: { razorpayOrderId: params.razorpayOrderId } });
  if (!request) return { ok: false as const, reason: "request_not_found" };
  if (request.paymentStatus === "PAID") return { ok: true as const, alreadyProcessed: true, request };
  if (params.amountInPaise !== request.feeInPaise) {
    console.error("[PARTNER_CARD] Payment amount mismatch", { requestId: request.id, paid: params.amountInPaise, fee: request.feeInPaise });
    return { ok: false as const, reason: "amount_mismatch" };
  }

  const { count } = await prisma.partnerCardRequest.updateMany({
    where: { id: request.id, paymentStatus: "PENDING" },
    data: {
      paymentStatus: "PAID",
      razorpayPaymentId: params.razorpayPaymentId,
      paidAt: new Date(),
      // A paid request moves to the admin's review queue — unless it was cancelled meanwhile.
      ...(request.status === "AWAITING_PAYMENT" ? { status: "PENDING" as const } : {}),
    },
  });
  const latest = await prisma.partnerCardRequest.findUniqueOrThrow({ where: { id: request.id } });
  if (count > 0) {
    await prisma.auditLog.create({
      data: {
        actorId: request.userId,
        action: "PARTNER_CARD_REISSUE_PAID",
        target: request.id,
        metadata: { razorpayPaymentId: params.razorpayPaymentId, amountInPaise: params.amountInPaise },
      },
    });
  }
  return { ok: true as const, alreadyProcessed: count === 0, request: latest };
}

/** Asks Razorpay directly (authoritative) whether the request's order was paid, capturing an authorized payment. */
export async function reconcileRequestPayment(request: Pick<PartnerCardRequest, "id" | "razorpayOrderId" | "feeInPaise" | "paymentStatus">) {
  if (request.paymentStatus === "PAID") return { paid: true as const };
  if (!request.razorpayOrderId) return { paid: false as const, reason: "No payment has been started for this request." };

  const razorpay = getRazorpayClient();
  const payments = await razorpay.orders.fetchPayments(request.razorpayOrderId);
  let captured = payments.items.find((p) => p.status === "captured");
  if (!captured) {
    const authorized = payments.items.find((p) => p.status === "authorized" && Number(p.amount) === request.feeInPaise);
    if (authorized) {
      try {
        captured = await razorpay.payments.capture(authorized.id, request.feeInPaise, "INR");
      } catch (err) {
        const latest = await razorpay.payments.fetch(authorized.id);
        if (latest.status !== "captured") throw err;
        captured = latest;
      }
    }
  }
  if (!captured) return { paid: false as const, reason: "Payment not received yet." };

  const result = await markRequestPaid({
    razorpayOrderId: request.razorpayOrderId,
    razorpayPaymentId: captured.id,
    amountInPaise: Number(captured.amount),
  });
  return result.ok ? { paid: true as const } : { paid: false as const, reason: "Payment could not be matched to this request." };
}
