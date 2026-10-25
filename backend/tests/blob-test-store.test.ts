/**
 * The Blob test-store guard (blob-test-store.ts): real-Blob tests may only ever run against a
 * positively identified test-only store, never production. Uses obviously fake tokens, makes no
 * network calls, and never prints a token.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertRealBlobAllowed, blobTestConfigFromEnv, blobTestMode, realBlobSkip, resolveBlobTestMode, storeIdOf } from "./blob-test-store.js";

const SECRET = "FakeSecretMustNeverBePrinted0123";
const fakeToken = (storeId: string) => `vercel_blob_rw_${storeId}_${SECRET}`;
const PROD = "FakeProdStore01";
const TEST = "FakeTestStore02";

test("store IDs are read from read-write tokens only", () => {
  assert.equal(storeIdOf(fakeToken(PROD)), PROD);
  for (const bad of [undefined, "", "not-a-token", "vercel_blob_ro_FakeProdStore01_x", `vercel_blob_rw_${PROD}`]) assert.equal(storeIdOf(bad), null, String(bad));
});

test("a test store is used only when it is positively identified and isolated", () => {
  const ok = { testToken: fakeToken(TEST), testStoreId: TEST, productionStoreIds: [PROD] };
  assert.deepEqual(resolveBlobTestMode(ok), { kind: "test-store", storeId: TEST });

  const cases: [string, Parameters<typeof resolveBlobTestMode>[0], "offline" | "refused", RegExp][] = [
    ["nothing configured", { productionStoreIds: [PROD] }, "offline", /no test-only Blob store/],
    ["malformed token", { ...ok, testToken: "vercel_blob_rw_oops" }, "refused", /isn't a Blob read-write token/],
    ["store ID not confirmed", { ...ok, testStoreId: undefined }, "refused", /set TEST_BLOB_STORE_ID/],
    ["store ID doesn't match the token", { ...ok, testStoreId: "SomeOtherStore" }, "refused", /doesn't match/],
    ["no production store to compare with", { ...ok, productionStoreIds: [] }, "refused", /can't confirm the test store is isolated/],
    ["the production token passed as the test token", { testToken: fakeToken(PROD), testStoreId: PROD, productionStoreIds: [PROD] }, "refused", /belongs to a production store/],
    ["a store listed in PRODUCTION_BLOB_STORE_IDS", { ...ok, productionStoreIds: [PROD, TEST] }, "refused", /belongs to a production store/],
  ];
  for (const [label, config, kind, reason] of cases) {
    const mode = resolveBlobTestMode(config);
    assert.equal(mode.kind, kind, label);
    assert.match((mode as { reason: string }).reason, reason, label);
    assert.ok(!JSON.stringify(mode).includes(SECRET), `${label}: the token never appears in the outcome`);
  }
});

test("production stores are taken from the main, public and listed stores", () => {
  const config = blobTestConfigFromEnv({
    BLOB_READ_WRITE_TOKEN: fakeToken(PROD),
    BLOB_PUBLIC_READ_WRITE_TOKEN: fakeToken("FakePublicStore03"),
    PRODUCTION_BLOB_STORE_IDS: " ListedStore04 , ",
    TEST_BLOB_READ_WRITE_TOKEN: fakeToken("FakePublicStore03"),
    TEST_BLOB_STORE_ID: "FakePublicStore03",
  } as NodeJS.ProcessEnv);
  assert.deepEqual(config.productionStoreIds.map((s) => s.trim()).filter(Boolean), [PROD, "FakePublicStore03", "ListedStore04"]);
  assert.equal(resolveBlobTestMode(config).kind, "refused", "the public (demo) store is production too");
});

test("this run: without a test store, no real token is left and the SDK can't reach a store", async (t) => {
  if (blobTestMode.kind === "test-store") return t.skip("this run is pinned to a test store");
  assert.ok(realBlobSkip || blobTestMode.kind === "refused");
  assert.equal(process.env.BLOB_READ_WRITE_TOKEN, "", "the main (production) token is cleared");
  assert.equal(process.env.BLOB_PUBLIC_READ_WRITE_TOKEN, "", "the public store token is cleared");
  assert.throws(assertRealBlobAllowed, /Refusing to run a real-Blob test/);
  const blob = await import("@vercel/blob");
  await assert.rejects(Promise.resolve().then(() => blob.put("x.txt", "x", { access: "private" } as never)), /offline test run/);
  await assert.rejects(Promise.resolve().then(() => blob.del("x.txt")), /offline test run/);
  await assert.rejects(Promise.resolve().then(() => blob.head("x.txt")), /offline test run/);
});

/**
 * A fresh process per scenario, so the guard decides from scratch. Each runs a tiny node:test file
 * with one "real-Blob" test and reports what the guard did; dotenv finds no .env in its temp folder.
 */
function runScenario(env: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), "eca-blob-guard-"));
  try {
    const guard = pathToFileURL(path.resolve("tests/blob-test-store.ts")).href;
    const sdk = import.meta.resolve("@vercel/blob");
    writeFileSync(
      path.join(dir, "scenario.test.mts"),
      `import { test } from "node:test";
import { assertRealBlobAllowed, blobTestMode, realBlobSkip, storeIdOf } from ${JSON.stringify(guard)};
const blob = await import(${JSON.stringify(sdk)});
let putError = null;
// Only probe when storage should be offline: with a (fake) test store this would be a network call.
if (blobTestMode.kind !== "test-store") {
  try { await blob.put("probe.txt", "x", { access: "private" }); } catch (e) { putError = String(e.message).slice(0, 80); }
}
console.log("RESULT " + JSON.stringify({
  kind: blobTestMode.kind,
  mainStore: storeIdOf(process.env.BLOB_READ_WRITE_TOKEN),
  mainTokenEmpty: process.env.BLOB_READ_WRITE_TOKEN === "",
  publicTokenEmpty: process.env.BLOB_PUBLIC_READ_WRITE_TOKEN === "",
  putError,
}));
test("real-Blob test", { skip: realBlobSkip }, () => { assertRealBlobAllowed(); });
`
    );
    const childEnv: Record<string, string> = { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", ...env };
    const res = spawnSync(process.execPath, ["--experimental-test-module-mocks", "--import", import.meta.resolve("tsx"), "--test", "--test-reporter=tap", "scenario.test.mts"], {
      cwd: dir,
      env: childEnv,
      encoding: "utf8",
      timeout: 60_000,
    });
    const output = `${res.stdout}\n${res.stderr}`;
    const line = output.split("\n").find((l) => l.includes("RESULT "));
    assert.ok(line, `scenario produced no result:\n${output.slice(0, 2000)}`);
    return { result: JSON.parse(line.slice(line.indexOf("RESULT ") + 7)), output, exitCode: res.status };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a production token offered as the test store is refused: offline storage, and the real-Blob test fails", () => {
  const { result, output, exitCode } = runScenario({ BLOB_READ_WRITE_TOKEN: fakeToken(PROD), TEST_BLOB_READ_WRITE_TOKEN: fakeToken(PROD), TEST_BLOB_STORE_ID: PROD });
  assert.equal(result.kind, "refused");
  assert.equal(result.mainTokenEmpty, true, "the production token doesn't survive into the run");
  assert.match(result.putError, /offline test run/, "a write can't reach any store");
  assert.match(output, /not ok 1 - real-Blob test/, "the real-Blob test fails instead of running");
  assert.match(output, /Refusing to run a real-Blob test: TEST_BLOB_READ_WRITE_TOKEN belongs to a production store/);
  assert.notEqual(exitCode, 0);
  assert.ok(!output.includes(SECRET), "no token in the output");
});

test("with no test store, a production token in the environment is cleared and real-Blob tests skip", () => {
  const { result, output, exitCode } = runScenario({ BLOB_READ_WRITE_TOKEN: fakeToken(PROD), BLOB_PUBLIC_READ_WRITE_TOKEN: fakeToken("FakePublicStore03") });
  assert.equal(result.kind, "offline");
  assert.equal(result.mainTokenEmpty, true);
  assert.equal(result.publicTokenEmpty, true);
  assert.match(result.putError, /offline test run/);
  assert.match(output, /ok 1 - real-Blob test # SKIP needs a test-only Blob store/);
  assert.equal(exitCode, 0);
  assert.ok(!output.includes(SECRET));
});

test("an identified, isolated test store pins the whole run to it (no network used here)", () => {
  const { result, output } = runScenario({ BLOB_READ_WRITE_TOKEN: fakeToken(PROD), TEST_BLOB_READ_WRITE_TOKEN: fakeToken(TEST), TEST_BLOB_STORE_ID: TEST });
  assert.equal(result.kind, "test-store");
  assert.equal(result.mainStore, TEST, "every storage call in the run uses the test store, not production");
  assert.equal(result.publicTokenEmpty, true);
  assert.match(output, /ok 1 - real-Blob test(?! # SKIP)/, "the real-Blob test is allowed to run");
  assert.ok(!output.includes(SECRET));
});
