/**
 * Shared fixture for the paid-access matrix tests: one throwaway VIDEO package (with a package video
 * and a linked category + category video) and one customer per order outcome. Prefix "zz-test-",
 * removed in teardown.
 */
import "./local-db-guard.js"; // first: refuses to run against a non-local (production) database
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { signSessionToken } from "../src/utils/tokens.js";

export const tag = `zz-test-${randomBytes(4).toString("hex")}`;
let server: Server;
let base = "";
const ids = { users: [] as string[], courses: [] as string[], categories: [] as string[] };

/**
 * How each customer's order ended up. Access rows are what markOrderPaid / reverseOrder leave behind;
 * the two *_UNREVOKED cases simulate a missed revocation, which the PAID-order check must still catch.
 */
export const CASES = {
  paid: { status: "PAID", access: "live" },
  pending: { status: "CREATED", access: "none" },
  failed: { status: "FAILED", access: "none" },
  refunded: { status: "REFUNDED", access: "revoked" },
  cancelled: { status: "CANCELLED", access: "revoked" },
  refundedUnrevoked: { status: "REFUNDED", access: "live" },
  cancelledUnrevoked: { status: "CANCELLED", access: "live" },
  pendingWithStrayAccess: { status: "CREATED", access: "live" },
} as const;
export type Case = keyof typeof CASES;
export const tokens = {} as Record<Case, string>;

export let courseId = "";
export let packageVideoId = "";
export let categoryVideoId = "";
export let categorySlug = "";

export async function call(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, raw: text };
}

/** Registers the fixture's before/after hooks in the calling test file. */
export function useFixture() {
before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const course = await prisma.course.create({
    data: { slug: `${tag}-video`, type: "VIDEO", title: `${tag} video`, shortDescription: "t", description: "t", priceInPaise: 69900, commissionInPaise: 0 },
  });
  courseId = course.id;
  ids.courses.push(course.id);
  const category = await prisma.courseCategory.create({ data: { name: `${tag} topic`, slug: `${tag}-topic`, packages: { create: { courseId } } } });
  ids.categories.push(category.id);
  categorySlug = category.slug;
  const video = (data: object) =>
    prisma.courseVideo.create({ data: { title: "v", storageKey: `course-videos/${tag}-${randomBytes(3).toString("hex")}.mp4`, sizeBytes: 1n, ...data } });
  packageVideoId = (await video({ courseId })).id;
  categoryVideoId = (await video({ categoryId: category.id })).id;

  for (const [name, c] of Object.entries(CASES) as [Case, (typeof CASES)[Case]][]) {
    const u = await prisma.user.create({
      data: { name, email: `${tag}-${name}@example.test`, username: `${tag}-${name}`, passwordHash: "x", referralCode: `${tag}-${name}` },
    });
    ids.users.push(u.id);
    tokens[name] = signSessionToken({ id: u.id, name, email: u.email, role: "USER", referralCode: u.referralCode }, u.passwordHash);
    const order = await prisma.order.create({
      data: { userId: u.id, courseId, amountInPaise: 69900, status: c.status, razorpayOrderId: `${tag}-${name}`, paidAt: c.status === "PAID" ? new Date() : null },
    });
    if (c.access !== "none") {
      await prisma.courseAccess.create({ data: { userId: u.id, courseId, orderId: order.id, revokedAt: c.access === "revoked" ? new Date() : null } });
    }
  }
});

after(async () => {
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids.users } } });
  await prisma.videoProgress.deleteMany({ where: { userId: { in: ids.users } } });
  await prisma.courseCertificate.deleteMany({ where: { courseId: { in: ids.courses } } });
  await prisma.courseVideo.deleteMany({ where: { OR: [{ courseId: { in: ids.courses } }, { categoryId: { in: ids.categories } }] } });
  await prisma.courseAccess.deleteMany({ where: { userId: { in: ids.users } } });
  await prisma.order.deleteMany({ where: { userId: { in: ids.users } } });
  await prisma.courseCategory.deleteMany({ where: { id: { in: ids.categories } } });
  await prisma.course.deleteMany({ where: { id: { in: ids.courses } } });
  await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
  await prisma.$disconnect();
  server.close();
});
}

export type Surface = [label: string, unlocked: (token: string) => Promise<boolean>];

/** Paid buyer unlocks every surface; every other order outcome unlocks none. */
export function accessMatrix(title: string, surfaces: Surface[]) {
  describe(title, () => {
    test("the paid buyer gets every surface", async () => {
      for (const [label, unlocked] of surfaces) assert.equal(await unlocked(tokens.paid), true, label);
    });
    for (const name of Object.keys(CASES).filter((n) => n !== "paid") as Case[]) {
      test(`${name}: ${CASES[name].status} order, access ${CASES[name].access} → everything locked`, async () => {
        for (const [label, unlocked] of surfaces) assert.equal(await unlocked(tokens[name]), false, `${name} — ${label}`);
      });
    }
  });
}
