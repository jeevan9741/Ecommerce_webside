import { isProductionDatabase } from "./payment-safety.js";

/**
 * Keeps non-production environments (local development, staging, tests) away from the production Vercel
 * Blob stores, which hold real customers' course files, e-books and documents. A process counts as
 * PRODUCTION only when NODE_ENV is "production" AND DATABASE_URL points at a known production database;
 * anything else — including a missing NODE_ENV — is non-production. In a non-production process, a Blob
 * token (or OIDC BLOB_STORE_ID) that belongs to a production store, or that can't be identified at all,
 * is refused: at startup the server exits, and every storage call throws before it reaches Vercel.
 * Token values are never printed; only their classification is.
 */

/**
 * Store IDs (without the "store_" prefix) of production Blob stores: the live store and the reserved
 * eca-production store. PRODUCTION_BLOB_STORE_IDS (comma-separated, with or without "store_") ADDS IDs;
 * it can't remove these, so an empty or mistyped value never switches the guard off.
 */
const BUILT_IN_PRODUCTION_STORES = ["FsKazgqDqoAf33lQ", "AxubRppuBaK1X6iD"];

export const normaliseStoreId = (id: string) => id.trim().replace(/^store_/i, "").toLowerCase();

export function productionStoreIds(extra: string | undefined = process.env.PRODUCTION_BLOB_STORE_IDS) {
  return new Set([...BUILT_IN_PRODUCTION_STORES, ...(extra ?? "").split(",")].map(normaliseStoreId).filter(Boolean));
}

/** The store ID inside a read-write token (vercel_blob_rw_<storeId>_<secret>), or null if it isn't one. */
export function storeIdFromToken(token: string | undefined): string | null {
  return /^vercel_blob_rw_([A-Za-z0-9]+)_\S+$/.exec((token ?? "").trim())?.[1] ?? null;
}

export type BlobTokenClass = "unset" | "production" | "non-production" | "unrecognised";

export function classifyBlobToken(token: string | undefined, productionIds: Set<string>): BlobTokenClass {
  if (!token || !token.trim()) return "unset";
  const storeId = storeIdFromToken(token);
  if (!storeId) return "unrecognised";
  return productionIds.has(normaliseStoreId(storeId)) ? "production" : "non-production";
}

/**
 * BLOB_STORE_ID picks the store for the SDK's OIDC auth (VERCEL_OIDC_TOKEN), which the SDK tries BEFORE
 * BLOB_READ_WRITE_TOKEN whenever a call passes no token — so it is classified like a token.
 */
export function classifyBlobStoreId(storeId: string | undefined, productionIds: Set<string>): BlobTokenClass {
  if (!storeId || !storeId.trim()) return "unset";
  if (!/^(store_)?[A-Za-z0-9]+$/i.test(storeId.trim())) return "unrecognised";
  return productionIds.has(normaliseStoreId(storeId)) ? "production" : "non-production";
}

/** Production only with BOTH NODE_ENV=production and a known production database; otherwise non-production. */
export function isProductionEnvironment(nodeEnv: string | undefined = process.env.NODE_ENV, productionDatabase: boolean = isProductionDatabase()) {
  return nodeEnv === "production" && productionDatabase;
}

export interface BlobSafetyInput {
  nodeEnv?: string;
  productionDatabase: boolean;
  privateToken?: string;
  publicToken?: string;
  oidcStoreId?: string;
  productionIdsExtra?: string;
}

const explain = (c: BlobTokenClass, what = "Vercel Blob read-write token") =>
  c === "production" ? "belongs to a PRODUCTION Blob store" : `isn't a recognisable ${what}, so it can't be shown to be a non-production store`;

/** Why this configuration must not use Blob storage, or null when it may. Never includes token values. */
export function blobSafetyProblem(input: BlobSafetyInput): string | null {
  if (isProductionEnvironment(input.nodeEnv, input.productionDatabase)) return null;
  const ids = productionStoreIds(input.productionIdsExtra);
  const problems: string[] = [];
  for (const [name, token] of [["BLOB_READ_WRITE_TOKEN", input.privateToken], ["BLOB_PUBLIC_READ_WRITE_TOKEN", input.publicToken]] as const) {
    const c = classifyBlobToken(token, ids);
    if (c === "production" || c === "unrecognised") problems.push(`${name} ${explain(c)}`);
  }
  const oidc = classifyBlobStoreId(input.oidcStoreId, ids);
  if (oidc === "production" || oidc === "unrecognised") problems.push(`BLOB_STORE_ID (used with VERCEL_OIDC_TOKEN) ${explain(oidc, "Blob store ID")}`);
  return problems.length
    ? `${problems.join("; ")} — refused in a non-production environment (NODE_ENV=production and a production DATABASE_URL are both required for production; add its endpoint to PRODUCTION_DATABASE_ENDPOINTS if the production database moved).`
    : null;
}

/** The current process's configuration (read at call time, so a changed environment is re-checked). */
const currentInput = (): BlobSafetyInput => ({
  nodeEnv: process.env.NODE_ENV,
  productionDatabase: isProductionDatabase(),
  privateToken: process.env.BLOB_READ_WRITE_TOKEN,
  publicToken: process.env.BLOB_PUBLIC_READ_WRITE_TOKEN,
  oidcStoreId: process.env.BLOB_STORE_ID,
  productionIdsExtra: process.env.PRODUCTION_BLOB_STORE_IDS,
});

export class BlobSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlobSafetyError";
  }
}

/** Every storage call runs this first: a refused configuration never reaches Vercel. */
export function assertBlobStoreAllowed() {
  const problem = blobSafetyProblem(currentInput());
  if (problem) throw new BlobSafetyError(`[BLOB] Storage refused: ${problem}`);
}

/** Startup report + hard stop: classifications only, never token values or store IDs. */
export function checkBlobStoreOnStartup() {
  const input = currentInput();
  const ids = productionStoreIds(input.productionIdsExtra);
  console.log(
    `[BLOB] environment: ${isProductionEnvironment(input.nodeEnv, input.productionDatabase) ? "PRODUCTION" : "non-production"} · private store: ${classifyBlobToken(input.privateToken, ids)} · public store: ${classifyBlobToken(input.publicToken, ids)} · OIDC store: ${classifyBlobStoreId(input.oidcStoreId, ids)}`
  );
  const problem = blobSafetyProblem(input);
  if (!problem) return;
  console.error(`[BLOB] FATAL: ${problem} Refusing to start.`);
  process.exit(1);
}
