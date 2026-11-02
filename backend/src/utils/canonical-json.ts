import { createHash } from "node:crypto";

/**
 * Canonical JSON for hashing configuration: object keys sorted, no whitespace, and only values that
 * serialise exactly — strings, booleans, null and SAFE INTEGERS. Floats, NaN, Infinity, unsafe
 * integers and BigInt are refused (money is carried as decimal-integer strings), so two equal
 * payloads always hash the same and a hash can never hide a rounding difference.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error(`Only safe integers are allowed in policy data (got ${value})`);
    return String(value);
  }
  if (typeof value === "bigint") throw new Error("BigInt values must be written as decimal strings in policy data");
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .filter((k) => record[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`)
      .join(",")}}`;
  }
  throw new Error(`Unsupported value in policy data: ${typeof value}`);
}

export function sha256Hex(text: string) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** SHA-256 of the canonical form: the hash approvers review and the database pins. */
export function canonicalSha256(value: unknown) {
  return sha256Hex(canonicalJson(value));
}

/** Parses canonical JSON text back to a plain value (used when re-hashing a stored payload). */
export function reparse<T = unknown>(value: unknown): T {
  return JSON.parse(canonicalJson(value)) as T;
}
