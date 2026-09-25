import { SITE_URL } from "@/lib/site";

/**
 * Origin printed into every card's QR code. Printed cards outlive deployments, so production pins
 * the stable public domain rather than whichever URL this build happens to run on.
 */
export const VERIFY_ORIGIN = (
  process.env.NEXT_PUBLIC_VERIFY_ORIGIN ??
  (process.env.NODE_ENV === "production" ? "https://ecommerce-training-academy.vercel.app" : SITE_URL)
).replace(/\/$/, "");
import type { PartnerCardArt } from "./design";

export type PartnerCardStatus = "PENDING" | "ACTIVE" | "REJECTED" | "INACTIVE";

/** PartnerCard row as the backend returns it. */
export interface PartnerCard {
  id: string;
  userId: string;
  partnerId: string;
  fullName: string;
  photo: string | null;
  role: string;
  location: string;
  email: string;
  phone: string;
  validFrom: string | null;
  qrToken: string;
  /** Site-relative path the QR code opens (e.g. /verify/ECTA-BP001?t=…). */
  qrCodeUrl: string;
  signature: string | null;
  status: PartnerCardStatus;
  adminNote: string | null;
  /** True once the free card has been issued; further cards are reissues. */
  issued: boolean;
  firstIssuedAt: string | null;
  /** Cards issued so far (first card = 1). */
  issueCount: number;
  /** Latest issue date. */
  issuedAt: string | null;
  /** Per-partner fee override (paise); null uses the Partner Card Settings fee. */
  reissueFeeInPaise: number | null;
  createdAt: string;
  updatedAt: string;
}

export type PartnerCardRequestKind = "FREE" | "REISSUE";
export type PartnerCardRequestStatus = "AWAITING_PAYMENT" | "PENDING" | "REJECTED" | "ISSUED" | "CANCELLED";
export type PartnerCardPaymentStatus = "NOT_REQUIRED" | "PENDING" | "PAID" | "WAIVED";

/** One request in a card's history (the free first card or a reissue). */
export interface PartnerCardRequestSummary {
  id: string;
  kind: PartnerCardRequestKind;
  status: PartnerCardRequestStatus;
  paymentStatus: PartnerCardPaymentStatus;
  feeInPaise: number;
  fullName: string;
  location: string;
  phone: string;
  reason: string | null;
  razorpayPaymentId: string | null;
  paidAt: string | null;
  adminNote: string | null;
  reviewedAt: string | null;
  issueNumber: number | null;
  createdAt: string;
}

export interface PartnerCardRequest extends PartnerCardRequestSummary {
  cardId: string;
  photo: string | null;
}

/** The partner's position under the one-free-card policy, computed by the backend. */
export interface PartnerCardPolicy {
  issued: boolean;
  firstIssuedAt: string | null;
  issueCount: number;
  freeCardsAllowed: number;
  freeCardsRemaining: number;
  nextCardFree: boolean;
  reissueFeeInPaise: number;
  paymentRequired: boolean;
}

export interface PartnerCardView {
  card: PartnerCard | null;
  openRequest: PartnerCardRequest | null;
  history: PartnerCardRequestSummary[];
  policy: PartnerCardPolicy;
}

export interface PartnerCardSettings {
  freeCardsAllowed: number;
  reissueFeeInPaise: number;
  reissuePaymentEnabled: boolean;
}

export const REQUEST_STATUS_LABEL: Record<PartnerCardRequestStatus, string> = {
  AWAITING_PAYMENT: "Awaiting payment",
  PENDING: "Pending approval",
  REJECTED: "Rejected",
  ISSUED: "Issued",
  CANCELLED: "Cancelled",
};

export const PAYMENT_STATUS_LABEL: Record<PartnerCardPaymentStatus, string> = {
  NOT_REQUIRED: "Free",
  PENDING: "Unpaid",
  PAID: "Paid",
  WAIVED: "Waived",
};

export const STATUS_LABEL: Record<PartnerCardStatus, string> = {
  PENDING: "Pending approval",
  ACTIVE: "Active",
  REJECTED: "Rejected",
  INACTIVE: "Deactivated",
};

/** Overlay printed across cards that aren't valid, so a preview can never pass for the real thing. */
export function watermarkFor(status: PartnerCardStatus | null): string | null {
  if (status === "ACTIVE") return null;
  if (status === "INACTIVE") return "DEACTIVATED";
  if (status === "REJECTED") return "NOT APPROVED";
  return "PENDING APPROVAL";
}

export function qrUrlFor(card: Pick<PartnerCard, "qrCodeUrl" | "partnerId">) {
  return `${VERIFY_ORIGIN}${card.qrCodeUrl || `/verify/${card.partnerId}`}`;
}

export function toCardArt(card: PartnerCard): PartnerCardArt {
  return {
    fullName: card.fullName,
    partnerId: card.partnerId,
    role: card.role,
    location: card.location,
    email: card.email,
    phone: card.phone,
    validFrom: card.validFrom,
    photo: card.photo,
    signature: card.signature,
    qrUrl: qrUrlFor(card),
  };
}
