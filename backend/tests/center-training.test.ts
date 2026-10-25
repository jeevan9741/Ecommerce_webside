/**
 * Centre (offline) training package details: the admin course PATCH merges metadata instead of
 * replacing it, validates CENTRE detail fields, never re-activates a package it wasn't asked to,
 * and the enrolment summary only reads. Everything is prefixed "zz-test-".
 */
import "./local-db-guard.js"; // first: refuses to run against a non-local (production) database
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { signSessionToken } from "../src/utils/tokens.js";
import { mergeCourseMetadata } from "../src/utils/course-metadata.js";

const tag = `zz-test-${randomBytes(4).toString("hex")}`;
let server: Server;
let base = "";
const ids = { users: [] as string[], courses: [] as string[] };
const tokens = { admin: "", customer: "", stranger: "" };
let centreId = "";
let videoId = "";

async function makeUser(name: string, role: "USER" | "ADMIN" = "USER") {
  const u = await prisma.user.create({
    data: { name, email: `${tag}-${name}@example.test`, username: `${tag}-${name}`, passwordHash: "x", referralCode: `${tag}-${name}`, role },
  });
  ids.users.push(u.id);
  return { id: u.id, token: signSessionToken({ id: u.id, name, email: u.email, role, referralCode: u.referralCode }, u.passwordHash) };
}

async function call(method: string, path: string, token: string | null, body?: unknown) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, raw: text };
}

const stored = (id: string) => prisma.course.findUniqueOrThrow({ where: { id } });
const snapshot = async () => ({
  orders: await prisma.order.findMany({ where: { courseId: centreId }, orderBy: { id: "asc" } }),
  access: await prisma.courseAccess.findMany({ where: { courseId: centreId }, orderBy: { id: "asc" } }),
});

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const course = (slug: string, type: "CENTRE" | "VIDEO", metadata?: object) =>
    prisma.course.create({ data: { slug: `${tag}-${slug}`, type, title: `${tag} ${slug}`, shortDescription: "t", description: "t", priceInPaise: 499900, commissionInPaise: 99900, metadata } });
  centreId = (await course("centre", "CENTRE", { address: "Old address", legacyKey: "kept" })).id;
  videoId = (await course("video", "VIDEO")).id;
  ids.courses.push(centreId, videoId);

  tokens.admin = (await makeUser("admin", "ADMIN")).token;
  const customer = await makeUser("customer");
  tokens.customer = customer.token;
  tokens.stranger = (await makeUser("stranger")).token;
  const refunded = await makeUser("refunded");

  const order = (userId: string, status: "PAID" | "CREATED" | "CANCELLED", n: number) =>
    prisma.order.create({ data: { userId, courseId: centreId, amountInPaise: 200, status, razorpayOrderId: `${tag}-order-${n}`, paidAt: status === "CREATED" ? null : new Date() } });
  const paid = await order(customer.id, "PAID", 1);
  await order(customer.id, "CREATED", 2);
  const cancelled = await order(refunded.id, "CANCELLED", 3);
  await prisma.courseAccess.create({ data: { userId: customer.id, courseId: centreId, orderId: paid.id } });
  await prisma.courseAccess.create({ data: { userId: refunded.id, courseId: centreId, orderId: cancelled.id, revokedAt: new Date() } });
});

after(async () => {
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids.users } } });
  await prisma.courseAccess.deleteMany({ where: { userId: { in: ids.users } } });
  await prisma.order.deleteMany({ where: { userId: { in: ids.users } } });
  await prisma.course.deleteMany({ where: { id: { in: ids.courses } } });
  await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
  server.close();
});

test("merge: patched keys replace, null/empty clear, omitted keys stay", () => {
  const merged = mergeCourseMetadata({ address: "A", dates: "D", legacyKey: 1 }, { address: "  New  ", dates: null, notes: "" }, "CENTRE");
  assert.deepEqual(merged, { address: "New", legacyKey: 1 });
  assert.deepEqual(mergeCourseMetadata(null, { notes: "n" }, "CENTRE"), { notes: "n" });
  assert.deepEqual(mergeCourseMetadata(["not", "an", "object"], { notes: "n" }, "CENTRE"), { notes: "n" });
  // Other package types keep free-form metadata.
  assert.deepEqual(mergeCourseMetadata({ meetingLink: "x" }, { anything: { nested: true } }, "ZOOM"), { meetingLink: "x", anything: { nested: true } });
});

test("admin saves centre details without erasing other fields", async () => {
  const first = await call("PATCH", `/admin/courses/${centreId}`, tokens.admin, {
    metadata: { address: "12 Training Road, Rayadurgam", mapUrl: "https://maps.google.com/?q=academy", dates: "10–12 Nov 2026", schedule: "9 AM – 6 PM", inclusions: "Accommodation\nMeals", notes: "Bring ID" },
  });
  assert.equal(first.status, 200, first.raw);

  // A later save that only touches the notes keeps every other detail and the unknown legacy key.
  const second = await call("PATCH", `/admin/courses/${centreId}`, tokens.admin, { metadata: { notes: "Bring a photo ID" } });
  assert.equal(second.status, 200, second.raw);
  assert.deepEqual((await stored(centreId)).metadata, {
    address: "12 Training Road, Rayadurgam",
    mapUrl: "https://maps.google.com/?q=academy",
    dates: "10–12 Nov 2026",
    schedule: "9 AM – 6 PM",
    inclusions: "Accommodation\nMeals",
    notes: "Bring a photo ID",
    legacyKey: "kept",
  });

  // Clearing a field removes just that key.
  await call("PATCH", `/admin/courses/${centreId}`, tokens.admin, { metadata: { schedule: "" } });
  const meta = (await stored(centreId)).metadata as Record<string, unknown>;
  assert.equal("schedule" in meta, false);
  assert.equal(meta.address, "12 Training Road, Rayadurgam");

  // A PATCH without metadata leaves it untouched.
  await call("PATCH", `/admin/courses/${centreId}`, tokens.admin, { title: `${tag} centre renamed` });
  assert.deepEqual((await stored(centreId)).metadata, meta);
});

test("price and status edits change only what was sent, and are audited", async () => {
  const off = await call("PATCH", `/admin/courses/${centreId}`, tokens.admin, { isActive: false });
  assert.equal(off.status, 200, off.raw);
  const price = await call("PATCH", `/admin/courses/${centreId}`, tokens.admin, { priceInPaise: 450000 });
  assert.equal(price.status, 200, price.raw);
  const course = await stored(centreId);
  assert.equal(course.isActive, false, "a PATCH that omits isActive must not re-activate the package");
  assert.equal(course.priceInPaise, 450000);
  assert.equal(course.commissionInPaise, 99900);
  assert.equal((course.metadata as Record<string, unknown>).address, "12 Training Road, Rayadurgam");

  const audit = await prisma.auditLog.findFirst({ where: { target: centreId, action: "COURSE_UPDATED", metadata: { path: ["priceTo"], equals: 450000 } } });
  assert.deepEqual(audit?.metadata, { fields: ["priceInPaise"], priceFrom: 499900, priceTo: 450000 });

  await call("PATCH", `/admin/courses/${centreId}`, tokens.admin, { isActive: true, priceInPaise: 499900 });
});

test("invalid centre details are rejected and nothing is saved", async () => {
  const before = (await stored(centreId)).metadata;
  const cases: [string, unknown][] = [
    ["javascript: map link", { mapUrl: "javascript:alert(1)" }],
    ["non-URL map link", { mapUrl: "not a url" }],
    ["unknown key (typo)", { adress: "x" }],
    ["non-string value", { dates: 12 }],
    ["over-long address", { address: "x".repeat(501) }],
  ];
  for (const [label, metadata] of cases) {
    const res = await call("PATCH", `/admin/courses/${centreId}`, tokens.admin, { metadata });
    assert.equal(res.status, 400, `${label}: ${res.raw}`);
  }
  const bad = await call("PATCH", `/admin/courses/${centreId}`, tokens.admin, { priceInPaise: 0 });
  assert.equal(bad.status, 400, bad.raw);
  const course = await stored(centreId);
  assert.deepEqual(course.metadata, before);
  assert.equal(course.priceInPaise, 499900);
});

test("only admins can edit or read the summary; unknown courses are 404", async () => {
  assert.equal((await call("PATCH", `/admin/courses/${centreId}`, tokens.customer, { metadata: { notes: "x" } })).status, 403);
  assert.equal((await call("PATCH", `/admin/courses/${centreId}`, null, { metadata: { notes: "x" } })).status, 401);
  assert.equal((await call("GET", `/admin/courses/${centreId}/enrolment-summary`, tokens.customer)).status, 403);
  assert.equal((await call("PATCH", `/admin/courses/${tag}-missing`, tokens.admin, { metadata: { notes: "x" } })).status, 404);
});

test("enrolment summary counts orders and access without changing them", async () => {
  const beforeRows = await snapshot();
  const res = await call("GET", `/admin/courses/${centreId}/enrolment-summary`, tokens.admin);
  assert.equal(res.status, 200, res.raw);
  assert.deepEqual(res.body, { orders: { PAID: 1, CREATED: 1, CANCELLED: 1 }, access: { active: 1, revoked: 1 } });
  assert.deepEqual(await snapshot(), beforeRows, "orders and access rows are untouched");
});

test("buyers get the configured details; the public catalogue and non-buyers don't", async () => {
  const mine = await call("GET", `/me/courses/${centreId}`, tokens.customer);
  assert.equal(mine.status, 200, mine.raw);
  assert.equal(mine.body.access.course.metadata.address, "12 Training Road, Rayadurgam");

  const catalogue = await call("GET", "/courses", null);
  assert.equal(catalogue.status, 200);
  assert.ok(!catalogue.raw.includes("12 Training Road"), "centre details are not in the public catalogue");

  assert.equal((await call("GET", `/me/courses/${centreId}`, tokens.stranger)).status, 403, "non-buyers never get the details");
});
