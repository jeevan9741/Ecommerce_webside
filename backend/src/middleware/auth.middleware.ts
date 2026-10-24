import type { NextFunction, Request, Response } from "express";
import { prisma } from "../config/prisma.js";
import { timingSafeEqual } from "node:crypto";
import { decodeSessionToken, passwordFingerprint, type SessionPayload } from "../utils/tokens.js";
import { HttpError } from "../utils/http.js";
import { PAID_ACCESS } from "../services/package-access.service.js";

declare module "express-serve-static-core" {
  interface Request {
    user?: SessionPayload;
  }
}

function readToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return null;
}

/**
 * The session in a token, if it's still good: signed, unexpired, the account still exists, and the
 * password hasn't changed since it was issued (so a password reset signs out every other device).
 * Tokens from before password fingerprints carry none; they stay valid only while the account is
 * unchanged since they were issued, which a reset also ends.
 */
async function authenticate(token: string | null): Promise<SessionPayload | null> {
  const decoded = token ? decodeSessionToken(token) : null;
  if (!decoded) return null;
  const account = await prisma.user.findUnique({ where: { id: decoded.session.id }, select: { passwordHash: true, updatedAt: true } });
  if (!account) return null;
  if (decoded.pv) {
    const expected = Buffer.from(passwordFingerprint(account.passwordHash));
    const given = Buffer.from(decoded.pv);
    return given.length === expected.length && timingSafeEqual(given, expected) ? decoded.session : null;
  }
  return Math.floor(account.updatedAt.getTime() / 1000) <= decoded.iat ? decoded.session : null;
}

/** Attaches req.user when a valid token is present; never rejects. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  authenticate(readToken(req))
    .then((user) => {
      if (user) req.user = user;
      next();
    })
    .catch(next);
}

export function requireUser(req: Request, _res: Response, next: NextFunction) {
  authenticate(readToken(req))
    .then((user) => {
      if (!user) return next(new HttpError(401, "Sign in required"));
      req.user = user;
      next();
    })
    .catch(next);
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  requireUser(req, res, (err?: unknown) => {
    if (err) return next(err);
    if (req.user?.role !== "ADMIN") return next(new HttpError(403, "Admin access required"));
    next();
  });
}

/**
 * Gates the student dashboard behind an actual purchase. Admins pass through so the admin
 * panel is unaffected; every other account needs at least one live (non-revoked) CourseAccess
 * row whose order is PAID. The frontend redirects before it ever gets here — this is the copy that can't be
 * bypassed by editing a cookie or calling the API directly.
 */
export function requireCourseAccess(req: Request, res: Response, next: NextFunction) {
  requireUser(req, res, (err?: unknown) => {
    if (err) return next(err);
    const user = req.user;
    if (!user) return next(new HttpError(401, "Sign in required"));
    if (user.role === "ADMIN") return next();

    prisma.courseAccess
      .count({ where: { userId: user.id, ...PAID_ACCESS } })
      .then((owned) => {
        if (owned === 0) {
          return next(
            new HttpError(403, "Purchase a package to unlock your student dashboard.", { code: "NO_COURSE_ACCESS" })
          );
        }
        next();
      })
      .catch(next);
  });
}

/** Non-null accessor for handlers mounted behind requireUser/requireAdmin. */
export function currentUser(req: Request): SessionPayload {
  if (!req.user) throw new HttpError(401, "Sign in required");
  return req.user;
}
