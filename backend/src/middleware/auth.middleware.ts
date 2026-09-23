import type { NextFunction, Request, Response } from "express";
import { prisma } from "../config/prisma.js";
import { verifySessionToken, type SessionPayload } from "../utils/tokens.js";
import { HttpError } from "../utils/http.js";

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

/** Attaches req.user when a valid token is present; never rejects. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = readToken(req);
  if (token) {
    const user = verifySessionToken(token);
    if (user) req.user = user;
  }
  next();
}

export function requireUser(req: Request, _res: Response, next: NextFunction) {
  const token = readToken(req);
  const user = token ? verifySessionToken(token) : null;
  if (!user) return next(new HttpError(401, "Sign in required"));
  req.user = user;
  next();
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
 * row. The frontend redirects before it ever gets here — this is the copy that can't be
 * bypassed by editing a cookie or calling the API directly.
 */
export function requireCourseAccess(req: Request, res: Response, next: NextFunction) {
  requireUser(req, res, (err?: unknown) => {
    if (err) return next(err);
    const user = req.user;
    if (!user) return next(new HttpError(401, "Sign in required"));
    if (user.role === "ADMIN") return next();

    prisma.courseAccess
      .count({ where: { userId: user.id, revokedAt: null } })
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
