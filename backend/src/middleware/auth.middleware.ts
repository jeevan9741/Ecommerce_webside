import type { NextFunction, Request, Response } from "express";
import { prisma } from "../config/prisma.js";
import { timingSafeEqual } from "node:crypto";
import { decodeSessionToken, mfaFingerprint, passwordFingerprint, type SessionPayload } from "../utils/tokens.js";
import { adminMfaEnforced } from "../utils/feature-flags.js";
import { HttpError } from "../utils/http.js";
import { PAID_ACCESS } from "../services/package-access.service.js";

declare module "express-serve-static-core" {
  interface Request {
    user?: SessionPayload;
    /** The account's role as stored in the database right now (the token's copy can be stale). */
    dbRole?: "USER" | "ADMIN";
    /** The session's MFA fingerprint, when it was issued after a second factor. */
    sessionMv?: string | null;
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
type Authenticated = { session: SessionPayload; role: "USER" | "ADMIN"; mv: string | null };

async function authenticate(token: string | null): Promise<Authenticated | null> {
  const decoded = token ? decodeSessionToken(token) : null;
  if (!decoded) return null;
  const account = await prisma.user.findUnique({ where: { id: decoded.session.id }, select: { passwordHash: true, updatedAt: true, role: true } });
  if (!account) return null;
  const ok = (): Authenticated => ({ session: decoded.session, role: account.role, mv: decoded.mv });
  if (decoded.pv) {
    const expected = Buffer.from(passwordFingerprint(account.passwordHash));
    const given = Buffer.from(decoded.pv);
    return given.length === expected.length && timingSafeEqual(given, expected) ? ok() : null;
  }
  return Math.floor(account.updatedAt.getTime() / 1000) <= decoded.iat ? ok() : null;
}

/**
 * Every signed-in request carries the role from the database, never the token's copy. An ADMIN whose session
 * hasn't passed two-step verification (while it is enforced) is treated as an ordinary user everywhere —
 * content checks included — and only requireAdmin explains why admin access is refused.
 */
async function attach(req: Request, a: Authenticated) {
  let effective: "USER" | "ADMIN" = a.role;
  if (a.role === "ADMIN" && adminMfaEnforced() && !(await sessionHasMfa(a.session.id, a.mv)).verified) effective = "USER";
  req.user = { ...a.session, role: effective };
  req.dbRole = a.role;
  req.sessionMv = a.mv;
}

const sameString = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Whether this session passed the admin's second factor: its MFA fingerprint must match the admin's
 * current, enabled factor (a reset or re-enrolment ends older sessions).
 */
export async function sessionHasMfa(userId: string, mv: string | null | undefined): Promise<{ enrolled: boolean; verified: boolean }> {
  const factor = await prisma.adminMfaFactor.findFirst({ where: { userId, disabledAt: null, enabledAt: { not: null } }, select: { id: true, enabledAt: true } });
  if (!factor?.enabledAt) return { enrolled: false, verified: false };
  return { enrolled: true, verified: Boolean(mv) && sameString(mfaFingerprint({ id: factor.id, enabledAt: factor.enabledAt }), mv!) };
}

/** Attaches req.user when a valid token is present; never rejects. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  authenticate(readToken(req))
    .then(async (a) => {
      if (a) await attach(req, a);
      next();
    })
    .catch(next);
}

export function requireUser(req: Request, _res: Response, next: NextFunction) {
  authenticate(readToken(req))
    .then(async (a) => {
      if (!a) return next(new HttpError(401, "Sign in required"));
      await attach(req, a);
      next();
    })
    .catch(next);
}

/**
 * Admin access: the role is read from the database (a demoted admin's token is refused at once), and —
 * unless ADMIN_MFA_ENFORCEMENT=off — the session must have passed the admin's second factor.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  requireUser(req, res, (err?: unknown) => {
    if (err) return next(err);
    if (req.dbRole !== "ADMIN") return next(new HttpError(403, "Admin access required", { code: "NOT_ADMIN" }));
    if (!adminMfaEnforced()) return next();
    sessionHasMfa(req.user!.id, req.sessionMv)
      .then(({ enrolled, verified }) => {
        if (!enrolled) return next(new HttpError(403, "Set up two-step verification to use the admin dashboard.", { code: "MFA_ENROLLMENT_REQUIRED" }));
        if (!verified) return next(new HttpError(403, "Sign in again with your authenticator code.", { code: "MFA_REQUIRED" }));
        next();
      })
      .catch(next);
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
    if (req.dbRole === "ADMIN") return next();

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
