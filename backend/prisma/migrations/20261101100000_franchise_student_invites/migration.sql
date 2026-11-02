-- Phase 5F-2: franchise student invitations. Additive only: one new table, its constraints, an
-- index and a guard trigger. No existing table, column or row is changed.

-- CreateTable
CREATE TABLE "FranchiseStudentInvite" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "inviteeName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "mobile" TEXT,
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sendCount" INTEGER NOT NULL DEFAULT 1,
    "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedUserId" TEXT,
    "studentLinkId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FranchiseStudentInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FranchiseStudentInvite_tokenHash_key" ON "FranchiseStudentInvite"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "FranchiseStudentInvite_studentLinkId_key" ON "FranchiseStudentInvite"("studentLinkId");

-- CreateIndex
CREATE INDEX "FranchiseStudentInvite_partnerId_status_createdAt_idx" ON "FranchiseStudentInvite"("partnerId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "FranchiseStudentInvite_email_idx" ON "FranchiseStudentInvite"("email");

-- AddForeignKey
ALTER TABLE "FranchiseStudentInvite" ADD CONSTRAINT "FranchiseStudentInvite_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "FranchisePartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FranchiseStudentInvite" ADD CONSTRAINT "FranchiseStudentInvite_acceptedUserId_fkey" FOREIGN KEY ("acceptedUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FranchiseStudentInvite" ADD CONSTRAINT "FranchiseStudentInvite_studentLinkId_fkey" FOREIGN KEY ("studentLinkId") REFERENCES "FranchiseStudent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Rules the application relies on, enforced here as well.
ALTER TABLE "FranchiseStudentInvite" ADD CONSTRAINT "FranchiseStudentInvite_status" CHECK ("status" IN ('OPEN', 'ACCEPTED', 'REVOKED', 'EXPIRED'));
ALTER TABLE "FranchiseStudentInvite" ADD CONSTRAINT "FranchiseStudentInvite_email_normalized" CHECK ("email" = lower(btrim("email")) AND "email" LIKE '%_@_%.__%');
ALTER TABLE "FranchiseStudentInvite" ADD CONSTRAINT "FranchiseStudentInvite_token_hash" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "FranchiseStudentInvite" ADD CONSTRAINT "FranchiseStudentInvite_name" CHECK (length(btrim("inviteeName")) BETWEEN 2 AND 100);
ALTER TABLE "FranchiseStudentInvite" ADD CONSTRAINT "FranchiseStudentInvite_dates" CHECK ("expiresAt" > "createdAt" AND "lastSentAt" >= "createdAt");
ALTER TABLE "FranchiseStudentInvite" ADD CONSTRAINT "FranchiseStudentInvite_send_count" CHECK ("sendCount" BETWEEN 1 AND 5);
ALTER TABLE "FranchiseStudentInvite" ADD CONSTRAINT "FranchiseStudentInvite_accepted_recorded" CHECK (("status" = 'ACCEPTED') = ("acceptedAt" IS NOT NULL AND "acceptedUserId" IS NOT NULL AND "studentLinkId" IS NOT NULL));
ALTER TABLE "FranchiseStudentInvite" ADD CONSTRAINT "FranchiseStudentInvite_revoked_recorded" CHECK (("status" = 'REVOKED') = ("revokedAt" IS NOT NULL AND "revokedById" IS NOT NULL));

-- At most one open invitation per franchise and email (a resend reuses it).
CREATE UNIQUE INDEX "FranchiseStudentInvite_one_open_per_email" ON "FranchiseStudentInvite"("partnerId", "email") WHERE "status" = 'OPEN';

-- Who invited whom never changes; ACCEPTED and REVOKED are final; acceptance only before expiry and
-- expiry only after it (UTC: Prisma stores timestamp(3) without a zone); deletion only through the
-- logged maintenance process.
CREATE FUNCTION eta_student_invite_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT eta_maintenance_allowed(TG_TABLE_NAME, TG_OP, OLD."id") THEN
      RAISE EXCEPTION 'invitation % cannot be deleted', OLD."id" USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'OPEN' OR NEW."sendCount" <> 1 OR NEW."acceptedAt" IS NOT NULL OR NEW."revokedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'invitations start OPEN, sent once, undecided' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW."id", NEW."partnerId", NEW."email", NEW."inviteeName", NEW."mobile", NEW."createdById", NEW."createdAt")
     IS DISTINCT FROM (OLD."id", OLD."partnerId", OLD."email", OLD."inviteeName", OLD."mobile", OLD."createdById", OLD."createdAt") THEN
    RAISE EXCEPTION 'invitation % identity is immutable', OLD."id" USING ERRCODE = 'P0001';
  END IF;
  IF OLD."status" IN ('ACCEPTED', 'REVOKED') THEN
    RAISE EXCEPTION 'invitation % is % (final)', OLD."id", OLD."status" USING ERRCODE = 'P0001';
  END IF;
  IF NOT ((OLD."status" = 'OPEN' AND NEW."status" IN ('OPEN', 'ACCEPTED', 'REVOKED', 'EXPIRED'))
       OR (OLD."status" = 'EXPIRED' AND NEW."status" IN ('EXPIRED', 'OPEN', 'REVOKED'))) THEN
    RAISE EXCEPTION 'invitation %: % → % is not allowed', OLD."id", OLD."status", NEW."status" USING ERRCODE = 'P0001';
  END IF;
  IF NEW."sendCount" < OLD."sendCount" THEN
    RAISE EXCEPTION 'invitation % send count cannot go down', OLD."id" USING ERRCODE = 'P0001';
  END IF;
  IF NEW."tokenHash" IS DISTINCT FROM OLD."tokenHash" AND NOT (NEW."status" = 'OPEN' AND NEW."sendCount" = OLD."sendCount" + 1) THEN
    RAISE EXCEPTION 'invitation % token changes only with a resend', OLD."id" USING ERRCODE = 'P0001';
  END IF;
  IF NEW."status" = 'ACCEPTED' AND OLD."status" <> 'ACCEPTED' AND OLD."expiresAt" <= (now() AT TIME ZONE 'UTC') THEN
    RAISE EXCEPTION 'invitation % has expired', OLD."id" USING ERRCODE = 'P0001';
  END IF;
  IF NEW."status" = 'EXPIRED' AND OLD."status" <> 'EXPIRED' AND NEW."expiresAt" > (now() AT TIME ZONE 'UTC') THEN
    RAISE EXCEPTION 'invitation % has not expired yet', OLD."id" USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "FranchiseStudentInvite_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FranchiseStudentInvite" FOR EACH ROW EXECUTE FUNCTION eta_student_invite_guard();
CREATE TRIGGER "FranchiseStudentInvite_no_truncate" BEFORE TRUNCATE ON "FranchiseStudentInvite" FOR EACH STATEMENT EXECUTE FUNCTION eta_append_only();
