import type { Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { LegalDocument } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { currentUser } from "../middleware/auth.middleware.js";
import { HttpError, param } from "../utils/http.js";
import { rateLimit } from "../utils/rate-limit.js";
import { deleteObject, getClientUploadToken, getDownloadUrl, readObjectHead, statObject } from "../services/storage.service.js";
import { SIGNATURE_BYTES, downloadName, extensionMatches, fileSignatureMatches } from "../services/ebook-file.js";

/**
 * Company legal documents (registration certificates, GST, policies…) for customers. PDFs only,
 * stored in the private store; customers get published ones through 5-minute signed links.
 */

export const LEGAL_DOCUMENT_PREFIX = "legal-documents/";
export const MAX_LEGAL_DOCUMENT_BYTES = 20 * 1024 ** 2; // 20 MB
const PDF = "application/pdf";
/** Signed links only need to outlive the click. */
const DOWNLOAD_TTL = 5 * 60;

export const LEGAL_DOCUMENT_TYPES = [
  "COMPANY_REGISTRATION",
  "GST_REGISTRATION",
  "COMPANY_PAN",
  "MSME_UDYAM",
  "TERMS_AND_CONDITIONS",
  "PRIVACY_POLICY",
  "OTHER",
] as const;

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new HttpError(400, result.error.issues[0]?.message ?? "Invalid request");
  return result.data;
}

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : v === undefined ? undefined : null));

async function cleanup(key: string | null | undefined, label: string) {
  if (!key) return;
  // The row is already gone/updated; a leftover blob is only storage waste, so never fail the request.
  await deleteObject(key).catch((err) => console.error(`[LEGAL_DOCUMENT] Failed to delete ${label} ${key}`, err));
}

function storageName(filename: string) {
  const base = filename.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "document";
  return `${Date.now()}-${randomBytes(6).toString("hex")}-${base}.pdf`;
}

/** Trust the store, not the browser: the upload must exist, be a PDF within the size cap, and really be a PDF. */
async function verifyUpload(key: string) {
  const stat = await statObject(key);
  if (!stat) throw new HttpError(400, "The document upload wasn't found — please upload it again.");
  const reject = async (message: string) => {
    await cleanup(key, "invalid upload");
    return new HttpError(400, message);
  };
  if (stat.contentType !== PDF) throw await reject("Only PDF documents can be uploaded.");
  if (stat.size <= 0 || stat.size > MAX_LEGAL_DOCUMENT_BYTES) throw await reject("Documents can be at most 20 MB.");
  if (!fileSignatureMatches(await readObjectHead(key, SIGNATURE_BYTES), PDF)) throw await reject("That file isn't a valid PDF.");
  return { size: stat.size };
}

async function audit(actorId: string, action: string, target: string, metadata: Record<string, unknown>) {
  await prisma.auditLog.create({ data: { actorId, action, target, metadata: metadata as object } });
}

/** What customers see — never the storage key or a permanent URL. */
function customerView(d: LegalDocument) {
  return {
    id: d.id,
    title: d.title,
    type: d.type,
    description: d.description,
    sizeBytes: Number(d.sizeBytes),
    updatedAt: d.updatedAt,
  };
}

function adminView(d: LegalDocument) {
  return {
    ...customerView(d),
    fileName: d.fileName,
    isPublished: d.isPublished,
    publishedAt: d.publishedAt,
    displayOrder: d.displayOrder,
    createdAt: d.createdAt,
  };
}

// ---------- Admin ----------

const uploadTokenSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.literal(PDF, { error: "Only PDF documents can be uploaded" }),
  sizeBytes: z.number().int().positive().max(MAX_LEGAL_DOCUMENT_BYTES, "Documents can be at most 20 MB"),
});

/** Scoped client token: one private pathname, PDF only, 20 MB cap. */
export async function createLegalDocumentUploadToken(req: Request, res: Response) {
  const admin = currentUser(req);
  if (!rateLimit(`legal-document-upload-token:${admin.id}`, 60, 60 * 60 * 1000)) throw new HttpError(429, "Too many uploads. Try again later.");
  const body = parse(uploadTokenSchema, req.body);
  if (!extensionMatches(body.filename, PDF)) throw new HttpError(400, "The file name must end in .pdf");
  const pathname = `${LEGAL_DOCUMENT_PREFIX}${storageName(body.filename)}`;
  const clientToken = await getClientUploadToken(pathname, { allowedContentTypes: [PDF], maximumSizeInBytes: MAX_LEGAL_DOCUMENT_BYTES, validForSeconds: 30 * 60 });
  res.json({ pathname, clientToken, access: "private" });
}

const fields = {
  title: z.string().trim().min(2, "Enter a title").max(150),
  type: z.enum(LEGAL_DOCUMENT_TYPES, { error: "Choose a document type" }),
  description: nullableText(1000),
  isPublished: z.boolean().optional(),
};

const createSchema = z.object({
  ...fields,
  storageKey: z.string().startsWith(LEGAL_DOCUMENT_PREFIX, "Invalid document upload"),
  fileName: z.string().trim().min(1).max(255),
});

const updateSchema = z.object({
  title: fields.title.optional(),
  type: fields.type.optional(),
  description: fields.description,
  isPublished: fields.isPublished,
  displayOrder: z.number().int().min(0).max(100000).optional(),
  /** A new upload replaces the file. */
  storageKey: createSchema.shape.storageKey.optional(),
  fileName: createSchema.shape.fileName.optional(),
});

export async function adminListLegalDocuments(_req: Request, res: Response) {
  const documents = await prisma.legalDocument.findMany({ orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }], take: 200 });
  res.json({ documents: documents.map(adminView), maxBytes: MAX_LEGAL_DOCUMENT_BYTES });
}

export async function adminCreateLegalDocument(req: Request, res: Response) {
  const admin = currentUser(req);
  const body = parse(createSchema, req.body);
  const file = await verifyUpload(body.storageKey);
  const { _max } = await prisma.legalDocument.aggregate({ _max: { displayOrder: true } });
  const isPublished = body.isPublished ?? false;

  const document = await prisma.legalDocument
    .create({
      data: {
        title: body.title,
        type: body.type,
        description: body.description ?? null,
        fileName: body.fileName,
        storageKey: body.storageKey,
        sizeBytes: BigInt(file.size),
        isPublished,
        publishedAt: isPublished ? new Date() : null,
        displayOrder: (_max.displayOrder ?? -1) + 1,
      },
    })
    .catch((err: { code?: string }) => {
      if (err.code === "P2002") throw new HttpError(409, "This upload is already saved as a document.");
      throw err;
    });

  await audit(admin.id, "LEGAL_DOCUMENT_CREATED", document.id, { type: document.type, isPublished, sizeBytes: file.size });
  res.status(201).json({ document: adminView(document) });
}

export async function adminUpdateLegalDocument(req: Request, res: Response) {
  const admin = currentUser(req);
  const body = parse(updateSchema, req.body);
  const existing = await prisma.legalDocument.findUnique({ where: { id: param(req, "id") } });
  if (!existing) throw new HttpError(404, "Document not found");
  const replacing = body.storageKey !== undefined && body.storageKey !== existing.storageKey;
  if (replacing && !body.fileName) throw new HttpError(400, "Missing file name for the replacement file");
  const file = replacing ? await verifyUpload(body.storageKey!) : null;
  const publishing = body.isPublished === true && !existing.isPublished;

  const { storageKey, fileName, ...rest } = body;
  const document = await prisma.legalDocument.update({
    where: { id: existing.id },
    data: {
      ...rest,
      ...(publishing ? { publishedAt: new Date() } : {}),
      ...(file ? { storageKey, fileName, sizeBytes: BigInt(file.size) } : {}),
    },
  });
  if (replacing) await cleanup(existing.storageKey, "replaced document");

  const action = replacing
    ? "LEGAL_DOCUMENT_FILE_REPLACED"
    : body.isPublished !== undefined && body.isPublished !== existing.isPublished
      ? body.isPublished
        ? "LEGAL_DOCUMENT_PUBLISHED"
        : "LEGAL_DOCUMENT_UNPUBLISHED"
      : "LEGAL_DOCUMENT_UPDATED";
  await audit(admin.id, action, document.id, { fields: Object.keys(body) });
  res.json({ document: adminView(document) });
}

export async function adminDeleteLegalDocument(req: Request, res: Response) {
  const admin = currentUser(req);
  const document = await prisma.legalDocument.delete({ where: { id: param(req, "id") } }).catch((err: { code?: string }) => {
    if (err.code === "P2025") throw new HttpError(404, "Document not found");
    throw err;
  });
  await cleanup(document.storageKey, "document");
  await audit(admin.id, "LEGAL_DOCUMENT_DELETED", document.id, { title: document.title, type: document.type });
  res.json({ ok: true });
}

/** Deletes an upload that never became a document (the admin closed the form). */
export async function adminDiscardLegalDocumentUpload(req: Request, res: Response) {
  const { key } = parse(z.object({ key: z.string().startsWith(LEGAL_DOCUMENT_PREFIX, "Invalid key") }), req.body);
  if (await prisma.legalDocument.count({ where: { storageKey: key } })) throw new HttpError(409, "That file belongs to a saved document.");
  await cleanup(key, "discarded upload");
  res.json({ ok: true });
}

/** Admin preview of any document, published or not. */
export async function adminPreviewLegalDocument(req: Request, res: Response) {
  const document = await prisma.legalDocument.findUnique({ where: { id: param(req, "id") } });
  if (!document) throw new HttpError(404, "Document not found");
  res.setHeader("Cache-Control", "no-store");
  res.json({ url: await getDownloadUrl(document.storageKey, DOWNLOAD_TTL), fileName: downloadName(document.fileName, document.title, PDF) });
}

// ---------- Customers ----------

export async function listPublishedLegalDocuments(_req: Request, res: Response) {
  const documents = await prisma.legalDocument.findMany({ where: { isPublished: true }, orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }] });
  res.json({ documents: documents.map(customerView) });
}

/** A 5-minute signed link to a published document. Unknown and unpublished IDs look the same. */
export async function downloadLegalDocument(req: Request, res: Response) {
  const user = currentUser(req);
  if (!rateLimit(`legal-document-download:${user.id}`, 30, 10 * 60 * 1000)) throw new HttpError(429, "Too many downloads. Please wait a few minutes.");
  const document = await prisma.legalDocument.findUnique({ where: { id: param(req, "id") } });
  if (!document || !document.isPublished) throw new HttpError(404, "Document not found");
  res.setHeader("Cache-Control", "no-store");
  res.json({
    url: await getDownloadUrl(document.storageKey, DOWNLOAD_TTL),
    fileName: downloadName(document.fileName, document.title, PDF),
    expiresAt: new Date(Date.now() + DOWNLOAD_TTL * 1000),
  });
}
