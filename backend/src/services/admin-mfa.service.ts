import bcrypt from "bcryptjs";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { HttpError } from "../utils/http.js";
import { rateLimit } from "../utils/rate-limit.js";
import { decryptJson, encryptJson } from "../utils/crypto.js";
import { canonicalSha256 } from "../utils/canonical-json.js";
import { adminMfaEnforced } from "../utils/feature-flags.js";
import { generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, otpauthUri, verifyTotp } from "../utils/totp.js";
import { mfaFingerprint, passwordFingerprint, signSessionToken, verifyMfaChallenge, type SessionPayload } from "../utils/tokens.js";
import { requireAdminInTx, requireAdminRead } from "./franchise-admin-guard.js";
import { sessionHasMfa } from "../middleware/auth.middleware.js";

/**
 * Admin two-step verification with an authenticator app (TOTP, RFC 6238) and one-time recovery codes.
 *
 * - Enrolment: a signed-in ADMIN re-enters their password, scans/enters the secret, and confirms with a
 *   code; ten recovery codes are shown once (only hashes are stored). Re-enrolment is possible only
 *   after a two-admin reset.
 * - Sign-in: password → 5-minute challenge → authenticator code (or a recovery code) → a 12-hour session
 *   bound to the factor. Codes can't be replayed (last accepted time step is stored); five wrong codes
 *   lock the factor for 15 minutes; attempts are rate-limited per address and account.
 * - Lost device and codes: two other admins reset the factor (request + independent approval); the admin
 *   then enrols again. Every step is audited (ADMIN_MFA_*; append-only in the database).
 */

const ISSUER = "ETA Admin";
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;
const RESET_TTL_MS = 24 * 60 * 60 * 1000;
/** An unfinished enrolment must be confirmed within this time; afterwards its key can never be turned on. */
export const PENDING_ENROLMENT_TTL_MS = 15 * 60 * 1000;

const parse = <T extends z.ZodType>(schema: T, input: unknown): z.infer<T> => {
  const r = schema.safeParse(input ?? {});
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? "Invalid request", { code: "INVALID_REQUEST" });
  return r.data;
};

type Account = { id: string; name: string; email: string; role: "USER" | "ADMIN"; referralCode: string; passwordHash: string };
const toSession = (u: Account): SessionPayload => ({ id: u.id, name: u.name, email: u.email, role: u.role, referralCode: u.referralCode });

async function adminAccount(userId: string): Promise<Account> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, role: true, referralCode: true, passwordHash: true } });
  if (!u || u.role !== "ADMIN") throw new HttpError(403, "Admin access required");
  return u;
}

const liveFactor = (db: Prisma.TransactionClient | typeof prisma, userId: string) => db.adminMfaFactor.findFirst({ where: { userId, disabledAt: null } });
const secretOf = (f: { secretEncrypted: string }) => decryptJson<{ s: string }>(f.secretEncrypted).s;

async function audit(db: Prisma.TransactionClient | typeof prisma, actorId: string | null, action: string, target: string, metadata: Record<string, unknown> = {}) {
  await db.auditLog.create({ data: { actorId, action, target, metadata: metadata as Prisma.InputJsonValue } });
}

// ---------- Status ----------

export async function mfaStatus(userId: string, sessionMv: string | null | undefined) {
  await adminAccount(userId);
  const f = await liveFactor(prisma, userId);
  const { enrolled, verified } = await sessionHasMfa(userId, sessionMv);
  const remaining = f?.enabledAt ? await prisma.adminMfaRecoveryCode.count({ where: { factorId: f.id, usedAt: null, revokedAt: null } }) : 0;
  return { enforced: adminMfaEnforced(), enrolled, pending: Boolean(f && !f.enabledAt), sessionVerified: verified, enabledAt: f?.enabledAt ?? null, recoveryCodesRemaining: remaining };
}

// ---------- Enrolment ----------

export async function startEnrollment(userId: string, input: unknown) {
  const { password } = parse(z.object({ password: z.string().min(1).max(200) }).strict(), input);
  if (!rateLimit(`mfa-enrol:${userId}`, 10, 15 * 60 * 1000)) throw new HttpError(429, "Too many attempts. Try again later.", { code: "RATE_LIMITED" });
  const account = await adminAccount(userId);
  if (!(await bcrypt.compare(password, account.passwordHash))) throw new HttpError(401, "That password isn't right.", { code: "BAD_PASSWORD" });
  const secret = generateTotpSecret();
  const factor = await prisma.$transaction(async (tx) => {
    await requireAdminInTx(tx, userId);
    const existing = await liveFactor(tx, userId);
    if (existing?.enabledAt) throw new HttpError(409, "Two-step verification is already set up. Ask two other admins to reset it if you lost your device.", { code: "MFA_ALREADY_ENROLLED" });
    if (existing) await tx.adminMfaFactor.update({ where: { id: existing.id }, data: { disabledAt: new Date(), disabledReason: "Replaced by a new enrolment before it was confirmed" } });
    const f = await tx.adminMfaFactor.create({ data: { userId, secretEncrypted: encryptJson({ s: secret }) } });
    await audit(tx, userId, "ADMIN_MFA_ENROLLMENT_STARTED", userId, { factorId: f.id });
    return f;
  });
  return { factorId: factor.id, secret, otpauthUri: otpauthUri(ISSUER, account.email, secret), issuer: ISSUER, account: account.email };
}

export async function confirmEnrollment(userId: string, input: unknown) {
  const { code } = parse(z.object({ code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app") }).strict(), input);
  const account = await adminAccount(userId);
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    await requireAdminInTx(tx, userId);
    const pending = await liveFactor(tx, userId);
    if (!pending || pending.enabledAt) throw new HttpError(409, "Start setting up two-step verification first.", { code: "NO_PENDING_ENROLLMENT" });
    // A setup key is shown once and must be confirmed soon after: an older unfinished enrolment (for
    // example one whose key was seen by someone else) can never be turned on; starting again retires it.
    if (now.getTime() - pending.createdAt.getTime() > PENDING_ENROLMENT_TTL_MS) {
      throw new HttpError(409, "This setup has expired. Start again to get a new key.", { code: "ENROLLMENT_EXPIRED" });
    }
    await tx.$queryRaw`SELECT "id" FROM "AdminMfaFactor" WHERE "id" = ${pending.id} FOR UPDATE`;
    if (pending.lockedUntil && pending.lockedUntil > now) throw new HttpError(429, "Too many wrong codes. Try again in 15 minutes.", { code: "MFA_LOCKED" });
    const step = verifyTotp(secretOf(pending), code, now, null);
    if (step === null) {
      const failed = pending.failedAttempts + 1;
      await tx.adminMfaFactor.update({ where: { id: pending.id }, data: { failedAttempts: failed, ...(failed >= MAX_FAILURES ? { lockedUntil: new Date(now.getTime() + LOCK_MS) } : {}) } });
      return { ok: false as const };
    }
    const enabled = await tx.adminMfaFactor.update({ where: { id: pending.id }, data: { enabledAt: now, lastUsedStep: step, failedAttempts: 0, lockedUntil: null } });
    const codes = generateRecoveryCodes();
    await tx.adminMfaRecoveryCode.createMany({ data: codes.map((c) => ({ factorId: enabled.id, codeHash: hashRecoveryCode(c) })) });
    await audit(tx, userId, "ADMIN_MFA_ENROLLED", userId, { factorId: enabled.id, recoveryCodes: codes.length });
    return { ok: true as const, factor: enabled, codes };
  });
  if (!result.ok) throw new HttpError(400, "That code isn't right. Check your device's time and try again.", { code: "MFA_INVALID_CODE" });
  const mv = mfaFingerprint({ id: result.factor.id, enabledAt: result.factor.enabledAt! });
  return { recoveryCodes: result.codes, token: signSessionToken(toSession(account), account.passwordHash, { mv }), user: toSession(account) };
}

// ---------- Sign-in second step ----------

const verifySchema = z
  .object({
    challengeToken: z.string().min(10).max(2000),
    code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code").optional(),
    recoveryCode: z.string().trim().min(12).max(20).optional(),
  })
  .strict()
  .refine((v) => Boolean(v.code) !== Boolean(v.recoveryCode), "Enter either an authenticator code or a recovery code");

export async function verifyLogin(input: unknown, ip: string) {
  const v = parse(verifySchema, input);
  if (!rateLimit(`mfa-verify-ip:${ip}`, 30, 10 * 60 * 1000)) throw new HttpError(429, "Too many attempts. Try again later.", { code: "RATE_LIMITED" });
  const expired = new HttpError(401, "Your sign-in has expired. Enter your password again.", { code: "MFA_CHALLENGE_INVALID" });
  const challenge = verifyMfaChallenge(v.challengeToken);
  if (!challenge) throw expired;
  const account = await prisma.user.findUnique({ where: { id: challenge.userId }, select: { id: true, name: true, email: true, role: true, referralCode: true, passwordHash: true } });
  if (!account || account.role !== "ADMIN") throw expired;
  const pv = Buffer.from(passwordFingerprint(account.passwordHash));
  if (pv.length !== challenge.pv.length || !timingSafeEqual(pv, Buffer.from(challenge.pv))) throw expired;
  if (!rateLimit(`mfa-verify-user:${account.id}`, 20, 10 * 60 * 1000)) throw new HttpError(429, "Too many attempts. Try again later.", { code: "RATE_LIMITED" });

  const now = new Date();
  const outcome = await prisma.$transaction(async (tx) => {
    const f = await tx.adminMfaFactor.findFirst({ where: { userId: account.id, disabledAt: null, enabledAt: { not: null } } });
    if (!f) return { kind: "noFactor" as const };
    await tx.$queryRaw`SELECT "id" FROM "AdminMfaFactor" WHERE "id" = ${f.id} FOR UPDATE`;
    const factor = await tx.adminMfaFactor.findUniqueOrThrow({ where: { id: f.id } });
    if (factor.lockedUntil && factor.lockedUntil > now) return { kind: "locked" as const };
    let method: "TOTP" | "RECOVERY_CODE" | null = null;
    let step: number | null = null;
    if (v.code) {
      step = verifyTotp(secretOf(factor), v.code, now, factor.lastUsedStep);
      if (step !== null) method = "TOTP";
    } else if (v.recoveryCode) {
      const rc = await tx.adminMfaRecoveryCode.findFirst({ where: { factorId: factor.id, codeHash: hashRecoveryCode(v.recoveryCode), usedAt: null, revokedAt: null } });
      if (rc) {
        await tx.adminMfaRecoveryCode.update({ where: { id: rc.id }, data: { usedAt: now } });
        method = "RECOVERY_CODE";
      }
    }
    if (!method) {
      const failed = factor.failedAttempts + 1;
      const lock = failed >= MAX_FAILURES;
      await tx.adminMfaFactor.update({ where: { id: factor.id }, data: { failedAttempts: lock ? 0 : failed, ...(lock ? { lockedUntil: new Date(now.getTime() + LOCK_MS) } : {}) } });
      await audit(tx, account.id, lock ? "ADMIN_MFA_LOCKED" : "ADMIN_MFA_LOGIN_FAILED", account.id, { factorId: factor.id, ip, attempt: failed });
      return { kind: "wrong" as const };
    }
    const updated = await tx.adminMfaFactor.update({ where: { id: factor.id }, data: { failedAttempts: 0, lockedUntil: null, ...(step !== null ? { lastUsedStep: step } : {}) } });
    const remaining = await tx.adminMfaRecoveryCode.count({ where: { factorId: factor.id, usedAt: null, revokedAt: null } });
    await audit(tx, account.id, method === "TOTP" ? "ADMIN_MFA_LOGIN_SUCCEEDED" : "ADMIN_MFA_RECOVERY_CODE_USED", account.id, { factorId: factor.id, ip, recoveryCodesRemaining: remaining });
    return { kind: "ok" as const, factor: updated, remaining, method };
  });

  if (outcome.kind === "noFactor") throw expired;
  if (outcome.kind === "locked") throw new HttpError(429, "Too many wrong codes. Try again in 15 minutes.", { code: "MFA_LOCKED" });
  if (outcome.kind === "wrong") throw new HttpError(401, "That code isn't right.", { code: "MFA_INVALID_CODE" });
  const mv = mfaFingerprint({ id: outcome.factor.id, enabledAt: outcome.factor.enabledAt! });
  return { token: signSessionToken(toSession(account), account.passwordHash, { mv }), user: toSession(account), method: outcome.method, recoveryCodesRemaining: outcome.remaining };
}

// ---------- Recovery codes ----------

/** New recovery codes (old unused ones revoked). Needs an MFA-verified session and a fresh authenticator code. */
export async function regenerateRecoveryCodes(userId: string, input: unknown) {
  const { code } = parse(z.object({ code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code") }).strict(), input);
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    await requireAdminInTx(tx, userId);
    const f = await tx.adminMfaFactor.findFirst({ where: { userId, disabledAt: null, enabledAt: { not: null } } });
    if (!f) throw new HttpError(409, "Two-step verification isn't set up.", { code: "MFA_NOT_ENROLLED" });
    await tx.$queryRaw`SELECT "id" FROM "AdminMfaFactor" WHERE "id" = ${f.id} FOR UPDATE`;
    const factor = await tx.adminMfaFactor.findUniqueOrThrow({ where: { id: f.id } });
    if (factor.lockedUntil && factor.lockedUntil > now) throw new HttpError(429, "Too many wrong codes. Try again in 15 minutes.", { code: "MFA_LOCKED" });
    const step = verifyTotp(secretOf(factor), code, now, factor.lastUsedStep);
    if (step === null) {
      const failed = factor.failedAttempts + 1;
      await tx.adminMfaFactor.update({ where: { id: factor.id }, data: { failedAttempts: failed >= MAX_FAILURES ? 0 : failed, ...(failed >= MAX_FAILURES ? { lockedUntil: new Date(now.getTime() + LOCK_MS) } : {}) } });
      return null;
    }
    await tx.adminMfaFactor.update({ where: { id: factor.id }, data: { lastUsedStep: step, failedAttempts: 0 } });
    await tx.adminMfaRecoveryCode.updateMany({ where: { factorId: factor.id, usedAt: null, revokedAt: null }, data: { revokedAt: now } });
    const codes = generateRecoveryCodes();
    await tx.adminMfaRecoveryCode.createMany({ data: codes.map((c) => ({ factorId: factor.id, codeHash: hashRecoveryCode(c) })) });
    await audit(tx, userId, "ADMIN_MFA_RECOVERY_CODES_REGENERATED", userId, { factorId: factor.id });
    return codes;
  });
  if (!result) throw new HttpError(400, "That code isn't right.", { code: "MFA_INVALID_CODE" });
  return { recoveryCodes: result };
}

// ---------- Two-admin reset (lost device and recovery codes) ----------

export async function listAdminsForMfa(actorId: string) {
  await requireAdminRead(actorId);
  const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, orderBy: { name: "asc" }, select: { id: true, name: true, email: true, mfaFactors: { where: { disabledAt: null, enabledAt: { not: null } }, select: { enabledAt: true } } } });
  return admins.map((a) => ({ id: a.id, name: a.name, email: a.email, mfaEnabledAt: a.mfaFactors[0]?.enabledAt ?? null }));
}

export async function requestMfaReset(actorId: string, targetUserId: string, input: unknown) {
  const { reason } = parse(z.object({ reason: z.string().trim().min(10, "Give a reason of at least 10 characters").max(500) }).strict(), input);
  if (targetUserId === actorId) throw new HttpError(403, "Two other admins must reset your two-step verification.", { code: "SELF_RESET" });
  const now = new Date();
  try {
    return await prisma.$transaction(async (tx) => {
      await requireAdminInTx(tx, actorId);
      const target = await tx.user.findUnique({ where: { id: targetUserId }, select: { id: true, role: true } });
      if (!target || target.role !== "ADMIN") throw new HttpError(404, "Not found");
      const f = await tx.adminMfaFactor.findFirst({ where: { userId: target.id, disabledAt: null, enabledAt: { not: null } } });
      if (!f) throw new HttpError(409, "This admin has no two-step verification to reset.", { code: "MFA_NOT_ENROLLED" });
      const openKey = `mfa-reset:${target.id}`;
      await tx.adminApprovalRequest.updateMany({ where: { openKey, status: "PENDING", expiresAt: { lte: now } }, data: { status: "EXPIRED", openKey: null } });
      const payload = { action: "ADMIN_MFA_RESET", targetUserId: target.id, factorId: f.id };
      const request = await tx.adminApprovalRequest.create({
        data: { action: "ADMIN_MFA_RESET", targetType: "User", targetId: target.id, payload, payloadSha256: canonicalSha256(payload), reason, openKey, requestedById: actorId, expiresAt: new Date(now.getTime() + RESET_TTL_MS) },
      });
      await audit(tx, actorId, "ADMIN_MFA_RESET_REQUESTED", target.id, { requestId: request.id, factorId: f.id, reason });
      return { id: request.id, status: request.status, payloadSha256: request.payloadSha256, expiresAt: request.expiresAt };
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") throw new HttpError(409, "This admin already has an open reset request.", { code: "REQUEST_EXISTS" });
    throw err;
  }
}

export async function listMfaResets(actorId: string) {
  await requireAdminRead(actorId);
  const rows = await prisma.adminApprovalRequest.findMany({
    where: { action: "ADMIN_MFA_RESET" },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, targetId: true, status: true, reason: true, payloadSha256: true, createdAt: true, expiresAt: true, decidedAt: true, requestedBy: { select: { id: true, name: true } }, decidedBy: { select: { id: true, name: true } } },
  });
  const targets = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.targetId) } }, select: { id: true, name: true, email: true } });
  const by = new Map(targets.map((t) => [t.id, t]));
  return rows.map((r) => ({ ...r, target: by.get(r.targetId) ?? null }));
}

async function lockResetRequest(tx: Prisma.TransactionClient, requestId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "AdminApprovalRequest" WHERE "id" = ${requestId} FOR UPDATE`;
  const req = rows.length ? await tx.adminApprovalRequest.findUnique({ where: { id: requestId } }) : null;
  if (!req || req.action !== "ADMIN_MFA_RESET") throw new HttpError(404, "Not found");
  if (req.status !== "PENDING") throw new HttpError(409, `This request is ${req.status}.`, { code: "NOT_PENDING" });
  return req;
}

/** A second admin — neither the requester nor the admin being reset — approves; the factor is retired. */
export async function approveMfaReset(actorId: string, requestId: string, input: unknown) {
  const { expectedPayloadSha } = parse(z.object({ expectedPayloadSha: z.string().regex(/^[0-9a-f]{64}$/) }).strict(), input);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    await requireAdminInTx(tx, actorId);
    const req = await lockResetRequest(tx, requestId);
    if (req.requestedById === actorId) throw new HttpError(403, "A different admin must approve this request.", { code: "SAME_ADMIN" });
    if (req.targetId === actorId) throw new HttpError(403, "You can't approve a reset of your own two-step verification.", { code: "SELF_RESET" });
    if (req.payloadSha256 !== expectedPayloadSha) throw new HttpError(409, "The request isn't the one you reviewed.", { code: "PAYLOAD_MISMATCH" });
    if (req.expiresAt <= now) throw new HttpError(409, "This request has expired.", { code: "EXPIRED" });
    const p = req.payload as { targetUserId: string; factorId: string };
    const f = await tx.adminMfaFactor.findFirst({ where: { id: p.factorId, userId: p.targetUserId, disabledAt: null } });
    if (!f) throw new HttpError(409, "This admin's two-step verification changed since the request was made.", { code: "STALE" });
    await tx.adminApprovalRequest.update({ where: { id: req.id }, data: { status: "APPROVED", decidedById: actorId, decidedAt: now } });
    await tx.adminMfaFactor.update({ where: { id: f.id }, data: { disabledAt: now, disabledReason: `Two-admin reset (request ${req.id}): ${req.reason}` } });
    await tx.adminMfaRecoveryCode.updateMany({ where: { factorId: f.id, usedAt: null, revokedAt: null }, data: { revokedAt: now } });
    await tx.adminApprovalRequest.update({ where: { id: req.id }, data: { status: "EXECUTED", executedAt: now, openKey: null } });
    await audit(tx, actorId, "ADMIN_MFA_RESET", p.targetUserId, { requestId: req.id, factorId: f.id, requestedById: req.requestedById, approvedById: actorId, reason: req.reason });
    return { targetUserId: p.targetUserId, status: "RESET" as const };
  });
}

export async function closeMfaReset(actorId: string, requestId: string, mode: "reject" | "cancel") {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    await requireAdminInTx(tx, actorId);
    const req = await lockResetRequest(tx, requestId);
    if (mode === "cancel" && req.requestedById !== actorId) throw new HttpError(403, "Only the admin who asked can cancel this request.", { code: "NOT_REQUESTER" });
    if (mode === "reject" && req.requestedById === actorId) throw new HttpError(403, "Cancel your own request instead of rejecting it.", { code: "SAME_ADMIN" });
    await tx.adminApprovalRequest.update({ where: { id: req.id }, data: { status: mode === "reject" ? "REJECTED" : "CANCELLED", openKey: null, decidedAt: now, ...(mode === "reject" ? { decidedById: actorId } : {}) } });
    await audit(tx, actorId, mode === "reject" ? "ADMIN_MFA_RESET_REJECTED" : "ADMIN_MFA_RESET_CANCELLED", req.targetId, { requestId: req.id, requestedById: req.requestedById });
    return { id: req.id, status: mode === "reject" ? "REJECTED" : "CANCELLED" };
  });
}
