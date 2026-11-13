import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * A student-to-franchise link written directly, for tests that need one without going through an
 * invitation. The database only accepts such a link inside the logged maintenance process (real links come
 * from an accepted invitation or a two-admin reassignment), so this does exactly that — and records it in
 * FinancialMaintenanceLog like any other maintenance write.
 */
export function linkFixture(prisma: PrismaClient, data: Prisma.FranchiseStudentUncheckedCreateInput) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL eta.financial_maintenance = 'on'`;
    await tx.$executeRaw`SET LOCAL eta.maintenance_reason = 'test fixture: student link without an invitation'`;
    return tx.franchiseStudent.create({ data });
  });
}

/** Moves a link to ENDED directly (tests only), also through the logged maintenance process. */
export function endLinkFixture(prisma: PrismaClient, id: string, endReason = "test") {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL eta.financial_maintenance = 'on'`;
    await tx.$executeRaw`SET LOCAL eta.maintenance_reason = 'test fixture: ending a student link directly'`;
    return tx.franchiseStudent.update({ where: { id }, data: { status: "ENDED", endsAt: new Date(), endReason } });
  });
}
