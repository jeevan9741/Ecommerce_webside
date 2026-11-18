-- Franchise applications: a PIN code on new applications, and an index for the one-open-application-per-mobile check.
-- Additive only: existing rows keep a NULL PIN code; nothing is rewritten.

-- AlterTable
ALTER TABLE "FranchiseApplication" ADD COLUMN     "pincode" TEXT;

-- A PIN code, when present, is six digits not starting with 0 (the API checks the same rule first).
ALTER TABLE "FranchiseApplication" ADD CONSTRAINT "FranchiseApplication_pincode_format" CHECK ("pincode" IS NULL OR "pincode" ~ '^[1-9][0-9]{5}$');

-- CreateIndex
CREATE INDEX "FranchiseApplication_mobile_idx" ON "FranchiseApplication"("mobile");
