// Run with `npm test` (Node strips the TypeScript types of the imported module).
import { test } from "node:test";
import assert from "node:assert/strict";
import { adminNotifyStatusText, testNotificationResult } from "../lib/admin-notify.ts";

test("status text: on with masked recipients, off when not configured", () => {
  assert.equal(adminNotifyStatusText({ enabled: true, recipients: ["ec***@gmail.com"] }), "On — sent to ec***@gmail.com.");
  assert.match(adminNotifyStatusText({ enabled: false, recipients: [] }), /^Off — ADMIN_NOTIFY_EMAIL isn't set/);
  assert.match(adminNotifyStatusText(null), /Couldn't load/);
});

test("test-send result messages", () => {
  assert.deepEqual(testNotificationResult(200, { sent: 1, recipients: ["ec***@gmail.com"] }), { ok: true, text: "Test email sent to ec***@gmail.com. Check the inbox (and spam folder)." });
  assert.equal(testNotificationResult(409, { code: "ADMIN_NOTIFY_NOT_CONFIGURED" }).ok, false);
  assert.match(testNotificationResult(429, {}).text, /Too many/);
  assert.match(testNotificationResult(502, { error: "The test email couldn't be sent. Check the email settings in the server logs." }).text, /couldn't be sent/);
});
