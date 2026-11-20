-- Franchise "request more info / documents": an admin asks the applicant for documents and/or information;
-- the applicant replies once with files and/or text. Additive only: the table existed unused (0 rows).

-- AlterTable
ALTER TABLE "FranchiseDocumentRequest" ADD COLUMN     "responseText" TEXT,
ADD COLUMN     "cancelledById" TEXT,
ADD COLUMN     "cancelReason" TEXT;

-- At most one open request per application.
CREATE UNIQUE INDEX "FranchiseDocumentRequest_one_open_per_application" ON "FranchiseDocumentRequest"("applicationId") WHERE "status" = 'OPEN';

-- The message is 10-500 characters, a reply at most 1000; each status has exactly its own timestamp.
ALTER TABLE "FranchiseDocumentRequest" ADD CONSTRAINT "FranchiseDocumentRequest_facts" CHECK (
  length(btrim("message")) BETWEEN 10 AND 500
  AND ("responseText" IS NULL OR length("responseText") <= 1000)
  AND (
    ("status" = 'OPEN' AND "fulfilledAt" IS NULL AND "cancelledAt" IS NULL AND "responseText" IS NULL)
    OR ("status" = 'FULFILLED' AND "fulfilledAt" IS NOT NULL AND "cancelledAt" IS NULL)
    OR ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "fulfilledAt" IS NULL AND "responseText" IS NULL)
  )
);

-- Requests are a record: what was asked never changes, an open request is answered or cancelled once (final),
-- and rows are deleted only in logged maintenance.
CREATE FUNCTION eta_franchise_document_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF eta_maintenance_allowed('FranchiseDocumentRequest', 'DELETE', OLD."id") THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'document requests are never deleted' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'OPEN' THEN RAISE EXCEPTION 'document requests start open' USING ERRCODE = 'P0001'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW."applicationId", NEW."message", NEW."kinds", NEW."requestedById", NEW."createdAt")
     IS DISTINCT FROM (OLD."applicationId", OLD."message", OLD."kinds", OLD."requestedById", OLD."createdAt") THEN
    RAISE EXCEPTION 'what a document request asked never changes' USING ERRCODE = 'P0001';
  END IF;
  IF OLD."status" <> 'OPEN' THEN RAISE EXCEPTION 'an answered or cancelled document request is final' USING ERRCODE = 'P0001'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "FranchiseDocumentRequest_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FranchiseDocumentRequest" FOR EACH ROW EXECUTE FUNCTION eta_franchise_document_request_guard();
CREATE TRIGGER "FranchiseDocumentRequest_no_truncate" BEFORE TRUNCATE ON "FranchiseDocumentRequest" FOR EACH STATEMENT EXECUTE FUNCTION eta_append_only();
