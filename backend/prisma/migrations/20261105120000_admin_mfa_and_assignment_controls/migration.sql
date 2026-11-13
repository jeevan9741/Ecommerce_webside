-- Admin two-factor authentication (TOTP), two-admin ending of student assignments, invitation provenance
-- for student links, and a wider append-only audit trail. Additive: two enum values, one nullable column,
-- two new tables, indexes, CHECKs and triggers. No existing row is changed.

-- AlterEnum
ALTER TYPE "AdminApprovalAction" ADD VALUE 'STUDENT_ASSIGNMENT_END';
ALTER TYPE "AdminApprovalAction" ADD VALUE 'ADMIN_MFA_RESET';

-- AlterTable
ALTER TABLE "FranchiseStudent" ADD COLUMN     "endApprovalRequestId" TEXT;

-- CreateTable
CREATE TABLE "AdminMfaFactor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "secretEncrypted" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enabledAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "disabledReason" TEXT,
    "lastUsedStep" INTEGER,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),

    CONSTRAINT "AdminMfaFactor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminMfaRecoveryCode" (
    "id" TEXT NOT NULL,
    "factorId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "AdminMfaRecoveryCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminMfaFactor_userId_idx" ON "AdminMfaFactor"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminMfaRecoveryCode_codeHash_key" ON "AdminMfaRecoveryCode"("codeHash");

-- CreateIndex
CREATE INDEX "AdminMfaRecoveryCode_factorId_idx" ON "AdminMfaRecoveryCode"("factorId");

-- CreateIndex
CREATE UNIQUE INDEX "FranchiseStudent_endApprovalRequestId_key" ON "FranchiseStudent"("endApprovalRequestId");

-- AddForeignKey
ALTER TABLE "FranchiseStudent" ADD CONSTRAINT "FranchiseStudent_endApprovalRequestId_fkey" FOREIGN KEY ("endApprovalRequestId") REFERENCES "AdminApprovalRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminMfaFactor" ADD CONSTRAINT "AdminMfaFactor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminMfaRecoveryCode" ADD CONSTRAINT "AdminMfaRecoveryCode_factorId_fkey" FOREIGN KEY ("factorId") REFERENCES "AdminMfaFactor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Admin MFA ----------
-- One not-disabled factor (pending or enabled) per admin.
CREATE UNIQUE INDEX "AdminMfaFactor_one_live_per_user" ON "AdminMfaFactor"("userId") WHERE "disabledAt" IS NULL;
ALTER TABLE "AdminMfaFactor" ADD CONSTRAINT "AdminMfaFactor_facts" CHECK (
  "failedAttempts" >= 0 AND ("lastUsedStep" IS NULL OR "lastUsedStep" > 0)
  AND ("disabledAt" IS NULL OR length(btrim(coalesce("disabledReason", ''))) > 0)
);
ALTER TABLE "AdminMfaRecoveryCode" ADD CONSTRAINT "AdminMfaRecoveryCode_hash" CHECK ("codeHash" ~ '^[0-9a-f]{64}$');

-- Factors: the owner, secret and creation never change; enabling and retiring happen once each, a retired
-- factor is final, accepted time steps only move forward; rows are deleted only in logged maintenance.
CREATE FUNCTION eta_admin_mfa_factor_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF eta_maintenance_allowed('AdminMfaFactor', 'DELETE', OLD."id") THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'MFA factors are never deleted' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."enabledAt" IS NOT NULL OR NEW."disabledAt" IS NOT NULL OR NEW."lastUsedStep" IS NOT NULL THEN
      RAISE EXCEPTION 'MFA factors start pending' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW."userId", NEW."secretEncrypted", NEW."createdAt") IS DISTINCT FROM (OLD."userId", OLD."secretEncrypted", OLD."createdAt") THEN
    RAISE EXCEPTION 'an MFA factor''s owner and secret never change' USING ERRCODE = 'P0001';
  END IF;
  IF OLD."disabledAt" IS NOT NULL THEN
    RAISE EXCEPTION 'a retired MFA factor is final' USING ERRCODE = 'P0001';
  END IF;
  IF OLD."enabledAt" IS NOT NULL AND NEW."enabledAt" IS DISTINCT FROM OLD."enabledAt" THEN
    RAISE EXCEPTION 'an MFA factor is enabled once' USING ERRCODE = 'P0001';
  END IF;
  IF OLD."lastUsedStep" IS NOT NULL AND (NEW."lastUsedStep" IS NULL OR NEW."lastUsedStep" < OLD."lastUsedStep") THEN
    RAISE EXCEPTION 'MFA time steps only move forward' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "AdminMfaFactor_guard" BEFORE INSERT OR UPDATE OR DELETE ON "AdminMfaFactor" FOR EACH ROW EXECUTE FUNCTION eta_admin_mfa_factor_guard();
CREATE TRIGGER "AdminMfaFactor_no_truncate" BEFORE TRUNCATE ON "AdminMfaFactor" FOR EACH STATEMENT EXECUTE FUNCTION eta_append_only();

-- Recovery codes: the hash and factor never change; used or revoked is set once and is final.
CREATE FUNCTION eta_admin_mfa_recovery_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF eta_maintenance_allowed('AdminMfaRecoveryCode', 'DELETE', OLD."id") THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'recovery codes are never deleted' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."usedAt" IS NOT NULL OR NEW."revokedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'recovery codes start unused' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW."factorId", NEW."codeHash", NEW."createdAt") IS DISTINCT FROM (OLD."factorId", OLD."codeHash", OLD."createdAt") THEN
    RAISE EXCEPTION 'a recovery code never changes' USING ERRCODE = 'P0001';
  END IF;
  IF OLD."usedAt" IS NOT NULL OR OLD."revokedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'a used or revoked recovery code is final' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "AdminMfaRecoveryCode_guard" BEFORE INSERT OR UPDATE OR DELETE ON "AdminMfaRecoveryCode" FOR EACH ROW EXECUTE FUNCTION eta_admin_mfa_recovery_guard();
CREATE TRIGGER "AdminMfaRecoveryCode_no_truncate" BEFORE TRUNCATE ON "AdminMfaRecoveryCode" FOR EACH STATEMENT EXECUTE FUNCTION eta_append_only();

-- ---------- Student links: provenance and two-admin ending ----------
ALTER TABLE "FranchiseStudent" ADD CONSTRAINT "FranchiseStudent_end_approval_only_when_ended" CHECK ("endApprovalRequestId" IS NULL OR "status" = 'ENDED');

-- Replaces the guard from 20261105100000 (same rules, plus):
-- * INSERT: only ACTIVE links from an accepted invitation (INVITE_ACCEPTED) or a two-admin reassignment
--   (ADMIN_REASSIGNMENT); anything else only in logged maintenance.
-- * UPDATE ACTIVE → ENDED: needs endApprovalRequestId = an APPROVED STUDENT_REASSIGN or
--   STUDENT_ASSIGNMENT_END request for exactly this link, decided by a different admin (or logged maintenance).
CREATE OR REPLACE FUNCTION eta_franchise_student_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "AdminApprovalRequest"%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF eta_maintenance_allowed('FranchiseStudent', 'DELETE', OLD."id") THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'student links are never deleted' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF (NEW."source" NOT IN ('INVITE_ACCEPTED', 'ADMIN_REASSIGNMENT') OR NEW."status"::text <> 'ACTIVE' OR NEW."endApprovalRequestId" IS NOT NULL)
       AND NOT eta_maintenance_allowed('FranchiseStudent', 'INSERT', NEW."id") THEN
      RAISE EXCEPTION 'student links start ACTIVE, from an accepted invitation or a two-admin reassignment' USING ERRCODE = 'P0001';
    END IF;
    IF NEW."approvalRequestId" IS NOT NULL THEN
      SELECT * INTO r FROM "AdminApprovalRequest" WHERE "id" = NEW."approvalRequestId" FOR SHARE;
      IF NOT FOUND OR r."action"::text <> 'STUDENT_REASSIGN' OR r."status"::text <> 'APPROVED'
         OR r."decidedById" IS NULL OR r."decidedById" = r."requestedById"
         OR r."payload"->>'toPartnerId' IS DISTINCT FROM NEW."partnerId"
         OR r."payload"->>'studentUserId' IS DISTINCT FROM NEW."studentUserId" THEN
        RAISE EXCEPTION 'a reassigned student link needs an approved two-admin STUDENT_REASSIGN request for this student and franchise' USING ERRCODE = 'P0001';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."partnerId" IS DISTINCT FROM OLD."partnerId" OR NEW."studentUserId" IS DISTINCT FROM OLD."studentUserId"
     OR NEW."source" IS DISTINCT FROM OLD."source" OR NEW."approvalRequestId" IS DISTINCT FROM OLD."approvalRequestId"
     OR NEW."startsAt" IS DISTINCT FROM OLD."startsAt" OR NEW."createdById" IS DISTINCT FROM OLD."createdById" THEN
    RAISE EXCEPTION 'a student link''s student, franchise, source and approval never change' USING ERRCODE = 'P0001';
  END IF;
  IF OLD."status"::text = 'ENDED' AND (NEW."status"::text <> 'ENDED' OR NEW."endsAt" IS DISTINCT FROM OLD."endsAt"
     OR NEW."endReason" IS DISTINCT FROM OLD."endReason" OR NEW."endApprovalRequestId" IS DISTINCT FROM OLD."endApprovalRequestId") THEN
    RAISE EXCEPTION 'an ended student link is final' USING ERRCODE = 'P0001';
  END IF;
  IF OLD."status"::text = 'ACTIVE' AND NEW."status"::text = 'ENDED' THEN
    IF NEW."endApprovalRequestId" IS NOT NULL THEN
      SELECT * INTO r FROM "AdminApprovalRequest" WHERE "id" = NEW."endApprovalRequestId" FOR SHARE;
    END IF;
    IF (NEW."endApprovalRequestId" IS NULL OR NOT FOUND OR r."action"::text NOT IN ('STUDENT_REASSIGN', 'STUDENT_ASSIGNMENT_END')
        OR r."status"::text <> 'APPROVED' OR r."decidedById" IS NULL OR r."decidedById" = r."requestedById"
        OR r."payload"->>'linkId' IS DISTINCT FROM OLD."id")
       AND NOT eta_maintenance_allowed('FranchiseStudent', 'END', OLD."id") THEN
      RAISE EXCEPTION 'ending a student link needs an approved two-admin request for this link' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Checked when the transaction commits, so the invitation (updated after the link is created, in the same
-- transaction) is visible: an INVITE_ACCEPTED link must be the one an ACCEPTED, unexpired invitation from
-- the same franchise points to, accepted by that student, whose account email is the invited address.
CREATE FUNCTION eta_franchise_student_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ok boolean;
BEGIN
  IF NEW."source" <> 'INVITE_ACCEPTED' THEN RETURN NULL; END IF;
  SELECT EXISTS (
    SELECT 1 FROM "FranchiseStudentInvite" i JOIN "User" u ON u."id" = NEW."studentUserId"
    WHERE i."studentLinkId" = NEW."id" AND i."status" = 'ACCEPTED' AND i."partnerId" = NEW."partnerId"
      AND i."acceptedUserId" = NEW."studentUserId" AND i."acceptedAt" IS NOT NULL AND i."acceptedAt" < i."expiresAt"
      AND i."email" = lower(btrim(u."email"))
  ) INTO ok;
  IF NOT ok AND NOT eta_maintenance_allowed('FranchiseStudent', 'INSERT_WITHOUT_INVITE', NEW."id") THEN
    RAISE EXCEPTION 'student link % has no accepted invitation behind it', NEW."id" USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "FranchiseStudent_invite_provenance" AFTER INSERT ON "FranchiseStudent"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION eta_franchise_student_provenance();

-- ---------- Append-only audit ----------
-- Adds admin MFA entries (ADMIN_MFA_*) to the append-only franchise and policy entries.
CREATE OR REPLACE FUNCTION eta_franchise_audit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."action" LIKE 'FRANCHISE\_%' OR OLD."action" LIKE 'POLICY\_%' OR OLD."action" LIKE 'ADMIN\_MFA\_%'
     OR (TG_OP = 'UPDATE' AND (NEW."action" LIKE 'FRANCHISE\_%' OR NEW."action" LIKE 'POLICY\_%' OR NEW."action" LIKE 'ADMIN\_MFA\_%')) THEN
    IF NOT eta_maintenance_allowed('AuditLog', TG_OP, OLD."id") THEN
      RAISE EXCEPTION 'franchise audit entries are append-only (% refused)', TG_OP USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;
