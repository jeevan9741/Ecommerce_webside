/**
 * End-to-end checks of e-book and live-session access through the real HTTP app and database.
 * Everything is created under throwaway packages/users (prefix "zz-test-") and removed afterwards,
 * so the real ₹349 / ₹999 packages and customers are never touched. Needs the dev DATABASE_URL and
 * the EBook/LiveSession migration.
 *
 * Tests 3b and 8b use real Blob storage, so they run ONLY when blob-test-store has pinned this run to
 * a positively identified, test-only store (TEST_BLOB_READ_WRITE_TOKEN + TEST_BLOB_STORE_ID); otherwise
 * they skip, or fail if that configuration is refused. They never use the production store.
 */
import "./local-db-guard.js"; // first: refuses to run against a non-local (production) database
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createHmac, randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { signSessionToken } from "../src/utils/tokens.js";
import { getDownloadUrl, statObject, uploadBuffer } from "../src/services/storage.service.js";
import { assertRealBlobAllowed, realBlobSkip } from "./blob-test-store.js";

const run = randomBytes(4).toString("hex");
const tag = `zz-test-${run}`;
let server: Server;
let base = "";

const ids = { users: [] as string[], courses: [] as string[] };
const tokens = { buyer: "", refunded: "", stranger: "", admin: "", pending: "", unrevoked: "", ebookOnly: "", zoomOnly: "" };
let ebookCourse = "";
let zoomCourse = "";
let otherCourse = "";
let languageId = "";

async function makeUser(name: string, role: "USER" | "ADMIN" = "USER") {
  const u = await prisma.user.create({
    data: { name, email: `${tag}-${name}@example.test`, username: `${tag}-${name}`, passwordHash: "x", referralCode: `${tag}-${name}`, role },
  });
  ids.users.push(u.id);
  return signSessionToken({ id: u.id, name: u.name, email: u.email, role, referralCode: u.referralCode }, u.passwordHash);
}

async function makeCourse(type: "EBOOK" | "ZOOM", priceInPaise: number) {
  const c = await prisma.course.create({
    data: { slug: `${tag}-${type}-${priceInPaise}`, type, title: `${tag} ${type}`, shortDescription: "t", description: "t", priceInPaise, commissionInPaise: 0 },
  });
  ids.courses.push(c.id);
  return c.id;
}

/**
 * An order + access as markOrderPaid / reverseOrder leave them. "PENDING" = checkout opened but no
 * captured payment (no access row); "UNREVOKED_CANCELLED" = a cancelled order whose access row was
 * somehow never revoked — the PAID-order guard must still refuse it.
 */
async function purchase(userToken: string, courseId: string, kind: "PAID" | "REFUNDED" | "PENDING" | "UNREVOKED_CANCELLED") {
  const userId = JSON.parse(Buffer.from(userToken.split(".")[1], "base64url").toString()).id as string;
  const status = kind === "PENDING" ? "CREATED" : kind === "UNREVOKED_CANCELLED" ? "CANCELLED" : kind;
  const order = await prisma.order.create({
    data: { userId, courseId, amountInPaise: 100, status, razorpayOrderId: `${tag}-${randomBytes(4).toString("hex")}`, paidAt: kind === "PENDING" ? null : new Date() },
  });
  if (kind === "PENDING") return;
  await prisma.courseAccess.create({ data: { userId, courseId, orderId: order.id, revokedAt: kind === "REFUNDED" ? new Date() : null } });
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

const minutes = (n: number) => new Date(Date.now() + n * 60_000);

/** A well-formed session token that claims ADMIN but is signed with the wrong key — what a forger could make. */
function forgedAdminToken(userToken: string) {
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const claims = { ...JSON.parse(Buffer.from(userToken.split(".")[1], "base64url").toString()), role: "ADMIN" };
  const unsigned = `${enc({ alg: "HS256", typ: "JWT" })}.${enc(claims)}`;
  return `${unsigned}.${createHmac("sha256", randomBytes(32)).update(unsigned).digest("base64url")}`;
}

/**
 * Every non-admin caller — paid buyer, customer without a purchase, signed-out visitor, forged
 * ADMIN token — is refused by each admin endpoint (403 for customers, 401 otherwise).
 */
async function assertAdminOnly(endpoints: [method: string, path: string, body?: unknown][]) {
  const callers: [label: string, token: string | null, expected: number][] = [
    ["paid buyer", tokens.buyer, 403],
    ["customer without purchase", tokens.stranger, 403],
    ["signed out", null, 401],
    ["forged ADMIN token", forgedAdminToken(tokens.buyer), 401],
  ];
  for (const [method, path, body] of endpoints) {
    for (const [label, token, expected] of callers) {
      const res = await call(method, path, token, body);
      assert.equal(res.status, expected, `${label} → ${method} ${path}: ${res.raw}`);
      assert.ok(!res.raw.includes("zoom.us") && !res.raw.includes("ebooks/"), `${label} → ${method} ${path} leaked data`);
    }
  }
}

before(async () => {
  const app = createApp();
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  languageId = (await prisma.language.create({ data: { code: `zz${run}`, name: "Test Hindi", nativeName: "हिन्दी" } })).id;
  ebookCourse = await makeCourse("EBOOK", 34900);
  zoomCourse = await makeCourse("ZOOM", 99900);
  otherCourse = await makeCourse("EBOOK", 11100);
  tokens.buyer = await makeUser("buyer");
  tokens.refunded = await makeUser("refunded");
  tokens.stranger = await makeUser("stranger");
  tokens.admin = await makeUser("admin", "ADMIN");
  tokens.pending = await makeUser("pending");
  tokens.unrevoked = await makeUser("unrevoked");
  tokens.ebookOnly = await makeUser("ebook-only");
  tokens.zoomOnly = await makeUser("zoom-only");
  await purchase(tokens.buyer, ebookCourse, "PAID");
  await purchase(tokens.buyer, zoomCourse, "PAID");
  await purchase(tokens.refunded, ebookCourse, "REFUNDED");
  await purchase(tokens.refunded, zoomCourse, "REFUNDED");
  // One package each: buying the ₹349 e-books must not open the ₹999 live classes, and vice versa.
  await purchase(tokens.ebookOnly, ebookCourse, "PAID");
  await purchase(tokens.zoomOnly, zoomCourse, "PAID");
  for (const c of [ebookCourse, zoomCourse]) {
    await purchase(tokens.pending, c, "PENDING");
    await purchase(tokens.unrevoked, c, "UNREVOKED_CANCELLED");
  }
});

after(async () => {
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids.users } } });
  await prisma.eBook.deleteMany({ where: { courseId: { in: ids.courses } } });
  await prisma.liveSession.deleteMany({ where: { courseId: { in: ids.courses } } });
  await prisma.courseAccess.deleteMany({ where: { userId: { in: ids.users } } });
  await prisma.order.deleteMany({ where: { userId: { in: ids.users } } });
  await prisma.course.deleteMany({ where: { id: { in: ids.courses } } });
  await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
  await prisma.language.deleteMany({ where: { id: languageId } });
  await prisma.$disconnect();
  server.close();
});

describe("e-books", () => {
  let ebookId = "";
  let otherEbookId = "";
  let draftId = "";

  before(async () => {
    // Rows inserted directly (no Blob upload needed): signing a download link doesn't read the file.
    const mk = (courseId: string, title: string, isPublished = true) =>
      prisma.eBook.create({
        data: { courseId, title, fileName: `${title}.pdf`, storageKey: `ebooks/${tag}-${title}.pdf`, mimeType: "application/pdf", sizeBytes: 1234n, isPublished },
      });
    ebookId = (await mk(ebookCourse, "guide")).id;
    otherEbookId = (await mk(otherCourse, "other")).id;
    draftId = (await mk(ebookCourse, "draft", false)).id;
  });

  test("1. a paid buyer sees their e-books and gets a short-lived download link", async () => {
    const list = await call("GET", "/me/ebooks", tokens.buyer);
    assert.equal(list.status, 200);
    const titles = list.body.ebooks.map((e: { title: string }) => e.title);
    assert.ok(titles.includes("guide"));
    assert.ok(!titles.includes("other"), "another package's e-book must not be listed");
    assert.ok(!titles.includes("draft"), "unpublished e-books must not be listed");
    assert.ok(!list.raw.includes("storageKey") && !list.raw.includes(`ebooks/${tag}`), "storage keys must never reach students");

    const dl = await call("POST", `/me/ebooks/${ebookId}/download`, tokens.buyer);
    assert.equal(dl.status, 200, dl.raw);
    assert.match(dl.body.url, /^https:\/\//);
    assert.equal(dl.body.fileName, "guide.pdf");
    const ttl = new Date(dl.body.expiresAt).getTime() - Date.now();
    assert.ok(ttl > 0 && ttl <= 5 * 60_000 + 5000, "link must expire within 5 minutes");
  });

  test("2. customers without the purchase — or whose order was refunded — are denied", async () => {
    for (const who of ["stranger", "refunded"] as const) {
      const dl = await call("POST", `/me/ebooks/${ebookId}/download`, tokens[who]);
      assert.equal(dl.status, 403, `${who}: ${dl.raw}`);
      assert.equal(dl.body.code, "NOT_PURCHASED");
      assert.ok(!dl.raw.includes("https://"), "no link of any kind in a denial");
      const list = await call("GET", "/me/ebooks", tokens[who]);
      assert.equal(list.status, 200);
      assert.equal(list.body.ebooks.length, 0);
      assert.ok(list.body.unlock.some((p: { id: string }) => p.id === ebookCourse), "the locked screen offers the package");
    }
    const scoped = await call("GET", `/me/ebooks?courseId=${ebookCourse}`, tokens.stranger);
    assert.equal(scoped.status, 403);
  });

  test("2b. unpaid (pending) orders and a non-PAID order with stray access never unlock downloads", async () => {
    for (const who of ["pending", "unrevoked"] as const) {
      const dl = await call("POST", `/me/ebooks/${ebookId}/download`, tokens[who]);
      assert.equal(dl.status, 403, `${who}: ${dl.raw}`);
      assert.equal((await call("GET", "/me/ebooks", tokens[who])).body.ebooks.length, 0);
    }
  });

  test("3b. signed links expire, and tampered or unsigned links are refused by the store", { skip: realBlobSkip }, async () => {
    assertRealBlobAllowed();
    // Read-only probes of a key that doesn't exist: a valid signature reaches the lookup (404),
    // anything else is refused before it (403).
    const key = `ebooks/${tag}-expiry-probe.pdf`;
    const fresh = await getDownloadUrl(key, 300);
    const short = await getDownloadUrl(key, 1);
    assert.equal((await fetch(fresh)).status, 404, "a valid link passes the signature check");
    await new Promise((r) => setTimeout(r, 4000));
    assert.equal((await fetch(short)).status, 403, "an expired link is refused");
    assert.equal((await fetch(fresh.replace(/(vercel-blob-signature=)([^&]{4})/, "$1AAAA"))).status, 403, "a tampered link is refused");
    assert.equal((await fetch(fresh.split("?")[0])).status, 403, "the bare storage URL is refused");
  });

  test("3. guessing IDs or URLs gets nothing", async () => {
    assert.equal((await call("POST", `/me/ebooks/${ebookId}/download`, null)).status, 401);
    assert.equal((await call("POST", `/me/ebooks/${otherEbookId}/download`, tokens.buyer)).status, 403, "buyer of one package can't take another's file");
    assert.equal((await call("POST", `/me/ebooks/${draftId}/download`, tokens.buyer)).status, 404);
    assert.equal((await call("POST", `/me/ebooks/does-not-exist/download`, tokens.buyer)).status, 404);
    // Admin endpoints are closed to customers.
    assert.equal((await call("GET", "/admin/ebooks", tokens.buyer)).status, 403);
    assert.equal((await call("POST", "/admin/ebooks/upload-token", tokens.buyer, { filename: "a.pdf", contentType: "application/pdf", sizeBytes: 10 })).status, 403);
  });

  test("3c. every e-book admin endpoint refuses non-admins, and nothing changes", async () => {
    const before = await prisma.eBook.findUniqueOrThrow({ where: { id: ebookId } });
    const count = await prisma.eBook.count({ where: { courseId: { in: ids.courses } } });
    await assertAdminOnly([
      ["GET", "/admin/ebooks"],
      ["POST", "/admin/ebooks/upload-token", { filename: "a.pdf", contentType: "application/pdf", sizeBytes: 10 }],
      ["POST", "/admin/ebooks", { title: "Injected", courseId: ebookCourse, storageKey: `ebooks/${tag}-x.pdf`, fileName: "x.pdf" }],
      ["PATCH", `/admin/ebooks/${ebookId}`, { title: "Hijacked", isPublished: false }],
      ["PATCH", `/admin/ebooks/${ebookId}`, { storageKey: `ebooks/${tag}-swap.pdf`, fileName: "swap.pdf" }],
      ["POST", "/admin/ebooks/discard-upload", { key: before.storageKey }],
      ["DELETE", `/admin/ebooks/${ebookId}`],
    ]);
    const after = await prisma.eBook.findUniqueOrThrow({ where: { id: ebookId } });
    assert.deepEqual(
      { title: after.title, storageKey: after.storageKey, isPublished: after.isPublished, updatedAt: after.updatedAt },
      { title: before.title, storageKey: before.storageKey, isPublished: before.isPublished, updatedAt: before.updatedAt },
      "the e-book is untouched"
    );
    assert.equal(await prisma.eBook.count({ where: { courseId: { in: ids.courses } } }), count, "nothing was created or deleted");
  });

  test("3d. admins edit, hide and re-publish an e-book; buyers see each change (no storage calls)", async () => {
    const titles = async () => (await call("GET", "/me/ebooks", tokens.buyer)).body.ebooks.map((e: { title: string }) => e.title);
    const edited = await call("PATCH", `/admin/ebooks/${otherEbookId}`, tokens.admin, { title: "Renamed guide", description: "Updated" });
    assert.equal(edited.status, 200, edited.raw);
    assert.equal(edited.body.ebook.title, "Renamed guide");

    assert.equal((await call("PATCH", `/admin/ebooks/${ebookId}`, tokens.admin, { isPublished: false })).status, 200);
    assert.ok(!(await titles()).includes("guide"), "a hidden e-book disappears for buyers");
    assert.equal((await call("POST", `/me/ebooks/${ebookId}/download`, tokens.buyer)).status, 404, "and can't be downloaded");
    assert.equal((await call("PATCH", `/admin/ebooks/${ebookId}`, tokens.admin, { isPublished: true })).status, 200);
    assert.ok((await titles()).includes("guide"), "re-published e-books come back");

    assert.equal((await call("PATCH", `/admin/ebooks/${ebookId}`, tokens.admin, { courseId: "no-such-package" })).status, 400);
    assert.equal((await call("PATCH", "/admin/ebooks/no-such-id", tokens.admin, { title: "x y" })).status, 404);
  });

  test("3e. e-book language: required on upload, validated, saved and shown; access unchanged", async () => {
    // Checked before the uploaded file is looked at (this run has no storage: reaching it would 500).
    const upload = { title: "Hindi guide", courseId: ebookCourse, storageKey: `ebooks/${tag}-new.pdf`, fileName: "new.pdf" };
    const missing = await call("POST", "/admin/ebooks", tokens.admin, upload);
    assert.equal(missing.status, 400, missing.raw);
    assert.match(missing.body.error, /Choose a language/);
    const unknown = await call("POST", "/admin/ebooks", tokens.admin, { ...upload, languageId: "no-such-language" });
    assert.equal(unknown.status, 400, unknown.raw);
    assert.match(unknown.body.error, /language doesn't exist/);
    assert.equal(await prisma.eBook.count({ where: { storageKey: upload.storageKey } }), 0, "nothing is saved");

    // Set on an existing e-book (edit form), then shown to admins and buyers.
    const set = await call("PATCH", `/admin/ebooks/${ebookId}`, tokens.admin, { languageId });
    assert.equal(set.status, 200, set.raw);
    assert.equal(set.body.ebook.languageId, languageId);
    assert.deepEqual(set.body.ebook.language, { code: `zz${run}`, name: "Test Hindi" });
    assert.equal((await prisma.eBook.findUniqueOrThrow({ where: { id: ebookId } })).languageId, languageId, "stored as the language's id");

    for (const bad of [null, "", "no-such-language"]) {
      assert.equal((await call("PATCH", `/admin/ebooks/${ebookId}`, tokens.admin, { languageId: bad })).status, 400, `languageId ${JSON.stringify(bad)} is refused`);
    }
    assert.equal((await prisma.eBook.findUniqueOrThrow({ where: { id: ebookId } })).languageId, languageId, "a refused edit changes nothing");

    const adminList = (await call("GET", `/admin/ebooks?courseId=${ebookCourse}`, tokens.admin)).body.ebooks as { id: string; languageId: string | null }[];
    assert.equal(adminList.find((e) => e.id === ebookId)?.languageId, languageId);
    const mine = (await call("GET", "/me/ebooks", tokens.buyer)).body.ebooks as { id: string; language: { name: string } | null }[];
    assert.equal(mine.find((e) => e.id === ebookId)?.language?.name, "Test Hindi", "buyers see the language");
    assert.ok(!JSON.stringify(mine).includes(languageId), "students get the name, not internal ids");
    const legacy = await call("GET", `/me/ebooks?courseId=${otherCourse}`, tokens.admin);
    assert.equal(legacy.body.ebooks[0].language, null, "e-books from before languages still list, with no language");

    // Language is display-only: downloads and paid access are exactly as before.
    assert.equal((await call("POST", `/me/ebooks/${ebookId}/download`, tokens.buyer)).status, 200);
    assert.equal((await call("POST", `/me/ebooks/${ebookId}/download`, tokens.stranger)).status, 403);
    assert.equal((await call("POST", `/me/ebooks/${ebookId}/download`, tokens.refunded)).status, 403);
  });

  test("8a. upload tokens enforce type, extension and size", async () => {
    const ok = await call("POST", "/admin/ebooks/upload-token", tokens.admin, { filename: "Guide.pdf", contentType: "application/pdf", sizeBytes: 1000 });
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      assert.equal(ok.status, 200, ok.raw);
      assert.match(ok.body.pathname, /^ebooks\/.+\.pdf$/);
      assert.equal(ok.body.access, "private");
    }
    assert.equal((await call("POST", "/admin/ebooks/upload-token", tokens.admin, { filename: "a.exe", contentType: "application/x-msdownload", sizeBytes: 10 })).status, 400);
    assert.equal((await call("POST", "/admin/ebooks/upload-token", tokens.admin, { filename: "a.epub", contentType: "application/pdf", sizeBytes: 10 })).status, 400);
    assert.equal((await call("POST", "/admin/ebooks/upload-token", tokens.admin, { filename: "a.pdf", contentType: "application/pdf", sizeBytes: 101 * 1024 ** 2 })).status, 400);
    assert.equal((await call("POST", "/admin/ebooks", tokens.admin, { title: "x", courseId: ebookCourse, languageId, storageKey: "course-videos/x.mp4", fileName: "x.pdf" })).status, 400);
  });

  test("8b. admins upload, replace and remove e-books (Blob round-trip)", { skip: realBlobSkip }, async () => {
    assertRealBlobAllowed();
    {
      const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
      const k1 = `ebooks/${tag}-one.pdf`;
      const k2 = `ebooks/${tag}-two.pdf`;
      const fake = `ebooks/${tag}-fake.pdf`;
      await uploadBuffer(k1, pdf, "application/pdf");
      await uploadBuffer(k2, pdf, "application/pdf");
      await uploadBuffer(fake, Buffer.from("<html>not a pdf</html>"), "application/pdf");

      const bad = await call("POST", "/admin/ebooks", tokens.admin, { title: "Fake", courseId: ebookCourse, languageId, storageKey: fake, fileName: "fake.pdf" });
      assert.equal(bad.status, 400, bad.raw);
      assert.equal(await statObject(fake), null, "a rejected upload is deleted from storage");

      const created = await call("POST", "/admin/ebooks", tokens.admin, { title: "Round trip", courseId: ebookCourse, languageId, storageKey: k1, fileName: "one.pdf" });
      assert.equal(created.status, 201, created.raw);
      const id = created.body.ebook.id;
      assert.equal(created.body.ebook.format, "PDF");
      assert.equal(created.body.ebook.languageId, languageId, "the chosen language is saved with the upload");

      const replaced = await call("PATCH", `/admin/ebooks/${id}`, tokens.admin, { storageKey: k2, fileName: "two.pdf" });
      assert.equal(replaced.status, 200, replaced.raw);
      assert.equal(replaced.body.ebook.fileName, "two.pdf");
      assert.equal(replaced.body.ebook.languageId, languageId, "replacing the file keeps the language");
      assert.equal(await statObject(k1), null, "the replaced file is deleted");

      const dl = await call("POST", `/me/ebooks/${id}/download`, tokens.buyer);
      assert.equal(dl.status, 200);
      const file = await fetch(dl.body.url);
      assert.equal(file.status, 200);
      assert.ok((await file.text()).startsWith("%PDF"));

      assert.equal((await call("DELETE", `/admin/ebooks/${id}`, tokens.admin)).status, 200);
      assert.equal(await statObject(k2), null, "the removed e-book's file is deleted");
      assert.equal((await call("POST", `/me/ebooks/${id}/download`, tokens.buyer)).status, 404);
    }
  });
});

describe("live Zoom sessions", () => {
  const joinUrl = "https://us06web.zoom.us/j/81234567890?pwd=secretpass";
  const sessionIds: Record<string, string> = {};

  before(async () => {
    const mk = (key: string, dayNumber: number, start: Date, end: Date, extra: object = {}) =>
      prisma.liveSession
        .create({ data: { courseId: zoomCourse, dayNumber, title: key, startsAt: start, endsAt: end, joinUrl, isPublished: true, ...extra } })
        .then((s) => (sessionIds[key] = s.id));
    await mk("completed", 1, minutes(-180), minutes(-60));
    await mk("live", 2, minutes(-30), minutes(60));
    await mk("soon", 3, minutes(10), minutes(130)); // join window (15 min) already open
    await mk("later", 4, minutes(24 * 60), minutes(25 * 60));
    await mk("cancelled", 5, minutes(-10), minutes(110), { status: "CANCELLED", cancelReason: "Trainer unwell", cancelledAt: new Date() });
    await mk("draft", 6, minutes(48 * 60), minutes(49 * 60), { isPublished: false });
  });

  test("4 & 7. a paid buyer sees the published schedule with the right states — and no join link", async () => {
    const res = await call("GET", "/me/live-sessions", tokens.buyer);
    assert.equal(res.status, 200, res.raw);
    const byTitle = Object.fromEntries(res.body.sessions.map((s: { title: string }) => [s.title, s]));
    assert.equal(byTitle.completed.state, "COMPLETED");
    assert.equal(byTitle.completed.canJoin, false);
    assert.equal(byTitle.live.state, "LIVE");
    assert.equal(byTitle.live.canJoin, true);
    assert.equal(byTitle.soon.state, "UPCOMING");
    assert.equal(byTitle.soon.canJoin, true);
    assert.equal(byTitle.later.state, "UPCOMING");
    assert.equal(byTitle.later.canJoin, false);
    assert.equal(byTitle.cancelled.state, "CANCELLED");
    assert.equal(byTitle.cancelled.cancelReason, "Trainer unwell");
    assert.equal(byTitle.draft, undefined, "unpublished sessions are hidden");
    assert.ok(!res.raw.includes("zoom.us"), "the schedule never carries the join link");
    assert.ok(res.body.serverTime);
  });

  test("5. Join works inside the joining window and is refused outside it", async () => {
    for (const key of ["live", "soon"]) {
      const res = await call("POST", `/me/live-sessions/${sessionIds[key]}/join`, tokens.buyer);
      assert.equal(res.status, 200, res.raw);
      assert.equal(res.body.joinUrl, joinUrl);
    }
    const early = await call("POST", `/me/live-sessions/${sessionIds.later}/join`, tokens.buyer);
    assert.equal(early.status, 409);
    assert.equal(early.body.code, "JOIN_NOT_OPEN");
    assert.ok(!early.raw.includes("zoom.us"));
    const ended = await call("POST", `/me/live-sessions/${sessionIds.completed}/join`, tokens.buyer);
    assert.equal(ended.body.code, "SESSION_ENDED");
    const cancelled = await call("POST", `/me/live-sessions/${sessionIds.cancelled}/join`, tokens.buyer);
    assert.equal(cancelled.body.code, "SESSION_CANCELLED");
    assert.equal((await call("POST", `/me/live-sessions/${sessionIds.draft}/join`, tokens.buyer)).status, 404);
  });

  test("6. ineligible customers can't see the schedule or join", async () => {
    for (const who of ["stranger", "refunded", "pending", "unrevoked"] as const) {
      const list = await call("GET", "/me/live-sessions", tokens[who]);
      assert.equal(list.status, 200);
      assert.equal(list.body.sessions.length, 0, `${who} must not see sessions`);
      const join = await call("POST", `/me/live-sessions/${sessionIds.live}/join`, tokens[who]);
      assert.equal(join.status, 403, `${who}: ${join.raw}`);
      assert.ok(!join.raw.includes("zoom.us"));
    }
    assert.equal((await call("POST", `/me/live-sessions/${sessionIds.live}/join`, null)).status, 401);
    assert.equal((await call("GET", "/admin/live-sessions", tokens.buyer)).status, 403);
  });

  test("6b. each package unlocks only itself: e-book buyers can't join live classes, live buyers can't download e-books", async () => {
    const ebook = await prisma.eBook.findFirstOrThrow({ where: { courseId: ebookCourse, isPublished: true } });

    const ebookOnlySchedule = await call("GET", "/me/live-sessions", tokens.ebookOnly);
    assert.equal(ebookOnlySchedule.body.sessions.length, 0);
    assert.ok(ebookOnlySchedule.body.unlock.some((p: { id: string }) => p.id === zoomCourse), "offers the live package instead");
    const join = await call("POST", `/me/live-sessions/${sessionIds.live}/join`, tokens.ebookOnly);
    assert.equal(join.status, 403, join.raw);
    assert.ok(!join.raw.includes("zoom.us"));
    assert.equal((await call("POST", `/me/ebooks/${ebook.id}/download`, tokens.ebookOnly)).status, 200, "their own package still works");

    const zoomOnlyBooks = await call("GET", "/me/ebooks", tokens.zoomOnly);
    assert.equal(zoomOnlyBooks.body.ebooks.length, 0);
    const dl = await call("POST", `/me/ebooks/${ebook.id}/download`, tokens.zoomOnly);
    assert.equal(dl.status, 403, dl.raw);
    assert.ok(!dl.raw.includes("https://"));
    assert.equal((await call("POST", `/me/live-sessions/${sessionIds.live}/join`, tokens.zoomOnly)).status, 200, "their own package still works");
  });

  test("6c. every live-session admin endpoint refuses non-admins, and nothing changes", async () => {
    const watched = [sessionIds.live, sessionIds.cancelled, sessionIds.draft];
    const snapshot = () =>
      prisma.liveSession.findMany({
        where: { id: { in: watched } },
        select: { id: true, title: true, startsAt: true, endsAt: true, joinUrl: true, isPublished: true, status: true, updatedAt: true },
        orderBy: { id: "asc" },
      });
    const before = await snapshot();
    const count = await prisma.liveSession.count({ where: { courseId: zoomCourse } });
    await assertAdminOnly([
      ["GET", "/admin/live-sessions"],
      ["POST", "/admin/live-sessions", { courseId: zoomCourse, dayNumber: 1, title: "Injected", date: "2030-01-15", startTime: "19:00", endTime: "21:00", timezone: "Asia/Kolkata", joinUrl: "https://zoom.us/j/1", isPublished: true }],
      ["PATCH", `/admin/live-sessions/${sessionIds.live}`, { joinUrl: "https://zoom.us/j/999" }],
      ["PATCH", `/admin/live-sessions/${sessionIds.live}`, { date: "2030-02-01", startTime: "10:00", endTime: "11:00" }],
      ["PATCH", `/admin/live-sessions/${sessionIds.draft}`, { isPublished: true }],
      ["POST", `/admin/live-sessions/${sessionIds.live}/cancel`, { reason: "x" }],
      ["POST", `/admin/live-sessions/${sessionIds.cancelled}/restore`],
      ["DELETE", `/admin/live-sessions/${sessionIds.live}`],
    ]);
    assert.deepEqual(await snapshot(), before, "no session was edited, rescheduled, published, cancelled or restored");
    assert.equal(await prisma.liveSession.count({ where: { courseId: zoomCourse } }), count, "nothing was created or deleted");
  });

  test("9. admins create, reschedule, cancel and restore sessions; students see the change", async () => {
    const created = await call("POST", "/admin/live-sessions", tokens.admin, {
      courseId: zoomCourse, dayNumber: 7, title: "Day 7 wrap-up", date: "2030-01-15", startTime: "19:00", endTime: "21:00",
      timezone: "Asia/Kolkata", joinUrl, isPublished: true,
    });
    assert.equal(created.status, 201, created.raw);
    const s = created.body.session;
    assert.equal(s.startsAt, "2030-01-15T13:30:00.000Z");
    assert.equal(s.endsAt, "2030-01-15T15:30:00.000Z");
    assert.equal(s.state, "UPCOMING");

    const moved = await call("PATCH", `/admin/live-sessions/${s.id}`, tokens.admin, { date: "2030-01-16", startTime: "18:00", endTime: "20:30" });
    assert.equal(moved.status, 200, moved.raw);
    assert.equal(moved.body.session.startsAt, "2030-01-16T12:30:00.000Z");
    assert.equal(moved.body.session.endTime, "20:30");

    const seen = await call("GET", "/me/live-sessions", tokens.buyer);
    const mine = seen.body.sessions.find((x: { id: string }) => x.id === s.id);
    assert.equal(mine.startsAt, "2030-01-16T12:30:00.000Z", "the reschedule shows up for students");

    const cancelled = await call("POST", `/admin/live-sessions/${s.id}/cancel`, tokens.admin, { reason: "Holiday" });
    assert.equal(cancelled.body.session.state, "CANCELLED");
    const restored = await call("POST", `/admin/live-sessions/${s.id}/restore`, tokens.admin);
    assert.equal(restored.body.session.state, "UPCOMING");

    // Validation
    const bad = (body: object) => call("POST", "/admin/live-sessions", tokens.admin, {
      courseId: zoomCourse, dayNumber: 1, title: "x x", date: "2030-01-15", startTime: "19:00", endTime: "21:00", joinUrl, ...body,
    });
    assert.equal((await bad({ endTime: "18:00" })).status, 400);
    assert.equal((await bad({ dayNumber: 8 })).status, 400);
    assert.equal((await bad({ timezone: "Mars/Base" })).status, 400);
    assert.equal((await bad({ joinUrl: "https://zoom.us/s/81234567890?zak=abc" })).status, 400);
    assert.equal((await bad({ joinUrl: "https://evil.example/j/1" })).status, 400);

    // A host start link can't be slipped in on edit either.
    const hostEdit = await call("PATCH", `/admin/live-sessions/${s.id}`, tokens.admin, { joinUrl: "https://us06web.zoom.us/s/81234567890?zak=hosttoken" });
    assert.equal(hostEdit.status, 400);
    assert.match(hostEdit.body.error, /host start link/);

    assert.equal((await call("DELETE", `/admin/live-sessions/${s.id}`, tokens.admin)).status, 200);
  });
});

describe("existing features still respond", () => {
  test("11. public catalogue no longer exposes package metadata", async () => {
    const res = await call("GET", "/courses", null);
    assert.equal(res.status, 200);
    assert.ok(res.body.courses.length > 0);
    assert.ok(res.body.courses.every((c: object) => !("metadata" in c)));
  });

  test("11. a buyer's own course list and course page still work", async () => {
    const mine = await call("GET", "/me/courses", tokens.buyer);
    assert.equal(mine.status, 200);
    assert.equal(mine.body.access.length, 2);
    assert.equal((await call("GET", `/me/courses/${zoomCourse}`, tokens.buyer)).status, 200);
    assert.equal((await call("GET", "/me/dashboard", tokens.stranger)).status, 403);
  });
});
