// Run with `npm test` (Node strips the TypeScript types of the imported modules).
import { test } from "node:test";
import assert from "node:assert/strict";
import { FRANCHISE_ADMIN_SECTIONS, activeFranchiseSection, isFranchiseAdminPath } from "../lib/franchise-admin-nav.ts";

test("the Franchise Management menu has the eight agreed sections, in order", () => {
  assert.deepEqual(
    FRANCHISE_ADMIN_SECTIONS.map((s) => s.label),
    ["Overview", "State Management", "Applications", "Franchise Partners", "Student Assignments", "Support Tickets", "Policies & Privacy Notice", "Audit History"]
  );
});

test("franchise admin pages are recognised; other admin pages are not", () => {
  for (const p of ["/admin/franchise", "/admin/franchise-states", "/admin/franchise-partners/abc", "/admin/franchise-audit"]) assert.equal(isFranchiseAdminPath(p), true, p);
  for (const p of ["/admin", "/admin/partners", "/admin/orders", "/franchise", "/franchise-partner", "/admin/franchises"]) assert.equal(isFranchiseAdminPath(p), false, p);
});

test("each page highlights its own section (detail pages and related pages included)", () => {
  assert.equal(activeFranchiseSection("/admin/franchise"), "/admin/franchise");
  assert.equal(activeFranchiseSection("/admin/franchise-states"), "/admin/franchise-states");
  assert.equal(activeFranchiseSection("/admin/franchise-locations"), "/admin/franchise-states", "locations live under State Management");
  assert.equal(activeFranchiseSection("/admin/franchise-applications/xyz"), "/admin/franchise-applications");
  assert.equal(activeFranchiseSection("/admin/franchise-tickets/t1"), "/admin/franchise-tickets");
  assert.equal(activeFranchiseSection("/admin/orders"), null);
});
