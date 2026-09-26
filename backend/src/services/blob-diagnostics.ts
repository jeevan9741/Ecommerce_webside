import { del, list, put } from "@vercel/blob";
import { getDownloadUrl, redactBlobSecrets } from "./storage.service.js";

/**
 * TEMPORARY Blob diagnostics for /api/health (investigating production 500s on demo videos).
 * Reports whether the token is present and well-formed and which store it belongs to, and runs
 * live list / signed-URL (and optionally put+delete) checks. Never returns the token or its secret.
 */

/** The private store holding course/demo files (appears lowercased in blob URLs). */
const EXPECTED_STORE_ID = "FsKazgqDqoAf33lQ";
const TOKEN_PREFIX = "vercel_blob_rw_";
const CACHE_MS = 60 * 1000;

function describeError(err: unknown) {
  if (err instanceof Error) return { name: err.name, message: redactBlobSecrets(err.message) };
  return { name: "Unknown", message: redactBlobSecrets(String(err)) };
}

export function inspectBlobToken() {
  const raw = process.env.BLOB_READ_WRITE_TOKEN;
  if (raw === undefined) return { present: false as const, problem: "BLOB_READ_WRITE_TOKEN is not set in this process's environment" };

  const trimmed = raw.trim().replace(/^["']|["']$/g, "");
  const problems: string[] = [];
  if (raw.length === 0) problems.push("BLOB_READ_WRITE_TOKEN is set but empty");
  if (raw !== raw.trim()) problems.push("value has leading/trailing whitespace or a newline");
  if (/^["']|["']$/.test(raw.trim())) problems.push("value is wrapped in quotes");
  if (!trimmed.startsWith(TOKEN_PREFIX)) {
    problems.push(
      trimmed.startsWith("vercel_blob_") ? "not a read-write token (expected prefix vercel_blob_rw_)" : "unexpected format (expected prefix vercel_blob_rw_)"
    );
  }
  // Format: vercel_blob_rw_<storeId>_<secret>
  const storeId = trimmed.startsWith(TOKEN_PREFIX) ? trimmed.slice(TOKEN_PREFIX.length).split("_")[0] || null : null;
  const matchesExpectedStore = storeId?.toLowerCase() === EXPECTED_STORE_ID.toLowerCase();
  if (storeId && !matchesExpectedStore) problems.push(`token belongs to store ${storeId}, expected ${EXPECTED_STORE_ID}`);

  return {
    present: true as const,
    length: raw.length,
    formatOk: trimmed.startsWith(TOKEN_PREFIX),
    storeId,
    expectedStoreId: EXPECTED_STORE_ID,
    matchesExpectedStore,
    problems,
  };
}

async function timed<T>(fn: () => Promise<T>) {
  const started = Date.now();
  try {
    const value = await fn();
    return { ok: true as const, ms: Date.now() - started, value };
  } catch (err) {
    return { ok: false as const, ms: Date.now() - started, error: describeError(err) };
  }
}

let cached: { at: number; full: boolean; result: unknown } | null = null;

/** `full` also writes and deletes a tiny test object (only on ?blob=full). */
export async function blobDiagnostics(full = false) {
  if (cached && Date.now() - cached.at < CACHE_MS && (cached.full || !full)) return cached.result;

  const token = inspectBlobToken();
  const listCheck = await timed(() => list({ limit: 1 }));
  const signCheck = await timed(() => getDownloadUrl("diagnostics/health-check.txt", 60));
  let putCheck: Awaited<ReturnType<typeof timed>> | null = null;
  if (full) {
    const key = `diagnostics/health-check-${Date.now()}.txt`;
    putCheck = await timed(async () => {
      await put(key, "ok", { access: "private", contentType: "text/plain", addRandomSuffix: false, allowOverwrite: true });
      await del(key);
    });
  }

  const firstError = [listCheck, signCheck, putCheck].find((c) => c && !c.ok) as { error: { name: string; message: string } } | undefined;
  const result = {
    blobConnected: listCheck.ok && signCheck.ok && (putCheck?.ok ?? true),
    blobStoreId: token.present ? token.storeId : null,
    token,
    otherBlobEnv: {
      BLOB_STORE_ID: Boolean(process.env.BLOB_STORE_ID),
      VERCEL_OIDC_TOKEN: Boolean(process.env.VERCEL_OIDC_TOKEN),
      BLOB_PUBLIC_READ_WRITE_TOKEN: Boolean(process.env.BLOB_PUBLIC_READ_WRITE_TOKEN),
    },
    checks: {
      list: listCheck.ok ? { ok: true, ms: listCheck.ms, objectsVisible: listCheck.value.blobs.length > 0 } : listCheck,
      signedUrl: signCheck.ok ? { ok: true, ms: signCheck.ms } : signCheck,
      put: putCheck ? (putCheck.ok ? { ok: true, ms: putCheck.ms } : putCheck) : "skipped (use ?blob=full)",
    },
    blobError: firstError?.error ?? null,
    checkedAt: new Date().toISOString(),
  };
  if (!result.blobConnected) console.error("[BLOB] Health diagnostics failed", JSON.stringify(result));
  cached = { at: Date.now(), full, result };
  return result;
}
