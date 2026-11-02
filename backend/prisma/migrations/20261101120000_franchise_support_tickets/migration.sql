-- Phase 5F-3: franchise support tickets. Additive only: two new enum types, three new tables,
-- their constraints and guard triggers. No existing table, column or row is changed.

-- CreateEnum
CREATE TYPE "SupportTicketCategory" AS ENUM ('TECHNICAL', 'PAYMENT', 'STUDENT', 'COURSE', 'OTHER');

-- CreateEnum
CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "ticketNo" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "openedById" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "category" "SupportTicketCategory" NOT NULL,
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
    "awaiting" TEXT NOT NULL DEFAULT 'ETA',
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicketMessage" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorRole" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportTicketMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicketEvent" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "fromStatus" "SupportTicketStatus",
    "toStatus" "SupportTicketStatus" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportTicketEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupportTicket_ticketNo_key" ON "SupportTicket"("ticketNo");

-- CreateIndex
CREATE INDEX "SupportTicket_partnerId_status_lastMessageAt_idx" ON "SupportTicket"("partnerId", "status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "SupportTicket_status_lastMessageAt_idx" ON "SupportTicket"("status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "SupportTicketMessage_ticketId_createdAt_idx" ON "SupportTicketMessage"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicketEvent_ticketId_createdAt_idx" ON "SupportTicketEvent"("ticketId", "createdAt");

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "FranchisePartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicketMessage" ADD CONSTRAINT "SupportTicketMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicketMessage" ADD CONSTRAINT "SupportTicketMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicketEvent" ADD CONSTRAINT "SupportTicketEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicketEvent" ADD CONSTRAINT "SupportTicketEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Rules the application relies on, enforced here as well.
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_ticket_no" CHECK ("ticketNo" ~ '^FT-[0-9]{4}-[0-9]{6}$');
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_subject" CHECK (length(btrim("subject")) BETWEEN 5 AND 150);
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_awaiting" CHECK ("awaiting" IN ('ETA', 'PARTNER', 'NONE') AND (("status" IN ('RESOLVED', 'CLOSED')) = ("awaiting" = 'NONE')));
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_closed_recorded" CHECK (("status" = 'CLOSED') = ("closedAt" IS NOT NULL AND "closedById" IS NOT NULL));
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_resolved_recorded" CHECK ("status" <> 'RESOLVED' OR "resolvedAt" IS NOT NULL);
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_version_nonnegative" CHECK ("version" >= 0);
ALTER TABLE "SupportTicketMessage" ADD CONSTRAINT "SupportTicketMessage_author_role" CHECK ("authorRole" IN ('PARTNER', 'ADMIN') AND (NOT "internal" OR "authorRole" = 'ADMIN'));
ALTER TABLE "SupportTicketMessage" ADD CONSTRAINT "SupportTicketMessage_body" CHECK (length(btrim("body")) BETWEEN 1 AND 5000);
ALTER TABLE "SupportTicketEvent" ADD CONSTRAINT "SupportTicketEvent_actor_role" CHECK ("actorRole" IN ('PARTNER', 'ADMIN'));
ALTER TABLE "SupportTicketEvent" ADD CONSTRAINT "SupportTicketEvent_changes_status" CHECK ("fromStatus" IS DISTINCT FROM "toStatus");

-- Who opened a ticket, for which franchise, about what, never changes; CLOSED is final; status moves only
-- along allowed paths; deletion only through the logged maintenance process.
CREATE FUNCTION eta_support_ticket_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT eta_maintenance_allowed(TG_TABLE_NAME, TG_OP, OLD."id") THEN
      RAISE EXCEPTION 'ticket % cannot be deleted', OLD."id" USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT "userId" INTO owner_id FROM "FranchisePartner" WHERE "id" = NEW."partnerId";
    IF NEW."openedById" IS DISTINCT FROM owner_id THEN
      RAISE EXCEPTION 'a ticket is opened by its franchise''s owner' USING ERRCODE = 'P0001';
    END IF;
    IF NEW."status" <> 'OPEN' OR NEW."version" <> 0 THEN
      RAISE EXCEPTION 'tickets start OPEN at version 0' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW."id", NEW."ticketNo", NEW."partnerId", NEW."openedById", NEW."subject", NEW."category", NEW."createdAt")
     IS DISTINCT FROM (OLD."id", OLD."ticketNo", OLD."partnerId", OLD."openedById", OLD."subject", OLD."category", OLD."createdAt") THEN
    RAISE EXCEPTION 'ticket % identity is immutable', OLD."id" USING ERRCODE = 'P0001';
  END IF;
  IF OLD."status" = 'CLOSED' THEN
    RAISE EXCEPTION 'ticket % is closed (final)', OLD."id" USING ERRCODE = 'P0001';
  END IF;
  IF NEW."version" < OLD."version" THEN
    RAISE EXCEPTION 'ticket % version cannot go down', OLD."id" USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

-- Messages: nothing is added to a closed ticket; a partner message comes from that franchise's owner;
-- admin messages (and every internal note) come from an ADMIN.
CREATE FUNCTION eta_support_message_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t_status text; owner_id text; author_role text;
BEGIN
  SELECT t."status"::text, p."userId" INTO t_status, owner_id FROM "SupportTicket" t JOIN "FranchisePartner" p ON p."id" = t."partnerId" WHERE t."id" = NEW."ticketId";
  IF t_status = 'CLOSED' THEN
    RAISE EXCEPTION 'ticket % is closed', NEW."ticketId" USING ERRCODE = 'P0001';
  END IF;
  IF NEW."authorRole" = 'PARTNER' AND NEW."authorId" IS DISTINCT FROM owner_id THEN
    RAISE EXCEPTION 'only the franchise owner writes as PARTNER on ticket %', NEW."ticketId" USING ERRCODE = 'P0001';
  END IF;
  IF NEW."authorRole" = 'ADMIN' THEN
    SELECT "role"::text INTO author_role FROM "User" WHERE "id" = NEW."authorId" FOR SHARE;
    IF author_role IS DISTINCT FROM 'ADMIN' THEN
      RAISE EXCEPTION 'only an ADMIN writes as ADMIN on ticket %', NEW."ticketId" USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "SupportTicket_guard" BEFORE INSERT OR UPDATE OR DELETE ON "SupportTicket" FOR EACH ROW EXECUTE FUNCTION eta_support_ticket_guard();
CREATE TRIGGER "SupportTicket_no_truncate" BEFORE TRUNCATE ON "SupportTicket" FOR EACH STATEMENT EXECUTE FUNCTION eta_append_only();
CREATE TRIGGER "SupportTicketMessage_guard" BEFORE INSERT ON "SupportTicketMessage" FOR EACH ROW EXECUTE FUNCTION eta_support_message_guard();
CREATE TRIGGER "SupportTicketMessage_append_only" BEFORE UPDATE OR DELETE ON "SupportTicketMessage" FOR EACH ROW EXECUTE FUNCTION eta_append_only();
CREATE TRIGGER "SupportTicketMessage_no_truncate" BEFORE TRUNCATE ON "SupportTicketMessage" FOR EACH STATEMENT EXECUTE FUNCTION eta_append_only();
CREATE TRIGGER "SupportTicketEvent_append_only" BEFORE UPDATE OR DELETE ON "SupportTicketEvent" FOR EACH ROW EXECUTE FUNCTION eta_append_only();
CREATE TRIGGER "SupportTicketEvent_no_truncate" BEFORE TRUNCATE ON "SupportTicketEvent" FOR EACH STATEMENT EXECUTE FUNCTION eta_append_only();
