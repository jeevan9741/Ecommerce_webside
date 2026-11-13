import type { DocumentRequirements } from "./franchise-form";

/** GET /api/franchise/info — only what the published COMMERCIAL policy says; nulls mean "not decided". */
export interface FranchiseInfo {
  open: boolean;
  reasons: string[];
  policy: { id: string; version: number; payloadSha256: string } | null;
  franchiseFeeInPaise: string | null;
  franchiseFeeGst: "PENDING" | Record<string, unknown>;
  agreementTermMonths: number | null;
  /** The applicant privacy notice in force (versioned with the COMMERCIAL policy), or null while pending. */
  privacyNotice: { version: number; text: string; sha256: string } | null;
  documentRequirements: DocumentRequirements | null;
  /** The published revenue split, or null until one is published. */
  revenueShare: { version: number; partnerShareBps: number; etaShareBps: number } | null;
}

export interface FranchiseDistrict {
  id: string;
  name: string;
  available: boolean;
}
/** One primary franchise per state: AVAILABLE, temporarily RESERVED by an admin, or CLOSED (has a franchise). */
export type StateAvailability = "AVAILABLE" | "RESERVED" | "CLOSED";
export interface FranchiseState {
  id: string;
  name: string;
  code: string | null;
  availability: StateAvailability;
  districts: FranchiseDistrict[];
}

export const STATE_CLOSED_MESSAGE = "This state already has an active ETA franchise.";
export const STATE_RESERVED_MESSAGE = "This state is temporarily reserved and isn't accepting applications.";

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
  rejectionReason: string | null;
  /** The applicant may withdraw while the application is before activation. */
  canWithdraw: boolean;
  documents: { id: string; kind: string; originalName: string; mimeType: string; sizeBytes: number; createdAt: string }[];
  timeline: { status: string; label: string; note: string | null; at: string }[];
}
