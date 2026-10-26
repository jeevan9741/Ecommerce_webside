// Run with `npm test` (Node strips the TypeScript types of the imported module).
import { test } from "node:test";
import assert from "node:assert/strict";
import { initialCheckoutLanguage } from "../lib/checkout-language.ts";

const langs = (...codes) => codes.map((code) => ({ code }));

test("e-book packages with several languages make the customer choose", () => {
  assert.equal(initialCheckoutLanguage({ type: "EBOOK", languages: langs("en", "hi", "te") }), "");
});

test("a single e-book language or a preset language is used directly", () => {
  assert.equal(initialCheckoutLanguage({ type: "EBOOK", languages: langs("hi") }), "hi");
  assert.equal(initialCheckoutLanguage({ type: "EBOOK", languages: langs("en", "hi") }, "hi"), "hi");
  assert.equal(initialCheckoutLanguage({ type: "EBOOK", languages: [] }), "", "nothing to sell yet");
});

test("other packages keep starting on their first language", () => {
  assert.equal(initialCheckoutLanguage({ type: "VIDEO", languages: langs("en", "hi") }), "en");
  assert.equal(initialCheckoutLanguage({ type: "ZOOM", languages: [] }), "");
});
