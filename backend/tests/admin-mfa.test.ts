/**
 * Admin two-step verification (TOTP, RFC 6238) end to end: the algorithm against the RFC test vectors,
 * enrolment, sign-in with a code or a recovery code, replay and lock-out, MFA-bound admin sessions, the
 * two-admin reset of a lost factor, the database role re-check, and the append-only MFA audit trail.
 * Real HTTP API and local database; synthetic accounts only, everything prefixed "zz-test-".
 */
import "./local-db-guard.js"; // first: refuses to run against a non-local (production) database
process.env.ADMIN_MFA_ENFORCEMENT = "on"; // this suite tests enforcement (the legacy preload sets "off" only when unset)
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { signSessionToken } from "../src/utils/tokens.js";
import { adminMfaEnforced } from "../src/utils/feature-flags.js";
import { base32Decode, base32Encode, hotp, totp, verifyTotp } from "../src/utils/totp.js";

const tag = `zz-test-${randomBytes(4).toString("hex")}`;
const short = tag.slice(-6).toUpperCase();
const PASSWORD = `Zz-${randomBytes(6).toString("hex")}-pw`;
let server: Server;
let base = "";
const userIds: string[] = [];
type U = { id: string; email: string; username: string; token: string };
const people: Record<string, U> = {};

async function makeUser(name: string, role: "USER" | "ADMIN" = "ADMIN") {
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const u = await prisma.user.create({ data: { name: `${tag} ${name}`, email: `${tag}-${name.toLowerCase()}@example.test`, username: `${tag}-${name.toLowerCase()}`, passwordHash, referralCode: `M${short}${userIds.length}`, role, emailVerified: new Date() } });
  userIds.push(u.id);
  people[name] = { id: u.id, email: u.email, username: u.username, token: signSessionToken({ id: u.id, name: u.name, email: u.email, role, referralCode: u.referralCode }, u.passwordHash) };
  return people[name];
}
async function call(method: string, path: string, token: string | null, body?: unknown) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { "X-Forwarded-For": `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text };
}
const login = (u: U, password = PASSWORD) => call("POST", "/auth/login", null, { identifier: u.username, password });
const ADMIN_PATH = "/admin/franchise/overview";

/** Enrols an admin through the API; returns the secret, recovery codes and the MFA-verified token. */
async function enrol(u: U) {
  const start = await call("POST", "/auth/mfa/enroll/start", u.token, { password: PASSWORD });
  assert.equal(start.status, 200, start.text);
  const confirm = await call("POST", "/auth/mfa/enroll/confirm", u.token, { code: totp(start.body.secret) });
  assert.equal(confirm.status, 200, confirm.text);
  return { secret: start.body.secret as string, codes: confirm.body.recoveryCodes as string[], token: confirm.body.token as string };
}
const nextStepCode = (secret: string) => totp(secret, new Date(Date.now() + 30_000)); // the next 30-second step (inside the drift window)

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const n of ["admA", "admB", "admC", "admLock", "admReset"]) await makeUser(n);
  await makeUser("student", "USER");
});

after(async () => {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL eta.financial_maintenance = 'on'`; // test cleanup only (logged)
      await tx.$executeRaw`SET LOCAL eta.maintenance_reason = 'admin-mfa test cleanup'`;
      const factors = (await tx.adminMfaFactor.findMany({ where: { userId: { in: userIds } }, select: { id: true } })).map((f) => f.id);
      await tx.adminMfaRecoveryCode.deleteMany({ where: { factorId: { in: factors } } });
      await tx.adminMfaFactor.deleteMany({ where: { id: { in: factors } } });
      await tx.adminApprovalRequest.deleteMany({ where: { requestedById: { in: userIds } } });
      await tx.partnerCard.deleteMany({ where: { userId: { in: userIds } } });
      await tx.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { target: { in: userIds } }] } });
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
    });
  } finally {
    server.close();
  }
});

describe("TOTP algorithm (RFC 6238 / RFC 4226)", () => {
  test("matches the RFC 6238 SHA-1 test vectors (8 digits)", () => {
    const secret = Buffer.from("12345678901234567890");
    for (const [t, code] of [[59, "94287082"], [1111111109, "07081804"], [1111111111, "14050471"], [1234567890, "89005924"], [2000000000, "69279037"], [20000000000, "65353130"]] as const) {
      assert.equal(hotp(secret, Math.floor(t / 30), 8), code, `T=${t}`);
    }
  });

  test("base32 round-trips; codes verify within ±1 step only; a used step can't be replayed", () => {
    const raw = randomBytes(20);
    assert.deepEqual(base32Decode(base32Encode(raw)), raw);
    const secret = base32Encode(raw);
    const now = new Date();
    const step = verifyTotp(secret, totp(secret, now), now, null);
    assert.ok(step !== null);
    assert.equal(verifyTotp(secret, totp(secret, now), now, step), null, "same step again → refused");
    assert.equal(verifyTotp(secret, totp(secret, new Date(now.getTime() - 90_000)), now, null), null, "3 steps old → refused");
    assert.equal(verifyTotp(secret, "12345", now, null), null);
    assert.equal(verifyTotp(secret, "abcdef", now, null), null);
  });

  test("enforcement can't be switched off in production", () => {
    const saved = { node: process.env.NODE_ENV, mfa: process.env.ADMIN_MFA_ENFORCEMENT };
    try {
      process.env.ADMIN_MFA_ENFORCEMENT = "off";
      process.env.NODE_ENV = "production";
      assert.equal(adminMfaEnforced(), true);
      process.env.NODE_ENV = "development";
      assert.equal(adminMfaEnforced(), false);
      delete process.env.ADMIN_MFA_ENFORCEMENT;
      assert.equal(adminMfaEnforced(), true, "on by default");
    } finally {
      process.env.NODE_ENV = saved.node;
      process.env.ADMIN_MFA_ENFORCEMENT = "on";
    }
  });
});

describe("enrolment", () => {
  test("an admin without MFA can sign in but can't use admin APIs until it is set up", async () => {
    const r = await login(people.admA);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.mfaEnrollmentRequired, true);
    const admin = await call("GET", ADMIN_PATH, r.body.token);
    assert.deepEqual([admin.status, admin.body.code], [403, "MFA_ENROLLMENT_REQUIRED"]);
    const status = await call("GET", "/auth/mfa/status", r.body.token);
    assert.deepEqual([status.body.enforced, status.body.enrolled, status.body.sessionVerified], [true, false, false]);
  });

  test("students and anonymous callers can't use MFA enrolment", async () => {
    assert.equal((await call("GET", "/auth/mfa/status", people.student.token)).status, 403);
    assert.equal((await call("POST", "/auth/mfa/enroll/start", people.student.token, { password: PASSWORD })).status, 403);
    assert.equal((await call("POST", "/auth/mfa/enroll/start", null, { password: PASSWORD })).status, 401);
  });

  test("enrolment needs the password again and a correct code; the secret is stored encrypted; codes shown once", async () => {
    assert.equal((await call("POST", "/auth/mfa/enroll/start", people.admA.token, { password: "wrong-password" })).body.code, "BAD_PASSWORD");
    const start = await call("POST", "/auth/mfa/enroll/start", people.admA.token, { password: PASSWORD });
    assert.equal(start.status, 200, start.text);
    assert.match(start.body.otpauthUri, /^otpauth:\/\/totp\/ETA%20Admin%3A.+\?secret=[A-Z2-7]+&issuer=ETA\+Admin/);
    const stored = await prisma.adminMfaFactor.findFirstOrThrow({ where: { userId: people.admA.id, disabledAt: null } });
    assert.equal(stored.secretEncrypted.includes(start.body.secret), false, "only the encrypted secret is stored");
    assert.equal(stored.enabledAt, null, "pending until confirmed");
    const bad = await call("POST", "/auth/mfa/enroll/confirm", people.admA.token, { code: totp(start.body.secret) === "000000" ? "111111" : "000000" });
    assert.deepEqual([bad.status, bad.body.code], [400, "MFA_INVALID_CODE"]);
    const ok = await call("POST", "/auth/mfa/enroll/confirm", people.admA.token, { code: totp(start.body.secret) });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.body.recoveryCodes.length, 10);
    assert.equal(new Set(ok.body.recoveryCodes).size, 10);
    const hashes = await prisma.adminMfaRecoveryCode.findMany({ where: { factorId: stored.id } });
    assert.ok(hashes.every((h) => /^[0-9a-f]{64}$/.test(h.codeHash) && !ok.body.recoveryCodes.includes(h.codeHash)));
    assert.equal((await call("GET", ADMIN_PATH, ok.body.token)).status, 200, "the session issued on enrolment is MFA-verified");
    assert.equal((await call("GET", ADMIN_PATH, people.admA.token)).body.code, "MFA_REQUIRED", "the old password-only session isn't");
    assert.equal((await call("POST", "/auth/mfa/enroll/start", ok.body.token, { password: PASSWORD })).body.code, "MFA_ALREADY_ENROLLED", "can't be replaced without a two-admin reset");
    assert.equal(await prisma.auditLog.count({ where: { action: "ADMIN_MFA_ENROLLED", actorId: people.admA.id } }), 1);
  });
});

describe("sign-in", () => {
  const fx = {} as { secret: string; codes: string[] };
  before(async () => {
    const e = await enrol(people.admB);
    fx.secret = e.secret;
    fx.codes = e.codes;
  });

  test("password alone gives only a 5-minute challenge — never a session", async () => {
    const r = await login(people.admB);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.mfaRequired, true);
    assert.equal(r.body.token, undefined);
    assert.equal((await call("GET", "/auth/session", r.body.challengeToken)).status, 401, "a challenge is not a session");
    assert.equal((await call("GET", ADMIN_PATH, r.body.challengeToken)).status, 401);
    assert.equal((await login(people.admB, "wrong")).status, 401);
  });

  test("wrong, malformed and replayed codes fail; a fresh code signs in with an MFA-bound session", async () => {
    const { body } = await login(people.admB);
    const wrong = await call("POST", "/auth/mfa/verify", null, { challengeToken: body.challengeToken, code: totp(fx.secret) === "000000" ? "111111" : "000000" });
    assert.deepEqual([wrong.status, wrong.body.code], [401, "MFA_INVALID_CODE"]);
    assert.equal((await call("POST", "/auth/mfa/verify", null, { challengeToken: body.challengeToken, code: "12ab56" })).status, 400);
    assert.equal((await call("POST", "/auth/mfa/verify", null, { challengeToken: "not-a-token-at-all", code: "123456" })).body.code, "MFA_CHALLENGE_INVALID");
    assert.equal((await call("POST", "/auth/mfa/verify", null, { challengeToken: people.admB.token, code: totp(fx.secret) })).body.code, "MFA_CHALLENGE_INVALID", "a session token isn't a challenge");
    const code = nextStepCode(fx.secret);
    const ok = await call("POST", "/auth/mfa/verify", null, { challengeToken: body.challengeToken, code });
    assert.equal(ok.status, 200, ok.text);
    assert.equal((await call("GET", ADMIN_PATH, ok.body.token)).status, 200);
    const again = await login(people.admB);
    const replay = await call("POST", "/auth/mfa/verify", null, { challengeToken: again.body.challengeToken, code });
    assert.deepEqual([replay.status, replay.body.code], [401, "MFA_INVALID_CODE"], "the same code can't be used twice");
    assert.ok(await prisma.auditLog.count({ where: { action: "ADMIN_MFA_LOGIN_SUCCEEDED", actorId: people.admB.id } }) >= 1);
    assert.ok(await prisma.auditLog.count({ where: { action: "ADMIN_MFA_LOGIN_FAILED", actorId: people.admB.id } }) >= 1);
  });

  test("a recovery code works exactly once and is counted down", async () => {
    const { body } = await login(people.admB);
    const r = await call("POST", "/auth/mfa/verify", null, { challengeToken: body.challengeToken, recoveryCode: fx.codes[0].toLowerCase() });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.body.method, r.body.recoveryCodesRemaining], ["RECOVERY_CODE", 9]);
    const again = await login(people.admB);
    assert.equal((await call("POST", "/auth/mfa/verify", null, { challengeToken: again.body.challengeToken, recoveryCode: fx.codes[0] })).body.code, "MFA_INVALID_CODE");
    assert.equal((await call("POST", "/auth/mfa/verify", null, { challengeToken: again.body.challengeToken, code: "123456", recoveryCode: fx.codes[1] })).status, 400, "one method at a time");
    assert.equal(await prisma.auditLog.count({ where: { action: "ADMIN_MFA_RECOVERY_CODE_USED", actorId: people.admB.id } }), 1);
  });

  test("regenerating recovery codes needs an MFA session and a fresh code; old codes stop working", async () => {
    const u = await makeUser("admRegen");
    const e = await enrol(u);
    assert.equal((await call("POST", "/admin/security/mfa/recovery-codes", u.token, { code: nextStepCode(e.secret) })).body.code, "MFA_REQUIRED", "a password-only session can't");
    const { body } = await login(u);
    const s = await call("POST", "/auth/mfa/verify", null, { challengeToken: body.challengeToken, recoveryCode: e.codes[0] });
    assert.equal(s.status, 200, s.text);
    assert.equal((await call("POST", "/admin/security/mfa/recovery-codes", s.body.token, { code: "000000" === nextStepCode(e.secret) ? "111111" : "000000" })).body.code, "MFA_INVALID_CODE");
    const regen = await call("POST", "/admin/security/mfa/recovery-codes", s.body.token, { code: nextStepCode(e.secret) });
    assert.equal(regen.status, 200, regen.text);
    const again = await login(u);
    assert.equal((await call("POST", "/auth/mfa/verify", null, { challengeToken: again.body.challengeToken, recoveryCode: e.codes[1] })).body.code, "MFA_INVALID_CODE", "old codes revoked");
    const fresh = await call("POST", "/auth/mfa/verify", null, { challengeToken: again.body.challengeToken, recoveryCode: regen.body.recoveryCodes[0] });
    assert.equal(fresh.status, 200, fresh.text);
    assert.equal(await prisma.auditLog.count({ where: { action: "ADMIN_MFA_RECOVERY_CODES_REGENERATED", actorId: u.id } }), 1);
  });

  test("a password change ends the challenge; a demoted admin's MFA session is refused at once", async () => {
    const { body } = await login(people.admB);
    const original = await prisma.user.findUniqueOrThrow({ where: { id: people.admB.id } });
    await prisma.user.update({ where: { id: people.admB.id }, data: { passwordHash: await bcrypt.hash(PASSWORD, 4) } });
    assert.equal((await call("POST", "/auth/mfa/verify", null, { challengeToken: body.challengeToken, code: totp(fx.secret) })).body.code, "MFA_CHALLENGE_INVALID");
    await prisma.user.update({ where: { id: people.admB.id }, data: { passwordHash: original.passwordHash } });
    const fresh = await login(people.admB);
    const s = await call("POST", "/auth/mfa/verify", null, { challengeToken: fresh.body.challengeToken, recoveryCode: fx.codes[1] });
    assert.equal(s.status, 200, s.text);
    await prisma.user.update({ where: { id: people.admB.id }, data: { role: "USER" } });
    try {
      for (const path of [ADMIN_PATH, "/admin/settings", "/admin/orders"]) assert.equal((await call("GET", path, s.body.token)).status, 403, `${path}: role re-read from the database`);
    } finally {
      await prisma.user.update({ where: { id: people.admB.id }, data: { role: "ADMIN" } });
    }
  });
});

describe("lock-out", () => {
  test("five wrong codes lock the factor for 15 minutes, even for a correct code; audited", async () => {
    const e = await enrol(people.admLock);
    const { body } = await login(people.admLock);
    for (let i = 0; i < 5; i++) {
      const r = await call("POST", "/auth/mfa/verify", null, { challengeToken: body.challengeToken, code: totp(e.secret) === "000000" ? "111111" : "000000" });
      assert.equal(r.body.code, "MFA_INVALID_CODE", `attempt ${i + 1}`);
    }
    const locked = await call("POST", "/auth/mfa/verify", null, { challengeToken: body.challengeToken, code: nextStepCode(e.secret) });
    assert.deepEqual([locked.status, locked.body.code], [429, "MFA_LOCKED"]);
    assert.equal(await prisma.auditLog.count({ where: { action: "ADMIN_MFA_LOCKED", actorId: people.admLock.id } }), 1);
    await prisma.adminMfaFactor.updateMany({ where: { userId: people.admLock.id, disabledAt: null }, data: { lockedUntil: new Date(Date.now() - 1000) } }); // the 15 minutes pass
    assert.equal((await call("POST", "/auth/mfa/verify", null, { challengeToken: body.challengeToken, code: nextStepCode(e.secret) })).status, 200);
  });
});

describe("two-admin reset of a lost factor", () => {
  test("two other admins reset it; nobody can reset or approve their own; the old sessions end; the admin enrols again", async () => {
    const tokenC = (await enrol(people.admC)).token; // C requests the reset
    const target = await enrol(people.admReset); // the admin who "lost" their device
    const path = `/admin/security/admins/${people.admReset.id}/mfa-reset-requests`;
    assert.equal((await call("POST", `/admin/security/admins/${people.admC.id}/mfa-reset-requests`, tokenC, { reason: "Lost my own phone, need a reset" })).body.code, "SELF_RESET");
    assert.equal((await call("POST", path, people.student.token, { reason: "Not allowed for students" })).status, 403);
    assert.equal((await call("POST", path, people.admC.token, { reason: "Password-only session must not work" })).body.code, "MFA_REQUIRED");
    assert.equal((await call("POST", path, tokenC, { reason: "short" })).status, 400);
    const req = await call("POST", path, tokenC, { reason: "Phone lost and recovery codes destroyed; identity confirmed by video call." });
    assert.equal(req.status, 201, req.text);
    const approve = (token: string) => call("POST", `/admin/security/mfa-reset-requests/${req.body.request.id}/approve`, token, { expectedPayloadSha: req.body.request.payloadSha256 });
    assert.equal((await approve(tokenC)).body.code, "SAME_ADMIN");
    assert.equal((await approve(target.token)).body.code, "SELF_RESET", "the admin being reset can't approve");
    assert.equal((await approve(people.student.token)).status, 403);
    const secondAdmin = await makeUser("secondApprover");
    const second = await enrol(secondAdmin);
    const ok = await approve(second.token);
    assert.equal(ok.status, 200, ok.text);
    // The target's MFA session ends; they can set it up again.
    assert.equal((await call("GET", ADMIN_PATH, target.token)).body.code, "MFA_ENROLLMENT_REQUIRED");
    const reLogin = await login(people.admReset);
    assert.equal(reLogin.body.mfaEnrollmentRequired, true, "password sign-in now leads to enrolment");
    const again = await call("POST", "/auth/mfa/enroll/start", reLogin.body.token, { password: PASSWORD });
    assert.equal(again.status, 200, again.text);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "ADMIN_MFA_RESET", target: people.admReset.id } });
    const meta = audit.metadata as { requestedById: string; approvedById: string };
    assert.deepEqual([audit.actorId, meta.requestedById, meta.approvedById], [secondAdmin.id, people.admC.id, secondAdmin.id]);
    const row = await prisma.adminApprovalRequest.findUniqueOrThrow({ where: { id: req.body.request.id } });
    assert.deepEqual([row.status, row.requestedById, row.decidedById], ["EXECUTED", people.admC.id, secondAdmin.id]);
  });
});

describe("admin powers outside the admin API", () => {
  test("viewing another user's records as an admin needs a current ADMIN role and an MFA-verified session", async () => {
    const card = await prisma.partnerCard.create({
      data: { userId: people.student.id, partnerId: `ZZ${short}`, fullName: "Synthetic Student", location: "Test City", email: people.student.email, phone: "9000000000", qrToken: randomBytes(8).toString("hex"), qrCodeUrl: "https://example.invalid/qr" },
    });
    const path = `/partner-cards/${card.partnerId}`;
    assert.equal((await call("GET", path, people.student.token)).status, 200, "the owner sees it");
    const u = await makeUser("admViewer");
    assert.equal((await call("GET", path, u.token)).status, 404, "an admin without MFA is treated as an ordinary user");
    const e = await enrol(u);
    assert.equal((await call("GET", path, e.token)).status, 200, "an MFA-verified admin can");
    await prisma.user.update({ where: { id: u.id }, data: { role: "USER" } });
    assert.equal((await call("GET", path, e.token)).status, 404, "a demoted admin's token no longer can");
  });
});

describe("database guards", () => {
  test("MFA audit entries are append-only; factors and recovery codes can't be deleted or rewritten", async () => {
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "ADMIN_MFA_ENROLLED", actorId: people.admA.id } });
    await assert.rejects(prisma.auditLog.update({ where: { id: entry.id }, data: { metadata: {} } }), /append-only/);
    await assert.rejects(prisma.auditLog.delete({ where: { id: entry.id } }), /append-only/);
    const f = await prisma.adminMfaFactor.findFirstOrThrow({ where: { userId: people.admA.id, disabledAt: null } });
    await assert.rejects(prisma.adminMfaFactor.delete({ where: { id: f.id } }), /never deleted/);
    await assert.rejects(prisma.adminMfaFactor.update({ where: { id: f.id }, data: { secretEncrypted: "x" } }), /never change/);
    await assert.rejects(prisma.adminMfaFactor.update({ where: { id: f.id }, data: { lastUsedStep: 1 } }), /only move forward/);
    await assert.rejects(prisma.adminMfaFactor.create({ data: { userId: people.admA.id, secretEncrypted: "x" } }), (e: { code?: string }) => e.code === "P2002", "one live factor per admin");
    const code = await prisma.adminMfaRecoveryCode.findFirstOrThrow({ where: { factorId: f.id } });
    await assert.rejects(prisma.adminMfaRecoveryCode.delete({ where: { id: code.id } }), /never deleted/);
    await assert.rejects(prisma.adminMfaRecoveryCode.update({ where: { id: code.id }, data: { codeHash: "0".repeat(64) } }), /never changes/);
  });
});
