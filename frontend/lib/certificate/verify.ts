import { SITE_URL } from "@/lib/site";

/** Public verification page for a certificate (the QR code's target). */
export function certificateVerifyUrl(certificateNo: string) {
  return `${SITE_URL}/verify-certificate/${encodeURIComponent(certificateNo)}`;
}

export function normaliseCertificateNo(value: string) {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Malformed escape — use the raw segment; it simply won't match a certificate.
  }
  return decoded.trim().toUpperCase().replace(/\s+/g, "");
}
