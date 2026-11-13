/**
 * Franchise Phase 5F-3: support tickets — through the real HTTP API and the local database. Emails are
 * captured (never sent). Covers the switch, creation and validation, ownership/IDOR, internal notes,
 * admin management, notifications, the status lifecycle, concurrency, rate limits and database guards.
 * Everything is prefixed "zz-test-".
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

async function makeUser(name: string, role: "USER" | "ADMIN" = "USER") {
  const u = await prisma.user.create({
    data: { name, email: `${tag}-${name}@example.test`.toLowerCase(), username: `${tag}-${name}`, passwordHash: "x", referralCode: `T${short}${userIds.length}`, role, emailVerified: new Date() },
  });
  userIds.push(u.id);
  people[name] = { id: u.id, email: u.email, token: signSessionToken({ id: u.id, name, email: u.email, role, referralCode: u.referralCode }, u.passwordHash) };
  return people[name];
}

async function makePartner(name: string) {
  const user = await makeUser(name);
  // One franchise per state: every test partner gets its own test state.
  const partnerStateId = (await prisma.indiaState.create({ data: { name: `${tag} ${name} State`, isActive: true } })).id;
  const districtId = (await prisma.district.create({ data: { stateId: partnerStateId, name: `${tag} ${name}`, isActive: true } })).id;
  const app = await prisma.franchiseApplication.create({
    data: {
      applicationNo: `ZT-${short}-${String(++seq).padStart(4, "0")}`, userId: user.id, status: "ACTIVE_FRANCHISE", applicantName: name, mobile: `9${String(400000000 + seq)}`,
      email: user.email, stateId: partnerStateId, districtId, address: "1, Test Street", requiredDocumentKinds: ["ID_PROOF"], refundPolicyVersion: 1, refundPolicyText: "test", refundPolicySha256: "a".repeat(64),
    },
  });
  const partner = await prisma.franchisePartner.create({
    data: { userId: user.id, applicationId: app.id, franchiseCode: `FR-ZT${short}${seq}`, districtId, status: "ACTIVE", agreementStartsAt: new Date(Date.now() - DAY), agreementEndsAt: new Date(Date.now() + 365 * DAY) },
  });
  await prisma.stateAllocation.create({ data: { stateId: partnerStateId, partnerId: partner.id, applicationId: app.id, status: "ALLOCATED", allocatedAt: new Date(), createdById: people.admA.id } });
  return { user, partner };
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
const PT = "/franchise-partner/tickets";
const AT = "/admin/franchise/tickets";
async function open(partner: U, over: Record<string, unknown> = {}) {
  const r = await call("POST", PT, partner, { subject: "Students can't see course videos", category: "TECHNICAL", message: "Since yesterday the player shows an error.", ...over });
  assert.equal(r.status, 201, r.text);
  return r.body.ticket as { id: string; ticketNo: string; status: string };
}
const row = (id: string) => prisma.supportTicket.findUniqueOrThrow({ where: { id } });

let A: Awaited<ReturnType<typeof makePartner>>;
let B: Awaited<ReturnType<typeof makePartner>>;

before(async () => {
  process.env.FRANCHISE_PARTNER_ENABLED = "true";
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await makeUser("admA", "ADMIN");
  await makeUser("admB", "ADMIN");
  await makeUser("student");
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
      await tx.$executeRaw`SET LOCAL eta.maintenance_reason = 'franchise-ticket test cleanup'`;
      const partners = (await tx.franchisePartner.findMany({ where: { userId: { in: userIds } }, select: { id: true } })).map((p) => p.id);
      const tickets = (await tx.supportTicket.findMany({ where: { partnerId: { in: partners } }, select: { id: true } })).map((t) => t.id);
      const apps = (await tx.franchiseApplication.findMany({ where: { userId: { in: userIds } }, select: { id: true } })).map((a) => a.id);
      const districts = (await tx.district.findMany({ where: { name: { startsWith: tag } }, select: { id: true } })).map((d) => d.id);
      await tx.supportTicketEvent.deleteMany({ where: { ticketId: { in: tickets } } });
      await tx.supportTicketMessage.deleteMany({ where: { ticketId: { in: tickets } } });
      await tx.supportTicket.deleteMany({ where: { id: { in: tickets } } });
      await tx.districtAllocation.deleteMany({ where: { districtId: { in: districts } } });
      // State-level exclusivity rows (guarded; removable only in logged maintenance mode).
      await tx.stateAllocationEvent.deleteMany({ where: { state: { name: { startsWith: tag } } } });
      await tx.stateAllocation.deleteMany({ where: { state: { name: { startsWith: tag } } } });
      await tx.franchisePartner.deleteMany({ where: { id: { in: partners } } });
      await tx.franchiseApplication.deleteMany({ where: { id: { in: apps } } });
      await tx.district.deleteMany({ where: { id: { in: districts } } });
      await tx.indiaState.deleteMany({ where: { name: { startsWith: tag } } });
      await tx.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { target: { in: [...partners, ...tickets] } }] } });
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
    });
  } finally {
    server.close();
  }
});

describe("partner switch", () => {
  test("OFF: partner ticket routes are plain 404s; the admin ticket desk still works", async () => {
    process.env.FRANCHISE_PARTNER_ENABLED = "false";
    try {
      for (const [m, p, b] of [["GET", PT], ["POST", PT, { subject: "Hello there", category: "OTHER", message: "x" }], ["GET", `${PT}/x`], ["POST", `${PT}/x/messages`, { body: "x" }]] as [string, string, unknown?][]) {
        assert.equal((await call(m, p, A.user, b)).status, 404, `${m} ${p}`);
      }
      assert.equal((await call("GET", AT, people.admA)).status, 200);
    } finally {
      process.env.FRANCHISE_PARTNER_ENABLED = "true";
    }
  });
});

describe("partner: create and own tickets", () => {
  test("create: number, status, first message, audit; every category accepted; validation", async () => {
    const t = await open(A.user);
    assert.match(t.ticketNo, new RegExp(`^FT-${new Date().getUTCFullYear()}-\\d{6}$`));
    const r = await row(t.id);
    assert.deepEqual([r.status, r.awaiting, r.partnerId, r.openedById, r.version], ["OPEN", "ETA", A.partner.id, A.user.id, 0]);
    const msgs = await prisma.supportTicketMessage.findMany({ where: { ticketId: t.id } });
    assert.deepEqual(msgs.map((m) => [m.authorRole, m.internal]), [["PARTNER", false]]);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "FRANCHISE_TICKET_CREATED", target: t.id } });
    assert.doesNotMatch(JSON.stringify(audit.metadata), /player shows an error/, "audit holds ids, not message text");
    for (const category of ["PAYMENT", "STUDENT", "COURSE", "OTHER"]) await open(B.user, { category, subject: `Question about ${category.toLowerCase()}` });
    for (const [label, b] of [
      ["unknown category", { subject: "Valid subject", category: "BILLING", message: "x" }],
      ["short subject", { subject: "Hey", category: "OTHER", message: "x" }],
      ["empty message", { subject: "Valid subject", category: "OTHER", message: "   " }],
      ["long message", { subject: "Valid subject", category: "OTHER", message: "x".repeat(5001) }],
      ["smuggled partner id", { subject: "Valid subject", category: "OTHER", message: "x", partnerId: B.partner.id }],
    ] as [string, unknown][]) {
      assert.equal((await call("POST", PT, A.user, b)).status, 400, label);
    }
  });

  test("ownership: another franchise can't list, read, reply to or close a ticket (404); non-partners are refused", async () => {
    const t = await open(A.user, { subject: "Private to franchise A" });
    const listB = await call("GET", PT, B.user);
    assert.ok(!listB.body.tickets.some((x: { id: string }) => x.id === t.id));
    assert.equal((await call("GET", `${PT}/${t.id}`, B.user)).status, 404);
    assert.equal((await call("POST", `${PT}/${t.id}/messages`, B.user, { body: "sneaky" })).status, 404);
    assert.equal((await call("POST", `${PT}/${t.id}/close`, B.user, { expectedVersion: 0 })).status, 404);
    assert.equal(await prisma.supportTicketMessage.count({ where: { ticketId: t.id } }), 1, "nothing was written");
    for (const who of [people.student, people.admA]) assert.equal((await call("GET", `${PT}/${t.id}`, who)).status, 403);
    assert.equal((await call("GET", `${PT}/${t.id}`, null)).status, 401);
    assert.equal((await call("GET", `${PT}/does-not-exist`, A.user)).status, 404);
  });
});

describe("admin desk", () => {
  test("customers, partners and demoted admins can't use the admin ticket routes", async () => {
    const t = await open(A.user, { subject: "Admin route access check" });
    const ex = await makeUser("exAdmin", "ADMIN");
    await prisma.user.update({ where: { id: ex.id }, data: { role: "USER" } });
    for (const [m, p, b] of [["GET", AT], ["GET", `${AT}/${t.id}`], ["POST", `${AT}/${t.id}/messages`, { body: "x" }], ["POST", `${AT}/${t.id}/status`, { to: "CLOSED", expectedVersion: 0 }]] as [string, string, unknown?][]) {
      for (const who of [people.student, A.user, ex]) assert.equal((await call(m, p, who, b)).status, 403, `${m} ${p}`);
    }
    assert.equal((await row(t.id)).status, "OPEN");
  });

  test("admins see every franchise's tickets with filters; viewing a ticket is audited", async () => {
    const a = await open(A.user, { subject: "Filter me technical", category: "TECHNICAL" });
    const b = await open(B.user, { subject: "Filter me payment", category: "PAYMENT" });
    const all = await call("GET", `${AT}?q=Filter%20me`, people.admA);
    assert.deepEqual(new Set(all.body.tickets.map((t: { id: string }) => t.id)), new Set([a.id, b.id]));
    assert.ok(all.body.awaitingEta >= 2);
    const pay = await call("GET", `${AT}?q=Filter%20me&category=PAYMENT`, people.admA);
    assert.deepEqual(pay.body.tickets.map((t: { id: string }) => t.id), [b.id]);
    const byCode = await call("GET", `${AT}?q=${encodeURIComponent(A.partner.franchiseCode)}`, people.admA);
    assert.ok(byCode.body.tickets.every((t: { franchiseCode: string }) => t.franchiseCode === A.partner.franchiseCode));
    const d = await call("GET", `${AT}/${a.id}`, people.admA);
    assert.equal(d.body.ticket.partner.franchiseCode, A.partner.franchiseCode);
    assert.equal(await prisma.auditLog.count({ where: { action: "FRANCHISE_TICKET_VIEWED", target: a.id } }), 1);
    assert.equal((await call("GET", `${AT}?status=NOPE`, people.admA)).status, 400);
  });

  test("replies and internal notes: partner never sees notes; replies notify with number + link only", async () => {
    const t = await open(A.user, { subject: "Conversation check", message: "First partner message" });
    sent.length = 0;
    const note = await call("POST", `${AT}/${t.id}/messages`, people.admA, { body: "Internal: check the CDN config", internal: true });
    assert.equal(note.status, 201, note.text);
    assert.equal(sent.length, 0, "internal notes notify nobody");
    assert.equal((await row(t.id)).awaiting, "ETA", "an internal note doesn't hand the ticket back");
    const reply = await call("POST", `${AT}/${t.id}/messages`, people.admB, { body: "We've fixed the player, please retry." });
    assert.equal(reply.status, 201);
    assert.equal((await row(t.id)).awaiting, "PARTNER");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, A.user.email);
    assert.match(sent[0].subject, new RegExp(t.ticketNo));
    assert.match(sent[0].html, new RegExp(`/franchise-partner/support/${t.id}`));
    assert.doesNotMatch(sent[0].html, /fixed the player|CDN/, "message text stays out of email");
    const mine = await call("GET", `${PT}/${t.id}`, A.user);
    assert.deepEqual(mine.body.ticket.messages.map((m: { authorRole: string }) => m.authorRole), ["PARTNER", "ADMIN"]);
    assert.doesNotMatch(mine.text, /CDN config|"internal"/, "the partner never sees internal notes");
    const back = await call("POST", `${PT}/${t.id}/messages`, A.user, { body: "Works now, thanks." });
    assert.equal(back.status, 201);
    assert.equal((await row(t.id)).awaiting, "ETA");
    const full = await call("GET", `${AT}/${t.id}`, people.admA);
    assert.deepEqual(full.body.ticket.messages.map((m: { authorRole: string; internal: boolean }) => [m.authorRole, m.internal]), [["PARTNER", false], ["ADMIN", true], ["ADMIN", false], ["PARTNER", false]]);
    assert.equal(await prisma.auditLog.count({ where: { action: "FRANCHISE_TICKET_REPLIED", target: t.id } }), 3);
    assert.equal(await prisma.auditLog.count({ where: { action: "FRANCHISE_TICKET_NOTIFIED", target: t.id } }), 1);
  });
});

describe("status lifecycle", () => {
  // Their own franchises, so the hourly new-ticket limit used up above doesn't interfere.
  let L: Awaited<ReturnType<typeof makePartner>>;
  let M: Awaited<ReturnType<typeof makePartner>>;
  before(async () => {
    L = await makePartner("partnerL");
    M = await makePartner("partnerM");
  });

  test("in progress → resolved → reopened by a partner reply → closed (final), with history and notifications", async () => {
    const t = await open(L.user, { subject: "Lifecycle check" });
    let v = (await row(t.id)).version;
    sent.length = 0;
    let r = await call("POST", `${AT}/${t.id}/status`, people.admA, { to: "IN_PROGRESS", expectedVersion: v });
    assert.equal(r.status, 200, r.text);
    v = r.body.version;
    assert.equal(sent.length, 0, "in-progress doesn't email");
    assert.deepEqual([(await call("POST", `${AT}/${t.id}/status`, people.admA, { to: "IN_PROGRESS", expectedVersion: v })).body.code], ["NO_CHANGE"]);
    assert.deepEqual([(await call("POST", `${AT}/${t.id}/status`, people.admA, { to: "RESOLVED", expectedVersion: v - 1 })).body.code], ["STALE"]);
    r = await call("POST", `${AT}/${t.id}/status`, people.admA, { to: "RESOLVED", expectedVersion: v, note: "Fixed in player v2" });
    assert.equal(r.status, 200);
    assert.deepEqual([(await row(t.id)).status, (await row(t.id)).awaiting], ["RESOLVED", "NONE"]);
    assert.equal(sent.length, 1);
    assert.match(sent[0].html, /Resolved/);
    const reopen = await call("POST", `${PT}/${t.id}/messages`, L.user, { body: "Still broken on mobile." });
    assert.equal(reopen.body.status, "OPEN", "a partner reply re-opens a resolved ticket");
    v = (await row(t.id)).version;
    r = await call("POST", `${AT}/${t.id}/status`, people.admB, { to: "CLOSED", expectedVersion: v });
    assert.equal(r.status, 200);
    const closed = await row(t.id);
    assert.deepEqual([closed.status, closed.awaiting, closed.closedById], ["CLOSED", "NONE", people.admB.id]);
    for (const [who, p, b] of [[L.user, `${PT}/${t.id}/messages`, { body: "one more" }], [people.admA, `${AT}/${t.id}/messages`, { body: "late" }], [people.admA, `${AT}/${t.id}/status`, { to: "OPEN", expectedVersion: closed.version }]] as [U, string, unknown][]) {
      assert.equal((await call("POST", p, who, b)).body.code, "TICKET_CLOSED", p);
    }
    const events = await prisma.supportTicketEvent.findMany({ where: { ticketId: t.id }, orderBy: { createdAt: "asc" } });
    assert.deepEqual(events.map((e) => [e.fromStatus, e.toStatus, e.actorRole]), [["OPEN", "IN_PROGRESS", "ADMIN"], ["IN_PROGRESS", "RESOLVED", "ADMIN"], ["RESOLVED", "OPEN", "PARTNER"], ["OPEN", "CLOSED", "ADMIN"]]);
  });

  test("a partner can close its own ticket (version-guarded); two admins changing status at once — one wins", async () => {
    const t = await open(L.user, { subject: "Partner closes this" });
    assert.equal((await call("POST", `${PT}/${t.id}/close`, L.user, { expectedVersion: 5 })).body.code, "STALE");
    assert.equal((await call("POST", `${PT}/${t.id}/close`, L.user, { expectedVersion: 0 })).body.status, "CLOSED");
    const u = await open(M.user, { subject: "Race between admins" });
    const results = await Promise.all([
      call("POST", `${AT}/${u.id}/status`, people.admA, { to: "RESOLVED", expectedVersion: 0 }),
      call("POST", `${AT}/${u.id}/status`, people.admB, { to: "CLOSED", expectedVersion: 0 }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409], JSON.stringify(results.map((r) => r.body)));
    assert.equal(await prisma.supportTicketEvent.count({ where: { ticketId: u.id } }), 1);
  });
});

describe("numbering and rate limits", () => {
  test("concurrent tickets get distinct, consecutive numbers", async () => {
    const C = await makePartner("partnerC");
    const D = await makePartner("partnerD");
    const [x, y] = await Promise.all([open(C.user, { subject: "Concurrent one" }), open(D.user, { subject: "Concurrent two" })]);
    const nums = [x.ticketNo, y.ticketNo].map((n) => Number(n.slice(-6))).sort((a, b) => a - b);
    assert.equal(nums[1] - nums[0], 1);
  });

  test("at most 10 new tickets an hour per franchise", async () => {
    const E = await makePartner("partnerE");
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await call("POST", PT, E.user, { subject: `Bulk ticket ${i}`, category: "OTHER", message: "bulk" })).status);
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(201));
    assert.equal(statuses[10], 429);
  });
});

describe("database guards", () => {
  test("messages and history are append-only; closed is final; identity is immutable; authorship is enforced", async () => {
    const t = await open(B.user, { subject: "Guard check ticket" });
    const msg = await prisma.supportTicketMessage.findFirstOrThrow({ where: { ticketId: t.id } });
    await assert.rejects(prisma.supportTicketMessage.update({ where: { id: msg.id }, data: { body: "edited silently" } }), /append-only/);
    await assert.rejects(prisma.supportTicketMessage.delete({ where: { id: msg.id } }), /append-only/);
    await assert.rejects(prisma.supportTicket.update({ where: { id: t.id }, data: { subject: "Changed subject" } }), /immutable/);
    await assert.rejects(prisma.supportTicket.update({ where: { id: t.id }, data: { partnerId: A.partner.id } }), /immutable/);
    await assert.rejects(prisma.supportTicket.delete({ where: { id: t.id } }), /cannot be deleted/);
    // Authorship: a non-owner can't write as PARTNER; a non-admin can't write as ADMIN; partners can't write internal notes.
    await assert.rejects(prisma.supportTicketMessage.create({ data: { ticketId: t.id, authorId: A.user.id, authorRole: "PARTNER", body: "forged" } }), /franchise owner/);
    await assert.rejects(prisma.supportTicketMessage.create({ data: { ticketId: t.id, authorId: people.student.id, authorRole: "ADMIN", body: "forged" } }), /only an ADMIN/);
    await assert.rejects(prisma.supportTicketMessage.create({ data: { ticketId: t.id, authorId: B.user.id, authorRole: "PARTNER", body: "note", internal: true } }), /author_role/);
    // A ticket can only be opened by its franchise's owner.
    await assert.rejects(prisma.supportTicket.create({ data: { ticketNo: "FT-2026-999999", partnerId: B.partner.id, openedById: A.user.id, subject: "Forged opener", category: "OTHER" } }), /franchise''?s owner/);
    // Closed is final, even for direct writes.
    await call("POST", `${AT}/${t.id}/status`, people.admA, { to: "CLOSED", expectedVersion: 0 });
    await assert.rejects(prisma.supportTicket.update({ where: { id: t.id }, data: { status: "OPEN", closedAt: null, closedById: null, awaiting: "ETA" } }), /closed \(final\)/);
    await assert.rejects(prisma.supportTicketMessage.create({ data: { ticketId: t.id, authorId: people.admA.id, authorRole: "ADMIN", body: "after close" } }), /is closed/);
    const ev = await prisma.supportTicketEvent.findFirstOrThrow({ where: { ticketId: t.id } });
    await assert.rejects(prisma.supportTicketEvent.update({ where: { id: ev.id }, data: { note: "rewritten" } }), /append-only/);
  });
});
