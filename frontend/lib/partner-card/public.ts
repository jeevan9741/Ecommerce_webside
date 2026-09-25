import { api, ApiError } from "@/lib/api";

export type VerificationState = "VERIFIED" | "NOT_YET_VALID" | "INACTIVE";

export interface PublicPartner {
  partnerId: string;
  fullName: string;
  role: string;
  location: string;
  validFrom: string | null;
  issuedAt: string | null;
  status: "ACTIVE" | "INACTIVE";
  state: VerificationState;
  photo: string | null;
  qr: "none" | "current" | "superseded";
}

/** Public lookup; null when the ID isn't in the register (unknown, or never approved). */
export async function getPublicPartner(partnerId: string, qrToken?: string | null): Promise<PublicPartner | null> {
  const qs = qrToken ? `?t=${encodeURIComponent(qrToken)}` : "";
  try {
    const { partner } = await api.get<{ partner: PublicPartner }>(
      `/public/partner-cards/${encodeURIComponent(partnerId)}${qs}`,
      { token: null }
    );
    return partner;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export function normalisePartnerId(value: string) {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Malformed escape — use the raw segment; it simply won't match a partner.
  }
  return decoded.trim().toUpperCase().replace(/\s+/g, "");
}
