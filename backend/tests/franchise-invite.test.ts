/**
 * Franchise Phase 5F-2: student invitations and franchise student links — through the real HTTP API
 * and the local database. Emails are captured (never sent); the token is taken from the captured link
 * exactly as a student would follow it. Covers the switch, ownership/IDOR, duplicates, expiry and
 * resend rules, acceptance rules, concurrency, audit and the database guards. Prefix "zz-test-".
 */
import "./local-db-guard.js"; // first: refuses to run against a non-local (production) database
import { after, before, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomBytes } from "node:crypto";

const realEmail = await import("../src/services/email.service.js");
const sent: { to: string; subject: string; html: string }[] = [];
mock.module("../src/services/email.service.js", {
  namedExports: { ...realEmail, sendEmail: async (m: { to: string; subject: string; html: string }) => void sent.push(m) },
});
const { createApp } = await import("../src/app.js");
const { prisma } = await import("../src/config/prisma.js");
const { signSessionToken } = await import("../src/utils/tokens.js");
const { hashToken, RESEND_MIN_GAP_MS } = await import("../src/services/franchise-invite.service.js");

const original = process.env.FRANCHISE_PARTNER_ENABLED;
const tag = `zz-test-${randomBytes(4).toString("hex")}`;
const short = tag.slice(-6).toUpperCase();
const DAY = 86_400_000;
let server: Server;
let base = "";
const userIds: string[] = [];
type U = { id: string; token: string; email: string };
const people: Record<string, U> = {};
let stateId = "";
let seq = 0;

async function makeUser(name: string, opts: { role?: "USER" | "ADMIN"; verified?: boolean; email?: string } = {}) {
  const role = opts.role ?? "USER";
  const u = await prisma.user.create({
    data: { name, email: opts.email ?? `${tag}-${name}@example.test`, username: `${tag}-${name}`, passwordHash: "x", referralCode: `I${short}${userIds.length}`, role, emailVerified: opts.verified === false ? null : new Date() },
  });
  userIds.push(u.id);
  people[name] = { id: u.id, email: u.email, token: signSessionToken({ id: u.id, name, email: u.email, role, referralCode: u.referralCode }, u.passwordHash) };
  return people[name];
}

async function makePartner(name: string) {
  const user = await makeUser(name);
  const districtId = (await prisma.district.create({ data: { stateId, name: `${tag} ${name}`, isActive: true } })).id;
  const app = await prisma.franchiseApplication.create({
    data: {
      applicationNo: `ZI-${short}-${String(++seq).padStart(4, "0")}`, userId: user.id, status: "ACTIVE_FRANCHISE", applicantName: name, mobile: `9${String(500000000 + seq)}`,
      email: user.email, stateId, districtId, address: "1, Test Street", requiredDocumentKinds: ["ID_PROOF"], refundPolicyVersion: 1, refundPolicyText: "test", refundPolicySha256: "a".repeat(64),
    },
  });
  const now = Date.now();
  const partner = await prisma.franchisePartner.create({
    data: { userId: user.id, applicationId: app.id, franchiseCode: `FR-ZI${short}${seq}`, districtId, status: "ACTIVE", agreementStartsAt: new Date(now - DAY), agreementEndsAt: new Date(now + 365 * DAY) },
  });
  await prisma.districtAllocation.create({ data: { districtId, partnerId: partner.id, applicationId: app.id, status: "ALLOCATED", allocatedAt: new Date(), createdById: people.adm.id } });
  return { user, partner };
}

async function call(method: string, path: string, user: U | null, body?: unknown) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { "X-Forwarded-For": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, ...(user ? { Authorization: `Bearer ${user.token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text };
}
const tokenFromLastEmail = (to: string) => {
  const m = [...sent].reverse().find((e) => e.to === to);
  const t = /\/franchise\/invite\/([A-Za-z0-9_-]{43})/.exec(m?.html ?? "")?.[1];
  assert.ok(t, `an invitation link was emailed to ${to}`);
  return t!;
};
async function invite(partner: U, email: string, name = "Invited Student") {
  const r = await call("POST", "/franchise-partner/invites", partner, { name, email });
  assert.equal(r.status, 201, r.text);
  return { id: r.body.invite.id as string, token: tokenFromLastEmail(email.trim().toLowerCase()) };
}
const accept = (u: U | null, token: string) => call("POST", `/franchise-invites/${token}/accept`, u);
const inviteRow = (id: string) => prisma.franchiseStudentInvite.findUniqueOrThrow({ where: { id } });

let A: Awaited<ReturnType<typeof makePartner>>;
let B: Awaited<ReturnType<typeof makePartner>>;

before(async () => {
  process.env.FRANCHISE_PARTNER_ENABLED = "true";
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await makeUser("adm", { role: "ADMIN" });
  stateId = (await prisma.indiaState.create({ data: { name: `${tag} State`, isActive: true } })).id;
  A = await makePartner("partnerA");
  B = await makePartner("partnerB");
});

after(async () => {
  if (original === undefined) delete process.env.FRANCHISE_PARTNER_ENABLED;
  else process.env.FRANCHISE_PARTNER_ENABLED = original;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL eta.financial_maintenance = 'on'`; // test cleanup only (logged)
      await tx.$executeRaw`SET LOCAL eta.maintenance_reason = 'franchise-invite test cleanup'`;
      const partners = (await tx.franchisePartner.findMany({ where: { userId: { in: userIds } }, select: { id: true } })).map((p) => p.id);
      const apps = (await tx.franchiseApplication.findMany({ where: { userId: { in: userIds } }, select: { id: true } })).map((a) => a.id);
      const districts = (await tx.district.findMany({ where: { name: { startsWith: tag } }, select: { id: true } })).map((d) => d.id);
      const links = (await tx.franchiseStudent.findMany({ where: { partnerId: { in: partners } }, select: { id: true } })).map((l) => l.id);
      await tx.franchiseStudentInvite.deleteMany({ where: { partnerId: { in: partners } } });
      await tx.franchiseStudent.deleteMany({ where: { id: { in: links } } });
      await tx.districtAllocation.deleteMany({ where: { districtId: { in: districts } } });
      await tx.franchisePartner.deleteMany({ where: { id: { in: partners } } });
      await tx.franchiseApplication.deleteMany({ where: { id: { in: apps } } });
      await tx.district.deleteMany({ where: { id: { in: districts } } });
      await tx.indiaState.deleteMany({ where: { name: { startsWith: tag } } });
      await tx.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { target: { in: [...partners, ...links] } }] } });
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
    });
  } finally {
    server.close();
  }
});

describe("partner switch", () => {
  test("OFF: invitation, student and accept routes are all plain 404s", async () => {
    process.env.FRANCHISE_PARTNER_ENABLED = "false";
    try {
      const routes: [string, string, unknown?][] = [["GET", "/franchise-partner/invites"], ["POST", "/franchise-partner/invites", { name: "X Y", email: "x@example.test" }], ["GET", "/franchise-partner/students"], ["GET", "/franchise-invites/abc"], ["POST", "/franchise-invites/abc/accept"]];
      for (const [m, p, b] of routes) assert.equal((await call(m, p, A.user, b)).status, 404, `${m} ${p}`);
    } finally {
      process.env.FRANCHISE_PARTNER_ENABLED = "true";
    }
  });
});

describe("invitations", () => {
  test("create: normalized email, emailed link, only the token hash stored, audited without the email", async () => {
    const r = await call("POST", "/franchise-partner/invites", A.user, { name: "Asha Student", email: `  ${tag}-Asha@Example.TEST `, mobile: "9876543210" });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.body.emailed, true);
    const row = await inviteRow(r.body.invite.id);
    assert.equal(row.email, `${tag}-asha@example.test`);
    const token = tokenFromLastEmail(row.email);
    assert.equal(row.tokenHash, hashToken(token));
    assert.ok(!JSON.stringify(row).includes(token), "the token itself is never stored");
    assert.equal(row.status, "OPEN");
    assert.ok(row.expiresAt.getTime() - Date.now() > 6.9 * DAY);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "FRANCHISE_INVITE_CREATED", target: row.id } });
    assert.doesNotMatch(JSON.stringify(audit.metadata), /@/);
  });

  test("validation, self-invitation, duplicates and paused linking are refused", async () => {
    for (const [label, body] of [
      ["bad email", { name: "Some One", email: "not-an-email" }],
      ["short name", { name: "S", email: `${tag}-v1@example.test` }],
      ["bad mobile", { name: "Some One", email: `${tag}-v2@example.test`, mobile: "12345" }],
      ["unknown field", { name: "Some One", email: `${tag}-v3@example.test`, partnerId: B.partner.id }],
    ] as [string, unknown][]) {
      assert.equal((await call("POST", "/franchise-partner/invites", A.user, body)).status, 400, label);
    }
    assert.equal((await call("POST", "/franchise-partner/invites", A.user, { name: "Me Myself", email: A.user.email.toUpperCase() })).body.code, "SELF_INVITE");
    await invite(A.user, `${tag}-dup@example.test`);
    const dup = await call("POST", "/franchise-partner/invites", A.user, { name: "Dup Again", email: `${tag}-DUP@example.test` });
    assert.deepEqual([dup.status, dup.body.code], [409, "INVITE_EXISTS"]);
    // Another franchise may invite the same person (only one acceptance can ever win).
    assert.equal((await call("POST", "/franchise-partner/invites", B.user, { name: "Dup Elsewhere", email: `${tag}-dup@example.test` })).status, 201);
    await prisma.franchisePartner.update({ where: { id: B.partner.id }, data: { attributionAllowed: false } });
    try {
      assert.equal((await call("POST", "/franchise-partner/invites", B.user, { name: "Paused Case", email: `${tag}-paused@example.test` })).body.code, "ATTRIBUTION_PAUSED");
    } finally {
      await prisma.franchisePartner.update({ where: { id: B.partner.id }, data: { attributionAllowed: true } });
    }
  });

  test("ownership: a franchise can't see, resend or cancel another franchise's invitations", async () => {
    const { id } = await invite(A.user, `${tag}-own@example.test`);
    const listB = await call("GET", "/franchise-partner/invites", B.user);
    assert.ok(!listB.body.invites.some((i: { id: string }) => i.id === id));
    assert.equal((await call("POST", `/franchise-partner/invites/${id}/resend`, B.user)).status, 404);
    assert.equal((await call("POST", `/franchise-partner/invites/${id}/cancel`, B.user)).status, 404);
    assert.equal((await inviteRow(id)).status, "OPEN");
    for (const who of [people.adm, null]) assert.notEqual((await call("GET", "/franchise-partner/invites", who)).status, 200);
  });

  test("resend: 15-minute gap, rotated link (the old one dies), at most 5 sends, re-opens an expired invitation", async () => {
    const { id } = await invite(A.user, `${tag}-resend@example.test`);
    const soon = await call("POST", `/franchise-partner/invites/${id}/resend`, A.user);
    assert.deepEqual([soon.status, soon.body.code], [429, "TOO_SOON"]);
    // An invitation sent a day ago (inserted directly: the guard allows new OPEN rows).
    const oldToken = randomBytes(32).toString("base64url");
    const old = await prisma.franchiseStudentInvite.create({
      data: { partnerId: A.partner.id, inviteeName: "Old Invite", email: `${tag}-old@example.test`, tokenHash: hashToken(oldToken), expiresAt: new Date(Date.now() + DAY), createdAt: new Date(Date.now() - DAY), lastSentAt: new Date(Date.now() - DAY), createdById: A.user.id },
    });
    const ok = await call("POST", `/franchise-partner/invites/${old.id}/resend`, A.user);
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.body.invite.sendCount, 2);
    const fresh = tokenFromLastEmail(`${tag}-old@example.test`);
    assert.equal((await inviteRow(old.id)).tokenHash, hashToken(fresh));
    const viewer = await makeUser("viewer");
    assert.equal((await call("GET", `/franchise-invites/${oldToken}`, viewer)).status, 404, "the previous link no longer works");
    assert.equal((await call("GET", `/franchise-invites/${fresh}`, viewer)).status, 200);
    // Five sends at most.
    await prisma.$executeRaw`UPDATE "FranchiseStudentInvite" SET "sendCount" = 5, "lastSentAt" = "createdAt" WHERE "id" = ${old.id}`;
    const limit = await call("POST", `/franchise-partner/invites/${old.id}/resend`, A.user);
    assert.deepEqual([limit.status, limit.body.code], [409, "SEND_LIMIT"]);
    // Expired: listing marks it EXPIRED; a resend re-opens it with a new expiry.
    const exp = await prisma.franchiseStudentInvite.create({
      data: { partnerId: A.partner.id, inviteeName: "Expired Invite", email: `${tag}-exp@example.test`, tokenHash: hashToken(randomBytes(32).toString("base64url")), expiresAt: new Date(Date.now() - 1000), createdAt: new Date(Date.now() - 8 * DAY), lastSentAt: new Date(Date.now() - 8 * DAY), createdById: A.user.id },
    });
    const list = await call("GET", "/franchise-partner/invites", A.user);
    assert.equal(list.body.invites.find((i: { id: string }) => i.id === exp.id).status, "EXPIRED");
    const reopened = await call("POST", `/franchise-partner/invites/${exp.id}/resend`, A.user);
    assert.equal(reopened.status, 200, reopened.text);
    const row = await inviteRow(exp.id);
    assert.equal(row.status, "OPEN");
    assert.ok(row.expiresAt.getTime() > Date.now() + 6.9 * DAY);
    assert.equal(await prisma.auditLog.count({ where: { action: "FRANCHISE_INVITE_RESENT", target: { in: [old.id, exp.id] } } }), 2);
  });

  test("cancel: the link stops working; accepted or cancelled invitations can't be cancelled again", async () => {
    const email = `${tag}-cancel@example.test`;
    const { id, token } = await invite(A.user, email);
    const c = await call("POST", `/franchise-partner/invites/${id}/cancel`, A.user);
    assert.equal(c.body.invite.status, "REVOKED");
    assert.equal((await call("POST", `/franchise-partner/invites/${id}/cancel`, A.user)).body.code, "NOT_CANCELLABLE");
    const student = await makeUser("cancelled", { email });
    assert.equal((await accept(student, token)).body.code, "INVITE_REVOKED");
    assert.equal(await prisma.auditLog.count({ where: { action: "FRANCHISE_INVITE_CANCELLED", target: id } }), 1);
  });
});

describe("acceptance (the student's own account)", () => {
  test("the invited, verified account accepts: link created, invitation closed, both audited; the link can't be reused", async () => {
    const email = `${tag}-happy@example.test`;
    const { id, token } = await invite(A.user, email, "Happy Student");
    const student = await makeUser("happy", { email });
    const pv = await call("GET", `/franchise-invites/${token}`, student);
    assert.equal(pv.status, 200, pv.text);
    assert.deepEqual([pv.body.invite.status, pv.body.invite.emailMatches, pv.body.invite.franchise.code], ["OPEN", true, A.partner.franchiseCode]);
    assert.doesNotMatch(pv.text, /@example\.test/, "the preview never shows the invited address");
    const r = await accept(student, token);
    assert.equal(r.status, 200, r.text);
    const link = await prisma.franchiseStudent.findUniqueOrThrow({ where: { id: r.body.studentLinkId } });
    assert.deepEqual([link.partnerId, link.studentUserId, link.status, link.source, link.createdById], [A.partner.id, student.id, "ACTIVE", "INVITE_ACCEPTED", student.id]);
    const row = await inviteRow(id);
    assert.deepEqual([row.status, row.acceptedUserId, row.studentLinkId], ["ACCEPTED", student.id, link.id]);
    assert.equal(await prisma.auditLog.count({ where: { action: "FRANCHISE_INVITE_ACCEPTED", target: id } }), 1);
    assert.equal(await prisma.auditLog.count({ where: { action: "FRANCHISE_STUDENT_LINKED", target: link.id } }), 1);
    assert.equal((await accept(student, token)).body.code, "INVITE_ACCEPTED");
    // Nothing about the student's account, login or access changed.
    const u = await prisma.user.findUniqueOrThrow({ where: { id: student.id } });
    assert.equal(u.passwordHash, "x");
    assert.equal(u.role, "USER");
  });

  test("refusals: signed out, wrong account, unverified, admin, partner, already linked, expired, bad links, unavailable franchise", async () => {
    const mk = async (label: string) => {
      const email = `${tag}-${label}@example.test`;
      return { email, ...(await invite(A.user, email)) };
    };
    // signed out
    const s0 = await mk("anon");
    assert.equal((await accept(null, s0.token)).status, 401);
    // a different account: refused, audited, invitation still open
    const s1 = await mk("mismatch");
    const other = await makeUser("someoneElse");
    const m = await accept(other, s1.token);
    assert.deepEqual([m.status, m.body.code], [403, "EMAIL_MISMATCH"]);
    assert.equal((await call("GET", `/franchise-invites/${s1.token}`, other)).body.invite.emailMatches, false);
    assert.equal(await prisma.auditLog.count({ where: { action: "FRANCHISE_INVITE_EMAIL_MISMATCH", target: s1.id, actorId: other.id } }), 1);
    assert.equal((await inviteRow(s1.id)).status, "OPEN");
    // unverified email
    const s2 = await mk("unverified");
    assert.equal((await accept(await makeUser("unverified", { email: s2.email, verified: false }), s2.token)).body.code, "EMAIL_NOT_VERIFIED");
    // admin account with the invited email
    const s3 = await mk("adminacct");
    assert.equal((await accept(await makeUser("adminacct", { email: s3.email, role: "ADMIN" }), s3.token)).body.code, "NOT_A_STUDENT_ACCOUNT");
    // a franchise partner can't join another franchise
    const s4 = await call("POST", "/franchise-partner/invites", A.user, { name: "Partner B", email: B.user.email });
    assert.equal((await accept(B.user, tokenFromLastEmail(B.user.email.toLowerCase()))).body.code, "PARTNERS_CANNOT_JOIN");
    assert.equal(s4.status, 201);
    // already linked to another franchise
    const email5 = `${tag}-twice@example.test`;
    const fromB = await invite(B.user, email5);
    const fromA = await invite(A.user, email5);
    const twice = await makeUser("twice", { email: email5 });
    assert.equal((await accept(twice, fromB.token)).status, 200);
    assert.equal((await accept(twice, fromA.token)).body.code, "ALREADY_LINKED");
    // expired: refused with 410 and recorded as EXPIRED
    const expToken = randomBytes(32).toString("base64url");
    const expired = await prisma.franchiseStudentInvite.create({
      data: { partnerId: A.partner.id, inviteeName: "Expired One", email: `${tag}-expired2@example.test`, tokenHash: hashToken(expToken), expiresAt: new Date(Date.now() - 1000), createdAt: new Date(Date.now() - 8 * DAY), lastSentAt: new Date(Date.now() - 8 * DAY), createdById: A.user.id },
    });
    const ex = await accept(await makeUser("expired2", { email: `${tag}-expired2@example.test` }), expToken);
    assert.deepEqual([ex.status, ex.body.code], [410, "INVITE_EXPIRED"]);
    assert.equal((await inviteRow(expired.id)).status, "EXPIRED");
    // malformed and unknown links
    const anyone = await makeUser("anyone");
    assert.equal((await accept(anyone, "not-a-token")).status, 404);
    assert.equal((await accept(anyone, randomBytes(32).toString("base64url"))).status, 404);
    // the franchise is suspended → no new students
    const s9 = await mk("suspended");
    await prisma.franchisePartner.update({ where: { id: A.partner.id }, data: { status: "SUSPENDED", suspendedAt: new Date() } });
    try {
      assert.equal((await accept(await makeUser("suspended", { email: s9.email }), s9.token)).body.code, "FRANCHISE_UNAVAILABLE");
    } finally {
      await prisma.franchisePartner.update({ where: { id: A.partner.id }, data: { status: "ACTIVE", suspendedAt: null } });
    }
  });

  test("concurrency: one student accepting two franchises' invitations at once gets exactly one link", async () => {
    const E = await makePartner("partnerE");
    const email = `${tag}-race@example.test`;
    const a = await invite(E.user, email);
    const b = await invite(B.user, email);
    const student = await makeUser("race", { email });
    const results = await Promise.all([accept(student, a.token), accept(student, b.token)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409], JSON.stringify(results.map((r) => r.body)));
    assert.equal(await prisma.franchiseStudent.count({ where: { studentUserId: student.id, status: "ACTIVE" } }), 1);
    const same = await invite(E.user, `${tag}-race2@example.test`);
    const s2 = await makeUser("race2", { email: `${tag}-race2@example.test` });
    const both = await Promise.all([accept(s2, same.token), accept(s2, same.token)]);
    assert.deepEqual(both.map((r) => r.status).sort(), [200, 409]);
  });
});

describe("own students (no cross-franchise access)", () => {
  let C: Awaited<ReturnType<typeof makePartner>>;
  before(async () => {
    C = await makePartner("partnerC");
  });

  test("each franchise lists only its own students, without contact details", async () => {
    const email = `${tag}-listed@example.test`;
    const { token } = await invite(C.user, email, "Listed Student");
    const student = await makeUser("listed", { email });
    const link = (await accept(student, token)).body.studentLinkId;
    const la = await call("GET", "/franchise-partner/students", C.user);
    assert.ok(la.body.students.some((s: { id: string }) => s.id === link));
    assert.doesNotMatch(la.text, /@example\.test|"mobile"|"email"/);
    const lb = await call("GET", "/franchise-partner/students", B.user);
    assert.ok(!lb.body.students.some((s: { id: string }) => s.id === link));
    const search = await call("GET", "/franchise-partner/students?q=listed", C.user);
    assert.deepEqual(search.body.students.map((s: { id: string }) => s.id), [link]);
  });

  test("detail: own student only (IDOR → 404), ended links hidden, every view audited", async () => {
    const email = `${tag}-detail@example.test`;
    const { token } = await invite(C.user, email, "Detail Student");
    const student = await makeUser("detail", { email });
    const link = (await accept(student, token)).body.studentLinkId;
    const d = await call("GET", `/franchise-partner/students/${link}`, C.user);
    assert.equal(d.status, 200, d.text);
    assert.equal(d.body.student.name, "detail");
    assert.ok(Array.isArray(d.body.student.courses));
    assert.doesNotMatch(d.text, /@example\.test|passwordHash|amount/i);
    assert.equal(await prisma.auditLog.count({ where: { action: "FRANCHISE_STUDENT_VIEWED", target: link, actorId: C.user.id } }), 1);
    for (const who of [A.user, B.user]) assert.equal((await call("GET", `/franchise-partner/students/${link}`, who)).status, 404, "another franchise gets a plain 404");
    assert.equal((await call("GET", `/franchise-partner/students/${student.id}`, C.user)).status, 404, "a user id is not a link id");
    assert.equal((await call("GET", "/franchise-partner/students/does-not-exist", C.user)).status, 404);
    assert.equal((await call("GET", `/franchise-partner/students/${link}`, student)).status, 403, "students can't use the partner API");
    assert.equal((await call("GET", `/franchise-partner/students/${link}`, people.adm)).status, 403, "admins can't use the partner API");
    await prisma.franchiseStudent.update({ where: { id: link }, data: { status: "ENDED", endsAt: new Date(), endReason: "test" } });
    assert.equal((await call("GET", `/franchise-partner/students/${link}`, C.user)).status, 404, "ended links are hidden");
  });
});

describe("rate limit", () => {
  test("a franchise can send at most 20 invitations an hour", async () => {
    const D = await makePartner("partnerD");
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) statuses.push((await call("POST", "/franchise-partner/invites", D.user, { name: `Bulk Student ${i}`, email: `${tag}-bulk${i}@example.test` })).status);
    assert.deepEqual(statuses.slice(0, 20), Array(20).fill(201));
    assert.equal(statuses[20], 429);
  });
});

describe("database guards", () => {
  test("identity is immutable, ACCEPTED is final, early expiry and deletion are refused, one open invitation per email", async () => {
    const G = await makePartner("partnerG");
    const email = `${tag}-guard@example.test`;
    const { id } = await invite(G.user, email);
    await assert.rejects(prisma.franchiseStudentInvite.update({ where: { id }, data: { email: `${tag}-other@example.test` } }), /immutable/);
    await assert.rejects(prisma.franchiseStudentInvite.update({ where: { id }, data: { partnerId: B.partner.id } }), /immutable/);
    await assert.rejects(prisma.franchiseStudentInvite.update({ where: { id }, data: { status: "EXPIRED" } }), /not expired yet/);
    await assert.rejects(prisma.franchiseStudentInvite.delete({ where: { id } }), /cannot be deleted/);
    await assert.rejects(
      prisma.franchiseStudentInvite.create({ data: { partnerId: G.partner.id, inviteeName: "Second Open", email, tokenHash: hashToken(randomBytes(32).toString("base64url")), expiresAt: new Date(Date.now() + DAY), createdById: A.user.id } }),
      (e: { code?: string }) => e.code === "P2002"
    );
    await assert.rejects(
      prisma.franchiseStudentInvite.create({ data: { partnerId: A.partner.id, inviteeName: "Born Accepted", email: `${tag}-born@example.test`, tokenHash: hashToken(randomBytes(32).toString("base64url")), expiresAt: new Date(Date.now() + DAY), status: "ACCEPTED", createdById: A.user.id } }),
      /start OPEN|accepted_recorded/
    );
    const accepted = await prisma.franchiseStudentInvite.findFirstOrThrow({ where: { partnerId: A.partner.id, status: "ACCEPTED" } });
    await assert.rejects(prisma.franchiseStudentInvite.update({ where: { id: accepted.id }, data: { status: "OPEN" } }), /final/);
  });
});
