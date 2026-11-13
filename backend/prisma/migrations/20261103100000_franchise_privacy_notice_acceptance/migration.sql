-- Franchise: versioned privacy notice acceptance. Additive only: one new append-only table, its
-- constraints and guard triggers. No existing table, column or row is changed. The notice text itself
-- lives in the COMMERCIAL policy payload (schema version 3), which is versioned and immutable.
-- No IP address or device data is stored.

-- CreateTable
CREATE TABLE "FranchisePrivacyNoticeAcceptance" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "policyVersionId" TEXT NOT NULL,
    "noticeVersion" INTEGER NOT NULL,
    "noticeSha256" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'EXPLICIT_CHECKBOX',
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FranchisePrivacyNoticeAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FranchisePrivacyNoticeAcceptance_userId_idx" ON "FranchisePrivacyNoticeAcceptance"("userId");

-- CreateIndex
CREATE INDEX "FranchisePrivacyNoticeAcceptance_policyVersionId_idx" ON "FranchisePrivacyNoticeAcceptance"("policyVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "FranchisePrivacyNoticeAcceptance_applicationId_policyVersio_key" ON "FranchisePrivacyNoticeAcceptance"("applicationId", "policyVersionId");

-- AddForeignKey
ALTER TABLE "FranchisePrivacyNoticeAcceptance" ADD CONSTRAINT "FranchisePrivacyNoticeAcceptance_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "FranchiseApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FranchisePrivacyNoticeAcceptance" ADD CONSTRAINT "FranchisePrivacyNoticeAcceptance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FranchisePrivacyNoticeAcceptance" ADD CONSTRAINT "FranchisePrivacyNoticeAcceptance_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "PolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Acceptance evidence is never changed or removed: a newer notice is a new row.
CREATE TRIGGER "FranchisePrivacyNoticeAcceptance_append_only" BEFORE UPDATE OR DELETE ON "FranchisePrivacyNoticeAcceptance" FOR EACH ROW EXECUTE FUNCTION eta_append_only();
CREATE TRIGGER "FranchisePrivacyNoticeAcceptance_no_truncate" BEFORE TRUNCATE ON "FranchisePrivacyNoticeAcceptance" FOR EACH STATEMENT EXECUTE FUNCTION eta_append_only();

-- A noticeVersion/hash pair is only ever written as a real SHA-256 hex string for a positive version.
ALTER TABLE "FranchisePrivacyNoticeAcceptance" ADD CONSTRAINT "FranchisePrivacyNoticeAcceptance_evidence_check" CHECK ("noticeVersion" > 0 AND "noticeSha256" ~ '^[0-9a-f]{64}$' AND "method" = 'EXPLICIT_CHECKBOX');
