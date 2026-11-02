import { randomBytes, randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import type { FranchiseDocumentKind, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { HttpError } from "../utils/http.js";
import { sha256Hex } from "../utils/canonical-json.js";
import { deleteObject, getDownloadUrl, uploadBuffer } from "./storage.service.js";
import { sendEmail } from "./email.service.js";
import { resolvePolicy } from "./policy.service.js";
import { isPending } from "./policy-schemas.js";
import { heldDistrictIds } from "./franchise-location.service.js";

/**
 * Franchise applications (Phase 4: submission and the applicant's own view). Applicants are signed-in,
 * email-verified accounts; everything is scoped to the caller — no application id is ever taken from
 * the request for applicant routes. Documents go to the PRIVATE Blob store and are only reachable
 * through short-lived signed links issued after an ownership check.
 *
 * Intake is closed unless the COMMERCIAL policy in force (two-admin published) says
 * applicationIntake = OPEN and the document requirements and fee refund policy are decided.
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
    if (isPending(payload.feeRefundPolicy) || payload.feeRefundPolicy === undefined) reasons.push("The fee refund policy hasn't been published yet.");
  }
  const refundText = !isPending(payload.feeRefundPolicy) ? (payload.feeRefundPolicy as { text?: string } | undefined)?.text : undefined;
  return {
    open: reasons.length === 0,
    reasons,
    policy: commercial ? { id: commercial.id, version: commercial.version, payloadSha256: commercial.payloadSha256 } : null,
    franchiseFeeInPaise: typeof payload.franchiseFeeInPaise === "string" ? payload.franchiseFeeInPaise : null,
    franchiseFeeGst: payload.franchiseFeeGst === undefined || isPending(payload.franchiseFeeGst) ? "PENDING" : payload.franchiseFeeGst,
    agreementTermMonths: typeof payload.agreementTermMonths === "number" ? payload.agreementTermMonths : null,
    refundPolicy: refundText && commercial ? { version: commercial.version, text: refundText, sha256: sha256Hex(refundText) } : null,
    documentRequirements: (isPending(payload.documentRequirements) ? null : (payload.documentRequirements as Requirements | undefined)) ?? null,
  };
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
  refundPolicyVersion: z.string().regex(/^\d+$/, "Acknowledge the refund policy"),
  refundPolicySha256: z.string().regex(/^[0-9a-f]{64}$/, "Acknowledge the refund policy"),
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
  if (Number(f.refundPolicyVersion) !== intake.refundPolicy!.version || f.refundPolicySha256 !== intake.refundPolicy!.sha256) {
    throw new HttpError(409, "The refund policy changed — please review it again.", { code: "POLICY_CHANGED", refundPolicy: intake.refundPolicy });
  }

  // Location: active state, active district inside it, not held by a primary franchise.
  const district = await prisma.district.findUnique({ where: { id: f.districtId }, include: { state: true } });
  if (!district || district.stateId !== f.stateId || !district.isActive || !district.state.isActive) {
    throw new HttpError(400, "Choose an available district in the selected state.", { code: "INVALID_LOCATION" });
  }
  if ((await heldDistrictIds([district.id])).size) throw new HttpError(409, "This district already has a franchise partner.", { code: "DISTRICT_UNAVAILABLE" });

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

  if (await prisma.franchiseApplication.count({ where: { userId: user.id, status: { not: "REJECTED" } } })) {
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
          refundPolicyVersion: intake.refundPolicy!.version,
          refundPolicyText: intake.refundPolicy!.text,
          refundPolicySha256: intake.refundPolicy!.sha256,
          submittedAt: now,
        },
      });
      if (documents.length) await tx.franchiseApplicationDocument.createMany({ data: documents });
      await tx.franchiseApplicationStatusHistory.create({
        data: { applicationId, toStatus: "APPLICATION_SUBMITTED", actorId: user.id, actorType: "APPLICANT", applicantNote: "Application submitted" },
      });
      // Audit metadata carries ids and counts only — no name, mobile, email or address.
      await tx.auditLog.create({
        data: { actorId: user.id, action: "FRANCHISE_APPLICATION_SUBMITTED", target: applicationId, metadata: { applicationNo, districtId: f.districtId, documents: documents.length, policyVersion: intake.refundPolicy!.version } },
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

const STATUS_LABEL: Record<string, string> = {
  APPLICATION_SUBMITTED: "Application submitted",
  UNDER_REVIEW: "Under review",
  INTERVIEW_DISCUSSION: "Interview / discussion",
  APPROVED: "Approved",
  PAYMENT_PENDING: "Payment pending",
  AGREEMENT_PENDING: "Agreement pending",
  ACTIVE_FRANCHISE: "Active franchise",
  REJECTED: "Not approved",
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
    refundPolicyVersion: app.refundPolicyVersion,
    rejectionReason: app.status === "REJECTED" ? app.rejectionReason : null,
    documents: app.documents,
    timeline: app.history.map((h) => ({ status: h.toStatus, label: STATUS_LABEL[h.toStatus] ?? h.toStatus, note: h.applicantNote, at: h.createdAt })),
  };
}

/** A short-lived signed link to one of the CALLER'S documents; anyone else's id is simply not found. */
export async function myDocumentUrl(userId: string, documentId: string) {
  const doc = await prisma.franchiseApplicationDocument.findFirst({ where: { id: documentId, application: { userId } }, select: { storageKey: true, originalName: true } });
  if (!doc) throw new HttpError(404, "Not found");
  return { url: await getDownloadUrl(doc.storageKey, SIGNED_URL_SECONDS), fileName: doc.originalName, expiresInSeconds: SIGNED_URL_SECONDS };
}
