/**
 * The TEST-keys-against-production guard, checked the way it runs for real: the guard reads its
 * configuration once at startup, so each case starts a fresh Node process with exactly that
 * environment (no .env file is loaded). Nothing connects to any database — only the hostname in
 * DATABASE_URL is inspected — and the credentials in these URLs are dummies.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SAFETY = pathToFileURL(fileURLToPath(new URL("../src/services/payment-safety.ts", import.meta.url))).href;
const BACKEND = fileURLToPath(new URL("..", import.meta.url));

const LIVE = "ep-rapid-fog-ar2sy1xy";
const url = (host: string, query = "") => `postgresql://user:pass@${host}/neondb?sslmode=require${query}`;
const LIVE_POOLED = url(`${LIVE}-pooler.c-4.us-west-2.aws.neon.tech`);
const LIVE_DIRECT = url(`${LIVE}.c-4.us-west-2.aws.neon.tech`);
const OLD_COPY = url("ep-frosty-resonance-arjo65c1-pooler.c-4.us-west-2.aws.neon.tech");
const DEV_BRANCH = url("ep-silent-sea-argk06vr-pooler.c-4.us-west-2.aws.neon.tech");
const TEST_KEY = "rzp_test_dummy";
const LIVE_KEY = "rzp_live_dummy";

interface Case {
  databaseUrl: string;
  keyId: string;
  nodeEnv?: string;
  /** undefined = variable not set at all. */
  override?: string;
  startup?: boolean;
}

/** Runs the guard in a child process; returns what it decided (and the exit code for the startup check). */
function guard(c: Case) {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    SYSTEMROOT: process.env.SYSTEMROOT ?? "",
    DOTENV_CONFIG_PATH: "does-not-exist.env", // never pick up a developer's real .env
    NODE_ENV: c.nodeEnv ?? "development",
    JWT_SECRET: "dummy",
    DATABASE_URL: c.databaseUrl,
    RAZORPAY_KEY_ID: c.keyId,
  };
  if (c.override !== undefined) env.PRODUCTION_DATABASE_ENDPOINTS = c.override;
  const script = `
    const m = await import(${JSON.stringify(SAFETY)});
    console.log("RESULT " + JSON.stringify({ isProd: m.isProductionDatabase(), blocked: m.paymentSafetyProblem() !== null }));
    ${c.startup ? "m.checkPaymentModeOnStartup();" : ""}
  `;
  const r = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { cwd: BACKEND, env, encoding: "utf8" });
  const line = r.stdout.split("\n").find((l) => l.startsWith("RESULT "));
  assert.ok(line, `child failed: ${r.stderr}`);
  return { ...(JSON.parse(line.slice(7)) as { isProd: boolean; blocked: boolean }), exitCode: r.status, output: r.stdout + r.stderr };
}

test("TEST keys are refused against the live database, pooled or direct, with no override set", () => {
  for (const databaseUrl of [LIVE_POOLED, LIVE_DIRECT, OLD_COPY]) {
    const r = guard({ databaseUrl, keyId: TEST_KEY });
    assert.deepEqual([r.isProd, r.blocked], [true, true], databaseUrl.split("@")[1]);
  }
});

test("PRODUCTION_DATABASE_ENDPOINTS can't switch the guard off: empty, stale or unrelated values still block the live database", () => {
  for (const override of ["", " ", ",", "ep-frosty-resonance-arjo65c1", "ep-some-other-db", "none"]) {
    const r = guard({ databaseUrl: LIVE_POOLED, keyId: TEST_KEY, override });
    assert.deepEqual([r.isProd, r.blocked], [true, true], `override=${JSON.stringify(override)}`);
  }
});

test("PRODUCTION_DATABASE_ENDPOINTS adds endpoints (pooled form and spacing tolerated)", () => {
  const moved = url("ep-new-home-123-pooler.c-4.us-west-2.aws.neon.tech");
  assert.equal(guard({ databaseUrl: moved, keyId: TEST_KEY }).blocked, false, "unknown before it's listed");
  for (const override of ["ep-new-home-123", " ep-new-home-123-pooler ", "ep-x, EP-NEW-HOME-123"]) {
    assert.equal(guard({ databaseUrl: moved, keyId: TEST_KEY, override }).blocked, true, `override=${JSON.stringify(override)}`);
  }
});

test("the endpoint is recognised however the URL is written", () => {
  for (const databaseUrl of [
    url(`${LIVE.toUpperCase()}-POOLER.C-4.US-WEST-2.AWS.NEON.TECH`),
    // Neon's fallback for clients without SNI: endpoint passed in the options parameter.
    url("pg.neon.tech", `&options=endpoint%3D${LIVE}`),
    url("pg.neon.tech", `&options=endpoint%3D${LIVE}-pooler`),
  ]) {
    assert.equal(guard({ databaseUrl, keyId: TEST_KEY }).blocked, true, databaseUrl.split("@")[1]);
  }
});

test("TEST keys are allowed against development databases", () => {
  for (const databaseUrl of [DEV_BRANCH, "postgresql://postgres@127.0.0.1:55432/eca_test"]) {
    const r = guard({ databaseUrl, keyId: TEST_KEY });
    assert.deepEqual([r.isProd, r.blocked], [false, false]);
  }
});

test("LIVE keys against the live database are allowed (that's production working normally)", () => {
  const r = guard({ databaseUrl: LIVE_POOLED, keyId: LIVE_KEY, nodeEnv: "production", startup: true });
  assert.deepEqual([r.isProd, r.blocked, r.exitCode], [true, false, 0]);
  assert.match(r.output, /Razorpay mode: LIVE · database: PRODUCTION/);
});

test("in production, TEST keys stop the server at startup — whatever the database", () => {
  for (const databaseUrl of [LIVE_POOLED, DEV_BRANCH]) {
    const r = guard({ databaseUrl, keyId: TEST_KEY, nodeEnv: "production", startup: true });
    assert.equal(r.blocked, true);
    assert.equal(r.exitCode, 1, "process.exit(1) before listening");
    assert.match(r.output, /FATAL/);
  }
});

test("outside production, TEST keys + live database start but disable checkout, with a warning", () => {
  const r = guard({ databaseUrl: LIVE_POOLED, keyId: TEST_KEY, startup: true });
  assert.equal(r.exitCode, 0);
  assert.match(r.output, /WARNING: .*PRODUCTION database/);
});

// ---------- R-1: LIVE keys only against the production database ----------

const SECRET_LIVE_KEY = "rzp_live_SECRETVALUE9137"; // the suffix must never appear in any output
const LOCAL_DB = "postgresql://postgres@127.0.0.1:55432/eca_dev";

test("R-1: LIVE keys against a non-production database stop the server at startup, in every NODE_ENV", () => {
  for (const nodeEnv of ["development", "staging", "production", "test"]) {
    for (const databaseUrl of [DEV_BRANCH, LOCAL_DB]) {
      const r = guard({ databaseUrl, keyId: SECRET_LIVE_KEY, nodeEnv, startup: true });
      assert.deepEqual([r.isProd, r.blocked, r.exitCode], [false, true, 1], `${nodeEnv} ${databaseUrl.split("@")[1]}`);
      assert.match(r.output, /FATAL: RAZORPAY_KEY_ID is a LIVE key/);
      assert.doesNotMatch(r.output, /SECRETVALUE9137/, "the key value is never printed");
    }
  }
});

test("R-1: an unparseable or unknown DATABASE_URL counts as non-production (fail closed)", () => {
  for (const databaseUrl of ["not a url", "postgresql://", url("ep-unknown-endpoint-1-pooler.c-4.us-west-2.aws.neon.tech")]) {
    const r = guard({ databaseUrl, keyId: SECRET_LIVE_KEY, startup: true });
    assert.deepEqual([r.isProd, r.blocked, r.exitCode], [false, true, 1], databaseUrl);
  }
});

test("R-1: a key that is neither rzp_test_ nor rzp_live_ is refused against a non-production database", () => {
  for (const keyId of ["key_SECRETVALUE9137", "RZP_LIVE_SECRETVALUE9137", " rzp_live_SECRETVALUE9137"]) {
    const r = guard({ databaseUrl: DEV_BRANCH, keyId, startup: true });
    assert.deepEqual([r.blocked, r.exitCode], [true, 1], JSON.stringify(keyId));
    assert.match(r.output, /neither a test \(rzp_test_\) nor a live \(rzp_live_\) key/);
    assert.doesNotMatch(r.output, /SECRETVALUE9137/);
  }
});

test("R-1: production behaviour is unchanged — LIVE (and unrecognised) keys against the production database start normally", () => {
  for (const keyId of [LIVE_KEY, "key_unrecognised"]) {
    const r = guard({ databaseUrl: LIVE_POOLED, keyId, nodeEnv: "production", startup: true });
    assert.deepEqual([r.isProd, r.blocked, r.exitCode], [true, false, 0], keyId);
  }
});

test("R-1: a newly listed production endpoint (PRODUCTION_DATABASE_ENDPOINTS) allows LIVE keys there", () => {
  const moved = url("ep-new-home-123-pooler.c-4.us-west-2.aws.neon.tech");
  assert.equal(guard({ databaseUrl: moved, keyId: LIVE_KEY, nodeEnv: "production" }).blocked, true, "before it's listed");
  const r = guard({ databaseUrl: moved, keyId: LIVE_KEY, nodeEnv: "production", override: "ep-new-home-123", startup: true });
  assert.deepEqual([r.isProd, r.blocked, r.exitCode], [true, false, 0]);
});

test("R-1: local development is unaffected — TEST keys or no keys against a development database start normally", () => {
  for (const keyId of [TEST_KEY, ""]) {
    const r = guard({ databaseUrl: LOCAL_DB, keyId, startup: true });
    assert.deepEqual([r.blocked, r.exitCode], [false, 0], JSON.stringify(keyId));
  }
});
