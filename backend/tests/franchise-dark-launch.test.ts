/**
 * Franchise dark launch: FRANCHISE_PUBLIC_ENABLED gates the public and applicant franchise API.
 * OFF (the default): every /api/franchise/* route is the app's normal 404 — before authentication and
 * before any upload is read — while admin franchise routes and the rest of the app are unaffected.
 * ON: the same routes answer normally. Read-only against the local database (nothing is created
 * except two test users, removed afterwards).
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
import { franchisePublicEnabled, isSwitchOn } from "../src/utils/feature-flags.js";

const original = process.env.FRANCHISE_PUBLIC_ENABLED;
delete process.env.FRANCHISE_PUBLIC_ENABLED; // the default: unset, whatever a local .env says

const tag = `zz-test-${randomBytes(4).toString("hex")}`;
let server: Server;
let base = "";
const userIds: string[] = [];
const tokens: Record<string, string> = {};

async function makeUser(name: string, role: "USER" | "ADMIN") {
  const u = await prisma.user.create({
    data: { name, email: `${tag}-${name}@example.test`, username: `${tag}-${name}`, passwordHash: "x", referralCode: `D${tag.slice(-8)}${userIds.length}`.toUpperCase(), role, emailVerified: new Date() },
  });
  userIds.push(u.id);
  tokens[name] = signSessionToken({ id: u.id, name, email: u.email, role, referralCode: u.referralCode }, u.passwordHash);
}

async function call(method: string, path: string, who: string | null, body?: BodyInit, contentType?: string) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { ...(who ? { Authorization: `Bearer ${tokens[who]}` } : {}), ...(contentType ? { "Content-Type": contentType } : {}) },
    body,
  });
  const text = await res.text();
  return { status: res.status, text };
}

const PUBLIC_ROUTES: [string, string, boolean][] = [
  ["GET", "/franchise/info", false],
  ["GET", "/franchise/locations", false],
  ["GET", "/franchise/applications/me", true],
  ["GET", "/franchise/applications/me/documents/any-id/url", true],
  ["POST", "/franchise/applications", true],
  ["GET", "/franchise/anything-else", false],
];

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await makeUser("admin", "ADMIN");
  await makeUser("student", "USER");
});

after(async () => {
  if (original === undefined) delete process.env.FRANCHISE_PUBLIC_ENABLED;
  else process.env.FRANCHISE_PUBLIC_ENABLED = original;
  try {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  } finally {
    server.close();
  }
});

describe("switch parsing", () => {
  test("only an explicit \"true\" (any case, trimmed) turns it on", () => {
    for (const v of ["true", "TRUE", " True "]) assert.equal(isSwitchOn(v), true, JSON.stringify(v));
    for (const v of [undefined, "", "false", "0", "1", "yes", "on", "enabled", "tru", "true!"]) assert.equal(isSwitchOn(v), false, JSON.stringify(v));
  });
});

describe("OFF (default)", () => {
  test("the switch is off when unset", () => {
    assert.equal(franchisePublicEnabled(), false);
  });

  test("every public/applicant franchise route is a plain 404, signed in or not", async () => {
    for (const [method, path, needsUser] of PUBLIC_ROUTES) {
      for (const who of needsUser ? [null, "student", "admin"] : [null, "student"]) {
        const r = await call(method, path, who, method === "POST" ? new FormData() : undefined);
        assert.equal(r.status, 404, `${method} ${path} as ${who ?? "anonymous"}: ${r.text}`);
        assert.deepEqual(JSON.parse(r.text), { error: "Not found" }, "indistinguishable from an unknown route");
      }
    }
  });

  test("an upload is refused before authentication or upload handling (404, not 401 or 413)", async () => {
    const big = new FormData();
    big.append("idProof", new Blob([new Uint8Array(6 * 1024 * 1024)], { type: "application/pdf" }), "big.pdf");
    const r = await call("POST", "/franchise/applications", null, big);
    assert.equal(r.status, 404, "an anonymous 6 MB upload gets neither the auth 401 nor the size-limit 413");
  });

  test("admin franchise pages' APIs stay available to admins, and stay closed to everyone else", async () => {
    for (const path of ["/admin/franchise/locations", "/admin/franchise/policies/schema", "/admin/franchise/policies/readiness", "/admin/franchise/applications", "/admin/franchise/applications/summary"]) {
      assert.equal((await call("GET", path, "admin")).status, 200, `${path} as admin`);
      assert.equal((await call("GET", path, "student")).status, 403, `${path} as student`);
      assert.equal((await call("GET", path, null)).status, 401, `${path} signed out`);
    }
  });

  test("the rest of the app is unaffected", async () => {
    assert.equal((await call("GET", "/health", null)).status, 200);
    assert.equal((await call("GET", "/courses", null)).status, 200);
    assert.equal((await call("GET", "/languages", null)).status, 200);
    assert.equal((await call("GET", "/settings/public", null)).status, 200);
    assert.equal((await call("GET", "/auth/session", "student")).status, 200);
  });
});

describe("ON", () => {
  test("with FRANCHISE_PUBLIC_ENABLED=true the routes answer normally", async () => {
    process.env.FRANCHISE_PUBLIC_ENABLED = "true";
    try {
      assert.equal(franchisePublicEnabled(), true);
      const info = await call("GET", "/franchise/info", null);
      assert.equal(info.status, 200, info.text);
      assert.equal(typeof JSON.parse(info.text).open, "boolean");
      assert.equal((await call("GET", "/franchise/locations", null)).status, 200);
      assert.equal((await call("GET", "/franchise/applications/me", null)).status, 401, "normal auth applies again");
      const mine = await call("GET", "/franchise/applications/me", "student");
      assert.equal(mine.status, 200);
      assert.deepEqual(JSON.parse(mine.text), { application: null });
      assert.equal((await call("GET", "/franchise/anything-else", null)).status, 404, "unknown paths are still 404");
    } finally {
      delete process.env.FRANCHISE_PUBLIC_ENABLED;
    }
  });

  test("switching back off takes effect immediately (read per request)", async () => {
    process.env.FRANCHISE_PUBLIC_ENABLED = "true";
    assert.equal((await call("GET", "/franchise/info", null)).status, 200);
    process.env.FRANCHISE_PUBLIC_ENABLED = "false";
    assert.equal((await call("GET", "/franchise/info", null)).status, 404);
    delete process.env.FRANCHISE_PUBLIC_ENABLED;
    assert.equal((await call("GET", "/franchise/info", null)).status, 404);
  });
});
