// Run with `npm test` (Node strips the TypeScript types of the imported module).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ADMIN_LOGIN_HANDOFF_KEY, offerAdminLogin, saveAdminLoginIdentifier, takeAdminLoginIdentifier } from "../lib/admin-login-handoff.ts";

const memoryStore = () => {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

test("'Go to admin login' is offered only when the server asks for the authenticator (admin accounts)", () => {
  assert.equal(offerAdminLogin({ ok: false, mfaRequired: true, challengeToken: "t" }), true);
  assert.equal(offerAdminLogin({ ok: false, error: "Invalid email/username or password." }), false, "wrong password: no admin link");
  assert.equal(offerAdminLogin({ ok: false, mfaRequired: false, error: "x" }), false);
  assert.equal(offerAdminLogin({ ok: true, user: { role: "USER" } }), false, "a student who signed in: no admin link");
  assert.equal(offerAdminLogin({ ok: true, user: { role: "ADMIN" }, mfaEnrollmentRequired: true }), false);
});

test("only the email/username is handed over — once, trimmed — and never the password", () => {
  const s = memoryStore();
  saveAdminLoginIdentifier(s, "  admin@example.test ");
  assert.deepEqual([...s.m.entries()], [[ADMIN_LOGIN_HANDOFF_KEY, "admin@example.test"]], "a single key holding the identifier");
  assert.equal(takeAdminLoginIdentifier(s), "admin@example.test");
  assert.equal(s.m.size, 0, "removed after reading");
  assert.equal(takeAdminLoginIdentifier(s), "", "read once");
  assert.equal(saveAdminLoginIdentifier.length, 2, "takes a store and the identifier only (no password parameter)");
});

test("empty, oversized or unavailable storage is ignored safely", () => {
  const s = memoryStore();
  saveAdminLoginIdentifier(s, "   ");
  saveAdminLoginIdentifier(s, "x".repeat(255));
  assert.equal(s.m.size, 0);
  assert.equal(takeAdminLoginIdentifier(null), "");
  saveAdminLoginIdentifier(null, "admin");
  const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => {} };
  assert.doesNotThrow(() => saveAdminLoginIdentifier(throwing, "admin"));
  assert.equal(takeAdminLoginIdentifier(throwing), "");
});
