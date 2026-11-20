// Run with `npm test` (Node strips the TypeScript types of the imported module).
import { test } from "node:test";
import assert from "node:assert/strict";
import { APPROVED_WARNING, STANDARD_WARNING, withdrawBody, withdrawPrompt } from "../lib/franchise-withdraw.ts";

test("before approval: the usual short warning, no acknowledgement, and no confirmation in the request", () => {
  assert.deepEqual(withdrawPrompt(false), { warning: STANDARD_WARNING, acknowledgement: null });
  assert.deepEqual(withdrawBody(false, false), {});
});

test("after approval: the strong warning, an acknowledgement, and confirmApproved only once it's ticked", () => {
  const p = withdrawPrompt(true);
  assert.equal(p.warning, APPROVED_WARNING);
  assert.match(p.warning, /give up this approval/);
  assert.match(p.warning, /state reservation/);
  assert.match(p.warning, /can't be undone/);
  assert.ok(p.acknowledgement);
  assert.equal(withdrawBody(true, false), null, "nothing is sent until the box is ticked");
  assert.deepEqual(withdrawBody(true, true), { confirmApproved: true });
});
