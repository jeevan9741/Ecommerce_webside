// Run with `npm test` (Node strips the TypeScript types of the imported module).
import { test } from "node:test";
import assert from "node:assert/strict";
import { franchisePublicEnabled, isSwitchOn, withLinkIf } from "../lib/feature-flags.ts";

test("a switch is on only for an explicit \"true\" (any case, trimmed)", () => {
  for (const v of ["true", "TRUE", " True "]) assert.equal(isSwitchOn(v), true, JSON.stringify(v));
  for (const v of [undefined, "", "false", "0", "1", "yes", "on", "tru"]) assert.equal(isSwitchOn(v), false, JSON.stringify(v));
});

test("the public franchise switch is OFF by default and ON only when set to true", () => {
  const saved = process.env.NEXT_PUBLIC_FRANCHISE_PUBLIC_ENABLED;
  try {
    delete process.env.NEXT_PUBLIC_FRANCHISE_PUBLIC_ENABLED;
    assert.equal(franchisePublicEnabled(process.env.NEXT_PUBLIC_FRANCHISE_PUBLIC_ENABLED), false, "unset → off");
    assert.equal(franchisePublicEnabled("false"), false);
    assert.equal(franchisePublicEnabled("true"), true);
  } finally {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_FRANCHISE_PUBLIC_ENABLED;
    else process.env.NEXT_PUBLIC_FRANCHISE_PUBLIC_ENABLED = saved;
  }
});

test("navigation: the Franchise link is added only when the feature is on", () => {
  const HOME = { href: "/", label: "Home" };
  const FR = { href: "/franchise", label: "Franchise" };
  assert.deepEqual(withLinkIf([HOME], FR, false), [HOME]);
  assert.deepEqual(withLinkIf([HOME], FR, true), [HOME, FR]);
});
