-- CreateEnum
CREATE TYPE "PartnerCardStatus" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED', 'INACTIVE');

-- CreateTable
CREATE TABLE "PartnerCard" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "partnerId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "photo" TEXT,
    "role" TEXT NOT NULL DEFAULT 'Authorized Business Partner',
    "location" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3),
    "qrToken" TEXT NOT NULL,
    "qrCodeUrl" TEXT NOT NULL,
    "signature" TEXT,
    "status" "PartnerCardStatus" NOT NULL DEFAULT 'PENDING',
    "adminNote" TEXT,
    "issueCount" INTEGER NOT NULL DEFAULT 1,
    "issuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartnerCard_userId_key" ON "PartnerCard"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerCard_number_key" ON "PartnerCard"("number");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerCard_partnerId_key" ON "PartnerCard"("partnerId");

-- CreateIndex
CREATE INDEX "PartnerCard_status_idx" ON "PartnerCard"("status");

-- AddForeignKey
ALTER TABLE "PartnerCard" ADD CONSTRAINT "PartnerCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
