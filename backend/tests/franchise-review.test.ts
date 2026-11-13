/**
 * Franchise Phase 5A: admin application review — list/search, audited detail, create-only notes and
 * the review status transitions — through the real HTTP API against the local database.
 * Emails are captured (never sent): the real email module is wrapped and its sendEmail recorded.
 * Applications are seeded directly; everything is prefixed "zz-test-" and removed afterwards.
 */
import "./local-db-guard.js"; // first: refuses to run against a non-local (production) database
// These tests exercise the public/applicant franchise API, which is dark (404) unless switched on.
process.env.FRANCHISE_PUBLIC_ENABLED = "true";
import { after, before, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomBytes } from "node:crypto";

const realEmail = await import("../src/services/email.service.js");
const sent: { to: string; subject: string; html: string }[] = [];
let failNextEmail = false;
mock.module("../src/services/email.service.js", {
  namedExports: {
    ...realEmail,
    sendEmail: async (m: { to: string; subject: string; html: string }) => {
      if (failNextEmail) {
        failNextEmail = false;
        throw new Error("simulated provider outage");
      }
      sent.push(m);
    },
  },
});

const { createApp } = await import("../src/app.js");
const { prisma } = await import("../src/config/prisma.js");
const { signSessionToken } = await import("../src/utils/tokens.js");

const tag = `zz-test-${randomBytes(4).toString("hex")}`;
const short = tag.slice(-6).toUpperCase();
let server: Server;
let base = "";
const userIds: string[] = [];
type U = { id: string; token: string; email: string };
const people: Record<string, U> = {};
const loc = { stateId: "", d1: "", d2: "", d3: "", dHeld: "", dOff: "" };
let seq = 0;

async function makeUser(name: string, role: "USER" | "ADMIN" = "USER") {
  const u = await prisma.user.create({
    data: { name, email: `${tag}-${name}@example.test`, username: `${tag}-${name}`, passwordHash: "x", referralCode: `R${short}${userIds.length}`, role, emailVerified: new Date() },
  });
  userIds.push(u.id);
  people[name] = { id: u.id, email: u.email, token: signSessionToken({ id: u.id, name, email: u.email, role, referralCode: u.referralCode }, u.passwordHash) };
  return people[name];
}

/** A submitted application for a fresh applicant (one open application per account). */
/** A district in a fresh test state (state-level rules: each conflict scenario gets its own state). */
async function districtInNewState(label: string, isActive = true) {
  const s = await prisma.indiaState.create({ data: { name: `${tag} ${label} State`, isActive: true } });
  return (await prisma.district.create({ data: { stateId: s.id, name: `${tag} ${label}`, isActive } })).id;
}
const stateOf = async (districtId: string) => (await prisma.district.findUniqueOrThrow({ where: { id: districtId } })).stateId;

async function makeApp(districtId: string, label = "app") {
  const n = ++seq;
  const user = await makeUser(`${label}${n}`);
  const app = await prisma.franchiseApplication.create({
    data: {
      applicationNo: `ZZ-${short}-${String(n).padStart(4, "0")}`,
      userId: user.id,
      applicantName: `Applicant ${label} ${n}`,
      mobile: `9${String(700000000 + n)}`,
      email: user.email,
      stateId: (await prisma.district.findUniqueOrThrow({ where: { id: districtId } })).stateId,
      districtId,
      address: `${n}, Test Street, Test Town`,
      requiredDocumentKinds: ["ID_PROOF"],
      refundPolicyVersion: 1,
      refundPolicyText: "test-only refund text",
      refundPolicySha256: "a".repeat(64),
      history: { create: { toStatus: "APPLICATION_SUBMITTED", actorId: user.id, actorType: "APPLICANT", applicantNote: "Application submitted" } },
    },
  });
  return { app, user };
}

async function call(method: string, path: string, user: U | null, body?: unknown) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { ...(user ? { Authorization: `Bearer ${user.token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text, headers: res.headers };
}
const A = "/admin/franchise/applications";
const move = (admin: U, id: string, body: Record<string, unknown>) => call("POST", `${A}/${id}/transition`, admin, body);
const version = async (id: string) => (await prisma.franchiseApplication.findUniqueOrThrow({ where: { id } })).version;

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await makeUser("admA", "ADMIN");
  await makeUser("admB", "ADMIN");
  await makeUser("plain");
  const st = await prisma.indiaState.create({ data: { name: `${tag} State`, isActive: true } });
  loc.stateId = st.id;
  for (const key of ["d1", "d2", "d3"] as const) {
    loc[key] = (await prisma.district.create({ data: { stateId: st.id, name: `${tag} ${key}`, isActive: true } })).id;
  }
  // One franchise per state: the held and the disabled districts each live in their own state.
  for (const key of ["dHeld", "dOff"] as const) loc[key] = await districtInNewState(key, key !== "dOff");
});

after(async () => {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL eta.financial_maintenance = 'on'`; // test cleanup only (logged)
      await tx.$executeRaw`SET LOCAL eta.maintenance_reason = 'franchise-review test cleanup'`;
      const apps = (await tx.franchiseApplication.findMany({ where: { userId: { in: userIds } }, select: { id: true } })).map((a) => a.id);
      const districts = (await tx.district.findMany({ where: { name: { startsWith: tag } }, select: { id: true } })).map((d) => d.id);
      await tx.districtAllocationEvent.deleteMany({ where: { districtId: { in: districts } } });
      await tx.districtAllocation.deleteMany({ where: { districtId: { in: districts } } });
      await tx.stateAllocationEvent.deleteMany({ where: { state: { name: { startsWith: tag } } } });
      await tx.stateAllocation.deleteMany({ where: { state: { name: { startsWith: tag } } } });
      await tx.franchiseNotification.deleteMany({ where: { applicationId: { in: apps } } });
      await tx.franchiseApplicationNote.deleteMany({ where: { applicationId: { in: apps } } });
      await tx.franchiseApplicationStatusHistory.deleteMany({ where: { applicationId: { in: apps } } });
      await tx.franchiseApplication.deleteMany({ where: { id: { in: apps } } });
      await tx.district.deleteMany({ where: { id: { in: districts } } });
      await tx.indiaState.deleteMany({ where: { name: { startsWith: tag } } });
      await tx.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { target: { in: apps } }] } });
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
    });
  } finally {
    server.close();
  }
});

describe("access control", () => {
  test("customers and signed-out callers are refused on every review route", async () => {
    const { app } = await makeApp(loc.d3, "acl");
    const routes: [string, string, unknown?][] = [
      ["GET", A],
      ["GET", `${A}/summary`],
      ["GET", `${A}/${app.id}`],
      ["POST", `${A}/${app.id}/transition`, { to: "UNDER_REVIEW", expectedVersion: 0 }],
      ["POST", `${A}/${app.id}/notes`, { body: "x" }],
    ];
    for (const [method, path, body] of routes) {
      assert.equal((await call(method, path, people.plain, body)).status, 403, `${method} ${path} as a customer`);
      assert.equal((await call(method, path, null, body)).status, 401, `${method} ${path} signed out`);
    }
    assert.equal((await prisma.franchiseApplication.findUniqueOrThrow({ where: { id: app.id } })).status, "APPLICATION_SUBMITTED");
  });

  test("a demoted admin's old token can neither read applicants' data nor act", async () => {
    const { app } = await makeApp(loc.d3, "demote");
    const exAdmin = await makeUser("exadmin", "ADMIN");
    await prisma.user.update({ where: { id: exAdmin.id }, data: { role: "USER" } });
    for (const [method, path, body] of [["GET", A], ["GET", `${A}/summary`], ["GET", `${A}/${app.id}`], ["POST", `${A}/${app.id}/transition`, { to: "UNDER_REVIEW", expectedVersion: 0 }], ["POST", `${A}/${app.id}/notes`, { body: "note" }]] as [string, string, unknown?][]) {
      assert.equal((await call(method, path, exAdmin, body)).status, 403, `${method} ${path}`);
    }
    assert.equal(await prisma.franchiseApplicationNote.count({ where: { applicationId: app.id } }), 0);
  });
});

describe("list, search and detail", () => {
  test("filters, search on number/name/email/mobile, pagination limits and minimal list fields", async () => {
    const one = await makeApp(loc.d1, "list");
    const two = await makeApp(loc.d2, "list");
    const r = await call("GET", `${A}?stateId=${loc.stateId}&pageSize=100`, people.admA);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.headers.get("cache-control"), "no-store");
    const ids = r.body.applications.map((a: { id: string }) => a.id);
    assert.ok(ids.includes(one.app.id) && ids.includes(two.app.id));
    assert.doesNotMatch(r.text, /@example\.test|Test Street|"mobile"|"email"|"address"/, "contact details only in the detail view");
    for (const q of [one.app.applicationNo, one.app.applicantName.toUpperCase(), one.user.email, one.app.mobile]) {
      const s = await call("GET", `${A}?q=${encodeURIComponent(q)}&stateId=${loc.stateId}`, people.admA);
      assert.deepEqual(s.body.applications.map((a: { id: string }) => a.id), [one.app.id], `search by ${q}`);
    }
    const byDistrict = await call("GET", `${A}?districtId=${loc.d2}`, people.admA);
    assert.ok(byDistrict.body.applications.every((a: { district: string }) => a.district === `${tag} d2`));
    const paged = await call("GET", `${A}?stateId=${loc.stateId}&pageSize=1&page=2`, people.admA);
    assert.equal(paged.body.applications.length, 1);
    assert.ok(paged.body.total >= 2);
    for (const bad of ["pageSize=101", "page=0", "status=NOT_A_STATUS", "from=2026-13", "q=" + "x".repeat(101)]) {
      assert.equal((await call("GET", `${A}?${bad}`, people.admA)).status, 400, bad);
    }
    const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    const dated = await call("GET", `${A}?stateId=${loc.stateId}&from=${today}&to=${today}&pageSize=100`, people.admA);
    assert.ok(dated.body.applications.some((a: { id: string }) => a.id === one.app.id), "IST day filter");
    const summary = await call("GET", `${A}/summary`, people.admA);
    assert.ok(summary.body.counts.APPLICATION_SUBMITTED >= 2);
  });

  test("detail shows the applicant, answers, documents metadata and history; every view is audited", async () => {
    const { app, user } = await makeApp(loc.d1, "detail");
    const r = await call("GET", `${A}/${app.id}`, people.admA);
    assert.equal(r.status, 200, r.text);
    const d = r.body.application;
    assert.equal(d.applicant.email, user.email);
    assert.equal(d.applicant.emailVerified, true);
    assert.deepEqual(d.allowedTransitions, ["UNDER_REVIEW", "REJECTED"]);
    assert.equal(d.history.length, 1);
    assert.equal(d.history[0].actorName, "Applicant");
    assert.doesNotMatch(r.text, /storageKey|franchise-applications\/|refundPolicyText/);
    assert.equal(await prisma.auditLog.count({ where: { action: "FRANCHISE_APPLICATION_VIEWED", target: app.id, actorId: people.admA.id } }), 1);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "FRANCHISE_APPLICATION_VIEWED", target: app.id } });
    assert.doesNotMatch(JSON.stringify(audit.metadata), /@|Test Street|Applicant/, "audit carries ids only");
    assert.equal((await call("GET", `${A}/does-not-exist`, people.admA)).status, 404);
  });
});

describe("status transitions", () => {
  test("submitted → under review → interview → approved: history, audit, version and applicant view", async () => {
    const { app, user } = await makeApp(loc.d1, "happy");
    const applicant = people[`happy${seq}`];
    sent.length = 0;
    let r = await move(people.admA, app.id, { to: "UNDER_REVIEW", expectedVersion: 0 });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.version, 1);
    r = await move(people.admA, app.id, { to: "INTERVIEW_DISCUSSION", expectedVersion: 1, applicantNote: "We'll call you on Monday.", internalNote: "Strong local network" });
    assert.equal(r.status, 200, r.text);
    r = await move(people.admB, app.id, { to: "APPROVED", expectedVersion: 2 });
    assert.equal(r.status, 200, r.text);
    const row = await prisma.franchiseApplication.findUniqueOrThrow({ where: { id: app.id }, include: { history: { orderBy: { createdAt: "asc" } } } });
    assert.deepEqual([row.status, row.version, row.approvedById], ["APPROVED", 3, people.admB.id]);
    assert.ok(row.approvedAt);
    assert.deepEqual(row.history.map((h) => [h.fromStatus, h.toStatus, h.actorType]), [
      [null, "APPLICATION_SUBMITTED", "APPLICANT"],
      ["APPLICATION_SUBMITTED", "UNDER_REVIEW", "ADMIN"],
      ["UNDER_REVIEW", "INTERVIEW_DISCUSSION", "ADMIN"],
      ["INTERVIEW_DISCUSSION", "APPROVED", "ADMIN"],
    ]);
    assert.equal(await prisma.auditLog.count({ where: { action: "FRANCHISE_APPLICATION_STATUS_CHANGED", target: app.id } }), 3);
    // No district allocation or reservation is created in this phase.
    assert.equal(await prisma.stateAllocation.count({ where: { stateId: loc.stateId } }), 0, "approval never reserves or closes the state by itself");
    // Applicant sees the status and the applicant note — never the internal note.
    const mine = await call("GET", "/franchise/applications/me", applicant);
    assert.equal(mine.body.application.status, "APPROVED");
    assert.ok(mine.body.application.timeline.some((t: { note: string | null }) => t.note === "We'll call you on Monday."));
    assert.doesNotMatch(mine.text, /Strong local network|internalNote/);
    // Emails: one per change, status + portal link only.
    assert.equal(sent.length, 3);
    assert.ok(sent.every((m) => m.to === user.email && m.subject.includes(app.applicationNo) && /\/franchise\/application/.test(m.html)));
    assert.match(sent[2].html, /Approved/);
    assert.ok(sent.every((m) => !/call you on Monday|Strong local network/.test(m.html)), "no notes in emails");
    const notes = await prisma.franchiseNotification.findMany({ where: { applicationId: app.id }, orderBy: { createdAt: "asc" } });
    assert.deepEqual(notes.map((n) => [n.kind, n.status]), [["STATUS_UNDER_REVIEW", "SENT"], ["STATUS_INTERVIEW_DISCUSSION", "SENT"], ["STATUS_APPROVED", "SENT"]]);
  });

  test("forbidden moves are refused and change nothing", async () => {
    const { app } = await makeApp(await districtInNewState("forbid"), "forbid"); // approves: its own state
    const expect = async (label: string, body: Record<string, unknown>, status: number, code?: string) => {
      const r = await move(people.admA, app.id, body);
      assert.equal(r.status, status, `${label}: ${r.text}`);
      if (code) assert.equal(r.body.code, code, label);
    };
    await expect("submitted → approved", { to: "APPROVED", expectedVersion: 0 }, 409, "INVALID_TRANSITION");
    await expect("submitted → interview", { to: "INTERVIEW_DISCUSSION", expectedVersion: 0 }, 409, "INVALID_TRANSITION");
    await expect("to a later-phase status", { to: "PAYMENT_PENDING", expectedVersion: 0 }, 400);
    await expect("to ACTIVE_FRANCHISE", { to: "ACTIVE_FRANCHISE", expectedVersion: 0 }, 400);
    await expect("unknown field", { to: "UNDER_REVIEW", expectedVersion: 0, status: "APPROVED" }, 400);
    await expect("missing version", { to: "UNDER_REVIEW" }, 400);
    assert.equal(await version(app.id), 0);
    // Approved can't be rejected (or moved) in this phase; rejected is final.
    await move(people.admA, app.id, { to: "UNDER_REVIEW", expectedVersion: 0 });
    await move(people.admA, app.id, { to: "APPROVED", expectedVersion: 1 });
    await expect("approved → rejected", { to: "REJECTED", expectedVersion: 2, rejectionReason: "Changed our mind about this one" }, 409, "INVALID_TRANSITION");
    await expect("approved → under review", { to: "UNDER_REVIEW", expectedVersion: 2 }, 409, "INVALID_TRANSITION");
    const { app: r2 } = await makeApp(loc.d3, "final");
    assert.equal((await move(people.admA, r2.id, { to: "REJECTED", expectedVersion: 0, rejectionReason: "Not enough local presence yet" })).status, 200);
    for (const to of ["UNDER_REVIEW", "INTERVIEW_DISCUSSION", "APPROVED"]) {
      assert.equal((await move(people.admA, r2.id, { to, expectedVersion: 1 })).body.code, "INVALID_TRANSITION", `rejected → ${to}`);
    }
  });

  test("stale versions are refused; two admins deciding at once — exactly one wins", async () => {
    const { app } = await makeApp(loc.d3, "race");
    assert.equal((await move(people.admA, app.id, { to: "UNDER_REVIEW", expectedVersion: 0 })).status, 200);
    const stale = await move(people.admB, app.id, { to: "REJECTED", expectedVersion: 0, rejectionReason: "Opened an old copy of the form" });
    assert.deepEqual([stale.status, stale.body.code], [409, "STALE"]);
    const results = await Promise.all([
      move(people.admA, app.id, { to: "INTERVIEW_DISCUSSION", expectedVersion: 1 }),
      move(people.admB, app.id, { to: "REJECTED", expectedVersion: 1, rejectionReason: "Second admin's decision at the same time" }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409], JSON.stringify(results.map((r) => r.body)));
    const row = await prisma.franchiseApplication.findUniqueOrThrow({ where: { id: app.id }, include: { history: true } });
    assert.equal(row.version, 2);
    assert.equal(row.history.length, 3, "one history row per accepted change");
  });

  test("rejection needs a 10–1000 character reason; the applicant sees it only after signing in", async () => {
    const { app } = await makeApp(loc.d2, "reject");
    const applicant = people[`reject${seq}`];
    for (const [label, body] of [
      ["no reason", { to: "REJECTED", expectedVersion: 0 }],
      ["short reason", { to: "REJECTED", expectedVersion: 0, rejectionReason: "too short" }],
      ["blank reason", { to: "REJECTED", expectedVersion: 0, rejectionReason: "          " }],
      ["long reason", { to: "REJECTED", expectedVersion: 0, rejectionReason: "x".repeat(1001) }],
      ["reason on a non-rejection", { to: "UNDER_REVIEW", expectedVersion: 0, rejectionReason: "This shouldn't be accepted" }],
    ] as [string, Record<string, unknown>][]) {
      assert.equal((await move(people.admA, app.id, body)).status, 400, label);
    }
    sent.length = 0;
    const reason = "We need applicants with an existing training space in the district.";
    const r = await move(people.admA, app.id, { to: "REJECTED", expectedVersion: 0, rejectionReason: reason, internalNote: "Checked twice" });
    assert.equal(r.status, 200, r.text);
    const row = await prisma.franchiseApplication.findUniqueOrThrow({ where: { id: app.id } });
    assert.equal(row.rejectionReason, reason);
    assert.ok(row.rejectedAt);
    const mine = await call("GET", "/franchise/applications/me", applicant);
    assert.equal(mine.body.application.rejectionReason, reason);
    assert.doesNotMatch(mine.text, /Checked twice/);
    assert.equal(sent.length, 1);
    assert.match(sent[0].html, /Not approved/);
    assert.ok(!sent[0].html.includes(reason) && !sent[0].subject.includes(reason), "the reason stays out of the email");
  });

  test("the database still refuses a rejection without a reason (bypassing the API)", async () => {
    const { app } = await makeApp(loc.d2, "dbcheck");
    await assert.rejects(prisma.franchiseApplication.update({ where: { id: app.id }, data: { status: "REJECTED" } }), /rejection_recorded|check constraint/i);
  });

  test("an email failure is recorded and never undoes the decision", async () => {
    const { app } = await makeApp(loc.d3, "mailfail");
    failNextEmail = true;
    const r = await move(people.admA, app.id, { to: "UNDER_REVIEW", expectedVersion: 0 });
    assert.equal(r.status, 200, r.text);
    assert.equal((await prisma.franchiseApplication.findUniqueOrThrow({ where: { id: app.id } })).status, "UNDER_REVIEW");
    const n = await prisma.franchiseNotification.findFirstOrThrow({ where: { applicationId: app.id } });
    assert.deepEqual([n.kind, n.status, n.error], ["STATUS_UNDER_REVIEW", "FAILED", "Error"]);
  });
});

describe("state rule on approval (approval never reserves or closes a state)", () => {
  const toReview = async (id: string) => assert.equal((await move(people.admA, id, { to: "UNDER_REVIEW", expectedVersion: 0 })).status, 200);

  test("a second approval for the same STATE is refused (even in another district); other states are unaffected", async () => {
    const district = await districtInNewState("solo");
    const sameState = (await prisma.district.create({ data: { stateId: await stateOf(district), name: `${tag} solo-2`, isActive: true } })).id;
    const a = await makeApp(district, "dupA");
    const b = await makeApp(sameState, "dupB");
    await toReview(a.app.id);
    await toReview(b.app.id);
    assert.equal((await move(people.admA, a.app.id, { to: "APPROVED", expectedVersion: 1 })).status, 200);
    const second = await move(people.admB, b.app.id, { to: "APPROVED", expectedVersion: 1 });
    assert.deepEqual([second.status, second.body.code], [409, "STATE_ALREADY_APPROVED"]);
    assert.match(second.body.error, new RegExp(a.app.applicationNo));
    const detail = await call("GET", `${A}/${b.app.id}`, people.admA);
    assert.equal(detail.body.application.territory.approvedApplicationNo, a.app.applicationNo);
    // B can still be rejected.
    assert.equal((await move(people.admB, b.app.id, { to: "REJECTED", expectedVersion: 1, rejectionReason: "State already has an approved partner." })).status, 200);
    assert.equal(await prisma.stateAllocation.count({ where: { stateId: await stateOf(district) } }), 0);
  });

  test("two approvals for one state at the same moment: exactly one wins (per-state lock)", async () => {
    const district = await districtInNewState("race");
    const apps = [await makeApp(district, "lockA"), await makeApp(district, "lockB"), await makeApp(district, "lockC")];
    for (const x of apps) await toReview(x.app.id);
    const results = await Promise.all(apps.map((x, i) => move(i % 2 ? people.admB : people.admA, x.app.id, { to: "APPROVED", expectedVersion: 1 })));
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409, 409], JSON.stringify(results.map((r) => r.body)));
    assert.ok(results.filter((r) => r.status === 409).every((r) => r.body.code === "STATE_ALREADY_APPROVED"));
    assert.equal(await prisma.franchiseApplication.count({ where: { districtId: district, status: "APPROVED" } }), 1);
  });

  test("a reserved state, or a disabled centre district, can't be approved", async () => {
    const held = await makeApp(loc.dHeld, "held");
    const holder = await makeApp(loc.dHeld, "holder");
    await prisma.stateAllocation.create({ data: { stateId: await stateOf(loc.dHeld), status: "RESERVED", reservedAt: new Date(), applicationId: holder.app.id, createdById: people.admA.id } });
    await toReview(held.app.id);
    const r1 = await move(people.admA, held.app.id, { to: "APPROVED", expectedVersion: 1 });
    assert.deepEqual([r1.status, r1.body.code], [409, "STATE_RESERVED"]);
    const off = await makeApp(loc.dOff, "off");
    await toReview(off.app.id);
    const r2 = await move(people.admA, off.app.id, { to: "APPROVED", expectedVersion: 1 });
    assert.deepEqual([r2.status, r2.body.code], [409, "LOCATION_DISABLED"]);
    assert.equal(await version(off.app.id), 1, "nothing changed");
  });
});

describe("internal notes", () => {
  test("create-only, audited, admin-only and never shown to the applicant", async () => {
    const { app } = await makeApp(loc.d1, "notes");
    const applicant = people[`notes${seq}`];
    assert.equal((await call("POST", `${A}/${app.id}/notes`, people.admA, { body: "" })).status, 400);
    assert.equal((await call("POST", `${A}/${app.id}/notes`, people.admA, { body: "x".repeat(2001) })).status, 400);
    const r = await call("POST", `${A}/${app.id}/notes`, people.admA, { body: "Called the applicant; documents look consistent." });
    assert.equal(r.status, 201, r.text);
    const note = await prisma.franchiseApplicationNote.findUniqueOrThrow({ where: { id: r.body.id } });
    assert.deepEqual([note.authorId, note.visibleToApplicant], [people.admA.id, false]);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "FRANCHISE_APPLICATION_NOTE_ADDED", target: app.id } });
    assert.doesNotMatch(JSON.stringify(audit.metadata), /documents look consistent/, "the audit records the note id, not its text");
    const detail = await call("GET", `${A}/${app.id}`, people.admB);
    assert.equal(detail.body.application.notes[0].author, "admA");
    for (const method of ["PATCH", "PUT", "DELETE"]) assert.equal((await call(method, `${A}/${app.id}/notes/${note.id}`, people.admA, method === "DELETE" ? undefined : { body: "edited" })).status, 404, `${method} has no route`);
    assert.equal((await call("POST", `${A}/does-not-exist/notes`, people.admA, { body: "note" })).status, 404);
    const mine = await call("GET", "/franchise/applications/me", applicant);
    assert.doesNotMatch(mine.text, /documents look consistent/);
  });
});
