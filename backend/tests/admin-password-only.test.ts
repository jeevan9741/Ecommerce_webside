/**
 * Admin sign-in with the password only (two-step verification switched off, the default): newly created
 * admins, admins who already enrolled an authenticator and admins with an unfinished enrolment all reach the
 * admin APIs with a password session. Authorization is unchanged: the database role, the password-change
 * sign-out and the student/anonymous refusals still apply, and no MFA data is deleted.
 * Real HTTP API and local database; synthetic accounts only, everything prefixed "zz-test-".
 */
import "./local-db-guard.js"; // first: refuses to run against a non-local (production) database
delete process.env.ADMIN_MFA_ENFORCEMENT; // the default, as in production (the legacy preload pins "off")
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import jwt from "jsonwebtoken";
import { env } from "../src/config/env.js";
import { adminMfaEnforced } from "../src/utils/feature-flags.js";
import { base32Encode, totp } from "../src/utils/totp.js";
import { encryptJson } from "../src/utils/crypto.js";
import { ADMIN_SESSION_MAX_AGE_SECONDS, passwordFingerprint } from "../src/utils/tokens.js";

const tag = `zz-test-${randomBytes(4).toString("hex")}`;
const short = tag.slice(-6).toUpperCase();
const PASSWORD = `Zz-${randomBytes(6).toString("hex")}-pw`;
let server: Server;
let base = "";
const userIds: string[] = [];
type U = { id: string; username: string };
const ADMIN_PATHS = ["/admin/franchise/overview", "/admin/orders"];

async function makeUser(name: string, role: "USER" | "ADMIN" = "ADMIN"): Promise<U> {
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const u = await prisma.user.create({ data: { name: `${tag} ${name}`, email: `${tag}-${name.toLowerCase()}@example.test`, username: `${tag}-${name.toLowerCase()}`, passwordHash, referralCode: `P${short}${userIds.length}`, role, emailVerified: new Date() } });
  userIds.push(u.id);
  return { id: u.id, username: u.username };
}
async function call(method: string, path: string, token: string | null, body?: unknown) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { "X-Forwarded-For": `10.78.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text };
}
/** Password-only sign-in: must return a session straight away, never a code challenge. */
async function signIn(u: U, password = PASSWORD) {
  const r = await call("POST", "/auth/login", null, { identifier: u.username, password });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.mfaRequired, undefined, "no authenticator challenge");
  assert.equal(r.body.challengeToken, undefined);
  assert.ok(!r.body.mfaEnrollmentRequired, "no set-up requirement");
  assert.equal(typeof r.body.token, "string");
  return r.body.token as string;
}
async function assertAdminAccess(token: string) {
  for (const p of ADMIN_PATHS) {
    const r = await call("GET", p, token);
    assert.equal(r.status, 200, `${p}: ${r.text}`);
  }
}

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL eta.financial_maintenance = 'on'`; // test cleanup only (logged)
      await tx.$executeRaw`SET LOCAL eta.maintenance_reason = 'admin-password-only test cleanup'`;
      const factors = (await tx.adminMfaFactor.findMany({ where: { userId: { in: userIds } }, select: { id: true } })).map((f) => f.id);
      await tx.adminMfaRecoveryCode.deleteMany({ where: { factorId: { in: factors } } });
      await tx.adminMfaFactor.deleteMany({ where: { id: { in: factors } } });
      await tx.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { target: { in: userIds } }] } });
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
    });
  } finally {
    server.close();
  }
});

describe("admin sign-in with the password only (MFA off by default)", () => {
  test("enforcement is off by default, including NODE_ENV=production", () => {
    const saved = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      assert.equal(adminMfaEnforced(), false);
    } finally {
      process.env.NODE_ENV = saved;
    }
  });

  test("a newly created admin signs in with the password and uses the admin APIs", async () => {
    const admin = await makeUser("NewAdmin");
    const token = await signIn(admin);
    await assertAdminAccess(token);
    const session = await call("GET", "/auth/session", token);
    assert.equal(session.status, 200, session.text);
    assert.equal(session.body.user?.role ?? session.body.role, "ADMIN");
    const status = await call("GET", "/auth/mfa/status", token);
    assert.equal(status.status, 200, status.text);
    assert.equal(status.body.enforced, false);
  });

  test("an admin who already enrolled an authenticator signs in with the password only; the enrolment is kept", async () => {
    const admin = await makeUser("EnrolledAdmin");
    const first = await signIn(admin);
    const start = await call("POST", "/auth/mfa/enroll/start", first, { password: PASSWORD });
    assert.equal(start.status, 200, start.text);
    const confirm = await call("POST", "/auth/mfa/enroll/confirm", first, { code: totp(start.body.secret) });
    assert.equal(confirm.status, 200, confirm.text);

    const token = await signIn(admin); // no code asked
    await assertAdminAccess(token);

    const factor = await prisma.adminMfaFactor.findFirst({ where: { userId: admin.id, disabledAt: null, enabledAt: { not: null } } });
    assert.ok(factor, "enrolled factor is still there");
    assert.equal(await prisma.adminMfaRecoveryCode.count({ where: { factorId: factor.id, usedAt: null, revokedAt: null } }), 10, "recovery codes kept");
    assert.equal(await prisma.auditLog.count({ where: { action: "ADMIN_MFA_ENROLLED", target: admin.id } }), 1, "audit kept");
  });

  test("an admin with an unfinished enrolment signs in with the password only", async () => {
    const admin = await makeUser("PendingAdmin");
    const first = await signIn(admin);
    const start = await call("POST", "/auth/mfa/enroll/start", first, { password: PASSWORD });
    assert.equal(start.status, 200, start.text);
    await assertAdminAccess(await signIn(admin));
    assert.equal(await prisma.adminMfaFactor.count({ where: { userId: admin.id, disabledAt: null, enabledAt: null } }), 1, "pending enrolment kept");
  });

  test("authorization is unchanged: wrong password, demoted admin, password change, student and anonymous are refused", async () => {
    const admin = await makeUser("CheckAdmin");
    const wrong = await call("POST", "/auth/login", null, { identifier: admin.username, password: `${PASSWORD}x` });
    assert.equal(wrong.status, 401);

    const token = await signIn(admin);
    await prisma.user.update({ where: { id: admin.id }, data: { role: "USER" } });
    const demoted = await call("GET", ADMIN_PATHS[0], token);
    assert.equal(demoted.status, 403);
    assert.equal(demoted.body.code, "NOT_ADMIN");
    await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
    await assertAdminAccess(token);

    await prisma.user.update({ where: { id: admin.id }, data: { passwordHash: await bcrypt.hash(`${PASSWORD}-new`, 4) } });
    assert.equal((await call("GET", ADMIN_PATHS[0], token)).status, 401, "a password change signs the old session out");

    const student = await makeUser("Student", "USER");
    const studentToken = await signIn(student);
    for (const p of ADMIN_PATHS) assert.equal((await call("GET", p, studentToken)).status, 403, p);
    for (const p of ADMIN_PATHS) assert.equal((await call("GET", p, null)).status, 401, p);
  });
});

/** Lifetime in seconds of a signed token (exp - iat). */
const lifetime = (token: string) => {
  const d = jwt.decode(token) as { iat: number; exp: number };
  return d.exp - d.iat;
};
/** A session token issued `ageSeconds` ago that would itself stay valid for 7 days (like an older ordinary session). */
async function oldToken(userId: string, ageSeconds: number) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const iat = Math.floor(Date.now() / 1000) - ageSeconds;
  return jwt.sign({ id: u.id, name: u.name, email: u.email, role: u.role, referralCode: u.referralCode, pv: passwordFingerprint(u.passwordHash), iat }, env.jwtSecret, { expiresIn: "7d" });
}

describe("admin sessions last at most 12 hours", () => {
  test("an admin password session is issued for 12 hours; a student's keeps JWT_EXPIRES_IN", async () => {
    const admin = await makeUser("TtlAdmin");
    assert.equal(lifetime(await signIn(admin)), ADMIN_SESSION_MAX_AGE_SECONDS);
    const student = await makeUser("TtlStudent", "USER");
    const expected = lifetime(jwt.sign({}, env.jwtSecret, { expiresIn: env.jwtExpiresIn as jwt.SignOptions["expiresIn"] }));
    assert.equal(lifetime(await signIn(student)), expected, "student session length unchanged");
    assert.notEqual(expected, ADMIN_SESSION_MAX_AGE_SECONDS, "the test would prove nothing if both were 12 hours");
  });

  test("an admin token older than 12 hours is refused even if it would last longer; a younger one works", async () => {
    const admin = await makeUser("OldTokenAdmin");
    assert.equal((await call("GET", ADMIN_PATHS[0], await oldToken(admin.id, 11 * 3600))).status, 200, "11 hours old");
    assert.equal((await call("GET", ADMIN_PATHS[0], await oldToken(admin.id, 13 * 3600))).status, 401, "13 hours old");
    assert.equal((await call("GET", "/auth/session", await oldToken(admin.id, 13 * 3600))).status, 401, "ended everywhere, not only on admin APIs");
  });

  test("an older session of an account promoted to admin ends; students' older sessions are unaffected", async () => {
    const user = await makeUser("PromotedUser", "USER");
    const token = await oldToken(user.id, 13 * 3600);
    assert.equal((await call("GET", "/auth/session", token)).status, 200, "a 13-hour-old student session still works");
    await prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });
    assert.equal((await call("GET", ADMIN_PATHS[0], token)).status, 401, "after promotion the old session is no admin session");
    assert.equal((await call("GET", "/auth/session", token)).status, 401);
  });
});

describe("an old unfinished MFA enrolment can never be turned on", () => {
  /** An unfinished enrolment created long ago, like one whose setup key was exposed. The key stays inside the test. */
  async function stalePending(userId: string) {
    const secret = base32Encode(randomBytes(20));
    const createdAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const f = await prisma.adminMfaFactor.create({ data: { userId, secretEncrypted: encryptJson({ s: secret }), createdAt } });
    return { id: f.id, secret };
  }

  for (const mode of ["on", undefined] as const) {
    test(`confirming it is refused (ADMIN_MFA_ENFORCEMENT ${mode ?? "unset"}); nothing is enabled`, async () => {
      const saved = process.env.ADMIN_MFA_ENFORCEMENT;
      try {
        if (mode) process.env.ADMIN_MFA_ENFORCEMENT = mode;
        else delete process.env.ADMIN_MFA_ENFORCEMENT;
        const admin = await makeUser(`Stale${mode ?? "Off"}`);
        const login = await call("POST", "/auth/login", null, { identifier: admin.username, password: PASSWORD });
        assert.equal(login.status, 200, login.text);
        const stale = await stalePending(admin.id);
        const confirm = await call("POST", "/auth/mfa/enroll/confirm", login.body.token, { code: totp(stale.secret) });
        assert.equal(confirm.status, 409, confirm.text);
        assert.equal(confirm.body.code, "ENROLLMENT_EXPIRED");
        assert.equal(confirm.body.recoveryCodes, undefined);
        const row = await prisma.adminMfaFactor.findUniqueOrThrow({ where: { id: stale.id } });
        assert.equal(row.enabledAt, null, "still not enabled");
        assert.equal(await prisma.adminMfaRecoveryCode.count({ where: { factorId: stale.id } }), 0);
        if (mode === "on") {
          const blocked = await call("GET", ADMIN_PATHS[0], login.body.token);
          assert.equal(blocked.status, 403);
          assert.equal(blocked.body.code, "MFA_ENROLLMENT_REQUIRED", "the stale key gives no MFA session");
        }
      } finally {
        if (saved === undefined) delete process.env.ADMIN_MFA_ENFORCEMENT;
        else process.env.ADMIN_MFA_ENFORCEMENT = saved;
      }
    });
  }

  test("with enforcement on, starting again retires the old key: its codes never work, the new key does", async () => {
    const saved = process.env.ADMIN_MFA_ENFORCEMENT;
    try {
      process.env.ADMIN_MFA_ENFORCEMENT = "on";
      const admin = await makeUser("RestartAdmin");
      const login = await call("POST", "/auth/login", null, { identifier: admin.username, password: PASSWORD });
      const stale = await stalePending(admin.id);
      const start = await call("POST", "/auth/mfa/enroll/start", login.body.token, { password: PASSWORD });
      assert.equal(start.status, 200, start.text);
      const old = await prisma.adminMfaFactor.findUniqueOrThrow({ where: { id: stale.id } });
      assert.ok(old.disabledAt, "the old unfinished enrolment is retired");
      assert.equal(old.enabledAt, null);
      assert.notEqual(start.body.secret, stale.secret);

      const withOld = await call("POST", "/auth/mfa/enroll/confirm", login.body.token, { code: totp(stale.secret) });
      assert.equal(withOld.status, 400, "a code from the old key is wrong for the new enrolment");
      const withNew = await call("POST", "/auth/mfa/enroll/confirm", login.body.token, { code: totp(start.body.secret) });
      assert.equal(withNew.status, 200, withNew.text);

      const enabled = await prisma.adminMfaFactor.findMany({ where: { userId: admin.id, enabledAt: { not: null } }, select: { id: true } });
      assert.deepEqual(enabled.map((f) => f.id), [start.body.factorId], "only the new key is active");
      const signIn2 = await call("POST", "/auth/login", null, { identifier: admin.username, password: PASSWORD });
      const verify = await call("POST", "/auth/mfa/verify", null, { challengeToken: signIn2.body.challengeToken, code: totp(stale.secret, new Date(Date.now() + 30_000)) });
      assert.ok(verify.status >= 400 && !verify.body?.token, `the old key can't sign in (${verify.status})`);
    } finally {
      if (saved === undefined) delete process.env.ADMIN_MFA_ENFORCEMENT;
      else process.env.ADMIN_MFA_ENFORCEMENT = saved;
    }
  });
});
