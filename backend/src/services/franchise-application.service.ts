import { randomBytes, randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import type { FranchiseApplicationStatus, FranchiseDocumentKind, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { HttpError } from "../utils/http.js";
import { sha256Hex } from "../utils/canonical-json.js";
import { deleteObject, getDownloadUrl, uploadBuffer } from "./storage.service.js";
import { sendEmail } from "./email.service.js";
import { resolvePolicy } from "./policy.service.js";
import { isPending } from "./policy-schemas.js";
import { holdingAllocation, lockState, releaseReservationFor } from "./franchise-state.service.js";

/**
 * Franchise applications (Phase 4: submission and the applicant's own view). Applicants are signed-in,
 * email-verified accounts; everything is scoped to the caller — no application id is ever taken from
 * the request for applicant routes. Documents go to the PRIVATE Blob store and are only reachable
 * through short-lived signed links issued after an ownership check.
 *
 * Intake is closed unless the COMMERCIAL policy in force (two-admin published) says
 * applicationIntake = OPEN and the document requirements and applicant privacy notice are decided.
 * Every application records an explicit acceptance of the exact notice version. There is no
 * customer-facing refund policy (customer decision, 2026-11): none is shown, required or recorded.
 * One franchise per STATE: a state held by a reservation or a franchise doesn't accept applications.
 */

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
const SIGNED_URL_SECONDS = 60;
export const UPLOAD_FIELDS = { idProof: "ID_PROOF", photo: "PHOTO", addressProof: "ADDRESS_PROOF", businessPlan: "BUSINESS_PLAN" } as const;
type UploadField = keyof typeof UPLOAD_FIELDS;
type DocumentRequirement = "REQUIRED" | "OPTIONAL" | "NOT_REQUESTED";
type Requirements = Record<"PHOTO" | "ADDRESS_PROOF" | "BUSINESS_PLAN", DocumentRequirement>;

export interface UploadedFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** File type from the file's own bytes (the declared type and name are not trusted). */
export function detectFileType(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-") return { mime: "application/pdf", ext: "pdf" };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: "png" };
  return null;
}

const MIME_ALIASES: Record<string, string> = { "image/jpg": "image/jpeg", "image/pjpeg": "image/jpeg" };

function checkFile(file: UploadedFile) {
  if (file.size === 0 || file.buffer.length === 0) throw new HttpError(400, `${file.originalname || file.fieldname} is empty.`, { code: "EMPTY_FILE", field: file.fieldname });
  if (file.size > MAX_DOCUMENT_BYTES) throw new HttpError(413, "Each document must be 5 MB or smaller.", { code: "FILE_TOO_LARGE", field: file.fieldname });
  const detected = detectFileType(file.buffer);
  if (!detected) throw new HttpError(415, "Documents must be PDF, JPEG or PNG files.", { code: "UNSUPPORTED_FILE", field: file.fieldname });
  const declared = MIME_ALIASES[file.mimetype] ?? file.mimetype;
  if (declared !== detected.mime) throw new HttpError(415, "The file's contents don't match its type.", { code: "FILE_TYPE_MISMATCH", field: file.fieldname });
  return detected;
}

/** Display-safe original name: no path, no control characters, at most 120 characters. */
const safeName = (name: string) => (name.split(/[\\/]/).pop() ?? "document").replace(/[^\w.\- ()]/g, "_").slice(0, 120) || "document";

// ---------- Intake ----------

export async function intakeStatus(now = new Date()) {
  const commercial = await resolvePolicy("COMMERCIAL", now);
  const payload = (commercial?.payload ?? {}) as Record<string, unknown>;
  const reasons: string[] = [];
  if (!commercial) reasons.push("No franchise policy has been published yet.");
  else {
    if (payload.applicationIntake !== "OPEN") reasons.push(isPending(payload.applicationIntake) || payload.applicationIntake === undefined ? "Application intake hasn't been decided yet." : "Applications are closed.");
    if (isPending(payload.documentRequirements) || payload.documentRequirements === undefined) reasons.push("Document requirements haven't been decided yet.");
    // A policy published before schema version 3 has no privacyNotice at all: that keeps intake closed too.
    if (isPending(payload.privacyNotice) || payload.privacyNotice === undefined) reasons.push("The applicant privacy notice hasn't been published yet.");
  }
  const privacyText = !isPending(payload.privacyNotice) ? (payload.privacyNotice as { text?: string } | undefined)?.text : undefined;
  return {
    open: reasons.length === 0,
    reasons,
    policy: commercial ? { id: commercial.id, version: commercial.version, payloadSha256: commercial.payloadSha256 } : null,
    franchiseFeeInPaise: typeof payload.franchiseFeeInPaise === "string" ? payload.franchiseFeeInPaise : null,
    franchiseFeeGst: payload.franchiseFeeGst === undefined || isPending(payload.franchiseFeeGst) ? "PENDING" : payload.franchiseFeeGst,
    agreementTermMonths: typeof payload.agreementTermMonths === "number" ? payload.agreementTermMonths : null,
    /** Versioned with the COMMERCIAL policy; the SHA-256 pins the exact wording the applicant accepts. */
    privacyNotice: privacyText && commercial ? { version: commercial.version, text: privacyText, sha256: sha256Hex(privacyText) } : null,
    documentRequirements: (isPending(payload.documentRequirements) ? null : (payload.documentRequirements as Requirements | undefined)) ?? null,
  };
}

/**
 * The published revenue split for the opportunity page, or null until one is published. Only the two
 * shares are exposed (nothing about formulas or settlement), and only when they are whole basis points
 * that add up to 100%.
 */
export async function publishedRevenueShare(now = new Date()) {
  const policy = await resolvePolicy("REVENUE_SHARE", now);
  const payload = (policy?.payload ?? {}) as Record<string, unknown>;
  const { partnerShareBps, etaShareBps } = payload;
  if (!policy || !Number.isInteger(partnerShareBps) || !Number.isInteger(etaShareBps)) return null;
  if ((partnerShareBps as number) + (etaShareBps as number) !== 10_000) return null;
  return { version: policy.version, partnerShareBps: partnerShareBps as number, etaShareBps: etaShareBps as number };
}

// ---------- Submission ----------

const MOBILE = /^[6-9]\d{9}$/;
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

const submissionSchema = z.object({
  applicantName: z.string().trim().min(2, "Enter your full name").max(100),
  mobile: z.string().trim().regex(MOBILE, "Enter a 10-digit Indian mobile number"),
  stateId: z.string().min(1, "Choose a state"),
  districtId: z.string().min(1, "Choose a district"),
  address: z.string().trim().min(10, "Enter your full address").max(500),
  education: optionalText(100),
  businessExperience: optionalText(2000),
  officeAvailable: z
    .enum(["", "true", "false"])
    .optional()
    .transform((v) => (v === "true" ? true : v === "false" ? false : null)),
  investmentCapacityInr: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || /^\d{1,10}$/.test(v), "Investment capacity is a whole number of rupees")
    .transform((v) => (v ? Number(v) : null))
    .refine((v) => v === null || v <= 1_000_000_000, "Investment capacity is at most ₹1,00,00,00,000"),
  businessPlanText: optionalText(5000),
});

async function nextApplicationNo(tx: Prisma.TransactionClient, now: Date) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('eta-franchise-application-no'))`;
  const year = now.getUTCFullYear();
  const prefix = `FA-${year}-`;
  const last = await tx.franchiseApplication.findFirst({ where: { applicationNo: { startsWith: prefix } }, orderBy: { applicationNo: "desc" }, select: { applicationNo: true } });
  const n = last ? Number(last.applicationNo.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(n).padStart(6, "0")}`;
}

export async function submitApplication(input: { userId: string; body: Record<string, unknown>; files: UploadedFile[]; now?: Date }) {
  const now = input.now ?? new Date();
  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, email: true, emailVerified: true, name: true } });
  if (!user) throw new HttpError(401, "Sign in required");
  if (!user.emailVerified) throw new HttpError(403, "Verify your email address before applying.", { code: "EMAIL_NOT_VERIFIED" });

  const intake = await intakeStatus(now);
  if (!intake.open) throw new HttpError(409, "Franchise applications are not open yet.", { code: "APPLICATIONS_CLOSED", reasons: intake.reasons });
  const parsed = submissionSchema.safeParse(input.body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid application", { code: "INVALID_APPLICATION", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  const f = parsed.data;
  // Privacy notice: an explicit acceptance of exactly the notice now published — checked here, on the
  // server, whatever the form did. It is separate from the refund-policy acknowledgement.
  if (input.body.privacyNoticeAccepted !== "true") {
    throw new HttpError(400, "Please read and accept the privacy notice.", { code: "PRIVACY_NOTICE_NOT_ACCEPTED" });
  }
  if (String(input.body.privacyNoticeVersion ?? "") !== String(intake.privacyNotice!.version) || input.body.privacyNoticeSha256 !== intake.privacyNotice!.sha256) {
    throw new HttpError(409, "The privacy notice changed — please review it again.", { code: "PRIVACY_NOTICE_CHANGED", privacyNotice: intake.privacyNotice });
  }

  // Location: active state, active district inside it, not held by a primary franchise.
  const district = await prisma.district.findUnique({ where: { id: f.districtId }, include: { state: true } });
  if (!district || district.stateId !== f.stateId || !district.isActive || !district.state.isActive) {
    throw new HttpError(400, "Choose an available district in the selected state.", { code: "INVALID_LOCATION" });
  }
  // One franchise per state: a reserved, allocated or suspended state takes no new applications.
  const held = await holdingAllocation(prisma, district.stateId);
  if (held) {
    throw held.status === "RESERVED"
      ? new HttpError(409, "This state is temporarily reserved and isn't accepting applications.", { code: "STATE_RESERVED" })
      : new HttpError(409, "This state already has an active ETA franchise.", { code: "STATE_CLOSED" });
  }

  // Documents: one per field; ID proof always required; others per the published requirements.
  const requirements = intake.documentRequirements!;
  const byField = new Map<UploadField, UploadedFile>();
  for (const file of input.files) {
    if (!(file.fieldname in UPLOAD_FIELDS)) throw new HttpError(400, `Unexpected file field "${file.fieldname}".`, { code: "UNEXPECTED_FILE" });
    if (byField.has(file.fieldname as UploadField)) throw new HttpError(400, "Upload one file per document.", { code: "DUPLICATE_FILE" });
    byField.set(file.fieldname as UploadField, file);
  }
  if (!byField.has("idProof")) throw new HttpError(400, "ID proof is required.", { code: "DOCUMENT_REQUIRED", field: "idProof" });
  for (const [field, kind] of [["photo", "PHOTO"], ["addressProof", "ADDRESS_PROOF"]] as const) {
    if (requirements[kind] === "REQUIRED" && !byField.has(field)) throw new HttpError(400, `${kind === "PHOTO" ? "A photograph" : "Address proof"} is required.`, { code: "DOCUMENT_REQUIRED", field });
    if (requirements[kind] === "NOT_REQUESTED" && byField.has(field)) throw new HttpError(400, "This document isn't requested.", { code: "UNEXPECTED_FILE", field });
  }
  if (requirements.BUSINESS_PLAN === "REQUIRED" && !byField.has("businessPlan") && !f.businessPlanText) {
    throw new HttpError(400, "A business plan (document or text) is required.", { code: "DOCUMENT_REQUIRED", field: "businessPlan" });
  }
  if (requirements.BUSINESS_PLAN === "NOT_REQUESTED" && (byField.has("businessPlan") || f.businessPlanText)) {
    throw new HttpError(400, "A business plan isn't requested.", { code: "UNEXPECTED_FILE", field: "businessPlan" });
  }
  const checked = [...byField.entries()].map(([field, file]) => ({ field, file, type: checkFile(file) }));

  if (await prisma.franchiseApplication.count({ where: { userId: user.id, status: { notIn: ["REJECTED", "WITHDRAWN"] } } })) {
    throw new HttpError(409, "You already have an open franchise application.", { code: "APPLICATION_EXISTS" });
  }

  // Upload first (private store), then write everything in one transaction; on failure, remove the files.
  const applicationId = `fa${randomUUID().replace(/-/g, "")}`;
  const uploaded: string[] = [];
  const documents: Prisma.FranchiseApplicationDocumentCreateManyInput[] = [];
  let application;
  try {
    for (const { field, file, type } of checked) {
      const kind = UPLOAD_FIELDS[field] as FranchiseDocumentKind;
      const storageKey = `franchise-applications/${applicationId}/${kind.toLowerCase()}-${randomBytes(8).toString("hex")}.${type.ext}`;
      try {
        // Submitted documents are never replaced: the store refuses an existing key.
        await uploadBuffer(storageKey, file.buffer, type.mime, { allowOverwrite: false });
      } catch (e) {
        console.error("[FRANCHISE] document upload failed", { applicationId, kind, error: e instanceof Error ? e.message : String(e) });
        throw new HttpError(503, "We couldn't store your documents just now. Please try again.", { code: "STORAGE_UNAVAILABLE" });
      }
      uploaded.push(storageKey);
      documents.push({
        applicationId,
        kind,
        storageKey,
        originalName: safeName(file.originalname),
        mimeType: type.mime,
        sizeBytes: file.size,
        sha256: createHash("sha256").update(file.buffer).digest("hex"),
        uploadedById: user.id,
      });
    }
    const requiredKinds: FranchiseDocumentKind[] = ["ID_PROOF", ...(["PHOTO", "ADDRESS_PROOF", "BUSINESS_PLAN"] as const).filter((k) => requirements[k] === "REQUIRED")];
    application = await prisma.$transaction(async (tx) => {
      const applicationNo = await nextApplicationNo(tx, now);
      const created = await tx.franchiseApplication.create({
        data: {
          id: applicationId,
          applicationNo,
          userId: user.id,
          applicantName: f.applicantName,
          mobile: f.mobile,
          email: user.email,
          stateId: f.stateId,
          districtId: f.districtId,
          address: f.address,
          education: f.education,
          businessExperience: f.businessExperience,
          officeAvailable: f.officeAvailable,
          investmentCapacityInr: f.investmentCapacityInr,
          businessPlanText: f.businessPlanText,
          requiredDocumentKinds: requiredKinds,
          submittedAt: now,
        },
      });
      if (documents.length) await tx.franchiseApplicationDocument.createMany({ data: documents });
      // Evidence of the explicit acceptance, with the application in the same transaction: both or neither.
      await tx.franchisePrivacyNoticeAcceptance.create({
        data: {
          applicationId,
          userId: user.id,
          policyVersionId: intake.policy!.id,
          noticeVersion: intake.privacyNotice!.version,
          noticeSha256: intake.privacyNotice!.sha256,
          method: "EXPLICIT_CHECKBOX",
          acceptedAt: now,
        },
      });
      await tx.franchiseApplicationStatusHistory.create({
        data: { applicationId, toStatus: "APPLICATION_SUBMITTED", actorId: user.id, actorType: "APPLICANT", applicantNote: "Application submitted" },
      });
      // Audit metadata carries ids and counts only — no name, mobile, email or address.
      await tx.auditLog.create({
        data: { actorId: user.id, action: "FRANCHISE_APPLICATION_SUBMITTED", target: applicationId, metadata: { applicationNo, districtId: f.districtId, documents: documents.length, policyVersion: intake.policy!.version, privacyNoticeVersion: intake.privacyNotice!.version } },
      });
      return created;
    });
  } catch (err) {
    await Promise.all(uploaded.map((key) => deleteObject(key).catch(() => console.error("[FRANCHISE] could not remove an orphaned upload", { key }))));
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") {
      throw new HttpError(409, "You already have an open franchise application.", { code: "APPLICATION_EXISTS" });
    }
    throw err;
  }
  // After the commit and outside the cleanup path: a notification problem must never touch saved documents.
  await notify(application.id, user.id, user.email, application.applicationNo).catch((e) => console.error("[FRANCHISE] notification record failed", { applicationId: application.id, error: String(e) }));
  return application;
}

/** Email after the commit; failures are logged, never fatal (the application is already saved). */
async function notify(applicationId: string, userId: string, to: string, applicationNo: string) {
  let status = "SENT";
  let error: string | null = null;
  try {
    await sendEmail({
      to,
      subject: `Franchise application received — ${applicationNo}`,
      html: `<p>We've received your franchise application <strong>${applicationNo}</strong>.</p><p>You can follow its status in your dashboard. We'll email you when it moves to the next stage.</p>`,
    });
  } catch (e) {
    status = "FAILED";
    // The error class only: provider messages can echo the recipient address.
    error = e instanceof Error ? e.name : "Error";
  }
  await prisma.franchiseNotification.create({ data: { applicationId, recipientUserId: userId, kind: "APPLICATION_SUBMITTED", status, error } });
}

// ---------- The applicant's own application ----------

/** Applicant- and admin-facing names for each status (one list for both). */
export const STATUS_LABEL: Record<FranchiseApplicationStatus, string> = {
  APPLICATION_SUBMITTED: "Application submitted",
  UNDER_REVIEW: "Under review",
  INTERVIEW_DISCUSSION: "Interview / discussion",
  APPROVED: "Approved",
  PAYMENT_PENDING: "Payment pending",
  AGREEMENT_PENDING: "Agreement pending",
  ACTIVE_FRANCHISE: "Active franchise",
  REJECTED: "Not approved",
  WITHDRAWN: "Withdrawn",
};

export async function myApplication(userId: string) {
  const app = await prisma.franchiseApplication.findFirst({
    where: { userId },
    orderBy: { submittedAt: "desc" },
    include: {
      state: { select: { name: true } },
      district: { select: { name: true } },
      documents: { orderBy: { createdAt: "asc" }, select: { id: true, kind: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true } },
      history: { orderBy: { createdAt: "asc" }, select: { toStatus: true, applicantNote: true, createdAt: true } },
    },
  });
  if (!app) return null;
  return {
    id: app.id,
    applicationNo: app.applicationNo,
    status: app.status,
    statusLabel: STATUS_LABEL[app.status] ?? app.status,
    submittedAt: app.submittedAt,
    applicantName: app.applicantName,
    mobile: app.mobile,
    email: app.email,
    state: app.state.name,
    district: app.district.name,
    address: app.address,
    education: app.education,
    businessExperience: app.businessExperience,
    officeAvailable: app.officeAvailable,
    investmentCapacityInr: app.investmentCapacityInr,
    businessPlanText: app.businessPlanText,
    rejectionReason: app.status === "REJECTED" ? app.rejectionReason : null,
    canWithdraw: WITHDRAWABLE.includes(app.status),
    documents: app.documents,
    timeline: app.history.map((h) => ({ status: h.toStatus, label: STATUS_LABEL[h.toStatus] ?? h.toStatus, note: h.applicantNote, at: h.createdAt })),
  };
}

/** Statuses the applicant can withdraw from (after AGREEMENT_PENDING the fee may be paid — ETA handles it). */
const WITHDRAWABLE: FranchiseApplicationStatus[] = ["APPLICATION_SUBMITTED", "UNDER_REVIEW", "INTERVIEW_DISCUSSION", "APPROVED", "PAYMENT_PENDING"];

/**
 * The applicant withdraws their own open application. A temporary state reservation for it is released in
 * the same transaction, so a withdrawal never closes or keeps holding a state. Audited; ids only.
 */
export async function withdrawApplication(userId: string, input: unknown) {
  const r = z.object({ reason: z.string().trim().max(500).optional() }).strict().safeParse(input ?? {});
  if (!r.success) throw new HttpError(400, "Invalid request", { code: "INVALID_REQUEST" });
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const app = await tx.franchiseApplication.findFirst({ where: { userId, status: { in: WITHDRAWABLE } }, orderBy: { submittedAt: "desc" }, select: { id: true, status: true, version: true, stateId: true, applicationNo: true } });
    if (!app) throw new HttpError(409, "You have no open application to withdraw.", { code: "NOTHING_TO_WITHDRAW" });
    await lockState(tx, app.stateId);
    const { count } = await tx.franchiseApplication.updateMany({ where: { id: app.id, status: app.status, version: app.version }, data: { status: "WITHDRAWN", version: { increment: 1 } } });
    if (count !== 1) throw new HttpError(409, "Your application changed — reload and try again.", { code: "STALE" });
    const released = await releaseReservationFor(tx, app.id, userId, "Application withdrawn by the applicant", now);
    await tx.franchiseApplicationStatusHistory.create({ data: { applicationId: app.id, fromStatus: app.status, toStatus: "WITHDRAWN", actorId: userId, actorType: "APPLICANT", applicantNote: "You withdrew this application", internalNote: r.data.reason || null } });
    await tx.auditLog.create({ data: { actorId: userId, action: "FRANCHISE_APPLICATION_WITHDRAWN", target: app.id, metadata: { applicationNo: app.applicationNo, fromStatus: app.status, reservationReleased: Boolean(released) } } });
    return { id: app.id, status: "WITHDRAWN" as const };
  });
}

/** A short-lived signed link to one of the CALLER'S documents; anyone else's id is simply not found. */
export async function myDocumentUrl(userId: string, documentId: string) {
  const doc = await prisma.franchiseApplicationDocument.findFirst({ where: { id: documentId, application: { userId } }, select: { storageKey: true, originalName: true } });
  if (!doc) throw new HttpError(404, "Not found");
  return { url: await getDownloadUrl(doc.storageKey, SIGNED_URL_SECONDS), fileName: doc.originalName, expiresInSeconds: SIGNED_URL_SECONDS };
}
