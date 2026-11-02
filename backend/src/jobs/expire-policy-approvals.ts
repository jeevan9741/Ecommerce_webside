/**
 * Scheduled job: expires franchise policy publication requests that passed their expiry time
 * (request → EXPIRED, policy → REJECTED, audit row; nothing is deleted). Safe to run repeatedly and
 * alongside the API: each request is expired under the same locks the approval path uses.
 *   npm run franchise:expire-approvals    (e.g. a Render Cron Job every 15 minutes)
 */
import { prisma } from "../config/prisma.js";
import { expireStaleApprovals } from "../services/policy.service.js";

const result = await expireStaleApprovals();
console.log(`[POLICY] expiry run: ${result.checked} overdue, ${result.expired} expired`);
await prisma.$disconnect();
