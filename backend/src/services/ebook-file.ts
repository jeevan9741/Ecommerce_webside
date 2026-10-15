/**
 * E-book file rules, shared by the upload token, the upload check and the tests. Only formats listed
 * here can be uploaded; each one is verified by its magic bytes, not just by the declared type.
 */

export const MAX_EBOOK_BYTES = 100 * 1024 ** 2; // 100 MB
export const EBOOK_PREFIX = "ebooks/";

export const EBOOK_FORMATS = {
  "application/pdf": { ext: "pdf", label: "PDF" },
  "application/epub+zip": { ext: "epub", label: "EPUB" },
} as const;

export type EBookMimeType = keyof typeof EBOOK_FORMATS;
export const EBOOK_MIME_TYPES = Object.keys(EBOOK_FORMATS) as EBookMimeType[];

/** Bytes needed by fileSignatureMatches. */
export const SIGNATURE_BYTES = 64;

export function isEBookMimeType(value: string): value is EBookMimeType {
  return value in EBOOK_FORMATS;
}

/** Extension of `filename` matches the declared type. */
export function extensionMatches(filename: string, mimeType: EBookMimeType) {
  return filename.toLowerCase().endsWith(`.${EBOOK_FORMATS[mimeType].ext}`);
}

/**
 * The file's first bytes match its declared type: PDFs start with "%PDF-" (allowing a little leading
 * junk, as readers do); EPUBs are ZIPs whose first entry is the uncompressed "mimetype" file.
 */
export function fileSignatureMatches(head: Uint8Array, mimeType: EBookMimeType) {
  const text = Buffer.from(head).toString("latin1");
  if (mimeType === "application/pdf") return text.slice(0, 32).includes("%PDF-");
  return text.startsWith("PK\x03\x04") && text.slice(30, 58) === "mimetypeapplication/epub+zip";
}

/** Download name: the admin's original filename, or the title, with the right extension. */
export function downloadName(fileName: string, title: string, mimeType: string) {
  const ext = isEBookMimeType(mimeType) ? EBOOK_FORMATS[mimeType].ext : "pdf";
  const base = (fileName || title).replace(/\.[^.]+$/, "").replace(/[^\w\- .()]+/g, "").trim().slice(0, 100) || "ebook";
  return `${base}.${ext}`;
}
