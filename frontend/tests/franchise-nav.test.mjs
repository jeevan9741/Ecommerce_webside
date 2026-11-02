// Run with `npm test` (Node strips the TypeScript types of the imported module).
import { test } from "node:test";
import assert from "node:assert/strict";
import { BECOME_PARTNER_LINK, FRANCHISE_DASHBOARD_LINK, FRANCHISE_LINK, signedInFranchiseLink, visitorFranchiseCta } from "../lib/franchise-nav.ts";
import { franchisePartnerEnabled } from "../lib/feature-flags.ts";

test("visitors: 'Become a Franchise Partner' beside Login only while the public switch is on", () => {
  assert.equal(visitorFranchiseCta(false), null);
  assert.deepEqual(visitorFranchiseCta(true), BECOME_PARTNER_LINK);
  assert.equal(BECOME_PARTNER_LINK.label, "Become a Franchise Partner");
  assert.equal(BECOME_PARTNER_LINK.href, "/franchise");
});

test("signed-in: active partners get the dashboard, others the public page, admins nothing", () => {
  const base = { role: "USER", publicOn: true, partnerOn: true, partnerActive: false };
  assert.deepEqual(signedInFranchiseLink({ ...base, partnerActive: true }), FRANCHISE_DASHBOARD_LINK);
  assert.deepEqual(signedInFranchiseLink(base), FRANCHISE_LINK);
  assert.equal(signedInFranchiseLink({ ...base, publicOn: false }), null);
  assert.deepEqual(signedInFranchiseLink({ ...base, publicOn: false, partnerActive: true }), FRANCHISE_DASHBOARD_LINK, "partner switch is independent");
  assert.deepEqual(signedInFranchiseLink({ ...base, partnerOn: false, partnerActive: true }), FRANCHISE_LINK, "partner switch off → no dashboard link");
  assert.equal(signedInFranchiseLink({ ...base, role: "ADMIN", partnerActive: true }), null, "admins never get franchise links");
});

test("the partner switch is OFF by default and ON only for an explicit true", () => {
  assert.equal(franchisePartnerEnabled(undefined), false);
  assert.equal(franchisePartnerEnabled("false"), false);
  assert.equal(franchisePartnerEnabled("1"), false);
  assert.equal(franchisePartnerEnabled(" TRUE "), true);
});
