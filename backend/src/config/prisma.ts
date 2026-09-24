import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { env } from "./env.js";

const adapter = new PrismaPg({ connectionString: env.databaseUrl });

export const prisma = new PrismaClient({
  adapter,
  log: env.isProduction ? ["error"] : ["error", "warn"],
  // The database is remote (and can cold-start), so Prisma's 2s/5s defaults are too tight for the
  // payment and withdrawal transactions — a timeout there would fail a webhook and force a retry.
  transactionOptions: { maxWait: 10_000, timeout: 20_000 },
});
