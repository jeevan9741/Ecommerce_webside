// Run with `npm test` (Node strips the TypeScript types of the imported module).
import { test } from "node:test";
import assert from "node:assert/strict";
import { CATEGORY_LABEL, TICKET_CATEGORIES, TICKET_STATUS_LABEL, adminStatusTargets, newTicketError, partnerCanReply } from "../lib/franchise-tickets.ts";

test("the five categories and four statuses all have labels", () => {
  assert.deepEqual([...TICKET_CATEGORIES], ["TECHNICAL", "PAYMENT", "STUDENT", "COURSE", "OTHER"]);
  for (const c of TICKET_CATEGORIES) assert.ok(CATEGORY_LABEL[c]);
  for (const s of ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]) assert.ok(TICKET_STATUS_LABEL[s]);
});

test("admins can move to any other status until closed; closed is final for everyone", () => {
  assert.deepEqual(adminStatusTargets("OPEN"), ["IN_PROGRESS", "RESOLVED", "CLOSED"]);
  assert.deepEqual(adminStatusTargets("RESOLVED"), ["OPEN", "IN_PROGRESS", "CLOSED"]);
  assert.deepEqual(adminStatusTargets("CLOSED"), []);
  assert.equal(partnerCanReply("RESOLVED"), true);
  assert.equal(partnerCanReply("CLOSED"), false);
});

test("new ticket form checks mirror the server", () => {
  assert.equal(newTicketError({ subject: "Videos not loading", category: "TECHNICAL", message: "Details" }), null);
  assert.match(newTicketError({ subject: "Hey", category: "TECHNICAL", message: "x" }), /subject/);
  assert.match(newTicketError({ subject: "Valid subject", category: "BILLING", message: "x" }), /category/);
  assert.match(newTicketError({ subject: "Valid subject", category: "OTHER", message: "   " }), /Describe/);
  assert.match(newTicketError({ subject: "Valid subject", category: "OTHER", message: "x".repeat(5001) }), /5000/);
});
