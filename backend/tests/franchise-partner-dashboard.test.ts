/**
 * Franchise Partner dashboard: tenant isolation of the overview, students, course enrolments, learning
 * progress and earnings views — through the real HTTP API and local database. Two active partners (A
 * and B), each with their own synthetic students, prove that nothing of one partner ever reaches the
 * other, whatever ids, query parameters or headers the caller sends. Everything is prefixed "zz-test-".
 */
import "./local-db-guard.js"; // first: refuses to run against a non-local (production) database
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomBytes } from "node:crypto";
import type { FranchisePartnerStatus } from "@prisma/client";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { linkFixture } from "./franchise-fixtures.js";
import { signSessionToken } from "../src/utils/tokens.js";
import { EARNINGS_UNAVAILABLE_MESSAGE } from "../src/services/franchise-partner-dashboard.service.js";

const original = process.env.FRANCHISE_PARTNER_ENABLED;
const tag = `zz-test-${randomBytes(4).toString("hex")}`;
const short = tag.slice(-6).toUpperCase();
const DAY = 86_400_000;
let server: Server;
let base = "";
const userIds: string[] = [];
type U = { id: string; token: string };
const people: Record<string, U> = {};
const ids = { courses: [] as string[], orders: [] as string[], videos: [] as string[] };
let stateId = "";
let seq = 0;

async function makeUser(name: string, role: "USER" | "ADMIN" = "USER") {
  const u = await prisma.user.create({
    data: { name: `${tag} ${name}`, email: `${tag}-${name}@example.test`, username: `${tag}-${name}`, passwordHash: "x", referralCode: `D${short}${userIds.length}`, role, emailVerified: new Date(), phone: `9${String(800000000 + userIds.length)}` },
  });
  userIds.push(u.id);
  people[name] = { id: u.id, token: signSessionToken({ id: u.id, name: u.name, email: u.email, role, referralCode: u.referralCode }, u.passwordHash) };
  return people[name];
}
/** A district in its own test state (one franchise per state). */
const newDistrict = async (label: string) => {
  const s = await prisma.indiaState.create({ data: { name: `${tag} ${label} State`, isActive: true } });
  return (await prisma.district.create({ data: { stateId: s.id, name: `${tag} ${label}`, isActive: true } })).id;
};
const stateOf = async (districtId: string) => (await prisma.district.findUniqueOrThrow({ where: { id: districtId } })).stateId;
async function makeApplication(user: U, districtId: string, status: "APPROVED" | "ACTIVE_FRANCHISE") {
  const n = ++seq;
  return prisma.franchiseApplication.create({
    data: {
      applicationNo: `ZD-${short}-${String(n).padStart(4, "0")}`, userId: user.id, status, applicantName: `Partner ${n}`, mobile: `9${String(700000000 + n)}`, email: `${tag}-app${n}@example.test`,
      stateId: await stateOf(districtId), districtId, address: `${n}, Partner Street`, requiredDocumentKinds: ["ID_PROOF"], refundPolicyVersion: 1, refundPolicyText: "test-only refund text", refundPolicySha256: "a".repeat(64),
    },
  });
}
async function makePartner(name: string, opts: { status?: FranchisePartnerStatus; endsAt?: Date } = {}) {
  const user = await makeUser(name);
  const districtId = await newDistrict(name);
  const app = await makeApplication(user, districtId, "ACTIVE_FRANCHISE");
  const status = opts.status ?? "ACTIVE";
  const now = new Date();
  const partner = await prisma.franchisePartner.create({
    data: {
      userId: user.id, applicationId: app.id, franchiseCode: `FR-ZD${short}${seq}`, districtId, status,
      agreementStartsAt: new Date(now.getTime() - DAY), agreementEndsAt: opts.endsAt ?? new Date(now.getTime() + 365 * DAY),
      ...(status === "SUSPENDED" ? { suspendedAt: now } : {}),
    },
  });
  await prisma.stateAllocation.create({ data: { stateId: await stateOf(districtId), partnerId: partner.id, applicationId: app.id, status: "ALLOCATED", allocatedAt: now, createdById: people.admin.id } });
  return { user, partner };
}
async function link(partnerId: string, student: U, status: "ACTIVE" | "ENDED" = "ACTIVE") {
  return linkFixture(prisma, { partnerId, studentUserId: student.id, status, source: "TEST", createdById: student.id, ...(status === "ENDED" ? { endsAt: new Date(), endReason: "test" } : {}) });
}
async function enrol(student: U, courseId: string, revoked = false) {
  const order = await prisma.order.create({ data: { userId: student.id, courseId, amountInPaise: 100, status: "PAID", razorpayOrderId: `${tag}-order-${ids.orders.length}`, paidAt: new Date() } });
  ids.orders.push(order.id);
  return prisma.courseAccess.create({ data: { userId: student.id, courseId, orderId: order.id, ...(revoked ? { revokedAt: new Date() } : {}) } });
}
async function call(method: string, path: string, user: U | null, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}/api${path}`, { method, headers: { ...headers, ...(user ? { Authorization: `Bearer ${user.token}` } : {}) } });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text };
}
async function send(method: string, path: string, user: U | null, body: unknown) {
  const res = await fetch(`${base}/api${path}`, { method, headers: { "Content-Type": "application/json", ...(user ? { Authorization: `Bearer ${user.token}` } : {}) }, body: JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text };
}

const fx = {} as {
  A: { user: U; partner: { id: string } };
  B: { user: U; partner: { id: string } };
  linkA1: string; linkA2: string; linkB1: string; linkEnded: string;
  courseWithLessons: string; courseNoLessons: string;
};
const PARTNER_VIEWS = ["/franchise-partner/me", "/franchise-partner/overview", "/franchise-partner/students", "/franchise-partner/enrolments", "/franchise-partner/progress", "/franchise-partner/earnings", "/franchise-partner/tickets"];

before(async () => {
  process.env.FRANCHISE_PARTNER_ENABLED = "true";
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await makeUser("admin", "ADMIN");
  stateId = (await prisma.indiaState.create({ data: { name: `${tag} State`, isActive: true } })).id;

  fx.A = await makePartner("partnerA");
  fx.B = await makePartner("partnerB");
  const [sA1, sA2, sB1, sEnded] = [await makeUser("studentA1"), await makeUser("studentA2"), await makeUser("studentB1"), await makeUser("studentEnded")];
  await makeUser("plainStudent");

  const course = (slug: string) => prisma.course.create({ data: { slug: `${tag}-${slug}`, type: "VIDEO", title: `${tag} ${slug}`, shortDescription: "t", description: "t", priceInPaise: 499900, commissionInPaise: 99900 } });
  fx.courseWithLessons = (await course("lessons")).id;
  fx.courseNoLessons = (await course("empty")).id;
  ids.courses.push(fx.courseWithLessons, fx.courseNoLessons);
  for (const n of [1, 2]) {
    const v = await prisma.courseVideo.create({ data: { courseId: fx.courseWithLessons, title: `${tag} lesson ${n}`, storageKey: `${tag}/lesson-${n}.mp4`, sizeBytes: BigInt(1), displayOrder: n } });
    ids.videos.push(v.id);
  }

  fx.linkA1 = (await link(fx.A.partner.id, sA1)).id;
  fx.linkA2 = (await link(fx.A.partner.id, sA2)).id;
  fx.linkB1 = (await link(fx.B.partner.id, sB1)).id;
  fx.linkEnded = (await link(fx.A.partner.id, sEnded, "ENDED")).id;

  await enrol(sA1, fx.courseWithLessons);
  await enrol(sA1, fx.courseNoLessons);
  await enrol(sA2, fx.courseWithLessons, true); // revoked
  await enrol(sB1, fx.courseWithLessons);
  await enrol(sEnded, fx.courseWithLessons);
  // sA1 completed lesson 1 of 2; sB1 completed both.
  await prisma.videoProgress.create({ data: { userId: sA1.id, videoId: ids.videos[0], completed: true, completedAt: new Date(), positionSeconds: 60, maxPositionSeconds: 60 } });
  for (const v of ids.videos) await prisma.videoProgress.create({ data: { userId: sB1.id, videoId: v, completed: true, completedAt: new Date() } });
});

after(async () => {
  if (original === undefined) delete process.env.FRANCHISE_PARTNER_ENABLED;
  else process.env.FRANCHISE_PARTNER_ENABLED = original;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL eta.financial_maintenance = 'on'`; // test cleanup only (logged)
      await tx.$executeRaw`SET LOCAL eta.maintenance_reason = 'franchise-partner-dashboard test cleanup'`;
      const partners = (await tx.franchisePartner.findMany({ where: { userId: { in: userIds } }, select: { id: true } })).map((p) => p.id);
      const apps = (await tx.franchiseApplication.findMany({ where: { userId: { in: userIds } }, select: { id: true } })).map((a) => a.id);
      const districts = (await tx.district.findMany({ where: { name: { startsWith: tag } }, select: { id: true } })).map((d) => d.id);
      await tx.videoProgress.deleteMany({ where: { userId: { in: userIds } } });
      await tx.courseAccess.deleteMany({ where: { userId: { in: userIds } } });
      await tx.order.deleteMany({ where: { id: { in: ids.orders } } });
      await tx.courseVideo.deleteMany({ where: { id: { in: ids.videos } } });
      await tx.course.deleteMany({ where: { id: { in: ids.courses } } });
      await tx.franchiseStudent.deleteMany({ where: { partnerId: { in: partners } } });
      await tx.districtAllocationEvent.deleteMany({ where: { districtId: { in: districts } } });
      await tx.districtAllocation.deleteMany({ where: { districtId: { in: districts } } });
      // State-level exclusivity rows (guarded; removable only in logged maintenance mode).
      await tx.stateAllocationEvent.deleteMany({ where: { state: { name: { startsWith: tag } } } });
      await tx.stateAllocation.deleteMany({ where: { state: { name: { startsWith: tag } } } });
      await tx.franchisePartnerEvent.deleteMany({ where: { partnerId: { in: partners } } });
      await tx.franchisePartner.deleteMany({ where: { id: { in: partners } } });
      await tx.franchiseApplicationStatusHistory.deleteMany({ where: { applicationId: { in: apps } } });
      await tx.franchiseApplication.deleteMany({ where: { id: { in: apps } } });
      await tx.district.deleteMany({ where: { id: { in: districts } } });
      await tx.indiaState.deleteMany({ where: { name: { startsWith: tag } } });
      await tx.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { target: { in: partners } }] } });
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
    });
  } finally {
    server.close();
  }
});

/** Every response must stay free of contact, payment and account secrets. */
function assertNoSensitiveData(text: string, label: string) {
  for (const pattern of [/@example\.test/, /passwordHash/i, /"email"/i, /"phone"/i, /"mobile"/i, /razorpay/i, /"orderId"/i, /amountInPaise/i, /storageKey/i, /\b9[0-9]{9}\b/]) {
    assert.doesNotMatch(text, pattern, `${label}: ${pattern}`);
  }
}

describe("1–5: each partner sees only its own data", () => {
  test("1. Partner A sees its own students, with reference, status and course count", async () => {
    const r = await call("GET", "/franchise-partner/students", fx.A.user);
    assert.equal(r.status, 200, r.text);
    const byId = new Map(r.body.students.map((s: { id: string }) => [s.id, s]));
    assert.deepEqual([...byId.keys()].sort(), [fx.linkA1, fx.linkA2].sort(), "only A's ACTIVE links; the ENDED link is hidden");
    const a1 = byId.get(fx.linkA1) as { reference: string; status: string; enrolledCourses: number; name: string };
    assert.match(a1.reference, /^FS-[A-Z0-9]{8}$/);
    assert.equal(a1.status, "ACTIVE");
    assert.equal(a1.enrolledCourses, 2);
    assert.equal((byId.get(fx.linkA2) as { enrolledCourses: number }).enrolledCourses, 0, "a revoked access isn't counted");
    assertNoSensitiveData(r.text, "students");
  });

  test("2. Partner A cannot open Partner B's student (404), nor an ended link of its own", async () => {
    for (const id of [fx.linkB1, fx.linkEnded, people.studentB1.id, fx.B.partner.id]) {
      const r = await call("GET", `/franchise-partner/students/${id}`, fx.A.user);
      assert.equal(r.status, 404, `${id}: ${r.text}`);
      assert.doesNotMatch(r.text, /studentB1/);
    }
    assert.equal((await call("GET", `/franchise-partner/students/${fx.linkA1}`, fx.A.user)).status, 200, "its own still works");
  });

  test("3. Partner A's course enrolments exclude Partner B's", async () => {
    const a = await call("GET", "/franchise-partner/enrolments", fx.A.user);
    assert.equal(a.status, 200, a.text);
    assert.equal(a.body.total, 3, "sA1 ×2 and sA2's revoked one; nothing of B or of the ended link");
    assert.ok(a.body.enrolments.every((e: { studentLinkId: string }) => [fx.linkA1, fx.linkA2].includes(e.studentLinkId)));
    assert.doesNotMatch(a.text, /studentB1|studentEnded/);
    const revoked = a.body.enrolments.find((e: { studentLinkId: string }) => e.studentLinkId === fx.linkA2);
    assert.deepEqual([revoked.status, revoked.accessStatus], ["ENDED", "REVOKED"]);
    assertNoSensitiveData(a.text, "enrolments");
    const b = await call("GET", "/franchise-partner/enrolments", fx.B.user);
    assert.equal(b.body.total, 1);
    assert.equal(b.body.enrolments[0].studentLinkId, fx.linkB1);
  });

  test("4. Partner A's progress excludes Partner B's, and uses only real progress data", async () => {
    const a = await call("GET", "/franchise-partner/progress", fx.A.user);
    assert.equal(a.status, 200, a.text);
    assert.equal(a.body.total, 2, "active enrolments only (the revoked one is left out)");
    assert.doesNotMatch(a.text, /studentB1|studentEnded/);
    const withLessons = a.body.progress.find((p: { available: boolean }) => p.available);
    assert.deepEqual([withLessons.completedLessons, withLessons.totalLessons, withLessons.percent, withLessons.isComplete], [1, 2, 50, false]);
    assert.ok(withLessons.lastActivityAt, "last activity comes from the recorded player report");
    const empty = a.body.progress.find((p: { available: boolean }) => !p.available);
    assert.deepEqual([empty.completedLessons, empty.totalLessons, empty.percent, empty.isComplete], [null, null, null, null], "no lessons → no invented percentage");
    assertNoSensitiveData(a.text, "progress");
    const b = await call("GET", "/franchise-partner/progress", fx.B.user);
    assert.equal(b.body.progress[0].percent, 100);
  });

  test("5. Earnings: no authoritative records exist, so no figures — for A or B", async () => {
    for (const p of [fx.A, fx.B]) {
      const r = await call("GET", "/franchise-partner/earnings", p.user);
      assert.equal(r.status, 200, r.text);
      assert.equal(r.body.earnings.available, false);
      assert.equal(r.body.earnings.message, EARNINGS_UNAVAILABLE_MESSAGE);
      assert.doesNotMatch(r.text, /"(amount|total|balance|paid|payout)[A-Za-z]*"\s*:\s*\d/i, "no monetary figures");
    }
  });

  test("overview counts are A's own", async () => {
    const r = await call("GET", "/franchise-partner/overview", fx.A.user);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.students, 2);
    assert.deepEqual(r.body.enrolments, { active: 2, ended: 1 });
    assert.deepEqual(r.body.progress, { completed: 0, inProgress: 1, notStarted: 0, unavailable: 1, counted: 2, partial: false });
    assert.equal(r.body.earnings.available, false);
    const b = await call("GET", "/franchise-partner/overview", fx.B.user);
    assert.deepEqual([b.body.students, b.body.enrolments.active, b.body.progress.completed], [1, 1, 1]);
  });
});

describe("6–8: ids, parameters, headers, search and pagination can't cross partners", () => {
  test("6. Student ids in the request don't bypass ownership", async () => {
    for (const view of ["/franchise-partner/enrolments", "/franchise-partner/progress", "/franchise-partner/students"]) {
      const plain = await call("GET", view, fx.A.user);
      for (const q of [`?studentId=${people.studentB1.id}`, `?studentLinkId=${fx.linkB1}`, `?userId=${people.studentB1.id}`, `?id=${fx.linkB1}`]) {
        const r = await call("GET", view + q, fx.A.user);
        assert.equal(r.status, 200, r.text);
        assert.equal(r.body.total, plain.body.total, `${view}${q}`);
        assert.doesNotMatch(r.text, /studentB1/);
      }
    }
  });

  test("7. Partner ids in the query or headers are never used", async () => {
    for (const view of PARTNER_VIEWS) {
      const plain = await call("GET", view, fx.A.user);
      for (const [q, h] of [[`?partnerId=${fx.B.partner.id}`, {}], [`?franchiseId=${fx.B.partner.id}`, {}], ["", { "X-Partner-Id": fx.B.partner.id, "X-Franchise-Id": fx.B.partner.id }]] as const) {
        const r = await call("GET", view + q, fx.A.user, h);
        assert.equal(r.status, 200, `${view}${q}: ${r.text}`);
        assert.deepEqual(r.body, plain.body, `${view}${q} returns A's own data unchanged`);
      }
    }
  });

  test("8. Search and pagination never reveal another partner's records", async () => {
    for (const view of ["/franchise-partner/students", "/franchise-partner/enrolments", "/franchise-partner/progress"]) {
      const byName = await call("GET", `${view}?q=${encodeURIComponent("studentB1")}`, fx.A.user);
      assert.equal(byName.status, 200);
      assert.equal(byName.body.total, 0, `${view}: B's student isn't found by name`);
      const deep = await call("GET", `${view}?page=999`, fx.A.user);
      assert.equal(deep.status, 200);
      assert.doesNotMatch(deep.text, /studentB1/);
      assert.ok(((deep.body.students ?? deep.body.enrolments ?? deep.body.progress) as unknown[]).length === 0, `${view}: an empty page, not someone else's`);
    }
    const ownSearch = await call("GET", `/franchise-partner/enrolments?q=${encodeURIComponent("studentA1")}`, fx.A.user);
    assert.equal(ownSearch.body.total, 2);
    for (const bad of ["?page=0", "?page=-1", "?page=abc", `?q=${"x".repeat(101)}`]) {
      assert.equal((await call("GET", `/franchise-partner/enrolments${bad}`, fx.A.user)).status, 400, bad);
    }
  });
});

describe("9–13: who can reach what", () => {
  test("9. A suspended partner is refused on every view", async () => {
    const s = await makePartner("suspended", { status: "SUSPENDED" });
    for (const view of PARTNER_VIEWS) {
      const r = await call("GET", view, s.user);
      assert.equal(r.status, 403, `${view}: ${r.text}`);
      assert.equal(r.body.code, "PARTNER_SUSPENDED");
    }
  });

  test("10. An unapproved applicant (no partner record) and an expired agreement are refused", async () => {
    const applicant = await makeUser("applicantOnly");
    await makeApplication(applicant, await newDistrict("applicant"), "APPROVED");
    const expired = await makePartner("expired", { endsAt: new Date(Date.now() - 1000) });
    for (const view of PARTNER_VIEWS) {
      const a = await call("GET", view, applicant);
      assert.deepEqual([a.status, a.body.code], [403, "NOT_A_FRANCHISE_PARTNER"], `${view} applicant`);
      const e = await call("GET", view, expired.user);
      assert.deepEqual([e.status, e.body.code], [403, "AGREEMENT_ENDED"], `${view} expired`);
    }
  });

  test("11. Ordinary students (linked or not) and anonymous callers can't use partner APIs", async () => {
    for (const view of PARTNER_VIEWS) {
      for (const u of [people.plainStudent, people.studentA1]) assert.equal((await call("GET", view, u)).status, 403, `${view} student`);
      assert.equal((await call("GET", view, null)).status, 401, `${view} anonymous`);
    }
  });

  test("12. A partner can't reach admin APIs", async () => {
    for (const path of ["/admin/franchise/partners", "/admin/franchise/applications", "/admin/settings", "/admin/courses", `/admin/franchise/partners/${fx.B.partner.id}`]) {
      assert.equal((await call("GET", path, fx.A.user)).status, 403, path);
    }
  });

  test("13. Admin functions still work for admins, and an admin can't act as a partner", async () => {
    assert.equal((await call("GET", "/admin/franchise/partners", people.admin)).status, 200);
    assert.equal((await call("GET", `/admin/franchise/partners/${fx.A.partner.id}`, people.admin)).status, 200);
    for (const view of PARTNER_VIEWS) assert.equal((await call("GET", view, people.admin)).status, 403, view);
  });

  test("the partner switch OFF hides every dashboard view (plain 404), and it can be switched back", async () => {
    process.env.FRANCHISE_PARTNER_ENABLED = "false";
    try {
      for (const view of PARTNER_VIEWS) for (const u of [fx.A.user, people.admin, null]) assert.equal((await call("GET", view, u)).status, 404, view);
    } finally {
      process.env.FRANCHISE_PARTNER_ENABLED = "true";
    }
    assert.equal((await call("GET", "/franchise-partner/overview", fx.A.user)).status, 200);
  });
});

describe("14–18: profile, referral & earnings, and what partners can never change", () => {
  test("14. Franchise Profile shows only the partner's own franchise and state, never credentials", async () => {
    const a = await call("GET", `/franchise-partner/me?partnerId=${fx.B.partner.id}`, fx.A.user, { "X-Partner-Id": fx.B.partner.id });
    assert.equal(a.status, 200, a.text);
    const mine = await prisma.franchisePartner.findUniqueOrThrow({ where: { id: fx.A.partner.id }, include: { district: { include: { state: true } } } });
    assert.equal(a.body.partner.franchiseCode, mine.franchiseCode);
    assert.deepEqual([a.body.partner.territory.state, a.body.partner.territory.status], [mine.district.state.name, "ALLOCATED"]);
    const b = await call("GET", "/franchise-partner/me", fx.B.user);
    assert.notEqual(b.body.partner.franchiseCode, a.body.partner.franchiseCode);
    assert.notEqual(b.body.partner.territory.state, a.body.partner.territory.state);
    assert.doesNotMatch(a.text, /passwordHash|razorpay|payoutAccount|accountNumber|ifsc|"id":/i, "no credentials, payment details or internal ids");
  });

  test("15. Referral & Earnings: both unavailable, no figures of any kind", async () => {
    for (const p of [fx.A, fx.B]) {
      const r = await call("GET", "/franchise-partner/earnings", p.user);
      assert.deepEqual([r.body.earnings.available, r.body.earnings.referral.available], [false, false]);
      assert.doesNotMatch(JSON.stringify(r.body), /\d{3,}|InPaise|amount/i, "no amounts");
    }
  });

  test("16. A deactivated partner is refused on every view", async () => {
    const d = await makePartner("deactivated");
    await prisma.franchisePartner.update({ where: { id: d.partner.id }, data: { status: "DEACTIVATED", deactivatedAt: new Date() } });
    for (const view of PARTNER_VIEWS) {
      const r = await call("GET", view, d.user);
      assert.deepEqual([r.status, r.body.code], [403, "PARTNER_DEACTIVATED"], view);
    }
  });

  test("17. A partner can't change its own role, state, franchise or students", async () => {
    const before = await prisma.franchisePartner.findUniqueOrThrow({ where: { id: fx.A.partner.id } });
    const allocBefore = await prisma.stateAllocation.findMany({ where: { partnerId: fx.A.partner.id } });
    // The ordinary account update ignores role and every franchise field.
    const me = await send("PATCH", "/me", fx.A.user, { role: "ADMIN", franchisePartner: { status: "ACTIVE" }, stateId: stateId });
    assert.ok([200, 400].includes(me.status), me.text);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: fx.A.user.id } })).role, "USER");
    // No partner write route exists for the profile, the state or student ownership.
    for (const [method, path] of [["PATCH", "/franchise-partner/me"], ["PUT", "/franchise-partner/me"], ["POST", "/franchise-partner/state"], ["PATCH", `/franchise-partner/students/${fx.linkB1}`], ["POST", `/franchise-partner/students/${fx.linkB1}/transfer`]] as const) {
      assert.equal((await send(method, path, fx.A.user, { partnerId: fx.A.partner.id, stateId, status: "ACTIVE" })).status, 404, `${method} ${path}`);
    }
    // Admin-only controls are refused.
    for (const [method, path] of [["POST", `/admin/franchise/partners/${fx.A.partner.id}/suspend`], ["POST", `/admin/franchise/partners/${fx.B.partner.id}/requests`], ["POST", `/admin/franchise/states/${stateId}/reopen-requests`], ["POST", `/admin/franchise/applications/${(await prisma.franchisePartner.findUniqueOrThrow({ where: { id: fx.B.partner.id } })).applicationId}/reserve-state`]] as const) {
      assert.equal((await send(method, path, fx.A.user, { reason: "attempted by a partner", action: "DEACTIVATE", role: "ADMIN" })).status, 403, `${method} ${path}`);
    }
    const after = await prisma.franchisePartner.findUniqueOrThrow({ where: { id: fx.A.partner.id } });
    assert.deepEqual([after.status, after.districtId, after.franchiseCode], [before.status, before.districtId, before.franchiseCode]);
    assert.deepEqual(await prisma.stateAllocation.findMany({ where: { partnerId: fx.A.partner.id } }), allocBefore);
    assert.equal((await prisma.franchiseStudent.findUniqueOrThrow({ where: { id: fx.linkB1 } })).partnerId, fx.B.partner.id);
  });

  test("18. Ordinary students keep their own dashboard; partner links change nothing for them", async () => {
    const r = await call("GET", "/me", people.studentA1);
    assert.equal(r.status, 200, r.text);
    assert.doesNotMatch(r.text, /franchiseCode|FR-ZD/, "a student's own profile doesn't expose the franchise");
  });
});
