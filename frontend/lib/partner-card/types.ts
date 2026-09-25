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
  issueCount: number;
  issuedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

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
