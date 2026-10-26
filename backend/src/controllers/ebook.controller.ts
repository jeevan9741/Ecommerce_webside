import type { Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { currentUser } from "../middleware/auth.middleware.js";
import { HttpError, param } from "../utils/http.js";
import { rateLimit } from "../utils/rate-limit.js";
import { deleteObject, getClientUploadToken, getDownloadUrl, readObjectHead, statObject } from "../services/storage.service.js";
import { ebookLanguageAccess, opensLanguage, packagesById, paidPackageIds } from "../services/package-access.service.js";
import {
  EBOOK_FORMATS,
  EBOOK_MIME_TYPES,
  EBOOK_PREFIX,
  MAX_EBOOK_BYTES,
  SIGNATURE_BYTES,
  downloadName,
  extensionMatches,
  fileSignatureMatches,
  isEBookMimeType,
} from "../services/ebook-file.js";

/** Signed download links only need to outlive the click. */
const DOWNLOAD_TTL = 5 * 60;

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
  await deleteObject(key).catch((err) => console.error(`[EBOOK] Failed to delete ${label} ${key}`, err));
}

function storageName(filename: string, ext: string) {
  const base = filename.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "ebook";
  return `${Date.now()}-${randomBytes(6).toString("hex")}-${base}.${ext}`;
}

/** Trust the store, not the browser: the upload must exist, be an allowed type and size, and really be that format. */
async function verifyEBookUpload(key: string) {
  const stat = await statObject(key);
  if (!stat) throw new HttpError(400, "The e-book upload wasn't found — please upload it again.");
  const reject = async (message: string) => {
    await cleanup(key, "invalid upload");
    return new HttpError(400, message);
  };
  if (!isEBookMimeType(stat.contentType)) throw await reject("Only PDF or EPUB e-books can be uploaded.");
  if (stat.size <= 0 || stat.size > MAX_EBOOK_BYTES) throw await reject("E-books can be at most 100 MB.");
  const head = await readObjectHead(key, SIGNATURE_BYTES);
  if (!fileSignatureMatches(head, stat.contentType)) {
    throw await reject(`That file isn't a valid ${EBOOK_FORMATS[stat.contentType].label}.`);
  }
  return { size: stat.size, contentType: stat.contentType };
}

async function assertCourse(courseId: string) {
  if (!(await prisma.course.count({ where: { id: courseId } }))) throw new HttpError(400, "That package doesn't exist");
}

async function assertCategory(categoryId: string | null | undefined) {
  if (!categoryId) return;
  if (!(await prisma.courseCategory.count({ where: { id: categoryId } }))) throw new HttpError(400, "That category doesn't exist");
}

async function assertLanguage(languageId: string | undefined) {
  if (!languageId) return;
  if (!(await prisma.language.count({ where: { id: languageId } }))) throw new HttpError(400, "That language doesn't exist");
}

async function nextOrder(courseId: string) {
  const { _max } = await prisma.eBook.aggregate({ where: { courseId }, _max: { displayOrder: true } });
  return (_max.displayOrder ?? -1) + 1;
}

const include = {
  course: { select: { id: true, title: true, priceInPaise: true } },
  category: { select: { id: true, name: true } },
  language: { select: { id: true, code: true, name: true } },
} as const;
type EBookRow = Prisma.EBookGetPayload<{ include: typeof include }>;

function formatLabel(mimeType: string) {
  return isEBookMimeType(mimeType) ? EBOOK_FORMATS[mimeType].label : "File";
}

/** What students see — never the storage key or a permanent URL. */
function studentView(e: EBookRow) {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    format: formatLabel(e.mimeType),
    sizeBytes: Number(e.sizeBytes),
    course: { id: e.course.id, title: e.course.title },
    category: e.category ? { name: e.category.name } : null,
    language: e.language ? { code: e.language.code, name: e.language.name } : null,
    updatedAt: e.updatedAt,
  };
}

function adminView(e: EBookRow) {
  return {
    ...studentView(e),
    courseId: e.courseId,
    categoryId: e.categoryId,
    languageId: e.languageId,
    fileName: e.fileName,
    mimeType: e.mimeType,
    displayOrder: e.displayOrder,
    isPublished: e.isPublished,
    createdAt: e.createdAt,
  };
}

// ---------- Admin ----------

const uploadTokenSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.enum(EBOOK_MIME_TYPES as [string, ...string[]], { error: "Only PDF or EPUB e-books can be uploaded" }),
  sizeBytes: z.number().int().positive().max(MAX_EBOOK_BYTES, "E-books can be at most 100 MB"),
});

/** Scoped client token: one private pathname, one content type, 100 MB cap. */
export async function createEBookUploadToken(req: Request, res: Response) {
  const admin = currentUser(req);
  if (!rateLimit(`ebook-upload-token:${admin.id}`, 60, 60 * 60 * 1000)) throw new HttpError(429, "Too many uploads. Try again later.");
  const body = parse(uploadTokenSchema, req.body);
  const mimeType = body.contentType as keyof typeof EBOOK_FORMATS;
  if (!extensionMatches(body.filename, mimeType)) {
    throw new HttpError(400, `The file name must end in .${EBOOK_FORMATS[mimeType].ext}`);
  }
  const pathname = `${EBOOK_PREFIX}${storageName(body.filename, EBOOK_FORMATS[mimeType].ext)}`;
  const clientToken = await getClientUploadToken(pathname, {
    allowedContentTypes: [mimeType],
    maximumSizeInBytes: MAX_EBOOK_BYTES,
    validForSeconds: 30 * 60,
  });
  res.json({ pathname, clientToken, access: "private" });
}

const fileFields = {
  storageKey: z.string().startsWith(EBOOK_PREFIX, "Invalid e-book upload"),
  fileName: z.string().trim().min(1).max(255),
};

const createSchema = z.object({
  title: z.string().trim().min(2, "Enter a title").max(150),
  description: nullableText(2000),
  courseId: z.string().min(1, "Choose a package"),
  categoryId: z.string().min(1).nullable().optional(),
  languageId: z.string({ error: "Choose a language" }).min(1, "Choose a language"),
  isPublished: z.boolean().optional(),
  ...fileFields,
});

const updateSchema = z.object({
  title: z.string().trim().min(2).max(150).optional(),
  description: nullableText(2000),
  courseId: z.string().min(1).optional(),
  categoryId: z.string().min(1).nullable().optional(),
  /** Can be changed, not cleared: every e-book should say what language it's in. */
  languageId: z.string().min(1, "Choose a language").optional(),
  isPublished: z.boolean().optional(),
  displayOrder: z.number().int().min(0).max(100000).optional(),
  /** A new upload replaces the file. */
  storageKey: fileFields.storageKey.optional(),
  fileName: fileFields.fileName.optional(),
});

export async function adminListEBooks(req: Request, res: Response) {
  const courseId = typeof req.query.courseId === "string" ? req.query.courseId : "";
  const ebooks = await prisma.eBook.findMany({
    where: courseId ? { courseId } : {},
    include,
    orderBy: [{ courseId: "asc" }, { displayOrder: "asc" }, { createdAt: "asc" }],
    take: 500,
  });
  res.json({ ebooks: ebooks.map(adminView), maxBytes: MAX_EBOOK_BYTES, formats: Object.values(EBOOK_FORMATS).map((f) => f.label) });
}

export async function adminCreateEBook(req: Request, res: Response) {
  const admin = currentUser(req);
  const body = parse(createSchema, req.body);
  await Promise.all([assertCourse(body.courseId), assertCategory(body.categoryId), assertLanguage(body.languageId)]);
  const file = await verifyEBookUpload(body.storageKey);

  const ebook = await prisma.eBook
    .create({
      data: {
        title: body.title,
        description: body.description ?? null,
        courseId: body.courseId,
        categoryId: body.categoryId ?? null,
        languageId: body.languageId,
        fileName: body.fileName,
        storageKey: body.storageKey,
        mimeType: file.contentType,
        sizeBytes: BigInt(file.size),
        isPublished: body.isPublished ?? true,
        displayOrder: await nextOrder(body.courseId),
      },
      include,
    })
    .catch((err: { code?: string }) => {
      if (err.code === "P2002") throw new HttpError(409, "This upload is already saved as an e-book.");
      throw err;
    });

  await prisma.auditLog.create({ data: { actorId: admin.id, action: "EBOOK_CREATED", target: ebook.id, metadata: { courseId: ebook.courseId, languageId: ebook.languageId, sizeBytes: file.size } } });
  res.status(201).json({ ebook: adminView(ebook) });
}

export async function adminUpdateEBook(req: Request, res: Response) {
  const admin = currentUser(req);
  const body = parse(updateSchema, req.body);
  const existing = await prisma.eBook.findUnique({ where: { id: param(req, "id") } });
  if (!existing) throw new HttpError(404, "E-book not found");
  if (body.courseId !== undefined) await assertCourse(body.courseId);
  if (body.categoryId !== undefined) await assertCategory(body.categoryId);
  await assertLanguage(body.languageId);
  const replacing = body.storageKey !== undefined && body.storageKey !== existing.storageKey;
  if (replacing && !body.fileName) throw new HttpError(400, "Missing file name for the replacement file");
  const file = replacing ? await verifyEBookUpload(body.storageKey!) : null;
  const moving = body.courseId !== undefined && body.courseId !== existing.courseId;

  const { storageKey, fileName, ...fields } = body;
  const ebook = await prisma.eBook.update({
    where: { id: existing.id },
    data: {
      ...fields,
      ...(file ? { storageKey, fileName, mimeType: file.contentType, sizeBytes: BigInt(file.size) } : {}),
      ...(moving && body.displayOrder === undefined ? { displayOrder: await nextOrder(body.courseId!) } : {}),
    },
    include,
  });
  if (replacing) await cleanup(existing.storageKey, "replaced e-book");

  await prisma.auditLog.create({
    data: { actorId: admin.id, action: replacing ? "EBOOK_FILE_REPLACED" : "EBOOK_UPDATED", target: ebook.id, metadata: { fields: Object.keys(body) } },
  });
  res.json({ ebook: adminView(ebook) });
}

export async function adminDeleteEBook(req: Request, res: Response) {
  const admin = currentUser(req);
  const ebook = await prisma.eBook.delete({ where: { id: param(req, "id") } }).catch((err: { code?: string }) => {
    if (err.code === "P2025") throw new HttpError(404, "E-book not found");
    throw err;
  });
  await cleanup(ebook.storageKey, "e-book");
  await prisma.auditLog.create({ data: { actorId: admin.id, action: "EBOOK_DELETED", target: ebook.id, metadata: { title: ebook.title } } });
  res.json({ ok: true });
}

/** Deletes an upload that never became an e-book (the admin closed the form). */
export async function adminDiscardEBookUpload(req: Request, res: Response) {
  const { key } = parse(z.object({ key: z.string().startsWith(EBOOK_PREFIX, "Invalid key") }), req.body);
  if (await prisma.eBook.count({ where: { storageKey: key } })) throw new HttpError(409, "That file belongs to a saved e-book.");
  await cleanup(key, "discarded upload");
  res.json({ ok: true });
}

// ---------- Students ----------

/** Active packages that come with e-books — their buyers get the E-Books section. */
async function ebookPackageIds() {
  const rows = await prisma.course.findMany({
    where: { isActive: true, OR: [{ type: "EBOOK" }, { ebooks: { some: { isPublished: true } } }] },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * The student's e-books: published files of packages they've paid for. Each is `locked` unless a
 * PAID order of theirs covers its language (ebookLanguageAccess); e-books with no language yet are
 * left out until an admin assigns one. `packages` lists their e-book packages (so an empty list can
 * say "coming soon"); `unlock` lists what they could buy. ?courseId= narrows to one package (and
 * 403s when it isn't owned). Admins see every published e-book, unlocked.
 */
export async function listMyEBooks(req: Request, res: Response) {
  const user = currentUser(req);
  const courseId = typeof req.query.courseId === "string" && req.query.courseId ? req.query.courseId : null;
  const isAdmin = user.role === "ADMIN";

  const [paid, withEBooks] = await Promise.all([isAdmin ? null : paidPackageIds(user.id), ebookPackageIds()]);
  const owns = (id: string) => isAdmin || paid!.has(id);
  if (courseId && !owns(courseId)) {
    const [pkg] = await packagesById([courseId]);
    throw new HttpError(403, "Buy this package to access its e-books", { code: "NOT_PURCHASED", packages: pkg ? [pkg] : [] });
  }

  const visibleCourses = courseId ? [courseId] : isAdmin ? undefined : [...paid!];
  const [ebooks, packages, unlock, languages] = await Promise.all([
    prisma.eBook.findMany({
      where: {
        isPublished: true,
        ...(visibleCourses ? { courseId: { in: visibleCourses } } : {}),
        ...(isAdmin ? {} : { languageId: { not: null } }),
      },
      include,
      orderBy: [{ course: { priceInPaise: "asc" } }, { displayOrder: "asc" }, { createdAt: "asc" }],
    }),
    packagesById(courseId ? [courseId] : withEBooks.filter(owns)),
    courseId ? [] : packagesById(withEBooks.filter((id) => !owns(id))),
    isAdmin ? null : ebookLanguageAccess(user.id, visibleCourses),
  ]);
  res.json({
    ebooks: ebooks.map((e) => ({ ...studentView(e), locked: languages ? !opensLanguage(languages.get(e.courseId), e.language?.code) : false })),
    packages,
    unlock,
  });
}

/**
 * A 5-minute signed link to the file — only for admins, or a student with paid access to the
 * package AND a PAID order covering the e-book's language (see ebookLanguageAccess).
 */
export async function downloadEBook(req: Request, res: Response) {
  const user = currentUser(req);
  const isAdmin = user.role === "ADMIN";
  if (!rateLimit(`ebook-download:${user.id}`, 30, 10 * 60 * 1000)) throw new HttpError(429, "Too many downloads. Please wait a few minutes.");
  const ebook = await prisma.eBook.findUnique({ where: { id: param(req, "id") }, include });
  // Unknown, unpublished and not-yet-language-assigned IDs look the same, so IDs can't be probed.
  if (!ebook || (!isAdmin && (!ebook.isPublished || !ebook.language))) throw new HttpError(404, "E-book not found");
  if (!isAdmin) {
    const access = (await ebookLanguageAccess(user.id, [ebook.courseId])).get(ebook.courseId);
    const pkg = { id: ebook.course.id, title: ebook.course.title, priceInPaise: ebook.course.priceInPaise };
    if (!access) throw new HttpError(403, "Buy this package to download its e-books", { code: "NOT_PURCHASED", packages: [pkg] });
    if (!opensLanguage(access, ebook.language!.code)) {
      throw new HttpError(403, `Your purchase doesn't include the ${ebook.language!.name} e-book`, {
        code: "LANGUAGE_NOT_PURCHASED",
        packages: [pkg],
        language: { code: ebook.language!.code, name: ebook.language!.name },
      });
    }
  }
  const url = await getDownloadUrl(ebook.storageKey, DOWNLOAD_TTL);
  res.setHeader("Cache-Control", "no-store");
  res.json({
    url,
    fileName: downloadName(ebook.fileName, ebook.title, ebook.mimeType),
    expiresAt: new Date(Date.now() + DOWNLOAD_TTL * 1000),
  });
}
