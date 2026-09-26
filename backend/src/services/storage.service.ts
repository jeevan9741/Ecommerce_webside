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

function tokenFor(store: BlobStore) {
  return store === "public" ? process.env.BLOB_PUBLIC_READ_WRITE_TOKEN : process.env.BLOB_READ_WRITE_TOKEN;
}

/** Admin content-upload flow: client PUTs directly to Blob storage using this URL. */
export async function getUploadUrl(key: string, contentType: string, expiresInSeconds = 300) {
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
  await put(key, body, { access: "private", contentType, addRandomSuffix: false, allowOverwrite: true });
}

export async function deleteObject(key: string, store: BlobStore = "private") {
  await del(key, { token: tokenFor(store) });
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
  return generateClientTokenFromReadWriteToken({
    token: tokenFor(opts.store ?? "private"),
    pathname,
    allowedContentTypes: opts.allowedContentTypes,
    maximumSizeInBytes: opts.maximumSizeInBytes,
    validUntil: Date.now() + opts.validForSeconds * 1000,
    addRandomSuffix: false,
    allowOverwrite: false,
  });
}

/** Metadata of a stored object, or null when it doesn't exist. */
export async function statObject(key: string, store: BlobStore = "private") {
  try {
    const blob = await head(key, { token: tokenFor(store) });
    return { size: blob.size, contentType: blob.contentType, pathname: blob.pathname, url: blob.url };
  } catch (err) {
    if (err instanceof BlobNotFoundError) return null;
    throw err;
  }
}
