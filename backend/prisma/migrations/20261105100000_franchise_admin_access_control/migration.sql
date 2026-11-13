-- Franchise admin-controlled access: two-admin student reassignment, guarded student links, and an
-- append-only franchise audit trail. Additive: one enum value, one nullable column with its index and
-- foreign key, CHECK constraints and triggers. No existing row is changed.

-- AlterEnum
ALTER TYPE "AdminApprovalAction" ADD VALUE 'STUDENT_REASSIGN';

-- AlterTable
ALTER TABLE "FranchiseStudent" ADD COLUMN     "approvalRequestId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "FranchiseStudent_approvalRequestId_key" ON "FranchiseStudent"("approvalRequestId");

-- AddForeignKey
ALTER TABLE "FranchiseStudent" ADD CONSTRAINT "FranchiseStudent_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "AdminApprovalRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Student links (FranchiseStudent) ----------
-- An admin reassignment link always carries the two-admin request that authorised it.
ALTER TABLE "FranchiseStudent" ADD CONSTRAINT "FranchiseStudent_reassignment_approved" CHECK (
  ("source" = 'ADMIN_REASSIGNMENT') = ("approvalRequestId" IS NOT NULL)
);
ALTER TABLE "FranchiseStudent" ADD CONSTRAINT "FranchiseStudent_status_facts" CHECK (
  ("status" = 'ACTIVE' AND "endsAt" IS NULL) OR ("status" = 'ENDED' AND "endsAt" IS NOT NULL)
);

-- * INSERT with ADMIN_REASSIGNMENT: the request must be an APPROVED STUDENT_REASSIGN for exactly this
--   student and target franchise, decided by an admin other than the one who asked (the request table's
--   own guard already requires two different, current admins).
-- * UPDATE: who, which franchise, the source, the request and the start never change; the only move is
--   ACTIVE → ENDED, and ENDED is final.
-- * DELETE only in logged maintenance.
CREATE FUNCTION eta_franchise_student_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "AdminApprovalRequest"%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF eta_maintenance_allowed('FranchiseStudent', 'DELETE', OLD."id") THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'student links are never deleted' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'INSERT' THEN
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
  IF OLD."status"::text = 'ENDED' AND (NEW."status"::text <> 'ENDED' OR NEW."endsAt" IS DISTINCT FROM OLD."endsAt" OR NEW."endReason" IS DISTINCT FROM OLD."endReason") THEN
    RAISE EXCEPTION 'an ended student link is final' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "FranchiseStudent_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FranchiseStudent" FOR EACH ROW EXECUTE FUNCTION eta_franchise_student_guard();
CREATE TRIGGER "FranchiseStudent_no_truncate" BEFORE TRUNCATE ON "FranchiseStudent" FOR EACH STATEMENT EXECUTE FUNCTION eta_append_only();

-- ---------- Franchise audit trail (AuditLog) ----------
-- Franchise and franchise-policy entries (actions FRANCHISE_* and POLICY_*) are append-only: no UPDATE
-- or DELETE outside logged maintenance. Other audit entries keep their existing behaviour.
CREATE FUNCTION eta_franchise_audit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."action" LIKE 'FRANCHISE\_%' OR OLD."action" LIKE 'POLICY\_%'
     OR (TG_OP = 'UPDATE' AND (NEW."action" LIKE 'FRANCHISE\_%' OR NEW."action" LIKE 'POLICY\_%')) THEN
    IF NOT eta_maintenance_allowed('AuditLog', TG_OP, OLD."id") THEN
      RAISE EXCEPTION 'franchise audit entries are append-only (% refused)', TG_OP USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "AuditLog_franchise_append_only" BEFORE UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION eta_franchise_audit_guard();
