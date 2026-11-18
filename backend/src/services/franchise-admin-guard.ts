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

/**
 * No admin decides on their own franchise application (review, approval, rejection, state reservation).
 * Admin accounts can't apply in the first place; this also covers an application made before a promotion.
 * The refusal is audited outside the caller's transaction so the record survives its rollback.
 */
export async function refuseOwnApplication(actorId: string, app: { id: string; userId: string; applicationNo: string }, action: string) {
  if (app.userId !== actorId) return;
  await prisma.auditLog.create({ data: { actorId, action: "FRANCHISE_SELF_REVIEW_BLOCKED", target: app.id, metadata: { applicationNo: app.applicationNo, attempted: action } } });
  throw new HttpError(403, "You can't review or decide on your own franchise application.", { code: "SELF_REVIEW" });
}
