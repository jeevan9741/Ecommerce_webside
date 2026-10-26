/**
 * Regression matrix for the "every language shows Download" report. Purchases go through the REAL
 * checkout (POST /checkout/create-order) and the REAL payment path (markOrderPaid); only Razorpay's
 * order creation is stubbed. Covers a Telugu purchaser, other languages, parameter tampering,
 * unauthenticated access, a second purchase, the documented legacy rule, admins and caching.
 * Everything is prefixed "zz-test-".
 */
import "./local-db-guard.js"; // first: refuses to run against a non-local (production) database
import { after, before, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomBytes } from "node:crypto";

let seq = 0;
mock.module("../src/services/razorpay.service.js", {
  namedExports: {
    RazorpayConfigError: class RazorpayConfigError extends Error {},
    getRazorpayClient: () => ({
      orders: {
        create: async (o: { amount: number }) => ({ id: `order_zzreg${Date.now()}${seq++}`, amount: o.amount, currency: "INR" }),
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
const { markOrderPaid } = await import("../src/services/order.service.js");
const { LEGACY_ALL_LANGUAGE_ORDERS_BEFORE } = await import("../src/services/package-access.service.js");

const tag = `zz-test-${randomBytes(4).toString("hex")}`;
// Letters only: language codes must look like ISO codes.
const run = randomBytes(3).toString("hex").replace(/[0-9]/g, (d) => "ghijklmnop"[Number(d)]);
const LANGS = { te: "Telugu", kn: "Kannada", en: "English", hi: "Hindi" } as const;
type L = keyof typeof LANGS;
const code = (l: L) => `${l}${run}`;
const PRICE = 34900;
let server: Server;
let base = "";
let pkg = "";
const ids = { users: [] as string[], languages: [] as string[] };
const ebook = {} as Record<L, string>;
const users: Record<string, { id: string; token: string }> = {};

async function makeUser(name: string, role: "USER" | "ADMIN" = "USER") {
  const u = await prisma.user.create({
    data: { name, email: `${tag}-${name}@example.test`, username: `${tag}-${name}`, passwordHash: "x", referralCode: `R${run}${ids.users.length}`.toUpperCase(), role, emailVerified: new Date() },
  });
  ids.users.push(u.id);
  users[name] = { id: u.id, token: signSessionToken({ id: u.id, name, email: u.email, role, referralCode: u.referralCode }, u.passwordHash) };
}

async function call(method: string, path: string, user: string | null, body?: unknown) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { ...(user ? { Authorization: `Bearer ${users[user].token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null, raw: text };
}

/** Buy one language exactly as a customer does: checkout, then Razorpay's captured payment. */
async function buy(user: string, language: L) {
  const order = await call("POST", "/checkout/create-order", user, { courseId: pkg, selectedLanguage: code(language) });
  assert.equal(order.status, 200, order.raw);
  const paid = await markOrderPaid({
    razorpayOrderId: order.body.razorpayOrderId,
    payment: { id: `pay_${tag}${++seq}`, orderId: order.body.razorpayOrderId, amountInPaise: order.body.amountInPaise, currency: "INR", status: "captured" },
  });
  assert.equal(paid.ok, true, JSON.stringify(paid));
  return order.body.orderId as string;
}

/** language → "download" | "locked", exactly as the E-Books page receives it. */
async function library(user: string) {
  const res = await call("GET", "/me/ebooks", user);
  assert.equal(res.status, 200, res.raw);
  const out: Record<string, string> = {};
  for (const [l, id] of Object.entries(ebook)) {
    const e = (res.body.ebooks as { id: string; locked: boolean }[]).find((x) => x.id === id);
    out[l] = !e ? "absent" : e.locked === false ? "download" : "locked";
  }
  return { view: out, res };
}

const download = (user: string | null, l: L, extra: { query?: string; body?: unknown } = {}) =>
  call("POST", `/me/ebooks/${ebook[l]}/download${extra.query ?? ""}`, user, extra.body);

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  pkg = (await prisma.course.create({ data: { slug: `${tag}-starter`, type: "EBOOK", title: `${tag} Starter E-books`, shortDescription: "t", description: "t", priceInPaise: PRICE, commissionInPaise: 0 } })).id;
  for (const [l, name] of Object.entries(LANGS) as [L, string][]) {
    const lang = await prisma.language.create({ data: { code: code(l), name, nativeName: name } });
    ids.languages.push(lang.id);
    ebook[l] = (await prisma.eBook.create({ data: { courseId: pkg, languageId: lang.id, title: `${name} guide`, fileName: `${l}.pdf`, storageKey: `ebooks/${tag}-${l}.pdf`, mimeType: "application/pdf", sizeBytes: 10n } })).id;
  }
  for (const n of ["telugu", "stranger", "legacy", "legacyLate", "legacyBlank"]) await makeUser(n);
  await makeUser("admin", "ADMIN");
  await buy("telugu", "te");

  // Historical orders as the pre-release checkout left them (inserted directly: that checkout no longer exists).
  const legacy = async (user: string, createdAt: Date, selectedLanguage: string | null) => {
    const o = await prisma.order.create({ data: { userId: users[user].id, courseId: pkg, amountInPaise: PRICE, status: "PAID", selectedLanguage, createdAt, paidAt: createdAt, razorpayOrderId: `${tag}-${user}` } });
    await prisma.courseAccess.create({ data: { userId: users[user].id, courseId: pkg, orderId: o.id } });
  };
  const DAY = 86_400_000;
  await legacy("legacy", new Date(LEGACY_ALL_LANGUAGE_ORDERS_BEFORE.getTime() - 2 * DAY), null);
  await legacy("legacyLate", new Date(LEGACY_ALL_LANGUAGE_ORDERS_BEFORE.getTime() + DAY), null);
  await legacy("legacyBlank", new Date(LEGACY_ALL_LANGUAGE_ORDERS_BEFORE.getTime() + DAY), "");
});

after(async () => {
  try {
    const orders = (await prisma.order.findMany({ where: { userId: { in: ids.users } }, select: { id: true } })).map((o) => o.id);
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids.users } }, { target: { in: orders } }] } });
    await prisma.courseAccess.deleteMany({ where: { userId: { in: ids.users } } });
    await prisma.order.deleteMany({ where: { id: { in: orders } } });
    await prisma.eBook.deleteMany({ where: { courseId: pkg } });
    await prisma.course.deleteMany({ where: { id: pkg } });
    await prisma.language.deleteMany({ where: { id: { in: ids.languages } } });
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
  } finally {
    server.close();
  }
});

describe("a Telugu purchase", () => {
  test("the order records Telugu; the E-Books page offers Download for Telugu only", async () => {
    const order = await prisma.order.findFirstOrThrow({ where: { userId: users.telugu.id } });
    assert.deepEqual([order.status, order.selectedLanguage], ["PAID", code("te")]);
    const { view, res } = await library("telugu");
    assert.deepEqual(view, { te: "download", kn: "locked", en: "locked", hi: "locked" });
    assert.deepEqual(res.body.languageAccess[pkg], { allLanguages: false, languages: [code("te")] });
    assert.equal(res.headers.get("cache-control"), "private, no-store", "entitlements are never cached");
  });

  test("Telugu downloads; Kannada, English and Hindi are refused by the server", async () => {
    const ok = await download("telugu", "te");
    assert.equal(ok.status, 200, ok.raw);
    assert.match(ok.body.url, /^https?:\/\//);
    for (const l of ["kn", "en", "hi"] as const) {
      const res = await download("telugu", l);
      assert.equal(res.status, 403, `${l}: ${res.raw}`);
      assert.equal(res.body.code, "LANGUAGE_NOT_PURCHASED");
      assert.ok(!("url" in res.body) && !res.raw.includes("ebooks/"), `${l}: no link or storage key`);
    }
  });

  test("changing parameters can't bypass it: only the e-book id and the buyer's PAID orders count", async () => {
    const attempts = [
      { query: `?language=${code("kn")}` },
      { query: `?languageId=${ids.languages[1]}&courseId=${pkg}` },
      { body: { language: code("kn"), languageCode: code("kn"), languageId: ids.languages[1], selectedLanguage: code("kn") } },
      { body: { locked: false, allLanguages: true } },
    ];
    for (const extra of attempts) {
      const res = await download("telugu", "kn", extra);
      assert.equal(res.status, 403, `${JSON.stringify(extra)}: ${res.raw}`);
    }
    // Telugu's own e-book can't be "relabelled" either: the server reads the e-book's language itself.
    assert.equal((await download("telugu", "te", { query: `?language=${code("kn")}` })).status, 200);
    const filtered = await call("GET", `/me/ebooks?courseId=${pkg}&language=${code("kn")}`, "telugu");
    assert.equal((filtered.body.ebooks as { id: string; locked: boolean }[]).find((e) => e.id === ebook.kn)?.locked, true);
  });

  test("checkout can't be re-pointed: paying the Telugu order never unlocks Kannada", async () => {
    assert.equal((await prisma.order.count({ where: { userId: users.telugu.id, selectedLanguage: code("kn") } })), 0);
    assert.equal((await download("telugu", "kn")).status, 403);
  });
});

describe("download audit trail", () => {
  test("every download decision is logged with its basis — grants and refusals", async () => {
    const decisions = async (user: string) =>
      (await prisma.auditLog.findMany({ where: { actorId: users[user].id, action: { in: ["EBOOK_DOWNLOAD_GRANTED", "EBOOK_DOWNLOAD_DENIED"] } }, orderBy: { createdAt: "asc" } })).map(
        (a) => [a.action, a.target, (a.metadata as { basis: string; language: string }).basis, (a.metadata as { language: string }).language]
      );
    await makeUser("auditee");
    await buy("auditee", "te");
    await download("auditee", "te");
    await download("auditee", "kn");
    assert.deepEqual(await decisions("auditee"), [
      ["EBOOK_DOWNLOAD_GRANTED", ebook.te, "purchased-language", code("te")],
      ["EBOOK_DOWNLOAD_DENIED", ebook.kn, "LANGUAGE_NOT_PURCHASED", code("kn")],
    ]);
    await download("legacy", "hi");
    assert.deepEqual((await decisions("legacy")).at(-1), ["EBOOK_DOWNLOAD_GRANTED", ebook.hi, "legacy-all-languages", code("hi")]);
    await download("admin", "en");
    assert.deepEqual((await decisions("admin")).at(-1), ["EBOOK_DOWNLOAD_GRANTED", ebook.en, "admin", code("en")]);
    await download("stranger", "te");
    assert.deepEqual((await decisions("stranger")).at(-1), ["EBOOK_DOWNLOAD_DENIED", ebook.te, "NOT_PURCHASED", code("te")]);
    const raw = JSON.stringify(await prisma.auditLog.findMany({ where: { action: { in: ["EBOOK_DOWNLOAD_GRANTED", "EBOOK_DOWNLOAD_DENIED"] }, actorId: { in: ids.users } } }));
    assert.ok(!raw.includes("ebooks/") && !raw.includes("@example.test"), "no storage keys or personal data in the log");
  });
});

describe("download audit trail: content and failure safety", () => {
  test("each entry holds exactly the e-book id, package, language code and basis — nothing personal or secret", async () => {
    await download("telugu", "te");
    const entries = await prisma.auditLog.findMany({ where: { actorId: users.telugu.id, action: { in: ["EBOOK_DOWNLOAD_GRANTED", "EBOOK_DOWNLOAD_DENIED"] } } });
    assert.ok(entries.length > 0);
    for (const e of entries) {
      assert.deepEqual(Object.keys(e.metadata as object).sort(), ["basis", "courseId", "language"], "only these metadata fields");
      assert.ok(Object.values(ebook).includes(e.target!), "target is the e-book id");
      const raw = JSON.stringify(e);
      for (const forbidden of ["ebooks/", "http", "token", "signature", "@", "Telugu Buyer", "passwordHash", "storageKey"]) {
        assert.ok(!raw.includes(forbidden), `no "${forbidden}" in ${raw}`);
      }
    }
  });

  test("if writing the audit log fails, refusals are still refused and nothing extra is granted", async () => {
    // Local test database only: make every e-book download audit insert fail.
    const fn = `zz_fail_ebook_audit_${run}`;
    await prisma.$executeRawUnsafe(`CREATE FUNCTION ${fn}() RETURNS trigger AS $$ BEGIN IF NEW.action LIKE 'EBOOK_DOWNLOAD_%' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER ${fn} BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
    try {
      const before = await prisma.auditLog.count({ where: { action: { in: ["EBOOK_DOWNLOAD_GRANTED", "EBOOK_DOWNLOAD_DENIED"] } } });
      for (const l of ["kn", "en", "hi"] as const) {
        const res = await download("telugu", l);
        assert.equal(res.status, 403, `${l} still refused: ${res.raw}`);
        assert.equal(res.body.code, "LANGUAGE_NOT_PURCHASED");
      }
      assert.equal((await download("stranger", "te")).status, 403, "no purchase: still refused");
      assert.equal((await download(null, "te")).status, 401, "signed out: still refused");
      assert.equal((await download("legacyLate", "te")).status, 403, "post-cutoff no-language order: still refused");
      const ok = await download("telugu", "te");
      assert.equal(ok.status, 200, "an entitled download isn't blocked by a logging outage");
      assert.equal(await prisma.auditLog.count({ where: { action: { in: ["EBOOK_DOWNLOAD_GRANTED", "EBOOK_DOWNLOAD_DENIED"] } } }), before, "the trigger really blocked every audit write");
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${fn} ON "AuditLog"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${fn}()`);
    }
  });
});

describe("other callers", () => {
  test("signed-out requests are rejected everywhere", async () => {
    assert.equal((await call("GET", "/me/ebooks", null)).status, 401);
    for (const l of Object.keys(LANGS) as L[]) assert.equal((await download(null, l)).status, 401);
  });

  test("customers without a purchase get nothing", async () => {
    assert.equal((await download("stranger", "te")).status, 403);
    assert.equal((await call("GET", "/me/ebooks", "stranger")).body.ebooks.length, 0);
  });

  test("admins keep full access", async () => {
    for (const l of Object.keys(LANGS) as L[]) assert.equal((await download("admin", l)).status, 200, l);
    const { view } = await library("admin");
    assert.deepEqual(view, { te: "download", kn: "download", en: "download", hi: "download" });
  });
});

describe("a second, separate purchase", () => {
  test("buying Kannada adds Kannada only; English and Hindi stay locked", async () => {
    await buy("telugu", "kn");
    const { view, res } = await library("telugu");
    assert.deepEqual(view, { te: "download", kn: "download", en: "locked", hi: "locked" });
    assert.deepEqual(res.body.languageAccess[pkg], { allLanguages: false, languages: [code("kn"), code("te")].sort() });
    assert.equal((await download("telugu", "kn")).status, 200);
    for (const l of ["en", "hi"] as const) assert.equal((await download("telugu", l)).status, 403);
    const again = await call("POST", "/checkout/create-order", "telugu", { courseId: pkg, selectedLanguage: code("te") });
    assert.equal(again.status, 409, "an owned language can't be bought twice");
  });
});

describe("the documented legacy rule", () => {
  test("a pre-cutoff paid order with no language keeps every language — and says why", async () => {
    const { view, res } = await library("legacy");
    assert.deepEqual(view, { te: "download", kn: "download", en: "download", hi: "download" });
    assert.deepEqual(res.body.languageAccess[pkg], { allLanguages: true, languages: [] });
  });

  test("no language after the cutoff (null or empty) never falls back to all languages", async () => {
    for (const user of ["legacyLate", "legacyBlank"]) {
      const { view, res } = await library(user);
      assert.deepEqual(view, { te: "locked", kn: "locked", en: "locked", hi: "locked" }, user);
      assert.deepEqual(res.body.languageAccess[pkg], { allLanguages: false, languages: [] }, user);
      for (const l of Object.keys(LANGS) as L[]) assert.equal((await download(user, l)).status, 403, `${user} ${l}`);
    }
  });
});
