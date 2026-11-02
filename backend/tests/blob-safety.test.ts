/**
 * R-2: a non-production process must never use a production Vercel Blob store. Pure classification is
 * tested directly; startup and storage calls are tested the way they run for real — each case in a fresh
 * Node process with exactly that environment (no .env file). All tokens are fakes: nothing contacts
 * Vercel or any database (only the hostname in DATABASE_URL is inspected), and the fake secret part of
 * every token is checked never to appear in any output.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { blobSafetyProblem, classifyBlobStoreId, classifyBlobToken, isProductionEnvironment, productionStoreIds, storeIdFromToken } from "../src/services/blob-safety.js";

const SAFETY = pathToFileURL(fileURLToPath(new URL("../src/services/blob-safety.ts", import.meta.url))).href;
const STORAGE = pathToFileURL(fileURLToPath(new URL("../src/services/storage.service.ts", import.meta.url))).href;
const BACKEND = fileURLToPath(new URL("..", import.meta.url));

const SECRET = "SECRETTOKEN42";
const token = (storeId: string) => `vercel_blob_rw_${storeId}_${SECRET}`;
const PROD_LIVE = "FsKazgqDqoAf33lQ"; // the live production store
const PROD_RESERVED = "AxubRppuBaK1X6iD"; // the reserved eca-production store
const DEV = "O1eIt76U1OQg1RHg"; // eca-dev
const TEST = "rillwfNwzcLeiqVF"; // eca-test
const LIVE_DB = "postgresql://user:pass@ep-rapid-fog-ar2sy1xy-pooler.c-4.us-west-2.aws.neon.tech/neondb?sslmode=require";
const DEV_DB = "postgresql://postgres@127.0.0.1:55432/eca_dev";

// ---------- pure classification ----------

test("store IDs are read from read-write tokens only", () => {
  assert.equal(storeIdFromToken(token(DEV)), DEV);
  assert.equal(storeIdFromToken(`  ${token(DEV)}  `), DEV);
  for (const bad of [undefined, "", "abc", "vercel_blob_rw_", `vercel_blob_rw_${DEV}`, `vercel_blob_ro_${DEV}_x`, `store_${DEV}`]) {
    assert.equal(storeIdFromToken(bad), null, JSON.stringify(bad));
  }
});

test("classification: unset, production (built-in, listed, any prefix or case), non-production, unrecognised", () => {
  const ids = productionStoreIds(" store_ListedStore01 , OtherListed02 ,, ");
  for (const t of [undefined, "", "   "]) assert.equal(classifyBlobToken(t, ids), "unset");
  for (const id of [PROD_LIVE, PROD_RESERVED, PROD_LIVE.toLowerCase(), PROD_LIVE.toUpperCase(), "ListedStore01", "otherlisted02"]) {
    assert.equal(classifyBlobToken(token(id), ids), "production", id);
  }
  for (const id of [DEV, TEST]) assert.equal(classifyBlobToken(token(id), ids), "non-production", id);
  for (const t of ["abc", "vercel_blob_rw_", `bearer ${token(DEV)}`]) assert.equal(classifyBlobToken(t, ids), "unrecognised", t);
});

test("PRODUCTION_BLOB_STORE_IDS can only add stores: empty or junk values never remove the built-in ones", () => {
  for (const extra of [undefined, "", " ", ",", "none", `${DEV}`]) {
    const ids = productionStoreIds(extra);
    assert.ok(ids.has(PROD_LIVE.toLowerCase()) && ids.has(PROD_RESERVED.toLowerCase()), JSON.stringify(extra));
  }
});

test("environment: production only with NODE_ENV=production AND a production database; anything else (incl. missing) is not", () => {
  assert.equal(isProductionEnvironment("production", true), true);
  for (const [nodeEnv, db] of [["production", false], ["staging", true], ["development", true], [undefined, true], ["", true], ["Production", true], ["test", false]] as const) {
    assert.equal(isProductionEnvironment(nodeEnv, db), false, `${nodeEnv} db=${db}`);
  }
});

test("non-production environments refuse production and unrecognised tokens (private or public); allow non-production or unset", () => {
  const nonProd = [
    { nodeEnv: "development", productionDatabase: false },
    { nodeEnv: "staging", productionDatabase: false },
    { nodeEnv: undefined, productionDatabase: false },
    { nodeEnv: "staging", productionDatabase: true }, // staging pointed at the production database is still not production
    { nodeEnv: "production", productionDatabase: false }, // production mode against a non-production database
  ];
  for (const env of nonProd) {
    const label = JSON.stringify(env);
    assert.match(blobSafetyProblem({ ...env, privateToken: token(PROD_LIVE) }) ?? "", /BLOB_READ_WRITE_TOKEN belongs to a PRODUCTION Blob store/, label);
    assert.match(blobSafetyProblem({ ...env, privateToken: token(DEV), publicToken: token(PROD_RESERVED) }) ?? "", /BLOB_PUBLIC_READ_WRITE_TOKEN belongs to a PRODUCTION/, label);
    assert.match(blobSafetyProblem({ ...env, privateToken: "not-a-blob-token" }) ?? "", /isn't a recognisable Vercel Blob read-write token/, label);
    assert.match(blobSafetyProblem({ ...env, privateToken: token("ListedStore01"), productionIdsExtra: "store_ListedStore01" }) ?? "", /PRODUCTION/, label);
    assert.equal(blobSafetyProblem({ ...env, privateToken: token(DEV) }), null, label);
    assert.equal(blobSafetyProblem({ ...env, privateToken: token(TEST), publicToken: "" }), null, label);
    assert.equal(blobSafetyProblem({ ...env }), null, `${label} unset`);
    const message = blobSafetyProblem({ ...env, privateToken: token(PROD_LIVE), publicToken: token(PROD_RESERVED) }) ?? "";
    assert.doesNotMatch(message, new RegExp(`${SECRET}|${PROD_LIVE}|${PROD_RESERVED}`, "i"), "no token values or store IDs in the message");
  }
});

test("production is unchanged: the production store (and any token) is allowed when NODE_ENV=production and the database is production", () => {
  const prod = { nodeEnv: "production", productionDatabase: true };
  for (const privateToken of [token(PROD_LIVE), token(DEV), "unrecognised", undefined]) {
    assert.equal(blobSafetyProblem({ ...prod, privateToken, publicToken: token(PROD_RESERVED) }), null, String(privateToken));
  }
});

test("OIDC: BLOB_STORE_ID (which the SDK prefers over BLOB_READ_WRITE_TOKEN) is classified and refused like a token", () => {
  const ids = productionStoreIds(undefined);
  for (const id of [undefined, "", "  "]) assert.equal(classifyBlobStoreId(id, ids), "unset");
  for (const id of [PROD_LIVE, `store_${PROD_RESERVED}`, ` ${PROD_LIVE.toLowerCase()} `]) assert.equal(classifyBlobStoreId(id, ids), "production", id);
  for (const id of [DEV, `store_${TEST}`]) assert.equal(classifyBlobStoreId(id, ids), "non-production", id);
  for (const id of ["store-x", "a b", token(DEV)]) assert.equal(classifyBlobStoreId(id, ids), "unrecognised", id);
  const env = { nodeEnv: "development", productionDatabase: false, privateToken: token(DEV) };
  assert.match(blobSafetyProblem({ ...env, oidcStoreId: PROD_LIVE }) ?? "", /BLOB_STORE_ID \(used with VERCEL_OIDC_TOKEN\) belongs to a PRODUCTION/);
  assert.match(blobSafetyProblem({ ...env, oidcStoreId: "not/a/store" }) ?? "", /BLOB_STORE_ID .* isn't a recognisable Blob store ID/);
  assert.equal(blobSafetyProblem({ ...env, oidcStoreId: DEV }), null);
  assert.doesNotMatch(blobSafetyProblem({ ...env, oidcStoreId: PROD_LIVE }) ?? "", new RegExp(PROD_LIVE, "i"));
  assert.equal(blobSafetyProblem({ nodeEnv: "production", productionDatabase: true, oidcStoreId: PROD_LIVE }), null, "production unchanged");
});

// ---------- startup and storage calls, as they really run ----------

interface Case {
  nodeEnv?: string;
  databaseUrl: string;
  privateToken?: string;
  publicToken?: string;
  oidcStoreId?: string;
  extra?: string;
  script: string;
}

function run(c: Case) {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    SYSTEMROOT: process.env.SYSTEMROOT ?? "",
    DOTENV_CONFIG_PATH: "does-not-exist.env", // never pick up a developer's real .env
    JWT_SECRET: "dummy",
    DATABASE_URL: c.databaseUrl,
  };
  if (c.nodeEnv !== undefined) env.NODE_ENV = c.nodeEnv;
  if (c.privateToken !== undefined) env.BLOB_READ_WRITE_TOKEN = c.privateToken;
  if (c.publicToken !== undefined) env.BLOB_PUBLIC_READ_WRITE_TOKEN = c.publicToken;
  if (c.oidcStoreId !== undefined) {
    env.BLOB_STORE_ID = c.oidcStoreId;
    env.VERCEL_OIDC_TOKEN = `fake-oidc-${SECRET}`;
  }
  if (c.extra !== undefined) env.PRODUCTION_BLOB_STORE_IDS = c.extra;
  const r = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", c.script], { cwd: BACKEND, env, encoding: "utf8", timeout: 120_000 }); // cold tsx imports can be slow on a loaded machine
  return { exitCode: r.status, output: (r.stdout ?? "") + (r.stderr ?? "") };
}

const startup = `const m = await import(${JSON.stringify(SAFETY)}); m.checkBlobStoreOnStartup(); console.log("STARTED");`;

test("startup: a production store in development, staging or with NODE_ENV unset exits before listening; nothing secret is printed", () => {
  for (const nodeEnv of ["development", "staging", undefined]) {
    const cases = [
      ["prod private", { privateToken: token(PROD_LIVE) }],
      ["prod public", { privateToken: token(DEV), publicToken: token(PROD_RESERVED) }],
      ["garbage private", { privateToken: "garbage-token" }],
      ["prod OIDC store", { privateToken: token(DEV), oidcStoreId: PROD_LIVE }],
    ] as const;
    for (const [name, tokens] of cases) {
      const r = run({ nodeEnv, databaseUrl: DEV_DB, ...tokens, script: startup });
      const label = `${nodeEnv} ${name}`;
      assert.equal(r.exitCode, 1, `${label}: ${r.output}`);
      assert.match(r.output, /\[BLOB\] FATAL: .* Refusing to start\./, label);
      assert.doesNotMatch(r.output, /STARTED/, label);
      assert.doesNotMatch(r.output, new RegExp(`${SECRET}|${PROD_LIVE}|${PROD_RESERVED}|${DEV}`, "i"), `${label}: no token values or store IDs printed`);
    }
  }
});

test("startup: development with the dev store (or no store) starts and logs classifications only", () => {
  for (const privateToken of [token(DEV), undefined]) {
    const r = run({ nodeEnv: "development", databaseUrl: DEV_DB, privateToken, script: startup });
    assert.equal(r.exitCode, 0, r.output);
    assert.match(r.output, /\[BLOB\] environment: non-production · private store: (non-production|unset) · public store: unset · OIDC store: unset/);
    assert.match(r.output, /STARTED/);
    assert.doesNotMatch(r.output, new RegExp(`${SECRET}|${DEV}`, "i"));
  }
});

test("startup: production with the production stores starts normally (behaviour unchanged)", () => {
  const r = run({ nodeEnv: "production", databaseUrl: LIVE_DB, privateToken: token(PROD_LIVE), publicToken: token(PROD_RESERVED), script: startup });
  assert.equal(r.exitCode, 0, r.output);
  assert.match(r.output, /\[BLOB\] environment: PRODUCTION · private store: production · public store: production/);
  assert.doesNotMatch(r.output, new RegExp(SECRET));
});

test("startup: NODE_ENV=production against a non-production database is not production — the production store is refused", () => {
  const r = run({ nodeEnv: "production", databaseUrl: DEV_DB, privateToken: token(PROD_LIVE), script: startup });
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /\[BLOB\] FATAL/);
});

test("every storage call refuses before contacting Vercel when a non-production process holds a production, unrecognised or OIDC production credential", () => {
  const script = `
    const s = await import(${JSON.stringify(STORAGE)});
    const configs = {
      prodBoth: { BLOB_READ_WRITE_TOKEN: ${JSON.stringify(token(PROD_LIVE))}, BLOB_PUBLIC_READ_WRITE_TOKEN: ${JSON.stringify(token(PROD_RESERVED))} },
      prodPublicOnly: { BLOB_READ_WRITE_TOKEN: ${JSON.stringify(token(DEV))}, BLOB_PUBLIC_READ_WRITE_TOKEN: ${JSON.stringify(token(PROD_RESERVED))} },
      unrecognisedPrivate: { BLOB_READ_WRITE_TOKEN: "not-a-token", BLOB_PUBLIC_READ_WRITE_TOKEN: "" },
      oidcProdStore: { BLOB_READ_WRITE_TOKEN: ${JSON.stringify(token(DEV))}, BLOB_PUBLIC_READ_WRITE_TOKEN: "", BLOB_STORE_ID: ${JSON.stringify(PROD_LIVE)}, VERCEL_OIDC_TOKEN: "fake-oidc-${SECRET}" },
    };
    const calls = {
      getUploadUrl: () => s.getUploadUrl("k", "application/pdf"),
      getDownloadUrl: () => s.getDownloadUrl("k"),
      uploadBuffer: () => s.uploadBuffer("k", Buffer.from("x"), "text/plain"),
      deleteObject: () => s.deleteObject("k"),
      deletePublic: () => s.deleteObject("k", "public"),
      getClientUploadToken: () => s.getClientUploadToken("k", { allowedContentTypes: ["application/pdf"], maximumSizeInBytes: 10, validForSeconds: 60 }),
      readObjectHead: () => s.readObjectHead("k", 4),
      statObject: () => s.statObject("k"),
    };
    const out = {};
    for (const [config, vars] of Object.entries(configs)) {
      for (const k of ["BLOB_READ_WRITE_TOKEN", "BLOB_PUBLIC_READ_WRITE_TOKEN", "BLOB_STORE_ID", "VERCEL_OIDC_TOKEN"]) delete process.env[k];
      Object.assign(process.env, vars);
      for (const [name, call] of Object.entries(calls)) {
        try { await call(); out[config + "." + name] = "ALLOWED"; } catch (e) { out[config + "." + name] = e?.name ?? "Error"; }
      }
    }
    console.log("RESULT " + JSON.stringify(out));
  `;
  const r = run({ nodeEnv: "development", databaseUrl: DEV_DB, script });
  const line = r.output.split("\n").find((l) => l.startsWith("RESULT "));
  assert.ok(line, r.output);
  const result = JSON.parse(line.slice(7)) as Record<string, string>;
  for (const [name, outcome] of Object.entries(result)) assert.equal(outcome, "BlobSafetyError", `${name} must be refused by the guard`);
  assert.equal(Object.keys(result).length, 4 * 8);
  assert.doesNotMatch(r.output, new RegExp(SECRET));
});
