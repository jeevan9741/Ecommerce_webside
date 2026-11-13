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

// ---------- strict production detection: every hostname component must match ----------

/** Classifies many URLs in one child process: [isProductionDatabase (protective), isConfirmedProductionDatabase (strict)]. */
function classifyUrls(urls: string[], override?: string, extraEnv: Record<string, string> = {}) {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    SYSTEMROOT: process.env.SYSTEMROOT ?? "",
    DOTENV_CONFIG_PATH: "does-not-exist.env",
    JWT_SECRET: "dummy",
    DATABASE_URL: LOCAL_DB,
    ...extraEnv,
  };
  if (override !== undefined) env.PRODUCTION_DATABASE_ENDPOINTS = override;
  const script = `
    const m = await import(${JSON.stringify(SAFETY)});
    const urls = ${JSON.stringify(urls)};
    console.log("RESULT " + JSON.stringify(urls.map((u) => [m.isProductionDatabase(u), m.isConfirmedProductionDatabase(u)])));
  `;
  const r = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { cwd: BACKEND, env, encoding: "utf8" });
  const line = r.stdout.split("\n").find((l) => l.startsWith("RESULT "));
  assert.ok(line, `child failed: ${r.stderr}`);
  return JSON.parse(line.slice(7)) as [boolean, boolean][];
}

test("strict detection: only a complete Neon hostname of a production endpoint is CONFIRMED production", () => {
  const confirmed = [
    LIVE_POOLED,
    LIVE_DIRECT,
    OLD_COPY,
    url(`${LIVE.toUpperCase()}-POOLER.C-4.US-WEST-2.AWS.NEON.TECH`),
    url(`${LIVE}-pooler.us-west-2.aws.neon.tech`), // no cell prefix
    url(`${LIVE}-pooler.c-4.us-west-2.aws.neon.tech`, `&options=endpoint%3D${LIVE}`), // consistent options
    `postgres://user:pass@${LIVE}.c-4.us-west-2.aws.neon.tech:5432/neondb`,
    `${LIVE_POOLED}&channel_binding=require`,
    `${LIVE_POOLED}\n`, // trailing line break (as some dashboards save it): node-postgres ignores it
    `${LIVE_POOLED}\r\n`,
    `postgresql://user:endpoint%3D${LIVE}%24pass@${LIVE}-pooler.c-4.us-west-2.aws.neon.tech/neondb`, // consistent password form
  ];
  for (const [i, [, strict]] of classifyUrls(confirmed).entries()) assert.equal(strict, true, confirmed[i].split("@")[1]);
});

test("strict detection: partial, look-alike, inconsistent or malformed URLs are NOT confirmed production", () => {
  const notConfirmed = [
    url(`${LIVE}.localtest.me`), // resolves to 127.0.0.1
    url(`${LIVE}.c-4.us-west-2.aws.neon.tech.evil.com`),
    url(`${LIVE}-pooler.c-4.us-west-2.aws.neon.tech.`),
    url(`${LIVE}x-pooler.c-4.us-west-2.aws.neon.tech`), // longer endpoint ID
    url(`${LIVE.slice(0, -1)}-pooler.c-4.us-west-2.aws.neon.tech`), // shorter endpoint ID
    url(`x${LIVE}-pooler.c-4.us-west-2.aws.neon.tech`),
    url(`${LIVE}.neon.tech`), // no region
    url(`${LIVE}-pooler.c-4.us-west-2.neon.tech`), // no cloud
    url(`${LIVE}-pooler.c-4.us-west-2.aws.neon.tech.internal`),
    url(`${LIVE}-pooler.c-4.us-west-2.aws.notneon.tech`),
    url("pg.neon.tech", `&options=endpoint%3D${LIVE}`), // production only via options
    url(`${LIVE}-pooler.c-4.us-west-2.aws.neon.tech`, "&options=endpoint%3Dep-silent-sea-argk06vr"), // host and options disagree
    url("ep-silent-sea-argk06vr-pooler.c-4.us-west-2.aws.neon.tech", `&options=endpoint%3D${LIVE}`),
    `mysql://user:pass@${LIVE}-pooler.c-4.us-west-2.aws.neon.tech/neondb`,
    `https://${LIVE}-pooler.c-4.us-west-2.aws.neon.tech/`,
    // node-postgres connects to ?host= / ?port= instead of the hostname, so these could reach another server
    url(`${LIVE}-pooler.c-4.us-west-2.aws.neon.tech`, "&host=127.0.0.1"),
    url(`${LIVE}-pooler.c-4.us-west-2.aws.neon.tech`, "&HOST=127.0.0.1"),
    url(`${LIVE}-pooler.c-4.us-west-2.aws.neon.tech`, `&host=${LIVE}-pooler.c-4.us-west-2.aws.neon.tech`),
    url(`${LIVE}-pooler.c-4.us-west-2.aws.neon.tech`, "&hostaddr=127.0.0.1"),
    url(`${LIVE}-pooler.c-4.us-west-2.aws.neon.tech`, "&port=5433"),
    url(`${LIVE}-pooler.c-4.us-west-2.aws.neon.tech`, "&service=dev"),
    url(`${LIVE}-pooler.c-4.us-west-2.aws.neon.tech`, "&servicefile=x"),
    // every options value counts (node-postgres keeps the last one), in either endpoint= spelling
    url(`${LIVE}-pooler.c-4.us-west-2.aws.neon.tech`, `&options=endpoint%3D${LIVE}&options=endpoint%3Dep-silent-sea-argk06vr`),
    url(`${LIVE}-pooler.c-4.us-west-2.aws.neon.tech`, "&options=--endpoint%3Dep-silent-sea-argk06vr"),
    url(`${LIVE}%2Dpooler.c-4.us-west-2.aws.neon.tech`), // percent-encoded host
    // node-postgres resolves a URL with leading whitespace relative to postgres://base — not the hostname
    ` ${LIVE_POOLED}`,
    `\uFEFF${LIVE_POOLED}`,
    `\u00A0${LIVE_POOLED}`,
    `\u3000${LIVE_POOLED}`,
    `\u2028${LIVE_POOLED}`,
    LIVE_POOLED.replace("neondb", "neon db"),
    // a trailing space or tab is encoded by node-postgres into the host when the URL ends at the hostname
    `postgresql://user:pass@${LIVE}-pooler.c-4.us-west-2.aws.neon.tech `,
    `${LIVE_POOLED}\t`,
    // other endpoint spellings that disagree with the hostname, or are malformed
    url(`${LIVE}-pooler.c-4.us-west-2.aws.neon.tech`, "&options=project%3Dep-silent-sea-argk06vr"),
    url(`${LIVE}-pooler.c-4.us-west-2.aws.neon.tech`, `&options=endpoint%3D${LIVE}_x`),
    url(`${LIVE}-pooler.c-4.us-west-2.aws.neon.tech`, "&options=endpoint%3D"),
    `postgresql://user:endpoint%3Dep-silent-sea-argk06vr%24pass@${LIVE}-pooler.c-4.us-west-2.aws.neon.tech/neondb`,
    DEV_BRANCH,
    LOCAL_DB,
    "not a url",
    "",
  ];
  for (const [i, [, strict]] of classifyUrls(notConfirmed).entries()) assert.equal(strict, false, JSON.stringify(notConfirmed[i]));
});

test("strict detection never weakens the TEST-key protection: doubtful URLs still count as possibly production", () => {
  const doubtful = [
    url("pg.neon.tech", `&options=endpoint%3D${LIVE}`),
    url(`${LIVE}.localtest.me`),
    url("ep-silent-sea-argk06vr-pooler.c-4.us-west-2.aws.neon.tech", `&options=endpoint%3D${LIVE}`),
    url("localhost", `&host=${LIVE}-pooler.c-4.us-west-2.aws.neon.tech`), // node-postgres would connect to production
    url(DEV_BRANCH.split("@")[1].split("/")[0], `&hostaddr=${LIVE}.c-4.us-west-2.aws.neon.tech`),
    url(`${LIVE}%2Dpooler.c-4.us-west-2.aws.neon.tech`), // node-postgres decodes this to the production pooler
    url("pg.neon.tech", `&options=x&options=--endpoint%3D${LIVE}`),
    url("pg.neon.tech", `&options=project%3D${LIVE}`), // Neon's legacy spelling
    `postgresql://user:endpoint%3D${LIVE}%24pass@pg.neon.tech/neondb`, // endpoint in the password
    `postgresql://user:endpoint%3D${LIVE}%3Bpass@pg.neon.tech/neondb`,
    // host-less URLs: node-postgres retries them with a dummy host and then uses ?host=
    `postgresql://user:pass@/neondb?host=${LIVE}-pooler.c-4.us-west-2.aws.neon.tech`,
    `postgresql://@/neondb?host=${LIVE}-pooler.c-4.us-west-2.aws.neon.tech`,
    url(`localhost,${LIVE}-pooler.c-4.us-west-2.aws.neon.tech`), // comma-separated hosts
  ];
  for (const [i, [loose, strict]] of classifyUrls(doubtful).entries()) assert.deepEqual([loose, strict], [true, false], doubtful[i].split("@")[1]);
  for (const databaseUrl of doubtful) assert.equal(guard({ databaseUrl, keyId: TEST_KEY }).blocked, true, "TEST keys still refused");
});

test("TEST-key protection also covers PGHOST / PGHOSTADDR / PGOPTIONS, which node-postgres uses when the URL omits them", () => {
  const prodHost = `${LIVE}-pooler.c-4.us-west-2.aws.neon.tech`;
  for (const extraEnv of [{ PGHOST: prodHost }, { PGHOSTADDR: prodHost }, { PGOPTIONS: `endpoint=${LIVE}` }, { PGOPTIONS: `--project=${LIVE}` }]) {
    const [[loose, strict]] = classifyUrls(["postgresql:///neondb"], undefined, extraEnv);
    assert.deepEqual([loose, strict], [true, false], JSON.stringify(extraEnv));
  }
  const [[loose]] = classifyUrls(["postgresql:///neondb"], undefined, { PGHOST: "127.0.0.1" });
  assert.equal(loose, false, "a local PGHOST is not production");
});

test("strict detection: PRODUCTION_DATABASE_ENDPOINTS adds endpoints, still requiring a complete Neon hostname", () => {
  const [[, listed], [, lookalike]] = classifyUrls([url("ep-new-home-123-pooler.c-4.us-west-2.aws.neon.tech"), url("ep-new-home-123.localtest.me")], "ep-new-home-123");
  assert.deepEqual([listed, lookalike], [true, false]);
});

// ---------- R-1: production means NODE_ENV=production AND a confirmed production database ----------

test("R-1: LIVE keys against the production database are refused unless NODE_ENV is exactly production", () => {
  for (const nodeEnv of ["development", "staging", "test", "Production", "production "]) {
    const r = guard({ databaseUrl: LIVE_POOLED, keyId: SECRET_LIVE_KEY, nodeEnv, startup: true });
    assert.deepEqual([r.blocked, r.exitCode], [true, 1], JSON.stringify(nodeEnv));
    assert.match(r.output, /FATAL: RAZORPAY_KEY_ID is a LIVE key \(rzp_live_\) outside production/);
    assert.doesNotMatch(r.output, /SECRETVALUE9137/);
  }
});

test("R-1: LIVE keys in production against a look-alike or unconfirmed production host are refused", () => {
  for (const databaseUrl of [url(`${LIVE}.localtest.me`), url("pg.neon.tech", `&options=endpoint%3D${LIVE}`)]) {
    const r = guard({ databaseUrl, keyId: SECRET_LIVE_KEY, nodeEnv: "production", startup: true });
    assert.deepEqual([r.blocked, r.exitCode], [true, 1], databaseUrl.split("@")[1]);
    assert.match(r.output, /database: PRODUCTION\? \(not confirmed\)/);
    assert.doesNotMatch(r.output, /SECRETVALUE9137/);
  }
});

test("R-1: the startup log reports the environment classification", () => {
  const r = guard({ databaseUrl: LIVE_POOLED, keyId: LIVE_KEY, nodeEnv: "production", startup: true });
  assert.match(r.output, /database: PRODUCTION \(.*\) · environment: PRODUCTION/);
  const d = guard({ databaseUrl: LOCAL_DB, keyId: TEST_KEY, startup: true });
  assert.match(d.output, /database: non-production \(.*\) · environment: non-production/);
});

// ---------- R-1 per call: getRazorpayClient() refuses LIVE keys outside production ----------

const RAZORPAY = pathToFileURL(fileURLToPath(new URL("../src/services/razorpay.service.ts", import.meta.url))).href;
const SECRET_KEY_SECRET = "KEYSECRETVALUE5521"; // must never appear in any output

/** Builds a Razorpay client in a child process (no network: the SDK only stores the keys) after applying `later` to process.env. */
function clientFor(c: { nodeEnv?: string; databaseUrl: string; keyId: string; later?: Record<string, string> }) {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    SYSTEMROOT: process.env.SYSTEMROOT ?? "",
    DOTENV_CONFIG_PATH: "does-not-exist.env",
    JWT_SECRET: "dummy",
    DATABASE_URL: c.databaseUrl,
    RAZORPAY_KEY_ID: c.keyId,
    RAZORPAY_KEY_SECRET: SECRET_KEY_SECRET,
  };
  if (c.nodeEnv !== undefined) env.NODE_ENV = c.nodeEnv;
  const script = `
    const m = await import(${JSON.stringify(RAZORPAY)});
    Object.assign(process.env, ${JSON.stringify(c.later ?? {})});
    let out;
    try { m.getRazorpayClient(); out = { built: true }; }
    catch (e) { out = { built: false, configError: e instanceof m.RazorpayConfigError, message: String(e?.message) }; }
    console.log("RESULT " + JSON.stringify(out));
  `;
  const r = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { cwd: BACKEND, env, encoding: "utf8" });
  const line = r.stdout.split("\n").find((l) => l.startsWith("RESULT "));
  assert.ok(line, `child failed: ${r.stderr}`);
  assert.doesNotMatch(r.stdout + r.stderr, new RegExp(`SECRETVALUE9137|${SECRET_KEY_SECRET}`), "no key or secret in any output");
  return JSON.parse(line.slice(7)) as { built: boolean; configError?: boolean; message?: string };
}

test("getRazorpayClient: LIVE keys are refused outside production, whichever payment path asks", () => {
  const cases = [
    { nodeEnv: "development", databaseUrl: LOCAL_DB },
    { nodeEnv: "production", databaseUrl: DEV_BRANCH },
    { nodeEnv: "development", databaseUrl: LIVE_POOLED },
    { nodeEnv: undefined, databaseUrl: LIVE_POOLED },
    { nodeEnv: "production", databaseUrl: url(`${LIVE}.localtest.me`) },
    { nodeEnv: "production", databaseUrl: "not a url" },
    { nodeEnv: "production", databaseUrl: url(`${LIVE}-pooler.c-4.us-west-2.aws.neon.tech`, "&host=127.0.0.1") }, // would connect locally
  ];
  for (const c of cases) {
    const r = clientFor({ ...c, keyId: SECRET_LIVE_KEY });
    assert.equal(r.built, false, JSON.stringify(c));
    assert.equal(r.configError, true, "RazorpayConfigError, which every caller maps to 503");
    assert.match(r.message ?? "", /LIVE key \(rzp_live_\) outside production/);
    assert.doesNotMatch(r.message ?? "", /SECRETVALUE9137/);
  }
});

test("getRazorpayClient: an unrecognised rzp_ key is refused outside production", () => {
  const r = clientFor({ nodeEnv: "development", databaseUrl: LOCAL_DB, keyId: "rzp_SECRETVALUE9137" });
  assert.deepEqual([r.built, r.configError], [false, true]);
  assert.match(r.message ?? "", /neither a test .* nor a live .* key outside production/);
});

test("getRazorpayClient: reads the environment at call time — a change after startup is enforced", () => {
  const prod = { nodeEnv: "production", databaseUrl: LIVE_POOLED, keyId: SECRET_LIVE_KEY };
  assert.equal(clientFor({ ...prod, later: { DATABASE_URL: LOCAL_DB } }).built, false, "database switched away from production");
  assert.equal(clientFor({ ...prod, later: { NODE_ENV: "development" } }).built, false, "NODE_ENV switched away from production");
  assert.equal(clientFor({ nodeEnv: "development", databaseUrl: LOCAL_DB, keyId: TEST_KEY, later: { RAZORPAY_KEY_ID: SECRET_LIVE_KEY } }).built, false, "key switched to LIVE");
});

test("getRazorpayClient: production (LIVE keys) and local development (TEST keys) are unchanged", () => {
  assert.equal(clientFor({ nodeEnv: "production", databaseUrl: LIVE_POOLED, keyId: SECRET_LIVE_KEY }).built, true, "production");
  for (const databaseUrl of [LOCAL_DB, DEV_BRANCH]) {
    assert.equal(clientFor({ nodeEnv: "development", databaseUrl, keyId: TEST_KEY }).built, true, databaseUrl.split("@")[1]);
  }
  const placeholder = clientFor({ nodeEnv: "development", databaseUrl: LOCAL_DB, keyId: "rzp_test_xxxxxxxx" });
  assert.match(placeholder.message ?? "", /placeholder/, "existing placeholder check still runs first");
});
