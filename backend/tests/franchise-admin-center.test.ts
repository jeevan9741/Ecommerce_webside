/**
 * Franchise Management control centre (admin): overview built from real records, admin-only student
 * assignments (verified target, verified student, reason + actor audited, history kept), the franchise
 * audit history, partner support history, reservation expiry, and that activation stays unavailable.
 * Real HTTP API and local database; synthetic data only, everything prefixed "zz-test-".
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
import { NOT_IMPLEMENTED_MESSAGE } from "../src/services/franchise-admin.service.js";

const original = { partner: process.env.FRANCHISE_PARTNER_ENABLED, pub: process.env.FRANCHISE_PUBLIC_ENABLED };
const tag = `zz-test-${randomBytes(4).toString("hex")}`;
const short = tag.slice(-6).toUpperCase();
const DAY = 86_400_000;
let server: Server;
let base = "";
const userIds: string[] = [];
type U = { id: string; token: string };
const people: Record<string, U> = {};
let seq = 0;
const reason = "Agreed with both franchises and the student by phone.";
const A = "/admin/franchise";

async function makeUser(name: string, role: "USER" | "ADMIN" = "USER") {
  const u = await prisma.user.create({
    data: { name: `${tag} ${name}`, email: `${tag}-${name}@example.test`, username: `${tag}-${name}`, passwordHash: "x", referralCode: `C${short}${userIds.length}`, role, emailVerified: new Date(), phone: `9${String(810000000 + userIds.length)}` },
  });
  userIds.push(u.id);
  people[name] = { id: u.id, token: signSessionToken({ id: u.id, name: u.name, email: u.email, role, referralCode: u.referralCode }, u.passwordHash) };
  return people[name];
}
async function newState(label: string) {
  const s = await prisma.indiaState.create({ data: { name: `${tag} ${label} State`, isActive: true } });
  const d = await prisma.district.create({ data: { stateId: s.id, name: `${tag} ${label}`, isActive: true } });
  return { stateId: s.id, districtId: d.id };
}
async function makeApplication(user: U, loc: { stateId: string; districtId: string }, status: "APPROVED" | "ACTIVE_FRANCHISE") {
  const n = ++seq;
  return prisma.franchiseApplication.create({
    data: {
      applicationNo: `ZC-${short}-${String(n).padStart(4, "0")}`, userId: user.id, status, applicantName: `Applicant ${n}`, mobile: `9${String(710000000 + n)}`, email: `${tag}-app${n}@example.test`,
      stateId: loc.stateId, districtId: loc.districtId, address: `${n}, Test Street`, requiredDocumentKinds: ["ID_PROOF"],
    },
  });
}
async function makePartner(name: string, opts: { status?: FranchisePartnerStatus; allocated?: boolean } = {}) {
  const user = await makeUser(name);
  const loc = await newState(name);
  const app = await makeApplication(user, loc, "ACTIVE_FRANCHISE");
  const status = opts.status ?? "ACTIVE";
  const now = new Date();
  const partner = await prisma.franchisePartner.create({
    data: {
      userId: user.id, applicationId: app.id, franchiseCode: `FR-ZC${short}${seq}`, districtId: loc.districtId, status,
      agreementStartsAt: new Date(now.getTime() - DAY), agreementEndsAt: new Date(now.getTime() + 365 * DAY), ...(status === "SUSPENDED" ? { suspendedAt: now } : {}),
    },
  });
  if (opts.allocated !== false) {
    await prisma.stateAllocation.create({
      data: { stateId: loc.stateId, partnerId: partner.id, applicationId: app.id, status: status === "SUSPENDED" ? "SUSPENDED" : "ALLOCATED", allocatedAt: now, ...(status === "SUSPENDED" ? { suspendedAt: now } : {}), createdById: people.admA.id },
    });
  }
  return { user, partner, ...loc };
}
async function call(method: string, path: string, user: U | null, body?: unknown) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { ...(user ? { Authorization: `Bearer ${user.token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text };
}

const fx = {} as { A: Awaited<ReturnType<typeof makePartner>>; B: Awaited<ReturnType<typeof makePartner>>; S: Awaited<ReturnType<typeof makePartner>>; N: Awaited<ReturnType<typeof makePartner>>; linkA1: string; linkA2: string };

before(async () => {
  process.env.FRANCHISE_PARTNER_ENABLED = "true";
  process.env.FRANCHISE_PUBLIC_ENABLED = "true";
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await makeUser("admA", "ADMIN");
  await makeUser("admB", "ADMIN");
  await makeUser("admC", "ADMIN");
  fx.A = await makePartner("partnerA");
  fx.B = await makePartner("partnerB");
  fx.S = await makePartner("suspended", { status: "SUSPENDED" });
  fx.N = await makePartner("noAllocation", { allocated: false });
  const [s1, s2] = [await makeUser("student1"), await makeUser("student2")];
  await makeUser("plainStudent");
  fx.linkA1 = (await linkFixture(prisma, { partnerId: fx.A.partner.id, studentUserId: s1.id, status: "ACTIVE", source: "TEST", createdById: s1.id })).id;
  fx.linkA2 = (await linkFixture(prisma, { partnerId: fx.A.partner.id, studentUserId: s2.id, status: "ACTIVE", source: "TEST", createdById: s2.id })).id;
});

after(async () => {
  for (const [k, v] of [["FRANCHISE_PARTNER_ENABLED", original.partner], ["FRANCHISE_PUBLIC_ENABLED", original.pub]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL eta.financial_maintenance = 'on'`; // test cleanup only (logged)
      await tx.$executeRaw`SET LOCAL eta.maintenance_reason = 'franchise-admin-center test cleanup'`;
      const partners = (await tx.franchisePartner.findMany({ where: { userId: { in: userIds } }, select: { id: true } })).map((p) => p.id);
      const apps = (await tx.franchiseApplication.findMany({ where: { userId: { in: userIds } }, select: { id: true } })).map((a) => a.id);
      const tickets = (await tx.supportTicket.findMany({ where: { partnerId: { in: partners } }, select: { id: true } })).map((t) => t.id);
      await tx.supportTicketEvent.deleteMany({ where: { ticketId: { in: tickets } } });
      await tx.supportTicketMessage.deleteMany({ where: { ticketId: { in: tickets } } });
      await tx.supportTicket.deleteMany({ where: { id: { in: tickets } } });
      const allocations = (await tx.stateAllocation.findMany({ where: { state: { name: { startsWith: tag } } }, select: { id: true } })).map((a) => a.id);
      await tx.franchiseStudentInvite.deleteMany({ where: { partnerId: { in: partners } } });
      await tx.franchiseStudent.deleteMany({ where: { partnerId: { in: partners } } });
      await tx.adminApprovalRequest.deleteMany({ where: { requestedById: { in: userIds } } });
      await tx.stateAllocationEvent.deleteMany({ where: { state: { name: { startsWith: tag } } } });
      await tx.stateAllocation.deleteMany({ where: { state: { name: { startsWith: tag } } } });
      await tx.franchisePartnerEvent.deleteMany({ where: { partnerId: { in: partners } } });
      await tx.franchisePartner.deleteMany({ where: { id: { in: partners } } });
      await tx.franchiseNotification.deleteMany({ where: { applicationId: { in: apps } } });
      await tx.franchiseApplicationStatusHistory.deleteMany({ where: { applicationId: { in: apps } } });
      await tx.franchiseApplication.deleteMany({ where: { id: { in: apps } } });
      await tx.district.deleteMany({ where: { name: { startsWith: tag } } });
      await tx.indiaState.deleteMany({ where: { name: { startsWith: tag } } });
      await tx.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { target: { in: [...partners, ...apps, ...userIds, ...allocations] } }] } });
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
    });
  } finally {
    server.close();
  }
});

const ADMIN_READS = [`${A}/overview`, `${A}/student-assignments`, `${A}/student-assignment-requests`, `${A}/audit`];

describe("access", () => {
  test("admins can use every control-centre read; partners, students and anonymous callers can't", async () => {
    for (const path of [...ADMIN_READS, `${A}/partners/${fx.A.partner.id}/support`]) {
      assert.equal((await call("GET", path, people.admA)).status, 200, path);
      for (const u of [fx.A.user, fx.B.user, people.plainStudent, people.student1]) assert.equal((await call("GET", path, u)).status, 403, `${path} non-admin`);
      assert.equal((await call("GET", path, null)).status, 401, `${path} anonymous`);
    }
  });

  test("a demoted admin's still-valid token is refused (role re-read from the database)", async () => {
    const d = await makeUser("demoted", "ADMIN");
    await prisma.user.update({ where: { id: d.id }, data: { role: "USER" } });
    for (const path of ADMIN_READS) assert.equal((await call("GET", path, d)).status, 403, path);
    const r = await call("POST", `${A}/student-assignments/${fx.linkA2}/end-requests`, d, { expectedPartnerId: fx.A.partner.id, reason });
    assert.equal(r.status, 403);
    assert.equal((await call("POST", `${A}/student-assignments/${fx.linkA2}/reassign-requests`, d, { targetPartnerId: fx.B.partner.id, expectedPartnerId: fx.A.partner.id, reason })).status, 403);
  });
});

describe("overview", () => {
  test("every figure comes from the database; nothing invented", async () => {
    const r = await call("GET", `${A}/overview`, people.admA);
    assert.equal(r.status, 200, r.text);
    const o = r.body;
    assert.equal(o.states.total, await prisma.indiaState.count());
    assert.equal(o.states.available + o.states.reserved + o.states.closed, o.states.total);
    assert.ok(o.states.closed >= 3, "our three held states count as closed (A, B, suspended)");
    assert.equal(o.partners.active, await prisma.franchisePartner.count({ where: { status: "ACTIVE" } }));
    assert.equal(o.partners.suspended, await prisma.franchisePartner.count({ where: { status: "SUSPENDED" } }));
    assert.equal(o.applications.ACTIVE_FRANCHISE, await prisma.franchiseApplication.count({ where: { status: "ACTIVE_FRANCHISE" } }));
    assert.equal(o.tickets.open, await prisma.supportTicket.count({ where: { status: "OPEN" } }));
    assert.equal(o.pending.reopenRequests, await prisma.adminApprovalRequest.count({ where: { action: "STATE_RELEASE", status: "PENDING", expiresAt: { gt: new Date() } } }));
  });

  test("payment, agreement, e-sign and payouts are reported as not implemented — never as figures", async () => {
    const r = await call("GET", `${A}/overview`, people.admA);
    assert.deepEqual(r.body.systems.map((s: { key: string }) => s.key), ["feePayment", "agreement", "esign", "payouts"]);
    for (const s of r.body.systems) assert.deepEqual([s.available, s.message], [false, NOT_IMPLEMENTED_MESSAGE]);
    assert.doesNotMatch(JSON.stringify(r.body.systems), /InPaise|amount|paid|signed"/i);
  });
});

describe("activation stays unavailable", () => {
  test("there is no activation route for admins (approval alone never activates)", async () => {
    const app = await makeApplication(await makeUser("approvedOnly"), await newState("approvedOnly"), "APPROVED");
    for (const path of [`${A}/applications/${app.id}/activate`, `${A}/partners/activate`, `${A}/activate`]) {
      assert.equal((await call("POST", path, people.admA, { applicationId: app.id })).status, 404, path);
    }
    assert.equal(await prisma.franchisePartner.count({ where: { applicationId: app.id } }), 0);
    assert.equal(await prisma.stateAllocation.count({ where: { applicationId: app.id } }), 0, "approval reserves nothing");
  });
});

describe("reservation expiry", () => {
  test("an expired reservation no longer holds its state, and is released (audited) before a new one", async () => {
    const loc = await newState("expiry");
    const first = await makeApplication(await makeUser("expiryFirst"), loc, "APPROVED");
    const old = await prisma.stateAllocation.create({ data: { stateId: loc.stateId, status: "RESERVED", applicationId: first.id, reservedAt: new Date(Date.now() - 31 * DAY), reservedUntil: new Date(Date.now() - DAY), createdById: people.admA.id } });
    const pub = await call("GET", "/franchise/locations", null);
    assert.equal(pub.body.states.find((s: { id: string }) => s.id === loc.stateId)?.availability, "AVAILABLE", "expired = no longer reserved");
    // A live reservation still blocks: reserving for a second application releases the expired one first.
    const second = await makeApplication(await makeUser("expirySecond"), loc, "APPROVED");
    await prisma.franchiseApplication.update({ where: { id: first.id }, data: { status: "REJECTED", rejectionReason: "test", rejectedAt: new Date() } }); // one approval per state
    const r = await call("POST", `${A}/applications/${second.id}/reserve-state`, people.admB, { reason, days: 7 });
    assert.equal(r.status, 201, r.text);
    const expired = await prisma.stateAllocation.findUniqueOrThrow({ where: { id: old.id } });
    assert.deepEqual([expired.status, expired.releaseReason], ["RELEASED", "Reservation expired"]);
    assert.equal(await prisma.auditLog.count({ where: { action: "FRANCHISE_STATE_RESERVATION_EXPIRED", target: old.id } }), 1);
    const pub2 = await call("GET", "/franchise/locations", null);
    assert.equal(pub2.body.states.find((s: { id: string }) => s.id === loc.stateId)?.availability, "RESERVED");
  });
});

describe("student assignments (two-admin reassignment and end)", () => {
  const R = `${A}/student-assignment-requests`;
  const ask = (who: U, linkId: string, body: Record<string, unknown>) => call("POST", `${A}/student-assignments/${linkId}/reassign-requests`, who, body);

  test("the list shows name and account email only — no phone, password hash or documents", async () => {
    const r = await call("GET", `${A}/student-assignments?partnerId=${fx.A.partner.id}`, people.admA);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.total, 2);
    assert.doesNotMatch(r.text, /passwordHash|"phone"|address|storageKey/);
  });

  test("the old one-admin reassign route no longer exists, and there is no admin 'add student' route", async () => {
    assert.equal((await call("POST", `${A}/student-assignments/${fx.linkA1}/reassign`, people.admA, { targetPartnerId: fx.B.partner.id, expectedPartnerId: fx.A.partner.id, reason })).status, 404);
    for (const path of [`${A}/student-assignments`, `${A}/partners/${fx.A.partner.id}/students`]) {
      assert.equal((await call("POST", path, people.admA, { partnerId: fx.A.partner.id, studentUserId: people.plainStudent.id, reason })).status, 404, path);
    }
    assert.equal(await prisma.franchiseStudent.count({ where: { studentUserId: people.plainStudent.id } }), 0);
  });

  test("a request needs a reason, the current partner, and an active target that holds its state", async () => {
    const cases: [Record<string, unknown>, number, string?][] = [
      [{ targetPartnerId: fx.B.partner.id, expectedPartnerId: fx.A.partner.id }, 400],
      [{ targetPartnerId: fx.B.partner.id, expectedPartnerId: fx.A.partner.id, reason: "short" }, 400],
      [{ targetPartnerId: fx.A.partner.id, expectedPartnerId: fx.A.partner.id, reason }, 400, "SAME_PARTNER"],
      [{ targetPartnerId: fx.B.partner.id, expectedPartnerId: fx.N.partner.id, reason }, 409, "STALE"],
      [{ targetPartnerId: fx.S.partner.id, expectedPartnerId: fx.A.partner.id, reason }, 409, "TARGET_NOT_ACTIVE"],
      [{ targetPartnerId: fx.N.partner.id, expectedPartnerId: fx.A.partner.id, reason }, 409, "TARGET_NOT_ALLOCATED"],
      [{ targetPartnerId: "does-not-exist", expectedPartnerId: fx.A.partner.id, reason }, 404, "TARGET_NOT_FOUND"],
      [{ targetPartnerId: fx.B.partner.id, expectedPartnerId: fx.A.partner.id, reason, extra: "x" }, 400],
    ];
    for (const [body, status, code] of cases) {
      const r = await ask(people.admA, fx.linkA1, body);
      assert.equal(r.status, status, `${JSON.stringify(body)} → ${r.text}`);
      if (code) assert.equal(r.body.code, code);
    }
    assert.equal(await prisma.adminApprovalRequest.count({ where: { action: "STUDENT_REASSIGN", targetId: fx.linkA1 } }), 0, "no request was created");
  });

  test("partners and students can't request, approve, reject or end anything", async () => {
    for (const u of [fx.A.user, fx.B.user, people.student1]) {
      assert.equal((await ask(u, fx.linkA1, { targetPartnerId: fx.B.partner.id, expectedPartnerId: fx.A.partner.id, reason })).status, 403);
      assert.equal((await call("GET", R, u)).status, 403);
      assert.equal((await call("POST", `${A}/student-assignments/${fx.linkA1}/end-requests`, u, { expectedPartnerId: fx.A.partner.id, reason })).status, 403);
    }
  });

  test("one admin requests; nothing moves until a DIFFERENT admin approves the exact request", async () => {
    const req = await ask(people.admA, fx.linkA1, { targetPartnerId: fx.B.partner.id, expectedPartnerId: fx.A.partner.id, reason });
    assert.equal(req.status, 201, req.text);
    const id = req.body.request.id;
    const sha = req.body.request.payloadSha256;
    assert.equal((await prisma.franchiseStudent.findUniqueOrThrow({ where: { id: fx.linkA1 } })).status, "ACTIVE", "a request moves nothing");
    assert.equal((await call("GET", `/franchise-partner/students/${fx.linkA1}`, fx.A.user)).status, 200, "A still sees its student");
    assert.equal((await ask(people.admB, fx.linkA1, { targetPartnerId: fx.B.partner.id, expectedPartnerId: fx.A.partner.id, reason })).body.code, "REQUEST_EXISTS", "one open request per student");
    // Self-approval, a partner, a student and a wrong payload are all refused.
    const self = await call("POST", `${R}/${id}/approve`, people.admA, { expectedPayloadSha: sha });
    assert.deepEqual([self.status, self.body.code], [403, "SAME_ADMIN"]);
    for (const u of [fx.A.user, fx.B.user, people.student1]) assert.equal((await call("POST", `${R}/${id}/approve`, u, { expectedPayloadSha: sha })).status, 403);
    assert.equal((await call("POST", `${R}/${id}/approve`, people.admB, { expectedPayloadSha: "0".repeat(64) })).body.code, "PAYLOAD_MISMATCH");
    assert.equal((await call("POST", `${R}/${id}/reject`, people.admA, {})).body.code, "SAME_ADMIN", "the requester can't reject (only cancel)");
    assert.equal((await call("POST", `${R}/${id}/cancel`, people.admB, {})).body.code, "NOT_REQUESTER");
    // The second admin approves.
    const ok = await call("POST", `${R}/${id}/approve`, people.admB, { expectedPayloadSha: sha });
    assert.equal(ok.status, 200, ok.text);
    const old = await prisma.franchiseStudent.findUniqueOrThrow({ where: { id: fx.linkA1 } });
    assert.equal(old.status, "ENDED");
    assert.match(old.endReason ?? "", /two-admin request/);
    const now = await prisma.franchiseStudent.findUniqueOrThrow({ where: { id: ok.body.newLinkId } });
    assert.deepEqual([now.partnerId, now.status, now.source, now.approvalRequestId, now.createdById], [fx.B.partner.id, "ACTIVE", "ADMIN_REASSIGNMENT", id, people.admB.id]);
    const row = await prisma.adminApprovalRequest.findUniqueOrThrow({ where: { id } });
    assert.deepEqual([row.status, row.requestedById, row.decidedById, row.openKey], ["EXECUTED", people.admA.id, people.admB.id, null]);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "FRANCHISE_STUDENT_REASSIGNED", target: people.student1.id } });
    const meta = audit.metadata as { requestedById: string; approvedById: string; reason: string };
    assert.deepEqual([audit.actorId, meta.requestedById, meta.approvedById, meta.reason], [people.admB.id, people.admA.id, people.admB.id, reason]);
    assert.equal(await prisma.auditLog.count({ where: { action: "FRANCHISE_STUDENT_REASSIGN_REQUESTED", actorId: people.admA.id, target: people.student1.id } }), 1);
    // Visibility follows ownership.
    assert.equal((await call("GET", `/franchise-partner/students/${fx.linkA1}`, fx.A.user)).status, 404, "A no longer sees the student");
    assert.match((await call("GET", "/franchise-partner/students", fx.B.user)).text, new RegExp(`${tag} student1`));
    assert.doesNotMatch((await call("GET", "/franchise-partner/students", fx.A.user)).text, new RegExp(`${tag} student1`));
    assert.equal((await call("POST", `${R}/${id}/approve`, people.admB, { expectedPayloadSha: sha })).body.code, "NOT_PENDING", "can't be replayed");
  });

  test("approval re-checks everything: a target suspended after the request can't receive the student", async () => {
    const t = await makePartner("laterSuspended");
    const req = await ask(people.admA, fx.linkA2, { targetPartnerId: t.partner.id, expectedPartnerId: fx.A.partner.id, reason });
    assert.equal(req.status, 201, req.text);
    await prisma.franchisePartner.update({ where: { id: t.partner.id }, data: { status: "SUSPENDED", suspendedAt: new Date() } });
    const r = await call("POST", `${R}/${req.body.request.id}/approve`, people.admB, { expectedPayloadSha: req.body.request.payloadSha256 });
    assert.deepEqual([r.status, r.body.code], [409, "TARGET_NOT_ACTIVE"]);
    assert.equal((await prisma.franchiseStudent.findUniqueOrThrow({ where: { id: fx.linkA2 } })).partnerId, fx.A.partner.id, "nothing moved");
    const rej = await call("POST", `${R}/${req.body.request.id}/reject`, people.admB, { note: "Target suspended" });
    assert.equal(rej.status, 200, rej.text);
    assert.equal(await prisma.auditLog.count({ where: { action: "FRANCHISE_STUDENT_REASSIGN_REJECTED", actorId: people.admB.id } }), 1);
  });

  test("a demoted approver is refused (role re-read in the database)", async () => {
    const req = await ask(people.admA, fx.linkA2, { targetPartnerId: fx.B.partner.id, expectedPartnerId: fx.A.partner.id, reason });
    assert.equal(req.status, 201, req.text);
    const d = await makeUser("demotedApprover", "ADMIN");
    await prisma.user.update({ where: { id: d.id }, data: { role: "USER" } });
    assert.equal((await call("POST", `${R}/${req.body.request.id}/approve`, d, { expectedPayloadSha: req.body.request.payloadSha256 })).status, 403);
    assert.equal((await call("POST", `${R}/${req.body.request.id}/cancel`, people.admA, {})).status, 200, "the requester cancels");
    assert.equal((await prisma.franchiseStudent.findUniqueOrThrow({ where: { id: fx.linkA2 } })).status, "ACTIVE");
  });

  test("the database refuses a reassigned link without an approved two-admin request, and keeps links immutable", async () => {
    const plain = people.plainStudent.id;
    await assert.rejects(
      prisma.franchiseStudent.create({ data: { partnerId: fx.B.partner.id, studentUserId: plain, status: "ACTIVE", source: "ADMIN_REASSIGNMENT", createdById: people.admA.id } }),
      /FranchiseStudent_reassignment_approved/
    );
    const pending = await ask(people.admA, fx.linkA2, { targetPartnerId: fx.B.partner.id, expectedPartnerId: fx.A.partner.id, reason });
    await assert.rejects(
      prisma.franchiseStudent.create({ data: { partnerId: fx.B.partner.id, studentUserId: people.student2.id, status: "ACTIVE", source: "ADMIN_REASSIGNMENT", approvalRequestId: pending.body.request.id, createdById: people.admA.id } }),
      /needs an approved two-admin/,
      "a PENDING request isn't enough"
    );
    await call("POST", `${R}/${pending.body.request.id}/cancel`, people.admA, {});
    await assert.rejects(prisma.franchiseStudent.update({ where: { id: fx.linkA2 }, data: { partnerId: fx.B.partner.id } }), /never change/);
    await assert.rejects(prisma.franchiseStudent.update({ where: { id: fx.linkA1 }, data: { status: "ACTIVE", endsAt: null } }), /final/);
    await assert.rejects(prisma.franchiseStudent.delete({ where: { id: fx.linkA2 } }), /never deleted/);
  });

  test("ending an assignment needs two admins: a request with a reason, then a different admin's approval", async () => {
    const E = (who: U, body: Record<string, unknown>) => call("POST", `${A}/student-assignments/${fx.linkA2}/end-requests`, who, body);
    assert.equal((await call("POST", `${A}/student-assignments/${fx.linkA2}/end`, people.admA, { expectedPartnerId: fx.A.partner.id, reason })).status, 404, "the one-admin end route is gone");
    assert.equal((await E(people.admA, { expectedPartnerId: fx.A.partner.id })).status, 400, "a reason is mandatory");
    assert.equal((await E(people.admA, { expectedPartnerId: fx.A.partner.id, reason: "short" })).status, 400);
    const req = await E(people.admA, { expectedPartnerId: fx.A.partner.id, reason });
    assert.equal(req.status, 201, req.text);
    const id = req.body.request.id;
    const sha = req.body.request.payloadSha256;
    assert.equal((await prisma.franchiseStudent.findUniqueOrThrow({ where: { id: fx.linkA2 } })).status, "ACTIVE", "a request ends nothing");
    // The database refuses to end the link without an APPROVED two-admin request (pending isn't enough).
    const endNow = { status: "ENDED" as const, endsAt: new Date(), endReason: "direct" };
    await assert.rejects(prisma.franchiseStudent.update({ where: { id: fx.linkA2 }, data: endNow }), /needs an approved two-admin request/);
    await assert.rejects(prisma.franchiseStudent.update({ where: { id: fx.linkA2 }, data: { ...endNow, endApprovalRequestId: id } }), /needs an approved two-admin request/);
    // Same admin, partners, students and a demoted admin can't approve.
    const self = await call("POST", `${R}/${id}/approve`, people.admA, { expectedPayloadSha: sha });
    assert.deepEqual([self.status, self.body.code], [403, "SAME_ADMIN"]);
    for (const u of [fx.A.user, fx.B.user, people.student2]) assert.equal((await call("POST", `${R}/${id}/approve`, u, { expectedPayloadSha: sha })).status, 403);
    const demoted = await makeUser("demotedEnder", "ADMIN");
    await prisma.user.update({ where: { id: demoted.id }, data: { role: "USER" } });
    assert.equal((await call("POST", `${R}/${id}/approve`, demoted, { expectedPayloadSha: sha })).status, 403);
    // A different admin approves.
    const ok = await call("POST", `${R}/${id}/approve`, people.admB, { expectedPayloadSha: sha });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.body.kind, "END");
    const link = await prisma.franchiseStudent.findUniqueOrThrow({ where: { id: fx.linkA2 } });
    assert.deepEqual([link.status, link.endApprovalRequestId], ["ENDED", id]);
    const row = await prisma.adminApprovalRequest.findUniqueOrThrow({ where: { id } });
    assert.deepEqual([row.status, row.requestedById, row.decidedById], ["EXECUTED", people.admA.id, people.admB.id]);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "FRANCHISE_STUDENT_ASSIGNMENT_ENDED", target: people.student2.id } });
    const meta = audit.metadata as { requestedById: string; approvedById: string; reason: string };
    assert.deepEqual([audit.actorId, meta.requestedById, meta.approvedById, meta.reason], [people.admB.id, people.admA.id, people.admB.id, reason]);
    assert.equal(await prisma.auditLog.count({ where: { action: "FRANCHISE_STUDENT_END_REQUESTED", actorId: people.admA.id, target: people.student2.id } }), 1);
    assert.equal((await call("POST", `${R}/${id}/approve`, people.admB, { expectedPayloadSha: sha })).body.code, "NOT_PENDING", "no replay");
    assert.equal((await E(people.admA, { expectedPartnerId: fx.A.partner.id, reason })).body.code, "NOT_ACTIVE");
    assert.equal((await call("GET", "/franchise-partner/students", fx.A.user)).text.includes(`${tag} student2`), false, "the old franchise no longer sees the student");
  });

  test("concurrency: a reassignment and an end can't both be pending; racing approvals by two admins — exactly one wins", async () => {
    const s = await makeUser("raceStudent");
    const linkId = (await linkFixture(prisma, { partnerId: fx.A.partner.id, studentUserId: s.id, status: "ACTIVE", source: "TEST", createdById: s.id })).id;
    const [r1, r2] = await Promise.all([
      call("POST", `${A}/student-assignments/${linkId}/reassign-requests`, people.admA, { targetPartnerId: fx.B.partner.id, expectedPartnerId: fx.A.partner.id, reason }),
      call("POST", `${A}/student-assignments/${linkId}/end-requests`, people.admB, { expectedPartnerId: fx.A.partner.id, reason }),
    ]);
    assert.deepEqual([r1.status, r2.status].sort(), [201, 409], JSON.stringify([r1.body, r2.body]));
    const loser = r1.status === 409 ? r1 : r2;
    assert.equal(loser.body.code, "REQUEST_EXISTS");
    const won = r1.status === 201 ? { res: r1, by: people.admA } : { res: r2, by: people.admB };
    const approvers = [people.admA, people.admB, people.admC].filter((a) => a.id !== won.by.id);
    const results = await Promise.all(approvers.map((a) => call("POST", `${R}/${won.res.body.request.id}/approve`, a, { expectedPayloadSha: won.res.body.request.payloadSha256 })));
    assert.equal(results.filter((r) => r.status === 200).length, 1, JSON.stringify(results.map((r) => r.body)));
    assert.ok(results.filter((r) => r.status !== 200).every((r) => r.body.code === "NOT_PENDING"));
    assert.equal(await prisma.franchiseStudent.count({ where: { studentUserId: s.id, status: "ACTIVE" } }), r1.status === 201 ? 1 : 0);
    assert.equal((await prisma.franchiseStudent.findUniqueOrThrow({ where: { id: linkId } })).endApprovalRequestId, won.res.body.request.id);
  });
});

describe("invitation provenance (database)", () => {
  async function invite(partner: { id: string }, owner: U, email: string) {
    return prisma.franchiseStudentInvite.create({ data: { partnerId: partner.id, inviteeName: "Test Invitee", email, tokenHash: randomBytes(32).toString("hex"), expiresAt: new Date(Date.now() + DAY), createdById: owner.id } });
  }
  /** Creates an INVITE_ACCEPTED link and accepts an invitation pointing at it, in one transaction (as the API does). */
  const acceptInTx = (link: { partnerId: string; studentUserId: string }, inv: { id: string } | null, acceptedUserId?: string) =>
    prisma.$transaction(async (tx) => {
      const l = await tx.franchiseStudent.create({ data: { ...link, status: "ACTIVE", source: "INVITE_ACCEPTED", createdById: link.studentUserId } });
      if (inv) await tx.franchiseStudentInvite.update({ where: { id: inv.id }, data: { status: "ACCEPTED", acceptedAt: new Date(), acceptedUserId: acceptedUserId ?? link.studentUserId, studentLinkId: l.id } });
      return l;
    });

  test("a student link claiming an invitation is refused unless a matching invitation was genuinely accepted", async () => {
    const [s1, s2, s3, s4, s5] = [await makeUser("prov1"), await makeUser("prov2"), await makeUser("prov3"), await makeUser("prov4"), await makeUser("prov5")];
    const email = (n: string) => `${tag}-${n}@example.test`;
    // No invitation at all.
    await assert.rejects(acceptInTx({ partnerId: fx.A.partner.id, studentUserId: s1.id }, null), /no accepted invitation/);
    // An invitation from another franchise.
    await assert.rejects(acceptInTx({ partnerId: fx.A.partner.id, studentUserId: s2.id }, await invite(fx.B.partner, fx.B.user, email("prov2"))), /no accepted invitation/);
    // Accepted by someone else.
    await assert.rejects(acceptInTx({ partnerId: fx.A.partner.id, studentUserId: s3.id }, await invite(fx.A.partner, fx.A.user, email("prov3")), s4.id), /no accepted invitation/);
    // Sent to a different email address.
    await assert.rejects(acceptInTx({ partnerId: fx.A.partner.id, studentUserId: s4.id }, await invite(fx.A.partner, fx.A.user, `${tag}-someone-else@example.test`)), /no accepted invitation/);
    // An ordinary source that isn't an invitation or a two-admin reassignment.
    await assert.rejects(prisma.franchiseStudent.create({ data: { partnerId: fx.A.partner.id, studentUserId: s5.id, status: "ACTIVE", source: "ADMIN_ADDED", createdById: people.admA.id } }), /accepted invitation or a two-admin reassignment/);
    await assert.rejects(prisma.franchiseStudent.create({ data: { partnerId: fx.A.partner.id, studentUserId: s5.id, status: "ENDED", endsAt: new Date(), source: "INVITE_ACCEPTED", createdById: s5.id } }), /start ACTIVE/);
    assert.equal(await prisma.franchiseStudent.count({ where: { studentUserId: { in: [s1.id, s2.id, s3.id, s4.id, s5.id] } } }), 0, "every refused attempt rolled back");
    // The genuine case: this franchise's invitation, to this address, accepted by this student.
    const good = await acceptInTx({ partnerId: fx.A.partner.id, studentUserId: s5.id }, await invite(fx.A.partner, fx.A.user, email("prov5")));
    assert.equal((await prisma.franchiseStudent.findUniqueOrThrow({ where: { id: good.id } })).status, "ACTIVE");
  });
});

describe("append-only franchise audit trail", () => {
  test("franchise audit entries can't be edited or deleted outside logged maintenance; other entries are unaffected", async () => {
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "FRANCHISE_STUDENT_REASSIGNED", target: people.student1.id } });
    await assert.rejects(prisma.auditLog.update({ where: { id: entry.id }, data: { metadata: { reason: "edited" } } }), /append-only/);
    await assert.rejects(prisma.auditLog.update({ where: { id: entry.id }, data: { action: "OTHER_ACTION" } }), /append-only/);
    await assert.rejects(prisma.auditLog.delete({ where: { id: entry.id } }), /append-only/);
    await assert.rejects(prisma.auditLog.deleteMany({ where: { action: { startsWith: "FRANCHISE_" }, actorId: people.admA.id } }), /append-only/);
    const other = await prisma.auditLog.create({ data: { actorId: people.admA.id, action: "ZZ_TEST_NON_FRANCHISE", target: tag } });
    await assert.rejects(prisma.auditLog.update({ where: { id: other.id }, data: { action: "FRANCHISE_FORGED" } }), /append-only/, "can't be turned into a franchise entry");
    await prisma.auditLog.delete({ where: { id: other.id } });
    assert.equal(await prisma.auditLog.count({ where: { id: entry.id } }), 1);
  });
});

describe("audit history and support history", () => {
  test("the audit history lists franchise entries with actor, filters by action, and is admin-only", async () => {
    const r = await call("GET", `${A}/audit?action=FRANCHISE_STUDENT_REASSIGNED`, people.admA);
    assert.equal(r.status, 200, r.text);
    assert.ok(r.body.entries.length >= 1);
    assert.ok(r.body.entries.every((e: { action: string }) => e.action === "FRANCHISE_STUDENT_REASSIGNED"));
    assert.ok(r.body.entries.some((e: { actor: { name: string } | null }) => e.actor?.name === `${tag} admB`), "the approving admin");
    assert.ok(r.body.actions.includes("FRANCHISE_STUDENT_REASSIGNED"));
    assert.equal((await call("GET", `${A}/audit?action=drop table`, people.admA)).status, 400);
    const all = await call("GET", `${A}/audit`, people.admA);
    assert.ok(all.body.entries.every((e: { action: string }) => /^(FRANCHISE|POLICY)_/.test(e.action)), "only franchise and policy entries");
  });

  test("partner support history shows only that partner's tickets", async () => {
    const created = await call("POST", "/franchise-partner/tickets", fx.A.user, { subject: "Need help with a student login", category: "STUDENT", message: "Synthetic test ticket." });
    assert.equal(created.status, 201, created.text);
    const a = await call("GET", `${A}/partners/${fx.A.partner.id}/support`, people.admA);
    const b = await call("GET", `${A}/partners/${fx.B.partner.id}/support`, people.admA);
    assert.equal(a.body.tickets.length, 1);
    assert.equal(b.body.tickets.length, 0);
    assert.equal((await call("GET", `${A}/partners/does-not-exist/support`, people.admA)).status, 404);
  });
});

describe("existing controls still behave", () => {
  test("suspending a partner (existing one-admin action) blocks its dashboard and keeps its state closed", async () => {
    const p = await makePartner("toSuspend");
    assert.equal((await call("GET", "/franchise-partner/overview", p.user)).status, 200);
    const s = await call("POST", `${A}/partners/${p.partner.id}/suspend`, people.admA, { reason });
    assert.equal(s.status, 200, s.text);
    assert.equal((await call("GET", "/franchise-partner/overview", p.user)).body.code, "PARTNER_SUSPENDED");
    const pub = await call("GET", "/franchise/locations", null);
    assert.equal(pub.body.states.find((x: { id: string }) => x.id === p.stateId)?.availability, "CLOSED");
    const ov = await call("GET", `${A}/overview`, people.admA);
    assert.equal(ov.body.partners.suspended, await prisma.franchisePartner.count({ where: { status: "SUSPENDED" } }));
  });
});

describe("who can do what: escalation, self-service and unavailable financial controls", () => {
  test("nobody can raise their own role or approve their own lifecycle change", async () => {
    // A partner (an ordinary USER account) can't make itself an admin through its own profile update.
    const me = await call("PATCH", "/me", fx.B.user, { role: "ADMIN", name: `${tag} partnerB` });
    assert.ok([200, 400].includes(me.status), me.text);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: fx.B.user.id } })).role, "USER");
    // A partner can't request or approve its own reinstatement/deactivation, nor suspend another.
    for (const [method, path, body] of [
      ["POST", `${A}/partners/${fx.B.partner.id}/requests`, { action: "REINSTATE", reason }],
      ["POST", `${A}/partners/${fx.A.partner.id}/suspend`, { reason }],
      ["POST", `${A}/partner-requests/anything/approve`, { expectedPayloadSha: "0".repeat(64) }],
      ["POST", `${A}/states/${fx.B.stateId}/reopen-requests`, { reason }],
    ] as const) {
      assert.equal((await call(method, path, fx.B.user, body)).status, 403, path);
    }
    // An admin can't approve their own request (checked for partner deactivation here; reopen and reassignment have their own tests).
    const req = await call("POST", `${A}/partners/${fx.S.partner.id}/requests`, people.admA, { action: "REINSTATE", reason });
    assert.equal(req.status, 201, req.text);
    const self = await call("POST", `${A}/partner-requests/${req.body.request.id}/approve`, people.admA, { expectedPayloadSha: req.body.request.payloadSha256 });
    assert.deepEqual([self.status, self.body.code], [403, "SAME_ADMIN"]);
    await call("POST", `${A}/partner-requests/${req.body.request.id}/cancel`, people.admA, {});
    // The database itself refuses a self-approved request.
    await assert.rejects(
      prisma.$transaction(async (tx) => {
        const r = await tx.adminApprovalRequest.create({ data: { action: "STUDENT_REASSIGN", targetType: "FranchiseStudent", targetId: `${tag}-x`, payload: {}, payloadSha256: "a".repeat(64), reason, openKey: `student-link:${tag}-x`, requestedById: people.admA.id, expiresAt: new Date(Date.now() + DAY) } });
        await tx.adminApprovalRequest.update({ where: { id: r.id }, data: { status: "APPROVED", decidedById: people.admA.id, decidedAt: new Date() } });
      }),
      /different admin/
    );
  });

  test("students reach only their own account: no partner or admin data, no one else's progress", async () => {
    const s = people.student2;
    const mine = await call("GET", "/me", s);
    assert.equal(mine.status, 200);
    assert.doesNotMatch(mine.text, new RegExp(`${tag} student1`));
    for (const path of ["/franchise-partner/students", "/franchise-partner/progress", `${A}/student-assignments`, `${A}/audit`, `/admin/franchise/applications`]) {
      assert.equal((await call("GET", path, s)).status, 403, path);
    }
  });

  test("admin financial and payment controls don't exist yet (no route to call)", async () => {
    for (const path of [`${A}/payouts`, `${A}/settlements`, `${A}/payments`, `${A}/ledger`, `${A}/earnings`, `${A}/applications/x/payment`, `${A}/applications/x/agreement`, `${A}/applications/x/activate`]) {
      assert.equal((await call("POST", path, people.admA, {})).status, 404, `POST ${path}`);
      assert.equal((await call("GET", path, people.admA)).status, 404, `GET ${path}`);
    }
  });
});
