import { api } from "@/lib/api";
import type { PartnerCard, PartnerCardStatus } from "@/lib/partner-card/types";

export interface PartnerCardDefaults {
  fullName: string;
  email: string;
  phone: string;
}

export type PartnerCardSummary = Omit<PartnerCard, "photo" | "signature" | "qrToken" | "qrCodeUrl">;

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
}

export const partnerCardService = {
  mine: () => api.get<{ card: PartnerCard | null; defaults: PartnerCardDefaults }>("/partner-card"),
  request: (body: { fullName: string; location: string; phone: string; photo: string }) =>
    api.post<{ card: PartnerCard }>("/partner-card", body),
  updatePhoto: (photo: string) => api.put<{ card: PartnerCard }>("/partner-card/photo", { photo }),
  regenerateQr: () => api.post<{ card: PartnerCard }>("/partner-card/regenerate-qr"),

  // Admin
  list: (params: { status?: PartnerCardStatus | ""; q?: string }) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set("status", params.status);
    if (params.q) qs.set("q", params.q);
    return api.get<{ cards: PartnerCardSummary[]; counts: Record<PartnerCardStatus, number> }>(
      `/admin/partner-cards${qs.size ? `?${qs}` : ""}`
    );
  },
  get: (id: string) => api.get<{ card: PartnerCard }>(`/admin/partner-cards/${id}`),
  issue: (body: { email: string; location: string; validFrom?: string }) =>
    api.post<{ card: PartnerCard }>("/admin/partner-cards", body),
  update: (id: string, body: PartnerCardEdit) => api.patch<{ card: PartnerCard }>(`/admin/partner-cards/${id}`, body),
  review: (id: string, body: { action: "APPROVE" | "REJECT"; adminNote?: string; validFrom?: string }) =>
    api.post<{ card: PartnerCard }>(`/admin/partner-cards/${id}/review`, body),
  setStatus: (id: string, status: "ACTIVE" | "INACTIVE", adminNote?: string) =>
    api.post<{ card: PartnerCard }>(`/admin/partner-cards/${id}/status`, { status, adminNote }),
  reissue: (id: string) => api.post<{ card: PartnerCard }>(`/admin/partner-cards/${id}/reissue`),
};
