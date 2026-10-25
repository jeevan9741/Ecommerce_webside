-- Company legal documents (additive only): a new table and enum; no existing data is touched.

-- CreateEnum
CREATE TYPE "LegalDocumentType" AS ENUM ('COMPANY_REGISTRATION', 'GST_REGISTRATION', 'COMPANY_PAN', 'MSME_UDYAM', 'TERMS_AND_CONDITIONS', 'PRIVACY_POLICY', 'OTHER');

-- CreateTable
CREATE TABLE "LegalDocument" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "LegalDocumentType" NOT NULL,
    "description" TEXT,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LegalDocument_storageKey_key" ON "LegalDocument"("storageKey");

-- CreateIndex
CREATE INDEX "LegalDocument_isPublished_displayOrder_idx" ON "LegalDocument"("isPublished", "displayOrder");
