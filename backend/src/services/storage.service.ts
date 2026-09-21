import { put, del, issueSignedToken, presignUrl } from "@vercel/blob";

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

export async function deleteObject(key: string) {
  await del(key);
}

export function buildStorageKey(prefix: string, filename: string) {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${prefix}/${Date.now()}-${safe}`;
}
