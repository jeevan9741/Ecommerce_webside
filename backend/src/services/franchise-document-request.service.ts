import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { FranchiseApplicationStatus, FranchiseDocumentKind, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { HttpError } from "../utils/http.js";
import { sendEmail } from "./email.service.js";
import { deleteObject, uploadBuffer } from "./storage.service.js";
import { checkFile, safeName, type UploadedFile } from "./franchise-application.service.js";
import { refuseOwnApplication, requireAdminInTx } from "./franchise-admin-guard.js";
import { notifyAdmins } from "./admin-notify.service.js";

/**
 * "Request more info / documents": an admin asks the applicant for documents and/or information; the
 * applicant replies once, with files and/or text. One open request per application (database index); the
 * request is a record that never changes what it asked and ends answered or cancelled (database guard).
 * Replies add new document rows (documents are append-only): the newest file of a kind is the current one,
 * earlier ones stay as history. The application's status doesn't change.
 */

type Tx = Prisma.TransactionClient;

/** Statuses in which an admin can ask for more (before a decision). */
export const REQUESTABLE_STATUSES: FranchiseApplicationStatus[] = ["APPLICATION_SUBMITTED", "UNDER_REVIEW", "INTERVIEW_DISCUSSION"];
export const REQUESTABLE_KINDS = ["ID_PROOF", "PHOTO", "ADDRESS_PROOF", "BUSINESS_PLAN", "ADDITIONAL"] as const;
/** Multipart field for each kind in a reply ("additional" may carry up to 3 files). */
export const REPLY_FIELDS = { idProof: "ID_PROOF", photo: "PHOTO", addressProof: "ADDRESS_PROOF", businessPlan: "BUSINESS_PLAN", additional: "ADDITIONAL" } as const;
export const MAX_ADDITIONAL_FILES = 3;
export const MAX_DOCUMENTS_PER_APPLICATION = 20;
export const KIND_LABEL: Record<FranchiseDocumentKind, string> = { ID_PROOF: "ID proof", PHOTO: "Photograph", ADDRESS_PROOF: "Address proof", BUSINESS_PLAN: "Business plan", ADDITIONAL: "Other document" };

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input ?? {});
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? "Invalid request", { code: "INVALID_REQUEST" });
  return r.data;
}

// ---------- Admin: ask ----------

const requestSchema = z
  .object({
    kinds: z.array(z.enum(REQUESTABLE_KINDS)).max(REQUESTABLE_KINDS.length).default([]),
    message: z.string().trim().min(10, "Write a message of at least 10 characters for the applicant").max(500, "The message is at most 500 characters"),
  })
  .strict();

export async function createDocumentRequest(actorId: string, applicationId: string, input: unknown) {
  const { kinds, message } = parse(requestSchema, input);
  const uniqueKinds = [...new Set(kinds)] as FranchiseDocumentKind[];
  const app = await prisma.franchiseApplication.findUnique({ where: { id: applicationId }, select: { id: true, userId: true, applicationNo: true, email: true } });
  if (!app) throw new HttpError(404, "Not found");
  await refuseOwnApplication(actorId, app, "REQUEST_DOCUMENTS");
  let request;
  try {
    request = await prisma.$transaction(async (tx) => {
      await requireAdminInTx(tx, actorId);
      // Re-read under a row lock so a concurrent decision or withdrawal can't slip past the status check.
      const rows = await tx.$queryRaw<{ status: FranchiseApplicationStatus }[]>`SELECT "status" FROM "FranchiseApplication" WHERE "id" = ${applicationId} FOR UPDATE`;
      if (!rows[0] || !REQUESTABLE_STATUSES.includes(rows[0].status)) {
        throw new HttpError(409, "More information can only be requested before a decision.", { code: "NOT_REQUESTABLE" });
      }
      const r = await tx.franchiseDocumentRequest.create({ data: { applicationId, message, kinds: uniqueKinds, requestedById: actorId } });
      await tx.auditLog.create({ data: { actorId, action: "FRANCHISE_DOCUMENTS_REQUESTED", target: applicationId, metadata: { applicationNo: app.applicationNo, requestId: r.id, kinds: uniqueKinds, messageLength: message.length } } });
      return r;
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new HttpError(409, "This application already has an open request. Cancel it first to send a new one.", { code: "REQUEST_OPEN" });
    throw e;
  }
  // After the commit: the document names and a sign-in link; the message itself stays behind sign-in.
  await emailApplicant(app.id, app.userId, app.email, "DOCUMENTS_REQUESTED", `More information needed for your franchise application ${app.applicationNo}`,
    `<p>To continue reviewing your franchise application <strong>${escapeHtml(app.applicationNo)}</strong>, we need more information from you.</p>` +
      (uniqueKinds.length ? `<p>Documents requested: <strong>${uniqueKinds.map((k) => escapeHtml(KIND_LABEL[k])).join(", ")}</strong>.</p>` : "") +
      `<p>Sign in to read our message and reply: <a href="${escapeHtml(`${env.siteUrl}/franchise/application`)}">${escapeHtml(`${env.siteUrl}/franchise/application`)}</a></p>`,
  ).catch((e) => console.error("[FRANCHISE] document request email record failed", { applicationId, error: e instanceof Error ? e.name : "Error" }));
  return { id: request.id, status: request.status, kinds: request.kinds, createdAt: request.createdAt };
}

const cancelSchema = z.object({ reason: z.string().trim().max(500).optional() }).strict();

export async function cancelDocumentRequest(actorId: string, applicationId: string, requestId: string, input: unknown) {
  const { reason } = parse(cancelSchema, input);
  return prisma.$transaction(async (tx) => {
    await requireAdminInTx(tx, actorId);
    const now = new Date();
    const { count } = await tx.franchiseDocumentRequest.updateMany({
      where: { id: requestId, applicationId, status: "OPEN" },
      data: { status: "CANCELLED", cancelledAt: now, cancelledById: actorId, cancelReason: reason || "Cancelled by an admin" },
    });
    if (count !== 1) throw new HttpError(409, "This request is no longer open.", { code: "NOT_OPEN" });
    await tx.auditLog.create({ data: { actorId, action: "FRANCHISE_DOCUMENT_REQUEST_CANCELLED", target: applicationId, metadata: { requestId, automatic: false } } });
    return { id: requestId, status: "CANCELLED" as const };
  });
}

/** Inside a rejection or withdrawal: an open request is cancelled with it (nothing left to reply to). */
export async function cancelOpenRequestFor(tx: Tx, applicationId: string, actorId: string, reason: string, now = new Date()) {
  const open = await tx.franchiseDocumentRequest.findFirst({ where: { applicationId, status: "OPEN" }, select: { id: true } });
  if (!open) return null;
  await tx.franchiseDocumentRequest.update({ where: { id: open.id }, data: { status: "CANCELLED", cancelledAt: now, cancelledById: actorId, cancelReason: reason } });
  await tx.auditLog.create({ data: { actorId, action: "FRANCHISE_DOCUMENT_REQUEST_CANCELLED", target: applicationId, metadata: { requestId: open.id, automatic: true } } });
  return open.id;
}

// ---------- Applicant: reply ----------

const replySchema = z.object({ responseText: z.string().trim().max(1000, "Your reply is at most 1000 characters").optional() }).passthrough();

export async function replyToDocumentRequest(input: { userId: string; requestId: string; body: Record<string, unknown>; files: UploadedFile[] }) {
  const { responseText } = parse(replySchema, input.body);
  const text = responseText || null;
  const request = await prisma.franchiseDocumentRequest.findFirst({
    where: { id: input.requestId, application: { userId: input.userId } },
    include: { application: { select: { id: true, applicationNo: true, applicantName: true, status: true, email: true, userId: true, _count: { select: { documents: true } } } } },
  });
  // Someone else's request is simply not found.
  if (!request) throw new HttpError(404, "Not found");
  if (request.status !== "OPEN") throw new HttpError(409, "This request has already been answered or cancelled.", { code: "NOT_OPEN" });
  if (!REQUESTABLE_STATUSES.includes(request.application.status)) throw new HttpError(409, "This application can no longer be updated.", { code: "NOT_REQUESTABLE" });

  // Files: only the requested kinds; each requested standard kind exactly once; "Other document" up to 3.
  const requested = new Set(request.kinds);
  const byField = new Map<keyof typeof REPLY_FIELDS, UploadedFile[]>();
  for (const file of input.files) {
    if (!(file.fieldname in REPLY_FIELDS)) throw new HttpError(400, `Unexpected file field "${file.fieldname}".`, { code: "UNEXPECTED_FILE" });
    const field = file.fieldname as keyof typeof REPLY_FIELDS;
    if (!requested.has(REPLY_FIELDS[field])) throw new HttpError(400, `${KIND_LABEL[REPLY_FIELDS[field]]} wasn't requested.`, { code: "UNEXPECTED_FILE", field });
    const list = byField.get(field) ?? [];
    list.push(file);
    byField.set(field, list);
  }
  for (const [field, list] of byField) {
    const max = field === "additional" ? MAX_ADDITIONAL_FILES : 1;
    if (list.length > max) throw new HttpError(400, field === "additional" ? `Upload at most ${MAX_ADDITIONAL_FILES} other documents.` : "Upload one file per document.", { code: "DUPLICATE_FILE", field });
  }
  for (const [field, kind] of Object.entries(REPLY_FIELDS) as [keyof typeof REPLY_FIELDS, FranchiseDocumentKind][]) {
    if (requested.has(kind) && !byField.has(field)) throw new HttpError(400, `${KIND_LABEL[kind]} is required.`, { code: "DOCUMENT_REQUIRED", field });
  }
  if (requested.size === 0 && !text) throw new HttpError(400, "Please write a reply.", { code: "REPLY_REQUIRED" });
  const files = [...byField.entries()].flatMap(([field, list]) => list.map((file) => ({ kind: REPLY_FIELDS[field] as FranchiseDocumentKind, file, type: checkFile(file) })));
  if (request.application._count.documents + files.length > MAX_DOCUMENTS_PER_APPLICATION) {
    throw new HttpError(409, "This application has reached its document limit. Please contact us.", { code: "TOO_MANY_DOCUMENTS" });
  }

  // Upload first (private store, never overwritten); then one transaction; on any failure, remove the files.
  const applicationId = request.application.id;
  const uploaded: string[] = [];
  const rows: Prisma.FranchiseApplicationDocumentCreateManyInput[] = [];
  const now = new Date();
  try {
    for (const { kind, file, type } of files) {
      const storageKey = `franchise-applications/${applicationId}/${kind.toLowerCase()}-${randomBytes(8).toString("hex")}.${type.ext}`;
      try {
        await uploadBuffer(storageKey, file.buffer, type.mime, { allowOverwrite: false });
      } catch (e) {
        console.error("[FRANCHISE] reply document upload failed", { applicationId, kind, error: e instanceof Error ? e.message : String(e) });
        throw new HttpError(503, "We couldn't store your documents just now. Please try again.", { code: "STORAGE_UNAVAILABLE" });
      }
      uploaded.push(storageKey);
      rows.push({ applicationId, kind, storageKey, originalName: safeName(file.originalname), mimeType: type.mime, sizeBytes: file.size, sha256: createHash("sha256").update(file.buffer).digest("hex"), uploadedById: input.userId, documentRequestId: request.id });
    }
    await prisma.$transaction(async (tx) => {
      // The request row is locked: of two replies sent at once, exactly one is saved.
      const locked = await tx.$queryRaw<{ status: string }[]>`SELECT "status"::text AS "status" FROM "FranchiseDocumentRequest" WHERE "id" = ${request.id} FOR UPDATE`;
      if (locked[0]?.status !== "OPEN") throw new HttpError(409, "This request has already been answered or cancelled.", { code: "NOT_OPEN" });
      const app = await tx.$queryRaw<{ status: FranchiseApplicationStatus }[]>`SELECT "status" FROM "FranchiseApplication" WHERE "id" = ${applicationId} FOR SHARE`;
      if (!app[0] || !REQUESTABLE_STATUSES.includes(app[0].status)) throw new HttpError(409, "This application can no longer be updated.", { code: "NOT_REQUESTABLE" });
      if (rows.length) await tx.franchiseApplicationDocument.createMany({ data: rows });
      await tx.franchiseDocumentRequest.update({ where: { id: request.id }, data: { status: "FULFILLED", fulfilledAt: now, responseText: text } });
      await tx.auditLog.create({
        data: { actorId: input.userId, action: "FRANCHISE_DOCUMENTS_SUBMITTED", target: applicationId, metadata: { applicationNo: request.application.applicationNo, requestId: request.id, kinds: files.map((f) => f.kind), files: files.length, withMessage: Boolean(text) } },
      });
    });
  } catch (e) {
    for (const key of uploaded) await deleteObject(key).catch((err) => console.error("[FRANCHISE] cleanup of an unsaved reply document failed", { applicationId, error: err instanceof Error ? err.message : String(err) }));
    throw e;
  }

  const a = request.application;
  await emailApplicant(applicationId, a.userId, a.email, "DOCUMENTS_RECEIVED", `We received your reply — ${a.applicationNo}`,
    `<p>Thank you. We've received your reply for franchise application <strong>${escapeHtml(a.applicationNo)}</strong>${files.length ? ` (${files.length} file${files.length === 1 ? "" : "s"})` : ""}.</p><p>Our team will continue the review. You can follow it in your dashboard.</p>`,
  ).catch((e) => console.error("[FRANCHISE] reply confirmation record failed", { applicationId, error: e instanceof Error ? e.name : "Error" }));
  notifyAdmins({ kind: "FRANCHISE_DOCUMENTS_RECEIVED", applicationId, applicationNo: a.applicationNo, applicantName: a.applicantName, documentKinds: files.map((f) => KIND_LABEL[f.kind]), withMessage: Boolean(text), receivedAt: now });
  return { id: request.id, status: "FULFILLED" as const, files: files.length };
}

/** Email after the commit; the record keeps only the kind and SENT/FAILED (no addresses or bodies). */
export async function emailApplicant(applicationId: string, userId: string, to: string, kind: string, subject: string, html: string) {
  let status = "SENT";
  let error: string | null = null;
  try {
    await sendEmail({ to, subject, html });
  } catch (e) {
    status = "FAILED";
    error = e instanceof Error ? e.name : "Error";
  }
  await prisma.franchiseNotification.create({ data: { applicationId, recipientUserId: userId, kind, status, error } });
}

/** What the applicant and the admin page show about requests (newest first). */
export function requestView(r: { id: string; status: string; kinds: FranchiseDocumentKind[]; message: string; createdAt: Date; fulfilledAt: Date | null; cancelledAt: Date | null; responseText: string | null }) {
  return { id: r.id, status: r.status, kinds: r.kinds, message: r.message, createdAt: r.createdAt, repliedAt: r.fulfilledAt, cancelledAt: r.cancelledAt, responseText: r.responseText };
}
