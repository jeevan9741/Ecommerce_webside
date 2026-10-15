import type { Request, Response } from "express";
import { z } from "zod";
import type { LiveSession, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { currentUser } from "../middleware/auth.middleware.js";
import { HttpError, param } from "../utils/http.js";
import { rateLimit } from "../utils/rate-limit.js";
import { hasPaidPackage, packagesById, paidPackageIds } from "../services/package-access.service.js";
import {
  DEFAULT_TIMEZONE,
  canJoinNow,
  isValidTimeZone,
  joinOpensAt,
  sessionState,
  utcToZonedInput,
  zonedTimeToUtc,
  zoomJoinUrlProblem,
} from "../services/live-session-time.js";

export const TRAINING_DAYS = 7;
const MAX_SESSION_HOURS = 12;

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

const include = { course: { select: { id: true, title: true } } } as const;
type SessionRow = Prisma.LiveSessionGetPayload<{ include: typeof include }>;

/** Schedule entry for students: times, state and whether Join is open — never the join URL. */
function studentView(s: SessionRow, now: Date) {
  return {
    id: s.id,
    course: s.course,
    dayNumber: s.dayNumber,
    title: s.title,
    description: s.description,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    timezone: s.timezone,
    joinOpensAt: joinOpensAt(s),
    state: sessionState(s, now),
    canJoin: canJoinNow(s, now),
    cancelReason: s.status === "CANCELLED" ? s.cancelReason : null,
    updatedAt: s.updatedAt,
  };
}

function adminView(s: SessionRow, now = new Date()) {
  const start = utcToZonedInput(s.startsAt, s.timezone);
  return {
    ...studentView(s, now),
    courseId: s.courseId,
    joinUrl: s.joinUrl,
    joinOpensMinutesBefore: s.joinOpensMinutesBefore,
    isPublished: s.isPublished,
    status: s.status,
    cancelledAt: s.cancelledAt,
    // Wall-clock values in the session's timezone, for the edit form.
    date: start.date,
    startTime: start.time,
    endTime: utcToZonedInput(s.endsAt, s.timezone).time,
    createdAt: s.createdAt,
  };
}

// ---------- Admin ----------

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
const time = z.string().regex(/^\d{2}:\d{2}$/, "Choose a time");

const sessionFields = {
  courseId: z.string().min(1, "Choose a package"),
  dayNumber: z.number().int().min(1).max(TRAINING_DAYS, `Day must be between 1 and ${TRAINING_DAYS}`),
  title: z.string().trim().min(2, "Enter a title").max(150),
  description: nullableText(2000),
  date,
  startTime: time,
  endTime: time,
  timezone: z.string().trim().min(1).max(64).default(DEFAULT_TIMEZONE),
  joinUrl: z.string().trim().min(1, "Enter the Zoom join link").max(2000),
  joinOpensMinutesBefore: z.number().int().min(0).max(240).default(15),
  isPublished: z.boolean().default(false),
};

const createSchema = z.object(sessionFields);
const updateSchema = z.object({
  courseId: sessionFields.courseId.optional(),
  dayNumber: sessionFields.dayNumber.optional(),
  title: sessionFields.title.optional(),
  description: sessionFields.description,
  date: date.optional(),
  startTime: time.optional(),
  endTime: time.optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  joinUrl: sessionFields.joinUrl.optional(),
  joinOpensMinutesBefore: z.number().int().min(0).max(240).optional(),
  isPublished: z.boolean().optional(),
});

/** Wall-clock date + times in `timezone` → UTC start/end, validated. */
function resolveTimes(input: { date: string; startTime: string; endTime: string; timezone: string }) {
  if (!isValidTimeZone(input.timezone)) throw new HttpError(400, "Unknown timezone");
  let startsAt: Date;
  let endsAt: Date;
  try {
    startsAt = zonedTimeToUtc(input.date, input.startTime, input.timezone);
    endsAt = zonedTimeToUtc(input.date, input.endTime, input.timezone);
  } catch {
    throw new HttpError(400, "Enter a valid date and time");
  }
  if (endsAt <= startsAt) throw new HttpError(400, "The end time must be after the start time");
  if (endsAt.getTime() - startsAt.getTime() > MAX_SESSION_HOURS * 3600_000) {
    throw new HttpError(400, `A session can be at most ${MAX_SESSION_HOURS} hours long`);
  }
  return { startsAt, endsAt };
}

function assertJoinUrl(url: string) {
  const problem = zoomJoinUrlProblem(url);
  if (problem) throw new HttpError(400, problem);
}

async function assertCourse(courseId: string) {
  if (!(await prisma.course.count({ where: { id: courseId } }))) throw new HttpError(400, "That package doesn't exist");
}

async function findSession(id: string) {
  const session = await prisma.liveSession.findUnique({ where: { id }, include });
  if (!session) throw new HttpError(404, "Session not found");
  return session;
}

export async function adminListLiveSessions(req: Request, res: Response) {
  const courseId = typeof req.query.courseId === "string" ? req.query.courseId : "";
  const sessions = await prisma.liveSession.findMany({
    where: courseId ? { courseId } : {},
    include,
    orderBy: [{ startsAt: "asc" }, { dayNumber: "asc" }],
    take: 500,
  });
  const now = new Date();
  res.json({ sessions: sessions.map((s) => adminView(s, now)), trainingDays: TRAINING_DAYS, defaultTimezone: DEFAULT_TIMEZONE });
}

export async function adminCreateLiveSession(req: Request, res: Response) {
  const admin = currentUser(req);
  const body = parse(createSchema, req.body);
  await assertCourse(body.courseId);
  assertJoinUrl(body.joinUrl);
  const { startsAt, endsAt } = resolveTimes(body);

  const session = await prisma.liveSession.create({
    data: {
      courseId: body.courseId,
      dayNumber: body.dayNumber,
      title: body.title,
      description: body.description ?? null,
      startsAt,
      endsAt,
      timezone: body.timezone,
      joinUrl: body.joinUrl,
      joinOpensMinutesBefore: body.joinOpensMinutesBefore,
      isPublished: body.isPublished,
    },
    include,
  });
  await prisma.auditLog.create({ data: { actorId: admin.id, action: "LIVE_SESSION_CREATED", target: session.id, metadata: { courseId: session.courseId, dayNumber: session.dayNumber } } });
  res.status(201).json({ session: adminView(session) });
}

/** Edit or reschedule. Time fields left out keep their current wall-clock value in the session's timezone. */
export async function adminUpdateLiveSession(req: Request, res: Response) {
  const admin = currentUser(req);
  const body = parse(updateSchema, req.body);
  const existing = await findSession(param(req, "id"));
  if (body.courseId !== undefined) await assertCourse(body.courseId);
  if (body.joinUrl !== undefined) assertJoinUrl(body.joinUrl);

  const retiming = [body.date, body.startTime, body.endTime, body.timezone].some((v) => v !== undefined);
  let times: Pick<LiveSession, "startsAt" | "endsAt" | "timezone"> | null = null;
  if (retiming) {
    const current = adminView(existing);
    const timezone = body.timezone ?? existing.timezone;
    times = {
      ...resolveTimes({
        date: body.date ?? current.date,
        startTime: body.startTime ?? current.startTime,
        endTime: body.endTime ?? current.endTime,
        timezone,
      }),
      timezone,
    };
  }
  const rescheduled = times !== null && (times.startsAt.getTime() !== existing.startsAt.getTime() || times.endsAt.getTime() !== existing.endsAt.getTime());

  const { date: _d, startTime: _s, endTime: _e, timezone: _t, ...fields } = body;
  const session = await prisma.liveSession.update({
    where: { id: existing.id },
    data: { ...fields, ...(times ?? {}) },
    include,
  });
  await prisma.auditLog.create({
    data: {
      actorId: admin.id,
      action: rescheduled ? "LIVE_SESSION_RESCHEDULED" : "LIVE_SESSION_UPDATED",
      target: session.id,
      metadata: { fields: Object.keys(body), ...(rescheduled ? { from: existing.startsAt, to: session.startsAt } : {}) },
    },
  });
  res.json({ session: adminView(session) });
}

export async function adminCancelLiveSession(req: Request, res: Response) {
  const admin = currentUser(req);
  const { reason } = parse(z.object({ reason: nullableText(300) }), req.body ?? {});
  const existing = await findSession(param(req, "id"));
  if (existing.status === "CANCELLED") throw new HttpError(409, "This session is already cancelled");
  const session = await prisma.liveSession.update({
    where: { id: existing.id },
    data: { status: "CANCELLED", cancelReason: reason ?? null, cancelledAt: new Date() },
    include,
  });
  await prisma.auditLog.create({ data: { actorId: admin.id, action: "LIVE_SESSION_CANCELLED", target: session.id, metadata: { reason: reason ?? null } } });
  res.json({ session: adminView(session) });
}

export async function adminRestoreLiveSession(req: Request, res: Response) {
  const admin = currentUser(req);
  const existing = await findSession(param(req, "id"));
  if (existing.status !== "CANCELLED") throw new HttpError(409, "This session isn't cancelled");
  const session = await prisma.liveSession.update({
    where: { id: existing.id },
    data: { status: "SCHEDULED", cancelReason: null, cancelledAt: null },
    include,
  });
  await prisma.auditLog.create({ data: { actorId: admin.id, action: "LIVE_SESSION_RESTORED", target: session.id } });
  res.json({ session: adminView(session) });
}

export async function adminDeleteLiveSession(req: Request, res: Response) {
  const admin = currentUser(req);
  const session = await prisma.liveSession.delete({ where: { id: param(req, "id") } }).catch((err: { code?: string }) => {
    if (err.code === "P2025") throw new HttpError(404, "Session not found");
    throw err;
  });
  await prisma.auditLog.create({ data: { actorId: admin.id, action: "LIVE_SESSION_DELETED", target: session.id, metadata: { title: session.title } } });
  res.json({ ok: true });
}

// ---------- Students ----------

/** Active packages that come with live classes. */
async function livePackageIds() {
  const rows = await prisma.course.findMany({
    where: { isActive: true, OR: [{ type: "ZOOM" }, { liveSessions: { some: { isPublished: true } } }] },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * The published schedule of the live packages the student has paid for. `packages` lists their live
 * packages (so an empty schedule can say "not published yet"); `unlock` lists what they could buy.
 * `serverTime` lets the browser correct its clock for the countdown.
 */
export async function listMyLiveSessions(req: Request, res: Response) {
  const user = currentUser(req);
  const courseId = typeof req.query.courseId === "string" && req.query.courseId ? req.query.courseId : null;
  const isAdmin = user.role === "ADMIN";

  const [paid, live] = await Promise.all([isAdmin ? null : paidPackageIds(user.id), livePackageIds()]);
  const owns = (id: string) => isAdmin || paid!.has(id);
  if (courseId && !owns(courseId)) {
    const [pkg] = await packagesById([courseId]);
    throw new HttpError(403, "Buy this package to see its live sessions", { code: "NOT_PURCHASED", packages: pkg ? [pkg] : [] });
  }

  const visibleCourses = courseId ? [courseId] : isAdmin ? undefined : [...paid!];
  const [sessions, packages, unlock] = await Promise.all([
    prisma.liveSession.findMany({
      where: { isPublished: true, ...(visibleCourses ? { courseId: { in: visibleCourses } } : {}) },
      include,
      orderBy: [{ startsAt: "asc" }, { dayNumber: "asc" }],
    }),
    packagesById(courseId ? [courseId] : live.filter(owns)),
    courseId ? [] : packagesById(live.filter((id) => !owns(id))),
  ]);
  const now = new Date();
  res.setHeader("Cache-Control", "no-store");
  res.json({ sessions: sessions.map((s) => studentView(s, now)), packages, unlock, serverTime: now });
}

/** Hands out the Zoom link — only to a paid buyer, only for a live session, only inside the joining window. */
export async function joinLiveSession(req: Request, res: Response) {
  const user = currentUser(req);
  if (!rateLimit(`live-join:${user.id}`, 30, 10 * 60 * 1000)) throw new HttpError(429, "Too many attempts. Please wait a few minutes.");
  const session = await prisma.liveSession.findUnique({ where: { id: param(req, "id") }, include });
  if (!session || (!session.isPublished && user.role !== "ADMIN")) throw new HttpError(404, "Session not found");
  if (!(await hasPaidPackage(user, session.courseId))) {
    throw new HttpError(403, "Buy this package to join its live sessions", { code: "NOT_PURCHASED" });
  }

  const now = new Date();
  const state = sessionState(session, now);
  if (state === "CANCELLED") throw new HttpError(409, "This session was cancelled", { code: "SESSION_CANCELLED" });
  if (state === "COMPLETED") throw new HttpError(409, "This session has ended", { code: "SESSION_ENDED" });
  if (!canJoinNow(session, now)) {
    throw new HttpError(409, "Joining hasn't opened yet", { code: "JOIN_NOT_OPEN", joinOpensAt: joinOpensAt(session) });
  }

  // Doubles as an attendance record for issuing certificates.
  await prisma.auditLog.create({ data: { actorId: user.id, action: "LIVE_SESSION_JOINED", target: session.id } });
  res.setHeader("Cache-Control", "no-store");
  res.json({ joinUrl: session.joinUrl });
}
