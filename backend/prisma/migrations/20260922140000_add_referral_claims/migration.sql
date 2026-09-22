-- CreateEnum
CREATE TYPE "ReferralClaimStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "ReferralClaim" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "studentName" TEXT NOT NULL,
    "studentPhone" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "utr" TEXT NOT NULL,
    "status" "ReferralClaimStatus" NOT NULL DEFAULT 'PENDING',
    "commissionInPaise" INTEGER,
    "adminNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReferralClaim_utr_key" ON "ReferralClaim"("utr");

-- CreateIndex
CREATE INDEX "ReferralClaim_partnerId_status_idx" ON "ReferralClaim"("partnerId", "status");

-- CreateIndex
CREATE INDEX "ReferralClaim_status_idx" ON "ReferralClaim"("status");

-- AddForeignKey
ALTER TABLE "ReferralClaim" ADD CONSTRAINT "ReferralClaim_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralClaim" ADD CONSTRAINT "ReferralClaim_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

