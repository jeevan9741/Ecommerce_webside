-- CreateEnum
CREATE TYPE "PartnerCardRequestKind" AS ENUM ('FREE', 'REISSUE');

-- CreateEnum
CREATE TYPE "PartnerCardRequestStatus" AS ENUM ('AWAITING_PAYMENT', 'PENDING', 'REJECTED', 'ISSUED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PartnerCardPaymentStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'PAID', 'WAIVED');

-- AlterTable
ALTER TABLE "PartnerCard" ADD COLUMN     "firstIssuedAt" TIMESTAMP(3),
ADD COLUMN     "issued" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reissueFeeInPaise" INTEGER,
ALTER COLUMN "issueCount" SET DEFAULT 0;

-- CreateTable
CREATE TABLE "PartnerCardRequest" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "PartnerCardRequestKind" NOT NULL,
    "status" "PartnerCardRequestStatus" NOT NULL,
    "paymentStatus" "PartnerCardPaymentStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "feeInPaise" INTEGER NOT NULL DEFAULT 0,
    "fullName" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "photo" TEXT,
    "reason" TEXT,
    "razorpayOrderId" TEXT,
    "razorpayPaymentId" TEXT,
    "paidAt" TIMESTAMP(3),
    "adminNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "issueNumber" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerCardRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartnerCardRequest_razorpayOrderId_key" ON "PartnerCardRequest"("razorpayOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerCardRequest_razorpayPaymentId_key" ON "PartnerCardRequest"("razorpayPaymentId");

-- CreateIndex
CREATE INDEX "PartnerCardRequest_cardId_status_idx" ON "PartnerCardRequest"("cardId", "status");

-- CreateIndex
CREATE INDEX "PartnerCardRequest_status_idx" ON "PartnerCardRequest"("status");

-- AddForeignKey
ALTER TABLE "PartnerCardRequest" ADD CONSTRAINT "PartnerCardRequest_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "PartnerCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Cards approved before this policy already received their free card.
UPDATE "PartnerCard"
SET "issued" = true, "firstIssuedAt" = COALESCE("issuedAt", "updatedAt")
WHERE "status" IN ('ACTIVE', 'INACTIVE');

-- At most one open (unpaid or awaiting review) request per card, enforced by the database so
-- concurrent submissions can't create duplicate free cards. Not expressible in the Prisma schema.
CREATE UNIQUE INDEX "PartnerCardRequest_one_open_per_card"
ON "PartnerCardRequest"("cardId")
WHERE "status" IN ('AWAITING_PAYMENT', 'PENDING');
