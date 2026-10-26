/**
 * E-book language access: a student opens an e-book only with paid package access AND a PAID order
 * for that e-book's language — or a grandfathered pre-cutoff order with no language (EBOOK packages
 * only). Covers listing, download, the legacy per-language link, checkout validation, buying a
 * second language, refunds and commissions. Razorpay is stubbed; payments go through the real
 * markOrderPaid / reverseOrder. Everything is prefixed "zz-test-".
 */
import "./local-db-guard.js"; // first: refuses to run against a non-local (production) database
import { after, before, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomBytes } from "node:crypto";

// No network: checkout gets a fake Razorpay order id. Must be registered before the app loads.
let rzpSeq = 0;
mock.module("../src/services/razorpay.service.js", {
  namedExports: {
    RazorpayConfigError: class RazorpayConfigError extends Error {},
    getRazorpayClient: () => ({
      orders: {
        create: async (o: { amount: number }) => ({ id: `order_zztest${Date.now()}${rzpSeq++}`, amount: o.amount, currency: "INR" }),
        fetchPayments: async () => ({ items: [] }),
      },
      payments: {},
    }),
    verifyWebhookSignature: () => false,
    verifyCheckoutSignature: () => false,
  },
});

const { createApp } = await import("../src/app.js");
const { prisma } = await import("../src/config/prisma.js");
const { signSessionToken } = await import("../src/utils/tokens.js");
const { markOrderPaid, reverseOrder } = await import("../src/services/order.service.js");
const { LEGACY_ALL_LANGUAGE_ORDERS_BEFORE, isLegacyAllLanguageOrder } = await import("../src/services/package-access.service.js");

const tag = `zz-test-${randomBytes(4).toString("hex")}`;
// Letters only: language codes must look like ISO codes (a-z and "-").
const run = randomBytes(3).toString("hex").replace(/[0-9]/g, (d) => "ghijklmnop"[Number(d)]);
const code = { en: `e${run}`, hi: `h${run}`, te: `t${run}`, draftOnly: `d${run}` };
let server: Server;
let base = "";
const ids = { users: [] as string[], courses: [] as string[], languages: [] as string[] };
const users: Record<string, { id: string; token: string }> = {};
const ebook: Record<"en" | "hi" | "te" | "unassigned" | "draft" | "videoEn", string> = { en: "", hi: "", te: "", unassigned: "", draft: "", videoEn: "" };
let pkg = ""; // EBOOK package (₹349, ₹50 commission)
let video = ""; // VIDEO package with e-books and a legacy per-language e-book file
let empty = ""; // EBOOK package whose only e-book has no language yet
const PRICE = 34900;
const COMMISSION = 5000;
const legacyDate = new Date(LEGACY_ALL_LANGUAGE_ORDERS_BEFORE.getTime() - 24 * 3600_000);
const afterCutoff = new Date(LEGACY_ALL_LANGUAGE_ORDERS_BEFORE.getTime() + 24 * 3600_000);

async function makeUser(name: string, role: "USER" | "ADMIN" = "USER") {
  const u = await prisma.user.create({
    data: { name, email: `${tag}-${name}@example.test`, username: `${tag}-${name}`, passwordHash: "x", referralCode: `Z${run}${ids.users.length}`.toUpperCase(), role, emailVerified: new Date() },
  });
  ids.users.push(u.id);
  users[name] = { id: u.id, token: signSessionToken({ id: u.id, name, email: u.email, role, referralCode: u.referralCode }, u.passwordHash) };
}

/** An order (and, when it was paid, the access row markOrderPaid would have left). */
async function order(user: string, courseId: string, status: "PAID" | "CREATED" | "FAILED" | "CANCELLED", selectedLanguage: string | null, createdAt = new Date()) {
  const o = await prisma.order.create({
    data: { userId: users[user].id, courseId, amountInPaise: PRICE, status, selectedLanguage, createdAt, razorpayOrderId: `${tag}-${randomBytes(5).toString("hex")}`, paidAt: status === "PAID" ? new Date() : null },
  });
  if (status === "PAID") await prisma.courseAccess.create({ data: { userId: users[user].id, courseId, orderId: o.id } });
  return o;
}

/** A checkout that Razorpay then confirms as captured — through the real markOrderPaid. */
async function buyAndPay(user: string, language: string, referralCode?: string) {
  const res = await call("POST", "/checkout/create-order", users[user].token, { courseId: pkg, selectedLanguage: language, referralCode });
  assert.equal(res.status, 200, res.raw);
  const paymentId = `pay_${tag}${randomBytes(4).toString("hex")}`;
  const paid = await markOrderPaid({
    razorpayOrderId: res.body.razorpayOrderId,
    payment: { id: paymentId, orderId: res.body.razorpayOrderId, amountInPaise: res.body.amountInPaise, currency: "INR", status: "captured" },
  });
  assert.equal(paid.ok, true, JSON.stringify(paid));
  return { orderId: res.body.orderId as string, paymentId };
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

/** Which of the package's e-books the student's library shows, and whether each is locked. */
async function library(user: string, courseId = pkg) {
  const res = await call("GET", `/me/ebooks?courseId=${courseId}`, users[user].token);
  if (res.status !== 200) return { status: res.status, code: res.body?.code as string };
  const byId = Object.fromEntries((res.body.ebooks as { id: string; locked: boolean }[]).map((e) => [e.id, e.locked]));
  return { status: 200, locked: byId as Record<string, boolean> };
}

const download = (user: string, id: string) => call("POST", `/me/ebooks/${id}/download`, users[user].token);

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const lang: Record<string, string> = {};
  for (const [key, c] of Object.entries(code)) {
    const l = await prisma.language.create({ data: { code: c, name: `Test ${key}`, nativeName: key } });
    ids.languages.push(l.id);
    lang[key] = l.id;
  }
  const course = async (slug: string, type: "EBOOK" | "VIDEO") => {
    const c = await prisma.course.create({ data: { slug: `${tag}-${slug}`, type, title: `${tag} ${slug}`, shortDescription: "t", description: "t", priceInPaise: PRICE, commissionInPaise: COMMISSION } });
    ids.courses.push(c.id);
    return c.id;
  };
  pkg = await course("ebooks", "EBOOK");
  video = await course("video", "VIDEO");
  empty = await course("empty", "EBOOK");
  const mk = async (courseId: string, title: string, languageId: string | null, isPublished = true) =>
    (await prisma.eBook.create({ data: { courseId, title, languageId, isPublished, fileName: `${title}.pdf`, storageKey: `ebooks/${tag}-${title}.pdf`, mimeType: "application/pdf", sizeBytes: 10n } })).id;
  ebook.en = await mk(pkg, "english", lang.en);
  ebook.hi = await mk(pkg, "hindi", lang.hi);
  ebook.te = await mk(pkg, "telugu", lang.te);
  ebook.unassigned = await mk(pkg, "unassigned", null);
  ebook.draft = await mk(pkg, "draft", lang.draftOnly, false);
  ebook.videoEn = await mk(video, "video-english", lang.en);
  await mk(empty, "empty-unassigned", null);
  // Legacy per-language files on the VIDEO package (the course player's e-book tab).
  for (const key of ["en", "hi"]) {
    await prisma.courseLanguageVideo.create({ data: { courseId: video, languageId: lang[key], videoUrl: `course-videos/${tag}-${key}.mp4`, ebookUrl: `ebooks/${tag}-legacy-${key}.pdf` } });
  }

  for (const name of ["hiBuyer", "legacy", "legacyLate", "pending", "failed", "stranger", "multi", "referrer", "videoBuyer", "videoLegacy", "mixed"]) await makeUser(name);
  await makeUser("admin", "ADMIN");

  await order("hiBuyer", pkg, "PAID", code.hi);
  await order("legacy", pkg, "PAID", null, legacyDate); // grandfathered: before the cutoff, no language
  await order("legacyLate", pkg, "PAID", null, afterCutoff); // no language but after the cutoff: nothing
  await order("pending", pkg, "CREATED", code.hi);
  await order("failed", pkg, "FAILED", code.hi);
  await order("videoBuyer", video, "PAID", code.en);
  await order("videoLegacy", video, "PAID", null, legacyDate); // legacy rule is EBOOK-only
  // Access points at the hi order; a cancelled te order alongside it must add nothing.
  await order("mixed", pkg, "PAID", code.hi);
  await prisma.order.create({ data: { userId: users.mixed.id, courseId: pkg, amountInPaise: PRICE, status: "CANCELLED", selectedLanguage: code.te, razorpayOrderId: `${tag}-mixed-te`, paidAt: new Date() } });
});

after(async () => {
  const orderIds = (await prisma.order.findMany({ where: { userId: { in: ids.users } }, select: { id: true } })).map((o) => o.id);
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids.users } }, { target: { in: orderIds } }] } });
  await prisma.commissionLedger.deleteMany({ where: { partnerId: { in: ids.users } } });
  await prisma.courseAccess.deleteMany({ where: { userId: { in: ids.users } } });
  await prisma.order.deleteMany({ where: { userId: { in: ids.users } } });
  await prisma.courseLanguageVideo.deleteMany({ where: { courseId: { in: ids.courses } } });
  await prisma.eBook.deleteMany({ where: { courseId: { in: ids.courses } } });
  await prisma.course.deleteMany({ where: { id: { in: ids.courses } } });
  await prisma.language.deleteMany({ where: { id: { in: ids.languages } } });
  await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
  server.close();
});

describe("listing and download", () => {
  test("matching language opens; other languages are listed locked and refused", async () => {
    const lib = await library("hiBuyer");
    assert.deepEqual(lib.locked, { [ebook.en]: true, [ebook.hi]: false, [ebook.te]: true });

    const ok = await download("hiBuyer", ebook.hi);
    assert.equal(ok.status, 200, ok.raw);
    assert.match(ok.body.url, /^https?:\/\//);

    for (const id of [ebook.en, ebook.te]) {
      const denied = await download("hiBuyer", id);
      assert.equal(denied.status, 403, denied.raw);
      assert.equal(denied.body.code, "LANGUAGE_NOT_PURCHASED");
      assert.ok(!denied.raw.includes("ebooks/") && !("url" in denied.body), "no link or storage key for a locked language");
    }
  });

  test("e-books without a language are hidden from students, like unknown IDs; admins keep them", async () => {
    for (const user of ["hiBuyer", "legacy"]) {
      assert.equal((await download(user, ebook.unassigned)).status, 404);
      assert.ok(!(ebook.unassigned in ((await library(user)).locked ?? {})), `${user} doesn't see it listed`);
    }
    assert.equal((await download("hiBuyer", "zz-no-such-ebook")).status, 404);
    assert.equal((await download("hiBuyer", ebook.draft)).status, 404, "unpublished stays hidden");

    const admin = await library("admin");
    assert.equal(admin.locked?.[ebook.unassigned], false, "admins list unassigned e-books, unlocked");
    for (const id of [ebook.unassigned, ebook.en, ebook.te, ebook.draft]) {
      assert.equal((await download("admin", id)).status, 200, `admin downloads ${id}`);
    }
  });

  test("unpaid, failed and non-buyers get nothing; a cancelled order adds no language", async () => {
    for (const user of ["pending", "failed", "stranger"]) {
      assert.deepEqual(await library(user), { status: 403, code: "NOT_PURCHASED" }, user);
      const res = await download(user, ebook.hi);
      assert.equal(res.status, 403, `${user}: ${res.raw}`);
      assert.equal(res.body.code, "NOT_PURCHASED");
    }
    const all = await call("GET", "/me/ebooks", users.pending.token);
    assert.equal(all.body.ebooks.length, 0, "the unfiltered library is empty too");

    assert.deepEqual((await library("mixed")).locked, { [ebook.en]: true, [ebook.hi]: false, [ebook.te]: true });
    assert.equal((await download("mixed", ebook.te)).status, 403);
  });

  test("access is per package: an e-book package doesn't open another package's e-books", async () => {
    assert.equal((await download("hiBuyer", ebook.videoEn)).status, 403);
    assert.equal((await download("videoBuyer", ebook.hi)).status, 403);
    assert.equal((await download("videoBuyer", ebook.videoEn)).status, 200, "VIDEO buyer's order language matches");
  });
});

describe("legacy orders (no language, before the cutoff)", () => {
  test("the rule: PAID-only is checked elsewhere; here no language + EBOOK + before cutoff", () => {
    const o = (selectedLanguage: string | null, createdAt: Date, type = "EBOOK") => isLegacyAllLanguageOrder({ selectedLanguage, createdAt, course: { type } });
    assert.equal(o(null, legacyDate), true);
    assert.equal(o(null, afterCutoff), false);
    assert.equal(o(null, LEGACY_ALL_LANGUAGE_ORDERS_BEFORE), false, "the cutoff itself is excluded");
    assert.equal(o(code.hi, legacyDate), false, "an order with a language is never all-language");
    assert.equal(o(null, legacyDate, "VIDEO"), false, "only e-book packages");
  });

  test("a grandfathered buyer keeps every language", async () => {
    assert.deepEqual((await library("legacy")).locked, { [ebook.en]: false, [ebook.hi]: false, [ebook.te]: false });
    for (const id of [ebook.en, ebook.hi, ebook.te]) assert.equal((await download("legacy", id)).status, 200);
  });

  test("the same kind of order after the cutoff opens nothing", async () => {
    assert.deepEqual((await library("legacyLate")).locked, { [ebook.en]: true, [ebook.hi]: true, [ebook.te]: true });
    assert.equal((await download("legacyLate", ebook.hi)).body.code, "LANGUAGE_NOT_PURCHASED");
  });

  test("historical orders are only read, never rewritten", async () => {
    const legacyOrder = await prisma.order.findFirstOrThrow({ where: { userId: users.legacy.id } });
    assert.equal(legacyOrder.selectedLanguage, null);
    assert.equal(legacyOrder.createdAt.getTime(), legacyDate.getTime());
  });
});

describe("legacy per-language e-book links (course player)", () => {
  test("only languages covered by a PAID order get a signed e-book link; videos stay switchable", async () => {
    const res = await call("GET", `/courses/${video}/content`, users.videoBuyer.token);
    assert.equal(res.status, 200, res.raw);
    const byCode = Object.fromEntries((res.body.languages as { code: string; ebookUrl: string | null; videoUrl: string | null }[]).map((l) => [l.code, l]));
    assert.ok(byCode[code.en].ebookUrl, "purchased language has its e-book link");
    assert.equal(byCode[code.hi].ebookUrl, null, "other language: no e-book link");
    assert.ok(byCode[code.hi].videoUrl, "videos are not language-restricted");

    const legacy = await call("GET", `/courses/${video}/content`, users.videoLegacy.token);
    assert.ok((legacy.body.languages as { ebookUrl: string | null }[]).every((l) => l.ebookUrl === null), "legacy rule doesn't apply to VIDEO packages");
  });
});

describe("checkout", () => {
  test("the language must be one of the package's published e-book languages", async () => {
    const attempt = (selectedLanguage: unknown) => call("POST", "/checkout/create-order", users.stranger.token, { courseId: pkg, selectedLanguage });
    for (const bad of [undefined, null, "", "zz-unknown", code.draftOnly]) {
      const res = await attempt(bad);
      assert.equal(res.status, 400, `${JSON.stringify(bad)}: ${res.raw}`);
      assert.equal(res.body.code, "INVALID_LANGUAGE");
    }
    const none = await call("POST", "/checkout/create-order", users.stranger.token, { courseId: empty, selectedLanguage: code.en });
    assert.equal(none.status, 409, none.raw);
    assert.equal(none.body.code, "NOT_AVAILABLE", "a package whose e-books have no language can't be sold yet");
    assert.equal(await prisma.order.count({ where: { userId: users.stranger.id } }), 0, "no order is created");
  });

  test("the public catalogue offers an e-book package's e-book languages", async () => {
    const res = await call("GET", "/courses", null);
    const p = (res.body.courses as { id: string; languages: { code: string }[] }[]).find((c) => c.id === pkg);
    assert.deepEqual(p?.languages.map((l) => l.code).sort(), [code.en, code.hi, code.te].sort(), "published, assigned languages only");
  });

  test("a language already owned can't be bought again; other packages stay one purchase", async () => {
    for (const [user, language] of [["hiBuyer", code.hi], ["legacy", code.te]] as const) {
      const res = await call("POST", "/checkout/create-order", users[user].token, { courseId: pkg, selectedLanguage: language });
      assert.equal(res.status, 409, `${user}: ${res.raw}`);
      assert.equal(res.body.code, "ALREADY_PURCHASED");
    }
    const again = await call("POST", "/checkout/create-order", users.videoBuyer.token, { courseId: video, selectedLanguage: code.hi });
    assert.equal(again.status, 409, again.raw);
  });
});

describe("buying more languages, refunds and commissions", () => {
  test("each paid language adds access; a refund removes only its own language and commission", async () => {
    const { referralCode: referral } = await prisma.user.findUniqueOrThrow({ where: { id: users.referrer.id } });
    const hi = await buyAndPay("multi", code.hi, referral);
    assert.deepEqual((await library("multi")).locked, { [ebook.en]: true, [ebook.hi]: false, [ebook.te]: true });

    const te = await buyAndPay("multi", code.te, referral);
    assert.deepEqual((await library("multi")).locked, { [ebook.en]: true, [ebook.hi]: false, [ebook.te]: false }, "second purchase adds te, keeps hi");
    const orders = await prisma.order.findMany({ where: { userId: users.multi.id }, orderBy: { createdAt: "asc" } });
    assert.deepEqual(orders.map((o) => [o.selectedLanguage, o.status, o.amountInPaise]), [[code.hi, "PAID", PRICE], [code.te, "PAID", PRICE]], "full price each time");

    const commissions = () => prisma.commissionLedger.findMany({ where: { partnerId: users.referrer.id }, orderBy: { createdAt: "asc" } });
    assert.deepEqual((await commissions()).map((c) => [c.orderId, c.status, c.amountInPaise]), [[hi.orderId, "CREDITED", COMMISSION], [te.orderId, "CREDITED", COMMISSION]], "one commission per paid purchase");

    // Refund the te order: te locks, hi stays, access moves to the still-paid hi order.
    assert.equal((await reverseOrder(te.paymentId, "refund_processed")).ok, true);
    assert.deepEqual((await library("multi")).locked, { [ebook.en]: true, [ebook.hi]: false, [ebook.te]: true });
    assert.equal((await download("multi", ebook.te)).body.code, "LANGUAGE_NOT_PURCHASED");
    assert.equal((await download("multi", ebook.hi)).status, 200);
    const access = await prisma.courseAccess.findFirstOrThrow({ where: { userId: users.multi.id } });
    assert.equal(access.revokedAt, null);
    assert.equal(access.orderId, hi.orderId);
    assert.deepEqual((await commissions()).map((c) => c.status), ["CREDITED", "REVERSED"], "only the refunded order's commission is reversed");

    // Refund the last paid order: everything is gone.
    assert.equal((await reverseOrder(hi.paymentId, "refund_processed")).ok, true);
    assert.deepEqual(await library("multi"), { status: 403, code: "NOT_PURCHASED" });
    assert.notEqual((await prisma.courseAccess.findFirstOrThrow({ where: { userId: users.multi.id } })).revokedAt, null);
    assert.deepEqual((await commissions()).map((c) => c.status), ["REVERSED", "REVERSED"]);

    // A refunded language can be bought again.
    const rebuy = await call("POST", "/checkout/create-order", users.multi.token, { courseId: pkg, selectedLanguage: code.te });
    assert.equal(rebuy.status, 200, rebuy.raw);
  });

  test("an unpaid checkout for a new language grants nothing and credits no commission", async () => {
    const res = await call("POST", "/checkout/create-order", users.hiBuyer.token, { courseId: pkg, selectedLanguage: code.te });
    assert.equal(res.status, 200, res.raw);
    const created = await prisma.order.findUniqueOrThrow({ where: { id: res.body.orderId } });
    assert.equal(created.status, "CREATED");
    assert.equal(created.selectedLanguage, code.te, "the server-validated language is recorded");
    assert.equal((await download("hiBuyer", ebook.te)).body.code, "LANGUAGE_NOT_PURCHASED");
    assert.equal(await prisma.commissionLedger.count({ where: { orderId: created.id } }), 0);
  });
});

describe("language codes recorded on orders", () => {
  test("a code used by orders can't be changed; names can, and buyers keep access", async () => {
    const hi = await prisma.language.findUniqueOrThrow({ where: { code: code.hi } });
    const rename = await call("PATCH", `/admin/languages/${hi.id}`, users.admin.token, { code: `x${run}` });
    assert.equal(rename.status, 409, rename.raw);
    assert.equal(rename.body.code, "LANGUAGE_CODE_IN_USE");
    assert.equal((await prisma.language.findUniqueOrThrow({ where: { id: hi.id } })).code, code.hi, "code unchanged");

    // Sending the same code back (a full form save) and editing the name are fine.
    const edit = await call("PATCH", `/admin/languages/${hi.id}`, users.admin.token, { code: code.hi, name: "Test hi (renamed)", isActive: true, displayOrder: hi.displayOrder });
    assert.equal(edit.status, 200, edit.raw);
    assert.equal(edit.body.language.name, "Test hi (renamed)");
    assert.equal((await download("hiBuyer", ebook.hi)).status, 200, "buyers keep their language after a name edit");

    assert.equal((await call("PATCH", `/admin/languages/${hi.id}`, users.hiBuyer.token, { code: `y${run}` })).status, 403, "admins only");
    assert.equal((await call("PATCH", "/admin/languages/zz-no-such-language", users.admin.token, { name: "x" })).status, 404);
  });

  test("a name-only edit keeps an inactive, reordered language as it is; its code stays locked", async () => {
    const hi = await prisma.language.findUniqueOrThrow({ where: { code: code.hi } });
    await prisma.language.update({ where: { id: hi.id }, data: { isActive: false, displayOrder: 7 } });
    try {
      const edit = await call("PATCH", `/admin/languages/${hi.id}`, users.admin.token, { name: "Name only" });
      assert.equal(edit.status, 200, edit.raw);
      let stored = await prisma.language.findUniqueOrThrow({ where: { id: hi.id } });
      assert.deepEqual(
        { name: stored.name, isActive: stored.isActive, displayOrder: stored.displayOrder, code: stored.code, nativeName: stored.nativeName },
        { name: "Name only", isActive: false, displayOrder: 7, code: code.hi, nativeName: hi.nativeName },
        "omitted fields keep their stored values (no re-activation, no order reset)"
      );

      const rename = await call("PATCH", `/admin/languages/${hi.id}`, users.admin.token, { code: `w${run}` });
      assert.equal(rename.status, 409, rename.raw);
      assert.equal(rename.body.code, "LANGUAGE_CODE_IN_USE");
      stored = await prisma.language.findUniqueOrThrow({ where: { id: hi.id } });
      assert.deepEqual([stored.code, stored.isActive, stored.displayOrder], [code.hi, false, 7], "a refused edit changes nothing");

      // Explicit values still apply.
      const reactivate = await call("PATCH", `/admin/languages/${hi.id}`, users.admin.token, { isActive: true, displayOrder: 3 });
      assert.equal(reactivate.status, 200, reactivate.raw);
      stored = await prisma.language.findUniqueOrThrow({ where: { id: hi.id } });
      assert.deepEqual([stored.isActive, stored.displayOrder, stored.name], [true, 3, "Name only"]);
    } finally {
      await prisma.language.update({ where: { id: hi.id }, data: { name: hi.name, isActive: hi.isActive, displayOrder: hi.displayOrder } });
    }
  });

  test("a code no order uses can still be changed, but not to an existing code", async () => {
    const draft = await prisma.language.findUniqueOrThrow({ where: { code: code.draftOnly } });
    const taken = await call("PATCH", `/admin/languages/${draft.id}`, users.admin.token, { code: code.en });
    assert.equal(taken.status, 409, taken.raw);
    const ok = await call("PATCH", `/admin/languages/${draft.id}`, users.admin.token, { code: `n${run}` });
    assert.equal(ok.status, 200, ok.raw);
    assert.equal(ok.body.language.code, `n${run}`);
    await prisma.language.update({ where: { id: draft.id }, data: { code: code.draftOnly } });
  });
});

describe("concurrent refunds", () => {
  /** A customer who paid for two languages, as markOrderPaid leaves it: access on the latest order. */
  async function twoLanguageBuyer(n: number) {
    const name = `concurrent${n}`;
    await makeUser(name);
    const paid = async (language: string, minutesAgo: number) =>
      prisma.order.create({
        data: {
          userId: users[name].id, courseId: pkg, amountInPaise: PRICE, status: "PAID", selectedLanguage: language,
          razorpayOrderId: `${tag}-${name}-${language}`, razorpayPaymentId: `pay_${tag}${name}${language}`,
          referrerUserId: users.referrer.id, paidAt: new Date(Date.now() - minutesAgo * 60_000),
        },
      });
    const a = await paid(code.hi, 10);
    const b = await paid(code.te, 5);
    await prisma.courseAccess.create({ data: { userId: users[name].id, courseId: pkg, orderId: b.id, languageGranted: code.te } });
    for (const o of [a, b]) await prisma.commissionLedger.create({ data: { partnerId: users.referrer.id, orderId: o.id, amountInPaise: COMMISSION, status: "CREDITED" } });
    return { name, a, b };
  }

  test("refunding both language orders at once ends with access revoked, both orders and commissions reversed", async () => {
    for (let n = 0; n < 6; n++) {
      const { name, a, b } = await twoLanguageBuyer(n);
      const results = await Promise.all([reverseOrder(a.razorpayPaymentId!, "refund_processed"), reverseOrder(b.razorpayPaymentId!, "refund_processed")]);
      assert.deepEqual(results.map((r) => r.ok), [true, true], `round ${n}`);

      const access = await prisma.courseAccess.findFirstOrThrow({ where: { userId: users[name].id }, include: { order: true } });
      assert.notEqual(access.revokedAt, null, `round ${n}: no PAID order left, so access is revoked`);
      const orders = await prisma.order.findMany({ where: { userId: users[name].id } });
      assert.deepEqual(orders.map((o) => o.status), ["REFUNDED", "REFUNDED"], `round ${n}`);
      const ledger = await prisma.commissionLedger.findMany({ where: { orderId: { in: [a.id, b.id] } } });
      assert.deepEqual(ledger.map((c) => c.status), ["REVERSED", "REVERSED"], `round ${n}`);
      assert.deepEqual(await library(name), { status: 403, code: "NOT_PURCHASED" });
    }
  });

  test("the same refund delivered twice at once is applied once", async () => {
    const { name, a } = await twoLanguageBuyer(100);
    const results = await Promise.all([reverseOrder(a.razorpayPaymentId!, "refund_processed"), reverseOrder(a.razorpayPaymentId!, "refund_processed")]);
    assert.deepEqual(results.map((r) => r.ok).sort(), [false, true]);
    assert.equal(await prisma.auditLog.count({ where: { target: a.id, action: "ORDER_REFUNDED" } }), 1);

    // The other language (te) is still PAID and the access row still points at it.
    const access = await prisma.courseAccess.findFirstOrThrow({ where: { userId: users[name].id }, include: { order: true } });
    assert.equal(access.revokedAt, null);
    assert.equal(access.order.status, "PAID");
    assert.deepEqual((await library(name)).locked, { [ebook.en]: true, [ebook.hi]: true, [ebook.te]: false });
  });

  test("refunding the order the access row isn't on keeps access on the still-PAID order", async () => {
    const { name, a, b } = await twoLanguageBuyer(200);
    assert.equal((await reverseOrder(a.razorpayPaymentId!, "refund_processed")).ok, true);
    const access = await prisma.courseAccess.findFirstOrThrow({ where: { userId: users[name].id } });
    assert.equal(access.orderId, b.id);
    assert.equal(access.revokedAt, null);
  });
});
