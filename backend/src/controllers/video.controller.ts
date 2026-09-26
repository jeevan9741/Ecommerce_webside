import type { Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { CourseVideo, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { currentUser } from "../middleware/auth.middleware.js";
import { HttpError, param } from "../utils/http.js";
import { rateLimit } from "../utils/rate-limit.js";
import type { SessionPayload } from "../utils/tokens.js";
import {
  deleteObject,
  getClientUploadToken,
  getDownloadUrl,
  publicStoreConfigured,
  statObject,
  type BlobStore,
} from "../services/storage.service.js";

export const MAX_VIDEO_BYTES = 2 * 1024 ** 3; // 2 GB
export const MAX_THUMBNAIL_BYTES = 5 * 1024 ** 2;
const VIDEO_PREFIX = "course-videos/";
const THUMBNAIL_PREFIX = "course-video-thumbnails/";
export const DEMO_VIDEO_PREFIX = "demo-videos/";
export const DEMO_THUMBNAIL_PREFIX = "demo-video-thumbnails/";
export const THUMBNAIL_TYPES = ["image/jpeg", "image/png", "image/webp"];
/** Signed thumbnail links only need to outlive a page view. */
const THUMBNAIL_URL_TTL = 30 * 60;

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new HttpError(400, result.error.issues[0]?.message ?? "Invalid request");
  return result.data;
}

/** Keeps a readable, URL-safe slug of the original filename in the storage key. */
function storageName(filename: string, ext: string) {
  const base = filename.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "file";
  return `${Date.now()}-${randomBytes(4).toString("hex")}-${base}.${ext}`;
}

async function cleanup(key: string | null | undefined, label: string) {
  if (!key) return;
  // The row is already gone/updated; a leftover blob is only storage waste, so never fail the request.
  await deleteObject(key).catch((err) => console.error(`[VIDEO] Failed to delete ${label} ${key}`, err));
}

async function thumbnailUrl(key: string | null) {
  return key ? getDownloadUrl(key, THUMBNAIL_URL_TTL) : null;
}

/** Long enough to watch the whole video in one sitting (the player re-requests on expiry anyway). */
function streamTtlSeconds(durationSeconds: number | null) {
  const twoHours = 2 * 60 * 60;
  return Math.min(6 * 60 * 60, Math.max(twoHours, (durationSeconds ?? 0) * 2));
}

/** Admins can open any course; everyone else needs live (purchased, not revoked) access. */
async function canAccessCourse(user: SessionPayload, courseId: string) {
  if (user.role === "ADMIN") return true;
  const access = await prisma.courseAccess.findUnique({ where: { userId_courseId: { userId: user.id, courseId } } });
  return Boolean(access && !access.revokedAt);
}

/** Tells a signed-in non-buyer which package unlocks the content (the UI shows "Buy Course to Access"). */
async function notPurchased(courseId: string) {
  const [course, videoCount] = await Promise.all([
    prisma.course.findUnique({ where: { id: courseId }, select: { id: true, title: true, isActive: true } }),
    prisma.courseVideo.count({ where: { courseId, isPublished: true } }),
  ]);
  if (!course?.isActive) return new HttpError(404, "Course not found");
  return new HttpError(403, "Buy Course to Access", { code: "NOT_PURCHASED", course: { id: course.id, title: course.title }, videoCount });
}

/**
 * A playable video: published, assigned to a course, and that course owned (admins: any).
 * Hidden or unassigned videos 404 so their IDs can't be probed; published ones in a live course
 * answer 403 NOT_PURCHASED so a non-buyer is pointed at the package instead.
 */
async function watchableVideo(user: SessionPayload, videoId: string) {
  const video = await prisma.courseVideo.findUnique({
    where: { id: videoId },
    include: { course: { select: { id: true, title: true } }, language: { select: { code: true, name: true } } },
  });
  if (!video || !video.courseId || (!video.isPublished && user.role !== "ADMIN")) throw new HttpError(404, "Video not found");
  if (!(await canAccessCourse(user, video.courseId))) throw await notPurchased(video.courseId);
  return video as typeof video & { courseId: string };
}

function progressView(p: { positionSeconds: number; maxPositionSeconds: number; completed: boolean; updatedAt: Date } | null | undefined) {
  return p
    ? { positionSeconds: p.positionSeconds, maxPositionSeconds: p.maxPositionSeconds, completed: p.completed, updatedAt: p.updatedAt }
    : null;
}

// ---------- Admin: uploads ----------

// `purpose` picks the folder and store: course videos are always private; demo videos go to the
// public store when one is configured.
const purpose = z.enum(["course", "demo"]).default("course");

const uploadTokenSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("video"),
    purpose,
    filename: z.string().min(1).max(255).regex(/\.mp4$/i, "Only MP4 files can be uploaded"),
    contentType: z.literal("video/mp4", { error: "Only MP4 (video/mp4) files can be uploaded" }),
    sizeBytes: z.number().int().positive().max(MAX_VIDEO_BYTES, "Videos can be at most 2 GB"),
  }),
  z.object({
    kind: z.literal("thumbnail"),
    purpose,
    filename: z.string().min(1).max(255),
    contentType: z.enum(THUMBNAIL_TYPES as [string, ...string[]], { error: "Thumbnails must be JPG, PNG or WebP" }),
    sizeBytes: z.number().int().positive().max(MAX_THUMBNAIL_BYTES, "Thumbnails can be at most 5 MB"),
  }),
]);

/** Issues a scoped client token; the browser then uploads the file straight to the private store. */
export async function createVideoUploadToken(req: Request, res: Response) {
  const admin = currentUser(req);
  if (!rateLimit(`video-upload-token:${admin.id}`, 60, 60 * 60 * 1000)) throw new HttpError(429, "Too many uploads. Try again later.");
  const body = parse(uploadTokenSchema, req.body);

  const isVideo = body.kind === "video";
  const demo = body.purpose === "demo";
  const store = demo && publicStoreConfigured() ? "public" : "private";
  const ext = isVideo ? "mp4" : body.contentType.split("/")[1].replace("jpeg", "jpg");
  const prefix = demo ? (isVideo ? DEMO_VIDEO_PREFIX : DEMO_THUMBNAIL_PREFIX) : isVideo ? VIDEO_PREFIX : THUMBNAIL_PREFIX;
  const pathname = `${prefix}${storageName(body.filename, ext)}`;
  const clientToken = await getClientUploadToken(pathname, {
    allowedContentTypes: [body.contentType],
    maximumSizeInBytes: isVideo ? MAX_VIDEO_BYTES : MAX_THUMBNAIL_BYTES,
    // A 2 GB upload on a slow connection can take hours.
    validForSeconds: isVideo ? 6 * 60 * 60 : 15 * 60,
    store,
  });
  // The browser must upload with the store's access mode, or Blob rejects the token.
  res.json({ pathname, clientToken, access: store });
}

// ---------- Admin: CRUD ----------

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : v === undefined ? undefined : null));

const createSchema = z.object({
  title: z.string().trim().min(2, "Enter a title").max(150),
  description: nullableText(5000),
  courseId: z.string().min(1).nullable().optional(),
  languageId: z.string().min(1).nullable().optional(),
  storageKey: z.string().startsWith(VIDEO_PREFIX, "Invalid video upload"),
  thumbnailKey: z.string().startsWith(THUMBNAIL_PREFIX, "Invalid thumbnail upload").nullable().optional(),
  durationSeconds: z.number().int().min(0).max(24 * 60 * 60).nullable().optional(),
  isPublished: z.boolean().optional(),
});

const updateSchema = z.object({
  title: z.string().trim().min(2).max(150).optional(),
  description: nullableText(5000),
  courseId: z.string().min(1).nullable().optional(),
  languageId: z.string().min(1).nullable().optional(),
  thumbnailKey: z.string().startsWith(THUMBNAIL_PREFIX, "Invalid thumbnail upload").nullable().optional(),
  /** Replaces the video file; students keep their progress. */
  storageKey: z.string().startsWith(VIDEO_PREFIX, "Invalid video upload").optional(),
  durationSeconds: z.number().int().min(0).max(24 * 60 * 60).nullable().optional(),
  isPublished: z.boolean().optional(),
  displayOrder: z.number().int().min(0).max(100000).optional(),
});

async function assertCourse(courseId: string | null | undefined) {
  if (!courseId) return;
  const exists = await prisma.course.count({ where: { id: courseId } });
  if (!exists) throw new HttpError(400, "That course doesn't exist");
}

async function assertLanguage(languageId: string | null | undefined) {
  if (!languageId) return;
  if (!(await prisma.language.count({ where: { id: languageId } }))) throw new HttpError(400, "That language doesn't exist");
}

/** Trust the store, not the client: the upload must exist and match the MP4/2 GB rules. */
async function verifyVideoUpload(key: string, store: BlobStore = "private") {
  const stat = await statObject(key, store);
  if (!stat) throw new HttpError(400, "The video upload wasn't found — please upload it again.");
  if (stat.contentType !== "video/mp4" || stat.size > MAX_VIDEO_BYTES) {
    await deleteObject(key, store).catch((err) => console.error(`[VIDEO] Failed to delete invalid video ${key}`, err));
    throw new HttpError(400, "Only MP4 videos up to 2 GB are allowed.");
  }
  return stat;
}

async function assertThumbnail(key: string | null | undefined) {
  if (!key) return;
  const stat = await statObject(key);
  if (!stat) throw new HttpError(400, "The thumbnail upload wasn't found — please upload it again.");
  if (!THUMBNAIL_TYPES.includes(stat.contentType) || stat.size > MAX_THUMBNAIL_BYTES) throw new HttpError(400, "Invalid thumbnail file");
}

async function nextOrder(courseId: string | null | undefined) {
  const { _max } = await prisma.courseVideo.aggregate({ where: { courseId: courseId ?? null }, _max: { displayOrder: true } });
  return (_max.displayOrder ?? -1) + 1;
}

async function adminView(
  v: CourseVideo & { course: { title: string } | null; language?: { code: string; name: string } | null; _count?: { progress: number } },
  completions = 0
) {
  return {
    id: v.id,
    courseId: v.courseId,
    courseTitle: v.course?.title ?? null,
    languageId: v.languageId,
    language: v.language ?? null,
    title: v.title,
    description: v.description,
    mimeType: v.mimeType,
    sizeBytes: Number(v.sizeBytes),
    durationSeconds: v.durationSeconds,
    displayOrder: v.displayOrder,
    isPublished: v.isPublished,
    thumbnailUrl: await thumbnailUrl(v.thumbnailKey),
    hasThumbnail: Boolean(v.thumbnailKey),
    viewers: v._count?.progress ?? 0,
    completions,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
}

export async function adminListVideos(req: Request, res: Response) {
  const courseId = typeof req.query.courseId === "string" ? req.query.courseId : "";
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const where: Prisma.CourseVideoWhereInput = {
    ...(courseId === "unassigned" ? { courseId: null } : courseId ? { courseId } : {}),
    ...(q ? { title: { contains: q, mode: "insensitive" } } : {}),
  };
  const [videos, completions] = await Promise.all([
    prisma.courseVideo.findMany({
      where,
      include: { course: { select: { title: true } }, language: { select: { code: true, name: true } }, _count: { select: { progress: true } } },
      orderBy: [{ courseId: "asc" }, { displayOrder: "asc" }, { createdAt: "asc" }],
      take: 500,
    }),
    prisma.videoProgress.groupBy({ by: ["videoId"], where: { completed: true }, _count: true }),
  ]);
  const done = new Map(completions.map((c) => [c.videoId, c._count]));
  res.json({ videos: await Promise.all(videos.map((v) => adminView(v, done.get(v.id) ?? 0))) });
}

export async function adminCreateVideo(req: Request, res: Response) {
  const admin = currentUser(req);
  const body = parse(createSchema, req.body);
  await Promise.all([assertCourse(body.courseId), assertLanguage(body.languageId)]);

  const stat = await verifyVideoUpload(body.storageKey);
  await assertThumbnail(body.thumbnailKey);

  const video = await prisma.courseVideo
    .create({
      data: {
        title: body.title,
        description: body.description ?? null,
        courseId: body.courseId ?? null,
        languageId: body.languageId ?? null,
        storageKey: body.storageKey,
        thumbnailKey: body.thumbnailKey ?? null,
        mimeType: stat.contentType,
        sizeBytes: BigInt(stat.size),
        durationSeconds: body.durationSeconds ?? null,
        isPublished: body.isPublished ?? true,
        displayOrder: await nextOrder(body.courseId),
      },
      include: { course: { select: { title: true } }, language: { select: { code: true, name: true } } },
    })
    .catch((err: { code?: string }) => {
      if (err.code === "P2002") throw new HttpError(409, "This upload is already saved as a video.");
      throw err;
    });

  await prisma.auditLog.create({ data: { actorId: admin.id, action: "COURSE_VIDEO_CREATED", target: video.id, metadata: { sizeBytes: stat.size } } });
  res.status(201).json({ video: await adminView(video) });
}

export async function adminUpdateVideo(req: Request, res: Response) {
  const admin = currentUser(req);
  const body = parse(updateSchema, req.body);
  const existing = await prisma.courseVideo.findUnique({ where: { id: param(req, "id") } });
  if (!existing) throw new HttpError(404, "Video not found");
  if (body.courseId !== undefined) await assertCourse(body.courseId);
  if (body.languageId !== undefined) await assertLanguage(body.languageId);
  if (body.thumbnailKey) await assertThumbnail(body.thumbnailKey);
  const replacing = body.storageKey !== undefined && body.storageKey !== existing.storageKey;
  const file = replacing ? await verifyVideoUpload(body.storageKey!) : null;

  const movingCourse = body.courseId !== undefined && body.courseId !== existing.courseId;
  const video = await prisma.courseVideo.update({
    where: { id: existing.id },
    data: {
      ...body,
      ...(file ? { mimeType: file.contentType, sizeBytes: BigInt(file.size) } : {}),
      // A video moved to another course joins the end of that course's list.
      ...(movingCourse && body.displayOrder === undefined ? { displayOrder: await nextOrder(body.courseId) } : {}),
    },
    include: { course: { select: { title: true } }, language: { select: { code: true, name: true } } },
  });
  if (body.thumbnailKey !== undefined && existing.thumbnailKey && existing.thumbnailKey !== body.thumbnailKey) {
    await cleanup(existing.thumbnailKey, "replaced thumbnail");
  }
  if (replacing) await cleanup(existing.storageKey, "replaced video");

  await prisma.auditLog.create({ data: { actorId: admin.id, action: "COURSE_VIDEO_UPDATED", target: video.id, metadata: { fields: Object.keys(body) } } });
  res.json({ video: await adminView(video) });
}

export async function adminDeleteVideo(req: Request, res: Response) {
  const admin = currentUser(req);
  const video = await prisma.courseVideo.delete({ where: { id: param(req, "id") } }).catch((err: { code?: string }) => {
    if (err.code === "P2025") throw new HttpError(404, "Video not found");
    throw err;
  });
  await Promise.all([cleanup(video.storageKey, "video"), cleanup(video.thumbnailKey, "thumbnail")]);
  await prisma.auditLog.create({ data: { actorId: admin.id, action: "COURSE_VIDEO_DELETED", target: video.id, metadata: { title: video.title } } });
  res.json({ ok: true });
}

/** Deletes an upload that never became a video (e.g. the admin cancelled the form). */
export async function adminDiscardUpload(req: Request, res: Response) {
  const { key } = parse(z.object({ key: z.string().min(1) }), req.body);
  const demo = key.startsWith(DEMO_VIDEO_PREFIX) || key.startsWith(DEMO_THUMBNAIL_PREFIX);
  if (!demo && !key.startsWith(VIDEO_PREFIX) && !key.startsWith(THUMBNAIL_PREFIX)) throw new HttpError(400, "Invalid key");
  const inUse = demo
    ? await prisma.demoVideo.count({ where: { OR: [{ storageKey: key }, { thumbnailKey: key }] } })
    : await prisma.courseVideo.count({ where: { OR: [{ storageKey: key }, { thumbnailKey: key }] } });
  if (inUse) throw new HttpError(409, "That file belongs to a saved video.");
  const store = demo && publicStoreConfigured() ? "public" : "private";
  await deleteObject(key, store).catch((err) => console.error(`[VIDEO] Failed to delete discarded upload ${key}`, err));
  res.json({ ok: true });
}

export async function adminPreviewVideo(req: Request, res: Response) {
  const video = await prisma.courseVideo.findUnique({ where: { id: param(req, "id") } });
  if (!video) throw new HttpError(404, "Video not found");
  const ttl = streamTtlSeconds(video.durationSeconds);
  res.json({ streamUrl: await getDownloadUrl(video.storageKey, ttl), expiresAt: new Date(Date.now() + ttl * 1000) });
}

// ---------- Demo videos (one per language, free to watch without login) ----------

type DemoRow = Prisma.DemoVideoGetPayload<{ include: { language: true } }>;

/** Where the upload tokens put new demo files right now (see createVideoUploadToken). */
function demoUploadStore(): BlobStore {
  return publicStoreConfigured() ? "public" : "private";
}

/** Public-store files carry their CDN URL; private ones (incl. every pre-existing demo) get signed links. */
async function demoPlayback(v: DemoRow) {
  return {
    url: v.publicUrl ?? (await getDownloadUrl(v.storageKey, streamTtlSeconds(v.durationSeconds))),
    thumbnailUrl: v.thumbnailUrl ?? (v.thumbnailKey ? await thumbnailUrl(v.thumbnailKey) : null),
  };
}

async function cleanupDemoFile(key: string | null, isPublic: boolean, label: string) {
  if (!key) return;
  await deleteObject(key, isPublic ? "public" : "private").catch((err) => console.error(`[VIDEO] Failed to delete ${label} ${key}`, err));
}

/** Shape for the homepage player. */
export async function demoPublicView(v: DemoRow) {
  return {
    title: v.title || `${v.language.name} demo`,
    description: v.description,
    languageCode: v.language.code,
    languageName: v.language.name,
    durationSeconds: v.durationSeconds,
    ...(await demoPlayback(v)),
  };
}

async function demoAdminView(v: DemoRow) {
  return {
    id: v.id,
    languageId: v.languageId,
    language: { id: v.language.id, code: v.language.code, name: v.language.name, nativeName: v.language.nativeName, isActive: v.language.isActive },
    title: v.title,
    description: v.description,
    sizeBytes: v.sizeBytes === null ? null : Number(v.sizeBytes),
    durationSeconds: v.durationSeconds,
    isPublic: Boolean(v.publicUrl),
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
    ...(await demoPlayback(v)),
  };
}

const demoFields = {
  title: z.string().trim().min(2, "Enter a title").max(150),
  description: nullableText(2000),
  languageId: z.string().min(1, "Choose a language"),
  storageKey: z.string().startsWith(DEMO_VIDEO_PREFIX, "Invalid video upload"),
  thumbnailKey: z.string().startsWith(DEMO_THUMBNAIL_PREFIX, "Invalid thumbnail upload").nullable().optional(),
  durationSeconds: z.number().int().min(0).max(24 * 60 * 60).nullable().optional(),
};
const demoCreateSchema = z.object(demoFields);
const demoUpdateSchema = z.object({
  ...demoFields,
  title: demoFields.title.optional(),
  languageId: demoFields.languageId.optional(),
  storageKey: demoFields.storageKey.optional(),
});

/** Verifies a new demo upload and returns the columns it sets. */
async function demoFileData(storageKey: string) {
  const store = demoUploadStore();
  const stat = await verifyVideoUpload(storageKey, store);
  return { storageKey, sizeBytes: BigInt(stat.size), publicUrl: store === "public" ? stat.url : null };
}

async function demoThumbData(thumbnailKey: string | null) {
  if (!thumbnailKey) return { thumbnailKey: null, thumbnailUrl: null };
  const store = demoUploadStore();
  const stat = await statObject(thumbnailKey, store);
  if (!stat || !THUMBNAIL_TYPES.includes(stat.contentType) || stat.size > MAX_THUMBNAIL_BYTES) {
    throw new HttpError(400, "The thumbnail upload wasn't found or isn't a valid image.");
  }
  return { thumbnailKey, thumbnailUrl: store === "public" ? stat.url : null };
}

function languageTaken(err: { code?: string }): never {
  if (err.code === "P2002") throw new HttpError(409, "That language already has a demo video — edit or replace it instead.");
  throw err;
}

export async function adminListDemoVideos(_req: Request, res: Response) {
  const videos = await prisma.demoVideo.findMany({ include: { language: true }, orderBy: { language: { displayOrder: "asc" } } });
  res.json({ videos: await Promise.all(videos.map(demoAdminView)) });
}

export async function adminCreateDemoVideo(req: Request, res: Response) {
  const admin = currentUser(req);
  const body = parse(demoCreateSchema, req.body);
  await assertLanguage(body.languageId);
  if (await prisma.demoVideo.count({ where: { languageId: body.languageId } })) languageTaken({ code: "P2002" });

  const video = await prisma.demoVideo
    .create({
      data: {
        languageId: body.languageId,
        title: body.title,
        description: body.description ?? null,
        durationSeconds: body.durationSeconds ?? null,
        ...(await demoFileData(body.storageKey)),
        ...(await demoThumbData(body.thumbnailKey ?? null)),
      },
      include: { language: true },
    })
    .catch(languageTaken);

  await prisma.auditLog.create({ data: { actorId: admin.id, action: "DEMO_VIDEO_CREATED", target: video.id, metadata: { language: video.language.code } } });
  res.status(201).json({ video: await demoAdminView(video) });
}

export async function adminUpdateDemoVideo(req: Request, res: Response) {
  const admin = currentUser(req);
  const body = parse(demoUpdateSchema, req.body);
  const existing = await prisma.demoVideo.findUnique({ where: { id: param(req, "id") } });
  if (!existing) throw new HttpError(404, "Demo video not found");
  if (body.languageId) await assertLanguage(body.languageId);

  const replacing = body.storageKey !== undefined && body.storageKey !== existing.storageKey;
  const rethumb = body.thumbnailKey !== undefined && body.thumbnailKey !== existing.thumbnailKey;
  const video = await prisma.demoVideo
    .update({
      where: { id: existing.id },
      data: {
        title: body.title,
        description: body.description,
        languageId: body.languageId,
        // A new file gets its duration from the form; keep the old one only for metadata edits.
        ...(replacing ? { ...(await demoFileData(body.storageKey!)), durationSeconds: body.durationSeconds ?? null } : {}),
        ...(rethumb ? await demoThumbData(body.thumbnailKey ?? null) : {}),
      },
      include: { language: true },
    })
    .catch(languageTaken);

  if (replacing) await cleanupDemoFile(existing.storageKey, Boolean(existing.publicUrl), "replaced demo video");
  if (rethumb) await cleanupDemoFile(existing.thumbnailKey, Boolean(existing.thumbnailUrl), "replaced demo thumbnail");
  await prisma.auditLog.create({ data: { actorId: admin.id, action: "DEMO_VIDEO_UPDATED", target: video.id, metadata: { fields: Object.keys(body) } } });
  res.json({ video: await demoAdminView(video) });
}

export async function adminDeleteDemoVideo(req: Request, res: Response) {
  const admin = currentUser(req);
  const video = await prisma.demoVideo.delete({ where: { id: param(req, "id") } }).catch((err: { code?: string }) => {
    if (err.code === "P2025") throw new HttpError(404, "Demo video not found");
    throw err;
  });
  await Promise.all([
    cleanupDemoFile(video.storageKey, Boolean(video.publicUrl), "demo video"),
    cleanupDemoFile(video.thumbnailKey, Boolean(video.thumbnailUrl), "demo thumbnail"),
  ]);
  await prisma.auditLog.create({ data: { actorId: admin.id, action: "DEMO_VIDEO_DELETED", target: video.id, metadata: { title: video.title } } });
  res.json({ ok: true });
}

// ---------- Students ----------

export async function listCourseVideos(req: Request, res: Response) {
  const user = currentUser(req);
  const courseId = param(req, "courseId");
  if (!(await canAccessCourse(user, courseId))) throw await notPurchased(courseId);

  const videos = await prisma.courseVideo.findMany({
    where: { courseId, isPublished: true },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
    include: { progress: { where: { userId: user.id }, take: 1 }, language: { select: { code: true, name: true } } },
  });
  res.json({
    videos: await Promise.all(
      videos.map(async (v) => ({
        id: v.id,
        title: v.title,
        description: v.description,
        durationSeconds: v.durationSeconds,
        language: v.language,
        thumbnailUrl: await thumbnailUrl(v.thumbnailKey),
        progress: progressView(v.progress[0]),
      }))
    ),
  });
}

/** Everything the player page needs, including a short-lived signed stream URL. */
export async function watchVideo(req: Request, res: Response) {
  const user = currentUser(req);
  const video = await watchableVideo(user, param(req, "id"));
  const ttl = streamTtlSeconds(video.durationSeconds);

  const [streamUrl, thumb, progress, playlist] = await Promise.all([
    getDownloadUrl(video.storageKey, ttl),
    thumbnailUrl(video.thumbnailKey),
    prisma.videoProgress.findUnique({ where: { userId_videoId: { userId: user.id, videoId: video.id } } }),
    prisma.courseVideo.findMany({
      where: { courseId: video.courseId, isPublished: true },
      orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, title: true, durationSeconds: true, progress: { where: { userId: user.id }, take: 1 } },
    }),
  ]);

  res.json({
    video: {
      id: video.id,
      title: video.title,
      description: video.description,
      durationSeconds: video.durationSeconds,
      mimeType: video.mimeType,
      thumbnailUrl: thumb,
      course: video.course,
    },
    streamUrl,
    expiresAt: new Date(Date.now() + ttl * 1000),
    progress: progressView(progress),
    playlist: playlist.map((p) => ({ id: p.id, title: p.title, durationSeconds: p.durationSeconds, progress: progressView(p.progress[0]) })),
  });
}

const progressSchema = z.object({
  positionSeconds: z.number().min(0).max(24 * 60 * 60),
  durationSeconds: z.number().min(0).max(24 * 60 * 60).optional(),
  completed: z.boolean().optional(),
});

/** Called every few seconds while playing, and on pause/end. */
export async function saveVideoProgress(req: Request, res: Response) {
  const user = currentUser(req);
  if (!rateLimit(`video-progress:${user.id}`, 120, 60 * 1000)) throw new HttpError(429, "Too many updates");
  const body = parse(progressSchema, req.body);
  const video = await watchableVideo(user, param(req, "id"));

  const duration = video.durationSeconds ?? (body.durationSeconds ? Math.round(body.durationSeconds) : null);
  const position = Math.round(duration ? Math.min(body.positionSeconds, duration) : body.positionSeconds);
  // Watching 95% counts as finished — credits and outros usually aren't watched.
  const reachedEnd = duration ? position >= duration * 0.95 : false;

  const existing = await prisma.videoProgress.findUnique({ where: { userId_videoId: { userId: user.id, videoId: video.id } } });
  const completed = existing?.completed || reachedEnd || body.completed === true;
  const data = {
    positionSeconds: position,
    maxPositionSeconds: Math.max(existing?.maxPositionSeconds ?? 0, position),
    completed,
    completedAt: completed ? existing?.completedAt ?? new Date() : null,
  };
  const saved = await prisma.videoProgress.upsert({
    where: { userId_videoId: { userId: user.id, videoId: video.id } },
    update: data,
    create: { userId: user.id, videoId: video.id, ...data },
  });

  // Fill in a missing duration from the first real player report (older uploads, failed metadata read).
  if (!video.durationSeconds && body.durationSeconds && body.durationSeconds > 0) {
    await prisma.courseVideo.update({ where: { id: video.id }, data: { durationSeconds: Math.round(body.durationSeconds) } });
  }
  res.json({ progress: progressView(saved) });
}
