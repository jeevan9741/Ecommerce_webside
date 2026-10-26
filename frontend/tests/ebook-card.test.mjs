// Run with `npm test` (Node strips the TypeScript types of the imported module).
import { test } from "node:test";
import assert from "node:assert/strict";
import { adminLibraryNote, downloadFailure, ebookCardAction, legacyAllLanguagesNote } from "../lib/ebook-card.ts";

const pkg = { id: "starter", type: "EBOOK" };
const book = (code, name, locked) => ({ locked, language: { code, name }, course: { id: "starter" } });

test("a Telugu purchaser gets Download only on Telugu; every other language is a locked purchase", () => {
  const library = [book("te", "Telugu", false), book("kn", "Kannada", true), book("en", "English", true), book("hi", "Hindi", true)];
  const actions = library.map((b) => ebookCardAction(b, pkg));
  assert.deepEqual(actions.map((a) => a.kind), ["download", "buy", "buy", "buy"]);
  assert.deepEqual(actions[1], { kind: "buy", languageCode: "kn", languageName: "Kannada", packageId: "starter" });
});

test("anything not explicitly unlocked by the server is locked", () => {
  for (const locked of [true, undefined, null, "false", 0]) {
    assert.notEqual(ebookCardAction({ ...book("kn", "Kannada", locked) }, pkg).kind, "download", `locked=${JSON.stringify(locked)}`);
  }
});

test("other packages' locked e-books can't be bought per language", () => {
  assert.deepEqual(ebookCardAction(book("kn", "Kannada", true), { id: "starter", type: "VIDEO" }), { kind: "not-included", languageName: "Kannada" });
  assert.equal(ebookCardAction(book("kn", "Kannada", true), undefined).kind, "not-included");
  assert.equal(ebookCardAction(book("kn", "Kannada", true), { id: "other", type: "EBOOK" }).kind, "not-included");
});

test("the legacy note appears only for an all-languages purchase", () => {
  assert.match(legacyAllLanguagesNote({ allLanguages: true }), /before e-books were sold per language/);
  assert.equal(legacyAllLanguagesNote({ allLanguages: false }), null);
  assert.equal(legacyAllLanguagesNote(undefined), null);
});

test("a refused download explains itself and reloads entitlements (e.g. a stale tab)", () => {
  assert.deepEqual(downloadFailure(403, "LANGUAGE_NOT_PURCHASED", "x"), { message: "This language isn't included in your purchase.", reload: true });
  assert.equal(downloadFailure(403, "NOT_PURCHASED", "x").reload, true);
  assert.deepEqual(downloadFailure(429, "RATE", "Too many downloads."), { message: "Too many downloads.", reload: false });
  assert.equal(downloadFailure(null, null, null).reload, false);
});

test("the admin banner shows for admins only, and doesn't misdescribe customers' access", () => {
  assert.match(adminLibraryNote("ADMIN"), /^Admin view: every e-book is available to you\./);
  assert.match(adminLibraryNote("ADMIN"), /languages their purchase includes/, "true for language-specific and legacy buyers alike");
  for (const role of ["USER", "admin", "", null, undefined]) assert.equal(adminLibraryNote(role), null, String(role));
});
