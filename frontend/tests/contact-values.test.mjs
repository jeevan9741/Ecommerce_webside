// Run with `npm test` (Node strips the TypeScript types of the imported module).
import { test } from "node:test";
import assert from "node:assert/strict";
import { isPlaceholderContact, shownContact, telHref } from "../lib/contact-values.ts";

// The built-in defaults the site used to fall back to (and that the admin settings form pre-fills).
const BUILT_IN_DEFAULTS = {
  address: "Rayadurgam, Andhra Pradesh, India",
  email: "support@ecommerceacademy.in",
  phone: "+91 00000 00000",
  whatsapp: "https://wa.me/910000000000",
  telegram: "https://t.me/ecommercetrainingacademy",
};

test("nothing saved → nothing shown (the built-in defaults are never used)", () => {
  for (const saved of [undefined, null, {}, "x", 42]) assert.deepEqual(shownContact(saved), {}, JSON.stringify(saved));
});

test("saved placeholders are dropped: all-zero phone and WhatsApp", () => {
  const shown = shownContact(BUILT_IN_DEFAULTS);
  assert.equal(shown.phone, undefined);
  assert.equal(shown.whatsapp, undefined);
  // Real-looking values an admin saved are kept.
  assert.equal(shown.email, "support@ecommerceacademy.in");
  assert.equal(shown.address, "Rayadurgam, Andhra Pradesh, India");
  assert.equal(shown.telegram, "https://t.me/ecommercetrainingacademy");
});

test("real details are shown; malformed ones are not", () => {
  const ok = shownContact({ phone: "+91 98000 00012", whatsapp: "https://wa.me/919800000012", email: "help@example.in", address: "12 Main Road", telegram: "https://t.me/eta" });
  assert.deepEqual(ok, { phone: "+91 98000 00012", whatsapp: "https://wa.me/919800000012", email: "help@example.in", address: "12 Main Road", telegram: "https://t.me/eta" });
  const bad = shownContact({
    phone: "call us",
    whatsapp: "https://evil.example/wa.me/919800000012",
    email: "not-an-email",
    address: " ",
    telegram: "https://t.me/",
  });
  assert.deepEqual(bad, {});
  assert.deepEqual(shownContact({ whatsapp: "javascript:alert(1)", telegram: "ftp://t.me/x" }), {});
});

test("placeholder detection", () => {
  for (const v of ["+91 00000 00000", "https://wa.me/910000000000", "0000000000", "", "  ", undefined, null]) assert.equal(isPlaceholderContact(v), true, String(v));
  for (const v of ["+91 98000 00012", "https://wa.me/919800000012", "help@example.in", "https://t.me/eta"]) assert.equal(isPlaceholderContact(v), false, v);
});

test("tel: links keep only digits and a leading +", () => {
  assert.equal(telHref("+91 98000 00012"), "tel:+919800000012");
  assert.equal(telHref("(080) 4567-8900"), "tel:08045678900");
});
