import type { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { HttpError } from "../utils/http.js";

/**
 * Admin checks for franchise administration that read the role from the database. The session token
 * carries the role it was issued with (and stays valid for days), so a demoted admin's token must not keep
 * reading or changing franchise configuration. The global requireAdmin middleware still runs first.
 */

/** Before a read, or before work that precedes a transaction: the actor is an ADMIN right now. */
export async function requireAdminRead(actorId: string) {
  const user = await prisma.user.findUnique({ where: { id: actorId }, select: { role: true } });
  if (user?.role !== "ADMIN") throw new HttpError(403, "Admin access required");
}

/** Inside a write transaction: re-reads and share-locks the actor's row, so a demotion can't race the write. */
export async function requireAdminInTx(tx: Prisma.TransactionClient, actorId: string) {
  const rows = await tx.$queryRaw<{ role: string }[]>`SELECT "role"::text AS "role" FROM "User" WHERE "id" = ${actorId} FOR SHARE`;
  if (rows[0]?.role !== "ADMIN") throw new HttpError(403, "Admin access required");
}
