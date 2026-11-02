// Run with `npm test` (Node strips the TypeScript types of the imported module).
import { test } from "node:test";
import assert from "node:assert/strict";
import { INVITE_STATUS_LABEL, MAX_SENDS, RESEND_MIN_GAP_MS, canCancel, inviteFormError, resendState } from "../lib/franchise-invite.ts";

const now = Date.parse("2026-11-01T10:00:00Z");
const ago = (ms) => new Date(now - ms).toISOString();

test("resend: open or expired, under the send limit, at least 15 minutes after the last send", () => {
  assert.deepEqual(resendState({ status: "OPEN", sendCount: 1, lastSentAt: ago(RESEND_MIN_GAP_MS + 1) }, now), { ok: true, reason: null });
  assert.deepEqual(resendState({ status: "EXPIRED", sendCount: 2, lastSentAt: ago(8 * 86400000) }, now), { ok: true, reason: null });
  assert.match(resendState({ status: "OPEN", sendCount: 1, lastSentAt: ago(60 * 1000) }, now).reason, /Can resend in 14 min/);
  assert.equal(resendState({ status: "OPEN", sendCount: MAX_SENDS, lastSentAt: ago(86400000) }, now).ok, false);
  assert.equal(resendState({ status: "ACCEPTED", sendCount: 1, lastSentAt: ago(86400000) }, now).ok, false);
  assert.equal(resendState({ status: "REVOKED", sendCount: 1, lastSentAt: ago(86400000) }, now).ok, false);
});

test("cancel only open or expired invitations; labels for every status", () => {
  assert.equal(canCancel({ status: "OPEN" }), true);
  assert.equal(canCancel({ status: "EXPIRED" }), true);
  assert.equal(canCancel({ status: "ACCEPTED" }), false);
  assert.equal(canCancel({ status: "REVOKED" }), false);
  for (const s of ["OPEN", "ACCEPTED", "REVOKED", "EXPIRED"]) assert.ok(INVITE_STATUS_LABEL[s], s);
});

test("invite form checks mirror the server", () => {
  assert.equal(inviteFormError({ name: "Asha", email: "asha@example.com", mobile: "" }), null);
  assert.equal(inviteFormError({ name: "Asha", email: "asha@example.com", mobile: "9876543210" }), null);
  assert.match(inviteFormError({ name: "A", email: "asha@example.com", mobile: "" }), /name/);
  assert.match(inviteFormError({ name: "Asha", email: "asha@", mobile: "" }), /email/);
  assert.match(inviteFormError({ name: "Asha", email: "asha@example.com", mobile: "12345" }), /mobile/);
});
