import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";

/** Per-request database timing, filled in by the Prisma query listener (see config/prisma.ts). */
const dbTiming = new AsyncLocalStorage<{ ms: number; count: number }>();

export function recordQuery(durationMs: number) {
  const store = dbTiming.getStore();
  if (!store) return;
  store.ms += durationMs;
  store.count += 1;
}

/**
 * Baseline security headers for a JSON API (it never renders HTML or gets framed), plus a
 * Server-Timing header — `app` is total time in this server, `db` is time spent in queries — so
 * browser devtools and curl can tell server/database time apart from network time.
 */
export function responseHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (env.isProduction) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");

  const started = process.hrtime.bigint();
  const store = { ms: 0, count: 0 };
  const writeHead = res.writeHead;
  res.writeHead = function (this: Response, ...args: Parameters<Response["writeHead"]>) {
    if (!res.headersSent) {
      const appMs = Number(process.hrtime.bigint() - started) / 1e6;
      res.setHeader("Server-Timing", `app;dur=${appMs.toFixed(1)}, db;dur=${store.ms.toFixed(1)};desc="${store.count} queries"`);
    }
    return writeHead.apply(this, args);
  } as Response["writeHead"];

  dbTiming.run(store, next);
}
