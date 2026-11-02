-- =====================================================================================
-- Phase 3: two-admin policy governance and maintenance controls, enforced in the database.
-- Additive: one new append-only table, functions and triggers; no existing table, column or row
-- changes. The application checks the same rules first and returns friendly errors; these
-- triggers are the backstop if any code path ever skips them.
-- =====================================================================================

-- ---------- Financial maintenance: restricted, reasoned and logged ----------
-- Append-only tables can be cleaned up only by an explicitly authorised maintenance session:
--   SET LOCAL eta.financial_maintenance = 'on';
--   SET LOCAL eta.maintenance_reason = '<why, at least 10 characters>';
-- AND the effective database role (current_user) must be a superuser or a member of the
-- eta_financial_maintenance role (which does not exist until separately created and approved).
-- Every allowed operation is written to FinancialMaintenanceLog, which can never be modified.

CREATE TABLE "FinancialMaintenanceLog" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tableName" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "rowId" TEXT,
    "reason" TEXT NOT NULL,
    "dbRole" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,

    CONSTRAINT "FinancialMaintenanceLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FinancialMaintenanceLog_occurredAt_idx" ON "FinancialMaintenanceLog"("occurredAt");

CREATE FUNCTION eta_never_modify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is never allowed', TG_TABLE_NAME, TG_OP USING ERRCODE = 'P0001';
END $$;

CREATE TRIGGER "FinancialMaintenanceLog_append_only" BEFORE UPDATE OR DELETE ON "FinancialMaintenanceLog" FOR EACH ROW EXECUTE FUNCTION eta_never_modify();
CREATE TRIGGER "FinancialMaintenanceLog_no_truncate" BEFORE TRUNCATE ON "FinancialMaintenanceLog" FOR EACH STATEMENT EXECUTE FUNCTION eta_never_modify();

-- Returns false when no maintenance was requested; raises when it was requested without a reason
-- or by a role that isn't authorised; otherwise logs the operation and returns true.
CREATE FUNCTION eta_maintenance_allowed(p_table text, p_operation text, p_row_id text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE reason text := trim(coalesce(current_setting('eta.maintenance_reason', true), ''));
BEGIN
  IF coalesce(current_setting('eta.financial_maintenance', true), '') <> 'on' THEN
    RETURN false;
  END IF;
  IF length(reason) < 10 THEN
    RAISE EXCEPTION 'financial maintenance needs eta.maintenance_reason (at least 10 characters)' USING ERRCODE = 'P0001';
  END IF;
  IF NOT (
       EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolsuper)
    OR (EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eta_financial_maintenance')
        AND pg_has_role(current_user, 'eta_financial_maintenance', 'MEMBER'))) THEN
    RAISE EXCEPTION 'financial maintenance is restricted to the eta_financial_maintenance role (current role: %)', current_user USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO "FinancialMaintenanceLog" ("occurredAt", "tableName", "operation", "rowId", "reason", "dbRole", "transactionId")
  VALUES ((now() AT TIME ZONE 'UTC'), p_table, p_operation, p_row_id, reason, current_user, txid_current()::text);
  RETURN true;
END $$;

-- The 2R append-only guard now uses the restricted, logged maintenance check.
CREATE OR REPLACE FUNCTION eta_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_id text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'append-only table %: UPDATE is not allowed', TG_TABLE_NAME USING ERRCODE = 'P0001';
  END IF;
  IF TG_LEVEL = 'ROW' THEN
    row_id := OLD."id";
  END IF;
  IF NOT eta_maintenance_allowed(TG_TABLE_NAME, TG_OP, row_id) THEN
    RAISE EXCEPTION 'append-only table %: % is not allowed', TG_TABLE_NAME, TG_OP USING ERRCODE = 'P0001';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NULL END;
END $$;

-- ---------- Approval requests ----------
-- * created PENDING, by a user who is ADMIN right now;
-- * what was requested (action, target, payload + hash, reason, requester, expiry) never changes;
-- * only legal transitions: PENDING → APPROVED | REJECTED | CANCELLED | EXPIRED,
--   APPROVED → EXECUTED | CANCELLED | EXPIRED; final states are final;
-- * approving needs an unexpired request, a decider different from the requester, and BOTH users
--   holding the ADMIN role at that moment (their User rows are locked FOR SHARE);
-- * a request can be marked EXPIRED only once its expiry time has actually passed;
-- * rows are never deleted (except in a logged maintenance session).
CREATE FUNCTION eta_approval_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE requester_role text; decider_role text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT eta_maintenance_allowed(TG_TABLE_NAME, TG_OP, OLD."id") THEN
      RAISE EXCEPTION 'approval request % cannot be deleted', OLD."id" USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'PENDING' OR NEW."decidedById" IS NOT NULL OR NEW."executedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'approval requests start PENDING and undecided' USING ERRCODE = 'P0001';
    END IF;
    SELECT "role"::text INTO requester_role FROM "User" WHERE "id" = NEW."requestedById" FOR SHARE;
    IF requester_role IS DISTINCT FROM 'ADMIN' THEN
      RAISE EXCEPTION 'only an ADMIN can request a two-admin action' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF (NEW."action", NEW."targetType", NEW."targetId", NEW."payload", NEW."payloadSha256", NEW."reason", NEW."requestedById", NEW."expiresAt", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."action", OLD."targetType", OLD."targetId", OLD."payload", OLD."payloadSha256", OLD."reason", OLD."requestedById", OLD."expiresAt", OLD."createdAt") THEN
    RAISE EXCEPTION 'approval request % content is immutable', OLD."id" USING ERRCODE = 'P0001';
  END IF;
  IF OLD."status" IN ('REJECTED', 'CANCELLED', 'EXPIRED', 'EXECUTED') THEN
    RAISE EXCEPTION 'approval request % is % (final)', OLD."id", OLD."status" USING ERRCODE = 'P0001';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
       (OLD."status" = 'PENDING' AND NEW."status" IN ('APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED'))
    OR (OLD."status" = 'APPROVED' AND NEW."status" IN ('EXECUTED', 'CANCELLED', 'EXPIRED'))) THEN
    RAISE EXCEPTION 'approval request %: % → % is not allowed', OLD."id", OLD."status", NEW."status" USING ERRCODE = 'P0001';
  END IF;
  IF OLD."status" = 'APPROVED' AND NEW."decidedById" IS DISTINCT FROM OLD."decidedById" THEN
    RAISE EXCEPTION 'approval request % decider cannot change', OLD."id" USING ERRCODE = 'P0001';
  END IF;
  -- Prisma stores timestamp(3) in UTC without a zone: compare against UTC, whatever the session TimeZone.
  IF OLD."status" = 'PENDING' AND NEW."status" = 'APPROVED' THEN
    IF NEW."decidedById" IS NULL OR NEW."decidedById" = NEW."requestedById" THEN
      RAISE EXCEPTION 'approval request % must be approved by a different admin', OLD."id" USING ERRCODE = 'P0001';
    END IF;
    IF NEW."expiresAt" <= (now() AT TIME ZONE 'UTC') THEN
      RAISE EXCEPTION 'approval request % has expired', OLD."id" USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF NEW."status" = 'EXPIRED' AND OLD."status" <> 'EXPIRED' AND NEW."expiresAt" > (now() AT TIME ZONE 'UTC') THEN
    RAISE EXCEPTION 'approval request % has not expired yet', OLD."id" USING ERRCODE = 'P0001';
  END IF;
  IF NEW."status" IN ('APPROVED', 'EXECUTED') AND NEW."status" IS DISTINCT FROM OLD."status" THEN
    SELECT "role"::text INTO requester_role FROM "User" WHERE "id" = NEW."requestedById" FOR SHARE;
    SELECT "role"::text INTO decider_role FROM "User" WHERE "id" = NEW."decidedById" FOR SHARE;
    IF requester_role IS DISTINCT FROM 'ADMIN' OR decider_role IS DISTINCT FROM 'ADMIN' THEN
      RAISE EXCEPTION 'approval request %: requester and approver must both be ADMIN now', OLD."id" USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "AdminApprovalRequest_guard" BEFORE INSERT OR UPDATE OR DELETE ON "AdminApprovalRequest" FOR EACH ROW EXECUTE FUNCTION eta_approval_request_guard();

-- ---------- Policy publication ----------
-- * policies are created as DRAFT by an ADMIN;
-- * DRAFT → PENDING_APPROVAL needs a PENDING POLICY_PUBLISH request for this policy, requested by its
--   creator, pinned to the policy's exact payload hash;
-- * PENDING_APPROVAL → PUBLISHED needs that request APPROVED/EXECUTED, decided by approvedById (≠
--   creator), with the SAME payload hash, both users ADMIN now, and an effective date that is not
--   before publication and not before any earlier version of the domain (no retroactive policy);
-- * PENDING_APPROVAL → REJECTED needs the request REJECTED/CANCELLED/EXPIRED.
CREATE FUNCTION eta_policy_publication_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "AdminApprovalRequest"%ROWTYPE; creator_role text; approver_role text; latest_effective timestamp(3);
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT' OR NEW."approvedById" IS NOT NULL OR NEW."publishedAt" IS NOT NULL OR NEW."approvalRequestId" IS NOT NULL THEN
      RAISE EXCEPTION 'policy versions are created as unapproved DRAFTs' USING ERRCODE = 'P0001';
    END IF;
    SELECT "role"::text INTO creator_role FROM "User" WHERE "id" = NEW."createdById" FOR SHARE;
    IF creator_role IS DISTINCT FROM 'ADMIN' THEN
      RAISE EXCEPTION 'only an ADMIN can draft a policy' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
       (OLD."status" = 'DRAFT' AND NEW."status" = 'PENDING_APPROVAL')
    OR (OLD."status" = 'PENDING_APPROVAL' AND NEW."status" IN ('PUBLISHED', 'REJECTED'))
    OR (OLD."status" = 'PUBLISHED' AND NEW."status" = 'SUPERSEDED')) THEN
    RAISE EXCEPTION 'policy version %: % → % is not allowed', OLD."id", OLD."status", NEW."status" USING ERRCODE = 'P0001';
  END IF;
  IF OLD."status" = 'DRAFT' AND (NEW."approvedById" IS NOT NULL OR NEW."publishedAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'policy version % is not published yet', OLD."id" USING ERRCODE = 'P0001';
  END IF;

  IF OLD."status" = 'DRAFT' AND NEW."status" = 'PENDING_APPROVAL' THEN
    SELECT * INTO r FROM "AdminApprovalRequest" WHERE "id" = NEW."approvalRequestId";
    IF NOT FOUND OR r."action" <> 'POLICY_PUBLISH' OR r."targetType" <> 'PolicyVersion' OR r."targetId" <> NEW."id"
       OR r."status" <> 'PENDING' OR r."payloadSha256" <> NEW."payloadSha256" OR r."requestedById" <> NEW."createdById" OR NEW."submittedAt" IS NULL THEN
      RAISE EXCEPTION 'policy version % needs a matching pending publication request', NEW."id" USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF OLD."status" = 'PENDING_APPROVAL' AND NEW."approvalRequestId" IS DISTINCT FROM OLD."approvalRequestId" THEN
    RAISE EXCEPTION 'policy version % approval request cannot change', OLD."id" USING ERRCODE = 'P0001';
  END IF;

  IF OLD."status" = 'PENDING_APPROVAL' AND NEW."status" = 'PUBLISHED' THEN
    SELECT * INTO r FROM "AdminApprovalRequest" WHERE "id" = NEW."approvalRequestId" FOR SHARE;
    IF NOT FOUND OR r."action" <> 'POLICY_PUBLISH' OR r."targetId" <> NEW."id" OR r."status" NOT IN ('APPROVED', 'EXECUTED')
       OR r."payloadSha256" <> NEW."payloadSha256" OR r."decidedById" IS DISTINCT FROM NEW."approvedById" OR r."requestedById" <> NEW."createdById" THEN
      RAISE EXCEPTION 'policy version % can only be published by its approved request, for the exact payload hash reviewed', NEW."id" USING ERRCODE = 'P0001';
    END IF;
    SELECT "role"::text INTO creator_role FROM "User" WHERE "id" = NEW."createdById" FOR SHARE;
    SELECT "role"::text INTO approver_role FROM "User" WHERE "id" = NEW."approvedById" FOR SHARE;
    IF creator_role IS DISTINCT FROM 'ADMIN' OR approver_role IS DISTINCT FROM 'ADMIN' THEN
      RAISE EXCEPTION 'policy version %: creator and approver must both be ADMIN now', NEW."id" USING ERRCODE = 'P0001';
    END IF;
    IF NEW."effectiveFrom" IS NULL OR NEW."effectiveFrom" < NEW."publishedAt" THEN
      RAISE EXCEPTION 'policy version % cannot take effect before it is published', NEW."id" USING ERRCODE = 'P0001';
    END IF;
    SELECT max("effectiveFrom") INTO latest_effective FROM "PolicyVersion"
      WHERE "domain" = NEW."domain" AND "id" <> NEW."id" AND "status" IN ('PUBLISHED', 'SUPERSEDED');
    IF latest_effective IS NOT NULL AND NEW."effectiveFrom" < latest_effective THEN
      RAISE EXCEPTION 'policy version % would take effect before an earlier version of %', NEW."id", NEW."domain" USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF OLD."status" = 'PENDING_APPROVAL' AND NEW."status" = 'REJECTED' THEN
    SELECT * INTO r FROM "AdminApprovalRequest" WHERE "id" = NEW."approvalRequestId";
    IF NOT FOUND OR r."status" NOT IN ('REJECTED', 'CANCELLED', 'EXPIRED') THEN
      RAISE EXCEPTION 'policy version % can only be rejected through its request', NEW."id" USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "PolicyVersion_publication" BEFORE INSERT OR UPDATE ON "PolicyVersion" FOR EACH ROW EXECUTE FUNCTION eta_policy_publication_guard();

-- Submitted/published/superseded/rejected versions stay undeletable outside a logged maintenance session.
CREATE OR REPLACE FUNCTION eta_policy_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' AND NOT eta_maintenance_allowed(TG_TABLE_NAME, TG_OP, OLD."id") THEN
      RAISE EXCEPTION 'policy version % (%) cannot be deleted', OLD."id", OLD."status" USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" <> 'DRAFT' AND (NEW."payload" IS DISTINCT FROM OLD."payload" OR NEW."payloadSha256" IS DISTINCT FROM OLD."payloadSha256"
      OR NEW."domain" IS DISTINCT FROM OLD."domain" OR NEW."version" IS DISTINCT FROM OLD."version" OR NEW."createdById" IS DISTINCT FROM OLD."createdById"
      OR NEW."effectiveFrom" IS DISTINCT FROM OLD."effectiveFrom" AND OLD."status" <> 'PENDING_APPROVAL') THEN
    RAISE EXCEPTION 'policy version % is % — its content is frozen', OLD."id", OLD."status" USING ERRCODE = 'P0001';
  END IF;
  IF OLD."status" IN ('PUBLISHED', 'SUPERSEDED', 'REJECTED') THEN
    IF NOT (OLD."status" = 'PUBLISHED' AND NEW."status" = 'SUPERSEDED'
            AND NEW."approvedById" IS NOT DISTINCT FROM OLD."approvedById"
            AND NEW."approvalRequestId" IS NOT DISTINCT FROM OLD."approvalRequestId"
            AND NEW."publishedAt" IS NOT DISTINCT FROM OLD."publishedAt"
            AND NEW."effectiveFrom" IS NOT DISTINCT FROM OLD."effectiveFrom") THEN
      RAISE EXCEPTION 'policy version % is % — only PUBLISHED → SUPERSEDED is allowed', OLD."id", OLD."status" USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- ---------- Historical policy references never move ----------
-- Records that captured "the policy in force" keep pointing at that exact version. (Fee payments,
-- agreements, ledger journals, TDS deductions and GST invoices are already protected in 2R.)
CREATE FUNCTION eta_policy_reference_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."policyVersionId" IS NOT NULL AND NEW."policyVersionId" IS DISTINCT FROM OLD."policyVersionId" THEN
    RAISE EXCEPTION '% %: its policy version reference cannot change', TG_TABLE_NAME, OLD."id" USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "SettlementSchedule_policy_reference" BEFORE UPDATE ON "SettlementSchedule" FOR EACH ROW EXECUTE FUNCTION eta_policy_reference_guard();
CREATE TRIGGER "SettlementBatch_policy_reference" BEFORE UPDATE ON "SettlementBatch" FOR EACH ROW EXECUTE FUNCTION eta_policy_reference_guard();
CREATE TRIGGER "FranchiseOrderAttribution_policy_reference" BEFORE UPDATE ON "FranchiseOrderAttribution" FOR EACH ROW EXECUTE FUNCTION eta_policy_reference_guard();
