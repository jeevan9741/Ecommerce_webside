import { api } from "@/lib/api";
import type {
  PartnerCard,
  PartnerCardRequest,
  PartnerCardRequestSummary,
  PartnerCardSettings,
  PartnerCardStatus,
  PartnerCardView,
} from "@/lib/partner-card/types";

export interface PartnerCardDefaults {
  fullName: string;
  email: string;
  phone: string;
}

export type PartnerCardSummary = Omit<PartnerCard, "photo" | "signature" | "qrToken" | "qrCodeUrl"> & {
  openRequest: Pick<PartnerCardRequest, "id" | "kind" | "status" | "paymentStatus" | "feeInPaise"> | null;
};

export interface PartnerCardEdit {
  fullName?: string;
  role?: string;
  location?: string;
  email?: string;
  phone?: string;
  validFrom?: string | null;
  photo?: string;
  signature?: string | null;
  adminNote?: string | null;
  reissueFeeInPaise?: number | null;
}

export interface ReissueCheckout {
  razorpayOrderId: string;
  amountInPaise: number;
  currency: string;
  keyId: string;
  description: string;
}

export interface AdminCardDetail {
  card: PartnerCard;
  openRequest: PartnerCardRequest | null;
  history: PartnerCardRequestSummary[];
  quote: { free: boolean; feeInPaise: number; paymentRequired: boolean; freeCardsRemaining: number };
}

export type ListFilter = PartnerCardStatus | "REISSUE" | "";

export const partnerCardService = {
  mine: () => api.get<PartnerCardView & { defaults: PartnerCardDefaults }>("/partner-card"),
  request: (body: { fullName: string; location: string; phone: string; photo: string }) =>
    api.post<PartnerCardView>("/partner-card", body),
  updatePhoto: (photo: string) => api.put<PartnerCardView>("/partner-card/photo", { photo }),
  reissue: (body: { fullName: string; location: string; phone: string; photo?: string; reason: string }) =>
    api.post<PartnerCardView>("/partner-card/reissue", body),
  pay: (requestId: string) => api.post<ReissueCheckout>(`/partner-card/requests/${requestId}/pay`),
  confirm: (requestId: string) =>
    api.post<PartnerCardView & { paid: boolean; reason?: string }>(`/partner-card/requests/${requestId}/confirm`),
  cancel: (requestId: string) => api.post<PartnerCardView>(`/partner-card/requests/${requestId}/cancel`),

  // Admin
  list: (params: { status?: ListFilter; q?: string }) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set("status", params.status);
    if (params.q) qs.set("q", params.q);
    return api.get<{ cards: PartnerCardSummary[]; counts: Record<PartnerCardStatus | "REISSUE", number> }>(
      `/admin/partner-cards${qs.size ? `?${qs}` : ""}`
    );
  },
  get: (id: string) => api.get<AdminCardDetail>(`/admin/partner-cards/${id}`),
  issue: (body: { email: string; location: string; validFrom?: string }) =>
    api.post<{ card: PartnerCard }>("/admin/partner-cards", body),
  update: (id: string, body: PartnerCardEdit) => api.patch<{ card: PartnerCard }>(`/admin/partner-cards/${id}`, body),
  review: (id: string, body: { action: "APPROVE" | "REJECT"; adminNote?: string; validFrom?: string }) =>
    api.post<{ card: PartnerCard }>(`/admin/partner-cards/${id}/review`, body),
  waiveFee: (id: string) => api.post<{ ok: true }>(`/admin/partner-cards/${id}/waive-fee`),
  setStatus: (id: string, status: "ACTIVE" | "INACTIVE", adminNote?: string) =>
    api.post<{ card: PartnerCard }>(`/admin/partner-cards/${id}/status`, { status, adminNote }),
  adminReissue: (id: string) => api.post<{ card: PartnerCard }>(`/admin/partner-cards/${id}/reissue`),
  settings: () => api.get<{ settings: PartnerCardSettings }>("/admin/partner-card-settings"),
  saveSettings: (settings: PartnerCardSettings) =>
    api.put<{ settings: PartnerCardSettings }>("/admin/partner-card-settings", settings),
};
