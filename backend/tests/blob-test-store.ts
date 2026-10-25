/**
 * Decides, once per test run, which Blob store the tests may touch. Preloaded by `npm test` and
 * imported by every test file, before the app, so it runs before anything reads a Blob token.
 *
 * - offline (default): no test store configured. @vercel/blob is replaced by a stand-in — signing
 *   returns dummy links on a reserved .invalid host, and put/del/head throw — and the main tokens
 *   (backend/.env holds the production store's) are cleared for the run, so nothing can reach a
 *   real store. Real-Blob tests skip.
 * - test-store: TEST_BLOB_READ_WRITE_TOKEN belongs to a store that is positively identified as
 *   isolated (see resolveBlobTestMode). The whole run is pinned to it: BLOB_READ_WRITE_TOKEN is
 *   replaced by the test token and the public-store token is cleared. Real-Blob tests run.
 * - refused: a test token is set but its store can't be proven isolated. Storage stays offline as
 *   above, and the real-Blob tests FAIL with the reason, so a misconfiguration is never silent.
 *
 * Tokens are never printed: messages name stores by a short prefix of their ID only.
 */
import "dotenv/config";
import { mock } from "node:test";

export type BlobTestMode =
  | { kind: "offline"; reason: string }
  | { kind: "test-store"; storeId: string }
  | { kind: "refused"; reason: string };

/** The store ID inside a read-write token (vercel_blob_rw_<storeId>_<secret>), or null. */
export function storeIdOf(token: string | undefined | null): string | null {
  return /^vercel_blob_rw_([A-Za-z0-9]+)_\S+$/.exec((token ?? "").trim())?.[1] ?? null;
}

/** Enough of a store ID to tell stores apart in a message, never the whole thing. */
export const describeStore = (storeId: string) => `${storeId.slice(0, 4)}…`;

export interface BlobTestConfig {
  /** TEST_BLOB_READ_WRITE_TOKEN */
  testToken?: string;
  /** TEST_BLOB_STORE_ID: the operator states which store the token must belong to. */
  testStoreId?: string;
  /** Stores the tests must never use: the main/public stores and PRODUCTION_BLOB_STORE_IDS. */
  productionStoreIds: string[];
}

/**
 * A test store is used only when ALL hold: the test token is a well-formed read-write token; its
 * store matches TEST_BLOB_STORE_ID (so the operator has confirmed which store it is); at least one
 * production store is known to compare against; and the test store is none of them. Anything less
 * can't be proven isolated, so it is refused rather than guessed.
 */
export function resolveBlobTestMode(config: BlobTestConfig): BlobTestMode {
  const testToken = config.testToken?.trim();
  if (!testToken) return { kind: "offline", reason: "no test-only Blob store configured (set TEST_BLOB_READ_WRITE_TOKEN and TEST_BLOB_STORE_ID)" };

  const storeId = storeIdOf(testToken);
  if (!storeId) return { kind: "refused", reason: "TEST_BLOB_READ_WRITE_TOKEN isn't a Blob read-write token" };

  const declared = config.testStoreId?.trim();
  if (!declared) return { kind: "refused", reason: "set TEST_BLOB_STORE_ID to the test store's ID to confirm which store the test token belongs to" };
  if (declared !== storeId) return { kind: "refused", reason: `TEST_BLOB_STORE_ID doesn't match the test token's store (${describeStore(storeId)})` };

  const production = [...new Set(config.productionStoreIds.map((s) => s.trim()).filter(Boolean))];
  if (production.length === 0) {
    return {
      kind: "refused",
      reason: "can't confirm the test store is isolated: no production store is known to compare against (keep BLOB_READ_WRITE_TOKEN in backend/.env, or set PRODUCTION_BLOB_STORE_IDS)",
    };
  }
  if (production.includes(storeId)) return { kind: "refused", reason: `TEST_BLOB_READ_WRITE_TOKEN belongs to a production store (${describeStore(storeId)})` };

  return { kind: "test-store", storeId };
}

/** Reads the configuration from the environment (after backend/.env has been loaded). */
export function blobTestConfigFromEnv(env: NodeJS.ProcessEnv = process.env): BlobTestConfig {
  return {
    testToken: env.TEST_BLOB_READ_WRITE_TOKEN,
    testStoreId: env.TEST_BLOB_STORE_ID,
    productionStoreIds: [
      storeIdOf(env.BLOB_READ_WRITE_TOKEN),
      storeIdOf(env.BLOB_PUBLIC_READ_WRITE_TOKEN),
      ...(env.PRODUCTION_BLOB_STORE_IDS ?? "").split(","),
    ].filter((s): s is string => Boolean(s && s.trim())),
  };
}

async function installOfflineStandIn() {
  const real = await import("@vercel/blob");
  const offline = (name: string) => () => {
    throw new Error(`@vercel/blob ${name}() called in an offline test run (no test-only Blob store)`);
  };
  mock.module("@vercel/blob", {
    namedExports: {
      ...real,
      issueSignedToken: async (opts: { pathname: string; validUntil: number }) => `offline:${opts.pathname}:${opts.validUntil}`,
      presignUrl: async (_token: string, opts: { operation: string; pathname: string; validUntil: number }) => ({
        presignedUrl: `https://blob.offline-test.invalid/${opts.pathname}?op=${opts.operation}&valid-until=${opts.validUntil}`,
      }),
      put: offline("put"),
      del: offline("del"),
      head: offline("head"),
    },
  });
}

/** Applies a mode to this process. Exported for the harness's own tests; runs once below. */
export async function applyBlobTestMode(mode: BlobTestMode, env: NodeJS.ProcessEnv = process.env) {
  if (mode.kind === "test-store") {
    env.BLOB_READ_WRITE_TOKEN = env.TEST_BLOB_READ_WRITE_TOKEN!.trim();
    env.BLOB_PUBLIC_READ_WRITE_TOKEN = "";
    return;
  }
  // Offline or refused: no real token survives in this process, and the SDK can't reach a store.
  env.BLOB_READ_WRITE_TOKEN = "";
  env.BLOB_PUBLIC_READ_WRITE_TOKEN = "";
  try {
    await installOfflineStandIn();
  } catch {
    // Without --experimental-test-module-mocks the stand-in can't be installed; with every token
    // cleared, real calls still fail instead of reaching a store.
  }
}

const globalKey = Symbol.for("eca.blobTestMode");
const store = globalThis as unknown as Record<symbol, BlobTestMode | undefined>;
if (!store[globalKey]) {
  const mode = resolveBlobTestMode(blobTestConfigFromEnv());
  store[globalKey] = mode;
  await applyBlobTestMode(mode);
  if (mode.kind === "refused") console.error(`[blob-test-store] REFUSED real-Blob tests: ${mode.reason}`);
}

/** This run's mode. */
export const blobTestMode: BlobTestMode = store[globalKey]!;

/** `skip` option for real-Blob tests: skipped when no test store is configured; never when refused. */
export const realBlobSkip: string | false =
  blobTestMode.kind === "offline" ? `needs a test-only Blob store: ${blobTestMode.reason}` : false;

/** First line of every real-Blob test: throws unless this run is pinned to an isolated test store. */
export function assertRealBlobAllowed() {
  if (blobTestMode.kind !== "test-store") {
    throw new Error(`Refusing to run a real-Blob test: ${blobTestMode.reason}`);
  }
  if (storeIdOf(process.env.BLOB_READ_WRITE_TOKEN) !== blobTestMode.storeId) {
    throw new Error("Refusing to run a real-Blob test: this run's Blob token isn't the test store's");
  }
}
