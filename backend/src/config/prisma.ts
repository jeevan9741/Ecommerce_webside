import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { env } from "./env.js";
import { recordQuery } from "../middleware/response-headers.middleware.js";

const adapter = new PrismaPg({ connectionString: env.databaseUrl });

export const prisma = new PrismaClient({
  adapter,
  log: [
    { emit: "stdout", level: "error" },
    ...(env.isProduction ? [] : [{ emit: "stdout" as const, level: "warn" as const }]),
    // Emitted as events (not printed) so each request can report its database time in Server-Timing.
    { emit: "event", level: "query" },
  ],
  // The database is remote (and can cold-start), so Prisma's 2s/5s defaults are too tight for the
  // payment and withdrawal transactions — a timeout there would fail a webhook and force a retry.
  transactionOptions: { maxWait: 10_000, timeout: 20_000 },
});

prisma.$on("query", (e) => recordQuery(e.duration));
