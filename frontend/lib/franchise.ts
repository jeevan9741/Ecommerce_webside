import type { DocumentRequirements } from "./franchise-form";

/** GET /api/franchise/info — only what the published COMMERCIAL policy says; nulls mean "not decided". */
export interface FranchiseInfo {
  open: boolean;
  reasons: string[];
  policy: { id: string; version: number; payloadSha256: string } | null;
  franchiseFeeInPaise: string | null;
  franchiseFeeGst: "PENDING" | Record<string, unknown>;
  agreementTermMonths: number | null;
  refundPolicy: { version: number; text: string; sha256: string } | null;
  documentRequirements: DocumentRequirements | null;
}

export interface FranchiseDistrict {
  id: string;
  name: string;
  available: boolean;
}
export interface FranchiseState {
  id: string;
  name: string;
  code: string | null;
  districts: FranchiseDistrict[];
}

export interface MyFranchiseApplication {
  id: string;
  applicationNo: string;
  status: string;
  statusLabel: string;
  submittedAt: string;
  applicantName: string;
  mobile: string;
  email: string;
  state: string;
  district: string;
  address: string;
  education: string | null;
  businessExperience: string | null;
  officeAvailable: boolean | null;
  investmentCapacityInr: number | null;
  businessPlanText: string | null;
  refundPolicyVersion: number;
  rejectionReason: string | null;
  documents: { id: string; kind: string; originalName: string; mimeType: string; sizeBytes: number; createdAt: string }[];
  timeline: { status: string; label: string; note: string | null; at: string }[];
}
