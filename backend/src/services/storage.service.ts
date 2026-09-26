import { BlobNotFoundError, put, del, head, issueSignedToken, presignUrl } from "@vercel/blob";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";

/**
 * Two stores: the main one is private (course content, signed links only). Demo videos can go to a
 * separate public store when BLOB_PUBLIC_READ_WRITE_TOKEN is set — Vercel fixes a store's access
 * mode at creation, so public files can't live in the private store.
 */
export type BlobStore = "private" | "public";

export function publicStoreConfigured() {
  return Boolean(process.env.BLOB_PUBLIC_READ_WRITE_TOKEN);
}

/** Strips anything token-like from text we return or log. */
export function redactBlobSecrets(text: string) {
  return text.replace(/vercel_blob_rw_[A-Za-z0-9_-]+/g, "vercel_blob_rw_[redacted]").replace(/(delegation|token)=[^&\s"]+/gi, "$1=[redacted]");
}

/**
 * TEMPORARY (production Blob investigation): logs every Blob call's failure with operation, key and
 * store, and slow successes. Rethrows unchanged, so behaviour is identical.
 */
async function logged<T>(op: string, key: string, store: BlobStore, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    const result = await fn();
    const ms = Date.now() - started;
    if (ms > 2000) console.warn(`[BLOB] ${op} ${key} (${store}) ok but slow: ${ms}ms`);
    return result;
  } catch (err) {
    if (!(err instanceof BlobNotFoundError)) {
      const e = err instanceof Error ? err : new Error(String(err));
      console.error(`[BLOB] ${op} ${key} (${store}) failed after ${Date.now() - started}ms: ${e.name}: ${redactBlobSecrets(e.message)}`, {
        tokenSet: Boolean(tokenFor(store)),
      });
    }
    throw err;
  }
}

function tokenFor(store: BlobStore) {
  return store === "public" ? process.env.BLOB_PUBLIC_READ_WRITE_TOKEN : process.env.BLOB_READ_WRITE_TOKEN;
}

/** Admin content-upload flow: client PUTs directly to Blob storage using this URL. */
export async function getUploadUrl(key: string, contentType: string, expiresInSeconds = 300) {
  return logged("sign-put-url", key, "private", () => signPutUrl(key, contentType, expiresInSeconds));
}

async function signPutUrl(key: string, contentType: string, expiresInSeconds: number) {
  const validUntil = Date.now() + expiresInSeconds * 1000;
  const token = await issueSignedToken({
    pathname: key,
    operations: ["put"],
    allowedContentTypes: [contentType],
    validUntil,
  });
  const { presignedUrl } = await presignUrl(token, {
    operation: "put",
    pathname: key,
    access: "private",
    allowedContentTypes: [contentType],
    allowOverwrite: true,
    addRandomSuffix: false,
    validUntil,
  });
  return presignedUrl;
}

/** Paid-content access flow: short-lived GET URL, only issued after CourseAccess is verified. */
export async function getDownloadUrl(key: string, expiresInSeconds = 300) {
  return logged("sign-get-url", key, "private", () => signGetUrl(key, expiresInSeconds));
}

async function signGetUrl(key: string, expiresInSeconds: number) {
  const validUntil = Date.now() + expiresInSeconds * 1000;
  const token = await issueSignedToken({
    pathname: key,
    operations: ["get"],
    validUntil,
  });
  const { presignedUrl } = await presignUrl(token, {
    operation: "get",
    pathname: key,
    access: "private",
    validUntil,
  });
  return presignedUrl;
}

/** Server-side upload for small submissions (e.g. job application resumes)
 * where we don't want to hand out a presigned PUT URL to anonymous visitors. */
export async function uploadBuffer(key: string, body: Buffer, contentType: string) {
  await logged("put", key, "private", () => put(key, body, { access: "private", contentType, addRandomSuffix: false, allowOverwrite: true }));
}

export async function deleteObject(key: string, store: BlobStore = "private") {
  await logged("del", key, store, () => del(key, { token: tokenFor(store) }));
}

export function buildStorageKey(prefix: string, filename: string) {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${prefix}/${Date.now()}-${safe}`;
}

/**
 * Client token for a browser upload straight to the private store, pinned to one pathname,
 * content type and size cap. Large files go up in parts (multipart), so they never pass
 * through this server — which couldn't accept a 2 GB request body anyway.
 */
export async function getClientUploadToken(
  pathname: string,
  opts: { allowedContentTypes: string[]; maximumSizeInBytes: number; validForSeconds: number; store?: BlobStore }
) {
  const store = opts.store ?? "private";
  return logged("client-upload-token", pathname, store, () =>
    generateClientTokenFromReadWriteToken({
      token: tokenFor(store),
      pathname,
      allowedContentTypes: opts.allowedContentTypes,
      maximumSizeInBytes: opts.maximumSizeInBytes,
      validUntil: Date.now() + opts.validForSeconds * 1000,
      addRandomSuffix: false,
      allowOverwrite: false,
    })
  );
}

/** Metadata of a stored object, or null when it doesn't exist. */
export async function statObject(key: string, store: BlobStore = "private") {
  try {
    const blob = await logged("head", key, store, () => head(key, { token: tokenFor(store) }));
    return { size: blob.size, contentType: blob.contentType, pathname: blob.pathname, url: blob.url };
  } catch (err) {
    if (err instanceof BlobNotFoundError) return null;
    throw err;
  }
}
