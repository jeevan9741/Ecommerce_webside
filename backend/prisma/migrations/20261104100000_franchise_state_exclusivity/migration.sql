-- Franchise: state-level exclusivity (one PRIMARY franchise per Indian state), applicant withdrawal,
-- a two-admin STATE_RELEASE action, and an optional refund acknowledgement. Additive: two new tables,
-- two enum values, guard triggers and constraints; three refund columns become optional. Historical
-- district allocations, applications and audit records are kept unchanged.

-- AlterEnum
ALTER TYPE "AdminApprovalAction" ADD VALUE 'STATE_RELEASE';

-- AlterEnum
ALTER TYPE "FranchiseApplicationStatus" ADD VALUE 'WITHDRAWN';

-- AlterTable
ALTER TABLE "FranchiseApplication" ALTER COLUMN "refundPolicyVersion" DROP NOT NULL,
ALTER COLUMN "refundPolicyText" DROP NOT NULL,
ALTER COLUMN "refundPolicySha256" DROP NOT NULL;

-- CreateTable
CREATE TABLE "StateAllocation" (
    "id" TEXT NOT NULL,
    "stateId" TEXT NOT NULL,
    "role" "DistrictAllocationRole" NOT NULL DEFAULT 'PRIMARY',
    "status" "DistrictAllocationStatus" NOT NULL,
    "applicationId" TEXT,
    "partnerId" TEXT,
    "reservedAt" TIMESTAMP(3),
    "reservedUntil" TIMESTAMP(3),
    "allocatedAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "releaseReason" TEXT,
    "createdById" TEXT NOT NULL,
    "approvalRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StateAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StateAllocationEvent" (
    "id" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "stateId" TEXT NOT NULL,
    "fromStatus" "DistrictAllocationStatus",
    "toStatus" "DistrictAllocationStatus" NOT NULL,
    "actorId" TEXT,
    "approvalRequestId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StateAllocationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StateAllocation_stateId_status_idx" ON "StateAllocation"("stateId", "status");

-- CreateIndex
CREATE INDEX "StateAllocation_partnerId_idx" ON "StateAllocation"("partnerId");

-- CreateIndex
CREATE INDEX "StateAllocation_applicationId_idx" ON "StateAllocation"("applicationId");

-- CreateIndex
CREATE INDEX "StateAllocationEvent_stateId_createdAt_idx" ON "StateAllocationEvent"("stateId", "createdAt");

-- CreateIndex
CREATE INDEX "StateAllocationEvent_allocationId_createdAt_idx" ON "StateAllocationEvent"("allocationId", "createdAt");

-- AddForeignKey
ALTER TABLE "StateAllocation" ADD CONSTRAINT "StateAllocation_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "IndiaState"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StateAllocation" ADD CONSTRAINT "StateAllocation_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "FranchiseApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StateAllocation" ADD CONSTRAINT "StateAllocation_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "FranchisePartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StateAllocationEvent" ADD CONSTRAINT "StateAllocationEvent_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "StateAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StateAllocationEvent" ADD CONSTRAINT "StateAllocationEvent_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "IndiaState"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- State exclusivity: database guarantees ----------

-- One PRIMARY franchise per state: at most one row holds a state (reserved, allocated or suspended).
CREATE UNIQUE INDEX "StateAllocation_one_primary_per_state" ON "StateAllocation"("stateId") WHERE "role" = 'PRIMARY' AND "status" IN ('RESERVED', 'ALLOCATED', 'SUSPENDED');
-- A partner holds at most one state, and an application at most one reservation or allocation.
CREATE UNIQUE INDEX "StateAllocation_one_state_per_partner" ON "StateAllocation"("partnerId") WHERE "partnerId" IS NOT NULL AND "status" IN ('ALLOCATED', 'SUSPENDED');
CREATE UNIQUE INDEX "StateAllocation_one_hold_per_application" ON "StateAllocation"("applicationId") WHERE "applicationId" IS NOT NULL AND "status" IN ('RESERVED', 'ALLOCATED', 'SUSPENDED');

-- Each status carries the facts that justify it.
ALTER TABLE "StateAllocation" ADD CONSTRAINT "StateAllocation_status_facts" CHECK (
  ("status" <> 'RESERVED' OR ("applicationId" IS NOT NULL AND "reservedAt" IS NOT NULL)) AND
  ("status" <> 'ALLOCATED' OR ("partnerId" IS NOT NULL AND "allocatedAt" IS NOT NULL)) AND
  ("status" <> 'SUSPENDED' OR ("partnerId" IS NOT NULL AND "suspendedAt" IS NOT NULL)) AND
  ("status" <> 'RELEASED' OR ("releasedAt" IS NOT NULL AND length(btrim(coalesce("releaseReason", ''))) > 0))
);

-- Rows are never deleted (outside logged maintenance); the state, role and application never change; a
-- partner is set once; only legal moves are allowed, and RELEASED is final.
CREATE FUNCTION eta_state_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT eta_maintenance_allowed(TG_TABLE_NAME, TG_OP, OLD."id") THEN
      RAISE EXCEPTION 'state allocations are never deleted' USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW."stateId" <> OLD."stateId" OR NEW."role" <> OLD."role" OR NEW."applicationId" IS DISTINCT FROM OLD."applicationId"
     OR (OLD."partnerId" IS NOT NULL AND NEW."partnerId" IS DISTINCT FROM OLD."partnerId") THEN
    RAISE EXCEPTION 'a state allocation''s state, application and partner can''t change' USING ERRCODE = 'P0001';
  END IF;
  IF NEW."status" <> OLD."status" AND NOT (
       (OLD."status" = 'RESERVED' AND NEW."status" IN ('ALLOCATED', 'RELEASED'))
    OR (OLD."status" = 'ALLOCATED' AND NEW."status" IN ('SUSPENDED', 'RELEASED'))
    OR (OLD."status" = 'SUSPENDED' AND NEW."status" IN ('ALLOCATED', 'RELEASED'))
  ) THEN
    RAISE EXCEPTION 'state allocation % → % is not allowed', OLD."status", NEW."status" USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "StateAllocation_guard" BEFORE UPDATE OR DELETE ON "StateAllocation" FOR EACH ROW EXECUTE FUNCTION eta_state_allocation_guard();
CREATE TRIGGER "StateAllocation_no_truncate" BEFORE TRUNCATE ON "StateAllocation" FOR EACH STATEMENT EXECUTE FUNCTION eta_append_only();

-- The history of every change is append-only.
CREATE TRIGGER "StateAllocationEvent_append_only" BEFORE UPDATE OR DELETE ON "StateAllocationEvent" FOR EACH ROW EXECUTE FUNCTION eta_append_only();
CREATE TRIGGER "StateAllocationEvent_no_truncate" BEFORE TRUNCATE ON "StateAllocationEvent" FOR EACH STATEMENT EXECUTE FUNCTION eta_append_only();

-- ---------- Refund acknowledgement is optional (no customer-facing refund policy) ----------
-- Either nothing is recorded, or a complete, valid acknowledgement (as every older application has).
ALTER TABLE "FranchiseApplication" DROP CONSTRAINT "FranchiseApplication_refund_policy";
ALTER TABLE "FranchiseApplication" ADD CONSTRAINT "FranchiseApplication_refund_policy" CHECK (
  ("refundPolicyVersion" IS NULL AND "refundPolicyText" IS NULL AND "refundPolicySha256" IS NULL)
  OR ("refundPolicyVersion" > 0 AND length("refundPolicyText") > 0 AND length("refundPolicySha256") = 64)
);
