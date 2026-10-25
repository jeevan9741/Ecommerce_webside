import { api } from "@/lib/api";

export const LEGAL_DOCUMENT_TYPES = {
  COMPANY_REGISTRATION: "Company Registration Certificate",
  GST_REGISTRATION: "GST Registration Certificate",
  COMPANY_PAN: "Company PAN",
  MSME_UDYAM: "MSME / Udyam Registration Certificate",
  TERMS_AND_CONDITIONS: "Terms & Conditions",
  PRIVACY_POLICY: "Privacy Policy",
  OTHER: "Other business / legal document",
} as const;

export type LegalDocumentType = keyof typeof LEGAL_DOCUMENT_TYPES;

/** Same cap as the API (20 MB). */
export const MAX_LEGAL_DOCUMENT_BYTES = 20 * 1024 ** 2;

export interface LegalDocument {
  id: string;
  title: string;
  type: LegalDocumentType;
  description: string | null;
  sizeBytes: number;
  updatedAt: string;
}

export interface AdminLegalDocument extends LegalDocument {
  fileName: string;
  isPublished: boolean;
  publishedAt: string | null;
  displayOrder: number;
  createdAt: string;
}

export interface LegalDocumentEdit {
  title?: string;
  type?: LegalDocumentType;
  description?: string | null;
  isPublished?: boolean;
  /** A new upload replaces the file (send with fileName). */
  storageKey?: string;
  fileName?: string;
}

export const legalDocumentService = {
  published: () => api.get<{ documents: LegalDocument[] }>("/me/legal-documents"),
  download: (id: string) => api.post<{ url: string; fileName: string; expiresAt: string }>(`/me/legal-documents/${id}/download`),

  // Admin
  uploadToken: (body: { filename: string; contentType: string; sizeBytes: number }) =>
    api.post<{ pathname: string; clientToken: string; access: "private" }>("/admin/legal-documents/upload-token", body),
  discardUpload: (key: string) => api.post<{ ok: true }>("/admin/legal-documents/discard-upload", { key }),
  adminList: () => api.get<{ documents: AdminLegalDocument[] }>("/admin/legal-documents"),
  create: (body: LegalDocumentEdit & { title: string; type: LegalDocumentType; storageKey: string; fileName: string }) =>
    api.post<{ document: AdminLegalDocument }>("/admin/legal-documents", body),
  update: (id: string, body: LegalDocumentEdit) => api.patch<{ document: AdminLegalDocument }>(`/admin/legal-documents/${id}`, body),
  remove: (id: string) => api.delete<{ ok: true }>(`/admin/legal-documents/${id}`),
  preview: (id: string) => api.get<{ url: string; fileName: string }>(`/admin/legal-documents/${id}/preview`),
};
