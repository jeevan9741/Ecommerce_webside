import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { currentUser } from "../middleware/auth.middleware.js";
import { HttpError, param } from "../utils/http.js";
import { getDownloadUrl } from "../services/storage.service.js";
import { ownedPackageIds } from "../services/category-access.service.js";

/**
 * The course category library: Meesho / Flipkart / … with optional subcategories. Admins manage the
 * tree and which packages unlock each top-level category; students browse it with video counts
 * and progress. Watching still goes through the video controller's access checks.
 */

const THUMBNAIL_URL_TTL = 30 * 60;

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new HttpError(400, result.error.issues[0]?.message ?? "Invalid request");
  return result.data;
}

function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "category"
  );
}

async function uniqueSlug(name: string) {
  const base = slugify(name);
  for (let i = 1; ; i++) {
    const slug = i === 1 ? base : `${base}-${i}`;
    if (!(await prisma.courseCategory.count({ where: { slug } }))) return slug;
  }
}

/** Published video counts per category ID (only videos filed directly in that category). */
async function publishedCounts() {
  const rows = await prisma.courseVideo.groupBy({ by: ["categoryId"], where: { isPublished: true, categoryId: { not: null } }, _count: true });
  return new Map(rows.map((r) => [r.categoryId!, r._count]));
}

/** The user's completed, published videos per category ID. */
async function completedCounts(userId: string) {
  const rows = await prisma.videoProgress.findMany({
    where: { userId, completed: true, video: { isPublished: true, categoryId: { not: null } } },
    select: { video: { select: { categoryId: true } } },
  });
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.video.categoryId!, (map.get(r.video.categoryId!) ?? 0) + 1);
  return map;
}

function percent(done: number, total: number) {
  return total ? Math.round((done / total) * 100) : 0;
}

// ---------- Admin: category manager ----------

const orderBy = [{ displayOrder: "asc" as const }, { name: "asc" as const }];

export async function adminListCategories(_req: Request, res: Response) {
  const [categories, videoCounts, packages] = await Promise.all([
    prisma.courseCategory.findMany({
      where: { parentId: null },
      orderBy,
      include: {
        packages: { select: { courseId: true } },
        children: { orderBy, include: { _count: { select: { videos: true } } } },
        _count: { select: { videos: true } },
      },
    }),
    publishedCounts(),
    prisma.course.findMany({ orderBy: { priceInPaise: "asc" }, select: { id: true, title: true, priceInPaise: true, isActive: true } }),
  ]);

  res.json({
    packages,
    categories: categories.map((c) => {
      const children = c.children.map((s) => ({
        id: s.id,
        name: s.name,
        slug: s.slug,
        description: s.description,
        displayOrder: s.displayOrder,
        isActive: s.isActive,
        videoCount: s._count.videos,
        publishedCount: videoCounts.get(s.id) ?? 0,
      }));
      return {
        id: c.id,
        name: c.name,
        slug: c.slug,
        description: c.description,
        displayOrder: c.displayOrder,
        isActive: c.isActive,
        packageIds: c.packages.map((p) => p.courseId),
        // A category's totals include its subcategories.
        videoCount: c._count.videos + children.reduce((n, s) => n + s.videoCount, 0),
        publishedCount: (videoCounts.get(c.id) ?? 0) + children.reduce((n, s) => n + s.publishedCount, 0),
        subcategories: children,
      };
    }),
  });
}

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === "" ? null : v));

const createSchema = z.object({
  name: z.string().trim().min(2, "Enter a name").max(80),
  description: nullableText(500),
  parentId: z.string().min(1).nullable().optional(),
});

export async function adminCreateCategory(req: Request, res: Response) {
  const admin = currentUser(req);
  const body = parse(createSchema, req.body);
  if (body.parentId) {
    const parent = await prisma.courseCategory.findUnique({ where: { id: body.parentId }, include: { _count: { select: { videos: true } } } });
    if (!parent) throw new HttpError(400, "That category doesn't exist");
    if (parent.parentId) throw new HttpError(400, "Subcategories can't have their own subcategories.");
    // Videos live in subcategories once a category has any, so don't strand videos filed on the parent.
    if (parent._count.videos > 0) {
      throw new HttpError(409, `Move the ${parent._count.videos} video(s) filed directly in “${parent.name}” into a subcategory first.`);
    }
  }
  const { _max } = await prisma.courseCategory.aggregate({ where: { parentId: body.parentId ?? null }, _max: { displayOrder: true } });
  const category = await prisma.courseCategory.create({
    data: {
      name: body.name,
      description: body.description ?? null,
      parentId: body.parentId ?? null,
      slug: await uniqueSlug(body.name),
      displayOrder: (_max.displayOrder ?? -1) + 1,
    },
  });
  await prisma.auditLog.create({ data: { actorId: admin.id, action: "CATEGORY_CREATED", target: category.id, metadata: { name: category.name } } });
  res.status(201).json({ category });
}

const updateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  description: nullableText(500),
  isActive: z.boolean().optional(),
});

/** The slug is kept on rename so student links and bookmarks keep working. */
export async function adminUpdateCategory(req: Request, res: Response) {
  const admin = currentUser(req);
  const body = parse(updateSchema, req.body);
  const category = await prisma.courseCategory
    .update({ where: { id: param(req, "id") }, data: body })
    .catch((err: { code?: string }) => {
      if (err.code === "P2025") throw new HttpError(404, "Category not found");
      throw err;
    });
  await prisma.auditLog.create({ data: { actorId: admin.id, action: "CATEGORY_UPDATED", target: category.id, metadata: { fields: Object.keys(body) } } });
  res.json({ category });
}

/** Swaps a category with its neighbour among its siblings. */
export async function adminMoveCategory(req: Request, res: Response) {
  const { direction } = parse(z.object({ direction: z.enum(["up", "down"]) }), req.body);
  const category = await prisma.courseCategory.findUnique({ where: { id: param(req, "id") } });
  if (!category) throw new HttpError(404, "Category not found");
  const siblings = await prisma.courseCategory.findMany({ where: { parentId: category.parentId }, orderBy });
  const i = siblings.findIndex((s) => s.id === category.id);
  const j = direction === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= siblings.length) return res.json({ ok: true });
  // Renumber the whole sibling list so ties from older data can't make the swap a no-op.
  [siblings[i], siblings[j]] = [siblings[j], siblings[i]];
  await prisma.$transaction(siblings.map((s, n) => prisma.courseCategory.update({ where: { id: s.id }, data: { displayOrder: n } })));
  res.json({ ok: true });
}

/** Which packages unlock a top-level category (replaces the whole set). */
export async function adminSetCategoryPackages(req: Request, res: Response) {
  const admin = currentUser(req);
  const { courseIds } = parse(z.object({ courseIds: z.array(z.string().min(1)).max(50) }), req.body);
  const category = await prisma.courseCategory.findUnique({ where: { id: param(req, "id") } });
  if (!category) throw new HttpError(404, "Category not found");
  if (category.parentId) throw new HttpError(400, "Packages are set on the main category and cover all its subcategories.");
  const ids = [...new Set(courseIds)];
  if ((await prisma.course.count({ where: { id: { in: ids } } })) !== ids.length) throw new HttpError(400, "One of those packages doesn't exist");

  await prisma.$transaction([
    prisma.categoryPackage.deleteMany({ where: { categoryId: category.id, courseId: { notIn: ids } } }),
    prisma.categoryPackage.createMany({ data: ids.map((courseId) => ({ categoryId: category.id, courseId })), skipDuplicates: true }),
  ]);
  await prisma.auditLog.create({ data: { actorId: admin.id, action: "CATEGORY_PACKAGES_SET", target: category.id, metadata: { courseIds: ids } } });
  res.json({ packageIds: ids });
}

/** Only empty categories can be deleted — videos and subcategories are never removed as a side effect. */
export async function adminDeleteCategory(req: Request, res: Response) {
  const admin = currentUser(req);
  const category = await prisma.courseCategory.findUnique({
    where: { id: param(req, "id") },
    include: { _count: { select: { videos: true, children: true } } },
  });
  if (!category) throw new HttpError(404, "Category not found");
  if (category._count.children) throw new HttpError(409, "Delete or move its subcategories first.");
  if (category._count.videos) throw new HttpError(409, `It still has ${category._count.videos} video(s) — move or delete them first.`);
  await prisma.courseCategory.delete({ where: { id: category.id } });
  await prisma.auditLog.create({ data: { actorId: admin.id, action: "CATEGORY_DELETED", target: category.id, metadata: { name: category.name } } });
  res.json({ ok: true });
}

// ---------- Students: category library ----------

const liveTree = {
  where: { parentId: null, isActive: true },
  orderBy,
  include: {
    packages: { select: { courseId: true, course: { select: { id: true, title: true, priceInPaise: true, isActive: true } } } },
    children: { where: { isActive: true }, orderBy },
  },
} as const;

type LiveCategory = Awaited<ReturnType<typeof prisma.courseCategory.findMany<typeof liveTree>>>[number];

function summarize(
  c: LiveCategory,
  ctx: { isAdmin: boolean; owned: Set<string>; counts: Map<string, number>; done: Map<string, number> }
) {
  const locked = !ctx.isAdmin && !c.packages.some((p) => ctx.owned.has(p.courseId));
  // A category with subcategories holds its videos in them; one without holds them itself.
  const sectionIds = c.children.length ? c.children.map((s) => s.id) : [c.id];
  const videoCount = sectionIds.reduce((n, id) => n + (ctx.counts.get(id) ?? 0), 0);
  const completedCount = locked ? 0 : sectionIds.reduce((n, id) => n + (ctx.done.get(id) ?? 0), 0);
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    description: c.description,
    locked,
    // What the locked screen offers; empty = not on sale yet.
    packages: locked
      ? c.packages.filter((p) => p.course.isActive).map((p) => p.course).sort((a, b) => a.priceInPaise - b.priceInPaise)
      : [],
    videoCount,
    completedCount,
    progressPercent: percent(completedCount, videoCount),
    subcategories: c.children.map((s) => {
      const count = ctx.counts.get(s.id) ?? 0;
      const completed = locked ? 0 : ctx.done.get(s.id) ?? 0;
      return { id: s.id, slug: s.slug, name: s.name, videoCount: count, completedCount: completed, progressPercent: percent(completed, count) };
    }),
  };
}

async function libraryContext(userId: string, isAdmin: boolean) {
  const [owned, counts, done] = await Promise.all([ownedPackageIds(userId), publishedCounts(), completedCounts(userId)]);
  return { isAdmin, owned, counts, done };
}

export async function listMyCategories(req: Request, res: Response) {
  const user = currentUser(req);
  const [categories, ctx] = await Promise.all([prisma.courseCategory.findMany(liveTree), libraryContext(user.id, user.role === "ADMIN")]);
  const list = categories.map((c) => summarize(c, ctx));
  const unlocked = list.filter((c) => !c.locked);
  const videoCount = unlocked.reduce((n, c) => n + c.videoCount, 0);
  const completedCount = unlocked.reduce((n, c) => n + c.completedCount, 0);
  res.json({ categories: list, summary: { videoCount, completedCount, progressPercent: percent(completedCount, videoCount) } });
}

/** One category with its sections (subcategories, or itself) and — when unlocked — their videos. */
export async function getMyCategory(req: Request, res: Response) {
  const user = currentUser(req);
  const [category, ctx] = await Promise.all([
    prisma.courseCategory.findFirst({ ...liveTree, where: { ...liveTree.where, slug: param(req, "slug") } }),
    libraryContext(user.id, user.role === "ADMIN"),
  ]);
  if (!category) throw new HttpError(404, "Category not found");
  const summary = summarize(category, ctx);
  const sections = category.children.length ? category.children : [category];

  const videos = summary.locked
    ? []
    : await prisma.courseVideo.findMany({
        where: { categoryId: { in: sections.map((s) => s.id) }, isPublished: true },
        orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
        include: { progress: { where: { userId: user.id }, take: 1 }, language: { select: { code: true, name: true } } },
      });
  const views = await Promise.all(
    videos.map(async (v) => ({
      categoryId: v.categoryId,
      id: v.id,
      title: v.title,
      description: v.description,
      durationSeconds: v.durationSeconds,
      language: v.language,
      thumbnailUrl: v.thumbnailKey ? await getDownloadUrl(v.thumbnailKey, THUMBNAIL_URL_TTL) : null,
      progress: v.progress[0]
        ? {
            positionSeconds: v.progress[0].positionSeconds,
            maxPositionSeconds: v.progress[0].maxPositionSeconds,
            completed: v.progress[0].completed,
            updatedAt: v.progress[0].updatedAt,
          }
        : null,
    }))
  );

  res.json({
    category: summary,
    sections: sections.map((s) => {
      const count = ctx.counts.get(s.id) ?? 0;
      const completed = summary.locked ? 0 : ctx.done.get(s.id) ?? 0;
      return {
        id: s.id,
        slug: s.slug,
        name: s.name,
        videoCount: count,
        completedCount: completed,
        progressPercent: percent(completed, count),
        videos: views.filter((v) => v.categoryId === s.id).map(({ categoryId: _c, ...v }) => v),
      };
    }),
  });
}
