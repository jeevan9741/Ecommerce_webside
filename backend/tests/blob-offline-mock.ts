/**
 * Preloaded by `npm test`. With no BLOB_READ_WRITE_TOKEN configured, replaces @vercel/blob so the
 * access-control tests can run offline: signing returns a dummy https link on a reserved .invalid
 * host (never reachable), and every call that would touch a store (put, del, head) throws. Tests
 * that need a real store (3b, 8b) still skip without a token. With a token set this does nothing.
 */
import "dotenv/config";
import { mock } from "node:test";

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  const real = await import("@vercel/blob");
  const offline = (name: string) => () => {
    throw new Error(`@vercel/blob ${name}() called in an offline test run (no BLOB_READ_WRITE_TOKEN)`);
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
