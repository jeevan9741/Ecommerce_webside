// Run with `npm test` (Node strips the TypeScript types of the imported module).
import { test } from "node:test";
import assert from "node:assert/strict";
import { APPLY_LINK, PARTNER_PAGE_APPLY_LINK, applicationsOpen, applyPageTitle, BECOME_PARTNER_LINK, FRANCHISE_DASHBOARD_LINK, FRANCHISE_LINK, homeFranchiseBadge, homeFranchiseClosing, PARTNER_LOGIN_LINK, partnerAreaNeedsSignIn, partnerAreaTitle, signedInFranchiseLink, visitorFranchiseCta } from "../lib/franchise-nav.ts";
import { franchisePartnerEnabled, franchisePublicEnabled } from "../lib/feature-flags.ts";

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

test("homepage franchise entry points: partner login → /franchise-partner, become a partner → /franchise/apply", () => {
  assert.deepEqual(PARTNER_LOGIN_LINK, { href: "/franchise-partner", label: "Franchise Partner Login" });
  assert.deepEqual(APPLY_LINK, { href: "/franchise/apply", label: "Become a Franchise Partner" });
});

test("the partner area asks visitors to sign in only while the partner dashboard is switched on", () => {
  assert.equal(partnerAreaNeedsSignIn(false), false, "switched off → coming-soon page, no login form");
  assert.equal(partnerAreaNeedsSignIn(true), true);
  assert.equal(partnerAreaNeedsSignIn(franchisePartnerEnabled(undefined)), false, "default (unset) is off");
});

test("partner area browser title: 'coming soon' while switched off, the dashboard title while on", () => {
  assert.deepEqual(partnerAreaTitle(false), { absolute: "Franchise Partner Login | Coming Soon" });
  assert.equal(partnerAreaTitle(true), "Franchise Dashboard");
  assert.deepEqual(partnerAreaTitle(franchisePartnerEnabled(undefined)), { absolute: "Franchise Partner Login | Coming Soon" }, "default (unset) is off");
});

test("applications count as open only when the public switch is on AND the server's intake check says open", () => {
  assert.equal(applicationsOpen(true, { open: true }), true);
  // Approved launch configuration: public pages on, intake closed → closed.
  assert.equal(applicationsOpen(true, { open: false }), false, "public on, intake closed");
  assert.equal(applicationsOpen(false, { open: true }), false, "public switch off");
  assert.equal(applicationsOpen(false, { open: false }), false);
  // Fail closed: API down, unexpected answer, or switch unset.
  assert.equal(applicationsOpen(true, null), false, "API unreachable");
  assert.equal(applicationsOpen(true, undefined), false);
  assert.equal(applicationsOpen(true, {}), false, "no open field");
  assert.equal(applicationsOpen(true, { open: "true" }), false, "only a real boolean true counts");
  assert.equal(applicationsOpen(franchisePublicEnabled(undefined), { open: true }), false, "default (unset) public switch is off");
});

test("homepage franchise copy: 'opening soon' until applications are open, the approved wording once open", () => {
  assert.equal(homeFranchiseBadge(false), "Applications opening soon");
  assert.equal(homeFranchiseBadge(true), "Franchise opportunity");
  assert.equal(homeFranchiseClosing(false), ". Applications aren't open yet. We'll announce here when they open.");
  assert.equal(homeFranchiseClosing(true), ", and our team reviews every application.");
  // Launch configuration: public on, intake closed.
  assert.equal(homeFranchiseBadge(applicationsOpen(true, { open: false })), "Applications opening soon");
  assert.equal(homeFranchiseClosing(applicationsOpen(true, { open: false })), ". Applications aren't open yet. We'll announce here when they open.");
  assert.equal(homeFranchiseBadge(applicationsOpen(true, { open: true })), "Franchise opportunity");
});

test("apply page browser title: 'coming soon' until applications are open", () => {
  assert.deepEqual(applyPageTitle(false), { absolute: "Franchise Applications | Coming Soon" });
  assert.equal(applyPageTitle(true), "Apply for a Franchise");
  assert.deepEqual(applyPageTitle(applicationsOpen(true, { open: false })), { absolute: "Franchise Applications | Coming Soon" }, "public on, intake closed");
  assert.deepEqual(applyPageTitle(applicationsOpen(false, { open: true })), { absolute: "Franchise Applications | Coming Soon" }, "public off");
  assert.equal(applyPageTitle(applicationsOpen(true, { open: true })), "Apply for a Franchise");
});

test("partner page offers 'Apply for Franchise': the apply page, never a partner sign-up", () => {
  assert.deepEqual(PARTNER_PAGE_APPLY_LINK, { href: "/franchise/apply", label: "Apply for Franchise" });
  assert.equal(PARTNER_PAGE_APPLY_LINK.href, APPLY_LINK.href, "same intake-gated apply page as the homepage");
});
