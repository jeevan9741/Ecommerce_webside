/**
 * Forgot password: POST /auth/forgot-password emails a LOGIN_RESET code, POST /auth/reset-password
 * redeems it. Emails go to the console (forced below, so no real email is ever sent) and the code is
 * read from that output. Users and codes are prefixed "zz-test-" and removed in teardown.
 */
import "./local-db-guard.js"; // first: refuses to run against a non-local (production) database
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { env } from "../src/config/env.js";

process.env.EMAIL_PROVIDER = "console";

const tag = `zz-test-${randomBytes(4).toString("hex")}`;
const unknownEmail = `${tag}-nobody@example.test`;
let server: Server;
let base = "";
const userIds: string[] = [];
const emails: string[] = [unknownEmail];

/** A user per test, since reset attempts are rate limited per email. Password: OldPass123. */
async function makeUser() {
  const name = `${tag}-${userIds.length}`;
  const user = await prisma.user.create({
    data: { name, email: `${name}@example.test`, username: name, passwordHash: await bcrypt.hash("OldPass123", 4), referralCode: name, emailVerified: new Date() },
  });
  userIds.push(user.id);
  emails.push(user.email);
  return { id: user.id, email: user.email, username: name };
}

/** GET /auth/session with this token: 200 while the session is good, 401 once it's revoked. */
async function sessionStatus(token: string) {
  return (await fetch(`${base}/api/auth/session`, { headers: { Authorization: `Bearer ${token}` } })).status;
}

async function post(path: string, body: unknown) {
  const res = await fetch(`${base}/api${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

/** Runs fn and returns the codes of the console emails it sent to `to`. */
async function emailedCodes(to: string, fn: () => Promise<unknown>) {
  const codes: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    const text = args.join(" ");
    if (text.includes(`to=${to} `)) codes.push(/letter-spacing: 8px[^>]*>(\d{6})</.exec(text)?.[1] ?? "");
    else original(...args);
  };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return codes;
}

/** A fresh code for the user, as if the cooldown had passed. */
async function freshCode(email: string) {
  await prisma.emailOtp.deleteMany({ where: { email } });
  const codes = await emailedCodes(email, () => post("/auth/forgot-password", { email }));
  assert.equal(codes.length, 1);
  return codes[0];
}

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.emailOtp.deleteMany({ where: { email: { in: emails } } });
  server.close();
});

test("answers the same for unknown emails and sends nothing", async () => {
  const codes = await emailedCodes(unknownEmail, async () => {
    const res = await post("/auth/forgot-password", { email: unknownEmail });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true, retryAfterSeconds: 60 });
  });
  assert.equal(codes.length, 0);
  assert.equal(await prisma.emailOtp.count({ where: { email: unknownEmail } }), 0);
});

test("a second request inside the cooldown is answered but sends no email", async () => {
  const { email } = await makeUser();
  await freshCode(email);
  const codes = await emailedCodes(email, async () => {
    const res = await post("/auth/forgot-password", { email: email.toUpperCase() });
    assert.equal(res.status, 200);
  });
  assert.equal(codes.length, 0);
});

test("wrong codes and weak passwords are refused, and the password is unchanged", async () => {
  const { email } = await makeUser();
  const code = await freshCode(email);
  const wrong = code === "000000" ? "111111" : "000000";
  assert.equal((await post("/auth/reset-password", { email, code: wrong, password: "NewPass123" })).status, 400);
  assert.equal((await post("/auth/reset-password", { email, code, password: "short" })).status, 400);
  assert.equal((await post("/auth/login", { identifier: email, password: "OldPass123" })).status, 200);
});

test("reset codes can't be redeemed through the registration endpoint", async () => {
  const { email } = await makeUser();
  const code = await freshCode(email);
  const res = await post("/email/verify-otp", { email, code, purpose: "LOGIN_RESET" });
  assert.equal(res.status, 400);
  assert.equal(res.body.verificationToken, undefined);
});

test("the right code sets the new password, signs in, and can't be reused", async () => {
  const { id: userId, email, username } = await makeUser();
  const code = await freshCode(email);
  const res = await post("/auth/reset-password", { email, code, password: "NewPass123" });
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.token, "string");
  assert.equal(res.body.user.email, email);

  assert.equal((await post("/auth/login", { identifier: email, password: "OldPass123" })).status, 401);
  assert.equal((await post("/auth/login", { identifier: username, password: "NewPass123" })).status, 200);
  assert.equal((await post("/auth/reset-password", { email, code, password: "Other12345" })).status, 400);
  assert.equal(await prisma.auditLog.count({ where: { actorId: userId, action: "PASSWORD_RESET" } }), 1);
});

test("five wrong guesses lock the code", async () => {
  const { email } = await makeUser();
  const code = await freshCode(email);
  const wrong = code === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++) await post("/auth/reset-password", { email, code: wrong, password: "Another123" });
  const res = await post("/auth/reset-password", { email, code, password: "Another123" });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Too many incorrect attempts/);
});

test("a password reset signs out every session issued before it", async () => {
  const { email } = await makeUser();
  const before = (await post("/auth/login", { identifier: email, password: "OldPass123" })).body.token as string;
  const otherDevice = (await post("/auth/login", { identifier: email, password: "OldPass123" })).body.token as string;
  assert.equal(await sessionStatus(before), 200);

  const code = await freshCode(email);
  const reset = await post("/auth/reset-password", { email, code, password: "NewPass123" });
  assert.equal(reset.status, 200);

  assert.equal(await sessionStatus(before), 401, "the old session is revoked");
  assert.equal(await sessionStatus(otherDevice), 401, "every other device too");
  assert.equal(await sessionStatus(reset.body.token), 200, "the session the reset hands back works");
  const relogin = (await post("/auth/login", { identifier: email, password: "NewPass123" })).body.token as string;
  assert.equal(await sessionStatus(relogin), 200);
});

test("tokens from before fingerprints keep working until the password changes", async () => {
  const { id, email } = await makeUser();
  // Issued a while ago, after the account last changed (token times are whole seconds).
  const now = Math.floor(Date.now() / 1000);
  const u = await prisma.user.update({ where: { id }, data: { updatedAt: new Date((now - 60) * 1000) } });
  const legacy = jwt.sign({ id, name: u.name, email, role: "USER", referralCode: u.referralCode, iat: now - 30 }, env.jwtSecret, { expiresIn: "7d" });
  assert.equal(await sessionStatus(legacy), 200, "no mass sign-out when this ships");

  const code = await freshCode(email);
  assert.equal((await post("/auth/reset-password", { email, code, password: "NewPass123" })).status, 200);
  assert.equal(await sessionStatus(legacy), 401, "a reset ends legacy sessions too");
});

test("a forged or tampered fingerprint is refused", async () => {
  const { email } = await makeUser();
  const token = (await post("/auth/login", { identifier: email, password: "OldPass123" })).body.token as string;
  const claims = jwt.decode(token) as Record<string, unknown>;
  const { iat: _iat, exp: _exp, ...rest } = claims;
  const forged = jwt.sign({ ...rest, pv: "A".repeat(22) }, env.jwtSecret, { expiresIn: "7d" });
  assert.equal(await sessionStatus(forged), 401);
  const unsigned = token.slice(0, token.lastIndexOf(".") + 1) + "x".repeat(43);
  assert.equal(await sessionStatus(unsigned), 401);
});

test("a deleted account's session stops working", async () => {
  const { id, email } = await makeUser();
  const token = (await post("/auth/login", { identifier: email, password: "OldPass123" })).body.token as string;
  await prisma.user.delete({ where: { id } });
  assert.equal(await sessionStatus(token), 401);
});
