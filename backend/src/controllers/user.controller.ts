import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { getPartnerBalance } from "../services/commission.service.js";
import { currentUser } from "../middleware/auth.middleware.js";
import { HttpError, param } from "../utils/http.js";

const patchSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  phone: z.string().min(10).max(15).optional(),
  preferredLanguageCode: z.string().max(10).optional().nullable(),
});

export async function getMe(req: Request, res: Response) {
  const { id } = currentUser(req);
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      username: true,
      referralCode: true,
      role: true,
      createdAt: true,
      preferredLanguage: { select: { code: true, name: true, nativeName: true } },
      courseAccess: {
        where: { revokedAt: null },
        select: {
          unlockedAt: true,
          languageGranted: true,
          course: { select: { id: true, title: true, type: true, slug: true } },
        },
      },
    },
  });
  if (!user) throw new HttpError(404, "Not found");
  res.json({ user });
}

export async function updateMe(req: Request, res: Response) {
  const { id } = currentUser(req);
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Invalid request");
  const { preferredLanguageCode, ...rest } = parsed.data;

  let preferredLanguageId: string | null | undefined = undefined;
  if (preferredLanguageCode !== undefined) {
    if (preferredLanguageCode === null) {
      preferredLanguageId = null;
    } else {
      const language = await prisma.language.findUnique({ where: { code: preferredLanguageCode } });
      if (!language) throw new HttpError(400, "Unknown language");
      preferredLanguageId = language.id;
    }
  }

  const user = await prisma.user.update({
    where: { id },
    data: { ...rest, ...(preferredLanguageId !== undefined ? { preferredLanguageId } : {}) },
    select: {
      name: true,
      phone: true,
      preferredLanguage: { select: { code: true, name: true, nativeName: true } },
    },
  });
  res.json({ user });
}

export async function myOrders(req: Request, res: Response) {
  const { id } = currentUser(req);
  const orders = await prisma.order.findMany({
    where: { userId: id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      amountInPaise: true,
      status: true,
      selectedLanguage: true,
      createdAt: true,
      paidAt: true,
      course: { select: { title: true, type: true } },
    },
  });
  res.json({ orders });
}

/** Everything the dashboard overview page used to query server-side in one request. */
export async function dashboardSummary(req: Request, res: Response) {
  const { id } = currentUser(req);
  const [coursesOwned, ordersCount, balance, user, languages] = await Promise.all([
    prisma.courseAccess.count({ where: { userId: id, revokedAt: null } }),
    prisma.order.count({ where: { userId: id } }),
    getPartnerBalance(id),
    prisma.user.findUnique({ where: { id }, include: { preferredLanguage: true } }),
    prisma.language.findMany({
      where: { isActive: true },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      select: { code: true, name: true, nativeName: true },
    }),
  ]);
  if (!user) throw new HttpError(404, "Not found");

  res.json({
    coursesOwned,
    ordersCount,
    balance,
    languages,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      phone: user.phone,
      createdAt: user.createdAt,
      preferredLanguageCode: user.preferredLanguage?.code ?? null,
    },
  });
}

export async function myCourses(req: Request, res: Response) {
  const { id } = currentUser(req);
  const access = await prisma.courseAccess.findMany({
    where: { userId: id, revokedAt: null },
    include: { course: true },
    orderBy: { unlockedAt: "desc" },
  });
  res.json({ access });
}

/** Access check + course metadata for the course player page. 404 when not owned. */
export async function myCourseAccess(req: Request, res: Response) {
  const { id: userId } = currentUser(req);
  const courseId = param(req, "courseId");
  const access = await prisma.courseAccess.findUnique({
    where: { userId_courseId: { userId, courseId } },
    include: { course: true },
  });
  if (!access || access.revokedAt) throw new HttpError(404, "Not found");
  res.json({ access });
}

export async function myActivity(req: Request, res: Response) {
  const { id } = currentUser(req);
  const orders = await prisma.order.findMany({
    where: { userId: id },
    orderBy: { createdAt: "desc" },
    include: { course: true },
  });
  res.json({ orders });
}
