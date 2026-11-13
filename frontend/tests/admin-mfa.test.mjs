// Run with `npm test` (Node strips the TypeScript types of the imported module).
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupSecret, mfaRedirect } from "../lib/admin-mfa.ts";

test("setup keys are shown in groups of four, upper-case", () => {
  assert.equal(groupSecret("jbswy3dpehpk3pxp"), "JBSW Y3DP EHPK 3PXP");
  assert.equal(groupSecret("ABCDE"), "ABCD E");
});

test("the admin area sends unverified sessions to set up or sign in again; verified or unenforced pass", () => {
  assert.equal(mfaRedirect({ enforced: true, enrolled: false, sessionVerified: false }), "/admin/mfa");
  assert.equal(mfaRedirect({ enforced: true, enrolled: true, sessionVerified: false }), "/admin/login?reason=mfa");
  assert.equal(mfaRedirect({ enforced: true, enrolled: true, sessionVerified: true }), null);
  assert.equal(mfaRedirect({ enforced: false, enrolled: false, sessionVerified: false }), null);
  assert.equal(mfaRedirect(null), null);
});
