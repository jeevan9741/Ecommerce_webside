import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Time-based one-time passwords (TOTP, RFC 6238 over HOTP, RFC 4226): HMAC-SHA1, 6 digits, 30-second
 * steps — the scheme every mainstream authenticator app (Google Authenticator, Microsoft Authenticator,
 * 1Password, Authy…) implements. Verified against the RFC 6238 test vectors in tests/admin-mfa.test.ts.
 */

export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;
/** Codes from one step either side are accepted, for clock drift. */
export const TOTP_WINDOW = 1;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) throw new Error("Invalid base32 character");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret (the RFC 4226 recommended length), base32 for authenticator apps. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** HOTP value for a counter (RFC 4226 dynamic truncation). */
export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", secret).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export const timeStep = (at: Date = new Date()) => Math.floor(at.getTime() / 1000 / TOTP_PERIOD_SECONDS);

export function totp(secretBase32: string, at: Date = new Date(), digits = TOTP_DIGITS): string {
  return hotp(base32Decode(secretBase32), timeStep(at), digits);
}

const sameCode = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Returns the time step a code matches (within the drift window), or null. A step at or before
 * `lastUsedStep` never matches, so a code — or an older one — can't be replayed.
 */
export function verifyTotp(secretBase32: string, code: string, at: Date = new Date(), lastUsedStep: number | null = null): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretBase32);
  const now = timeStep(at);
  let matched: number | null = null;
  for (let step = now - TOTP_WINDOW; step <= now + TOTP_WINDOW; step++) {
    // Check every step (no early exit) so timing doesn't reveal which one matched.
    if (sameCode(hotp(secret, step), code) && (lastUsedStep === null || step > lastUsedStep)) matched = step;
  }
  return matched;
}

/** The otpauth:// URI authenticator apps import (by QR code or link). */
export function otpauthUri(issuer: string, account: string, secretBase32: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret: secretBase32, issuer, algorithm: "SHA1", digits: String(TOTP_DIGITS), period: String(TOTP_PERIOD_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Ten one-time recovery codes, 12 base32 characters each (60 bits), shown as XXXX-XXXX-XXXX. */
export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const raw = base32Encode(randomBytes(8)).slice(0, 12);
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
  });
}

/** Recovery codes are stored only as a SHA-256 of their normalised form (they are high-entropy). */
export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(`eta-admin-recovery:${code.replace(/[\s-]/g, "").toUpperCase()}`).digest("hex");
}
