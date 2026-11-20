-- One open franchise application per account: a WITHDRAWN application is closed too (like a REJECTED one),
-- so its applicant can apply again. The rule was written before the WITHDRAWN status existed.
-- Index only; no rows change. Matches the API's own check (CLOSED_STATUSES = REJECTED, WITHDRAWN).

DROP INDEX "FranchiseApplication_one_open_per_user";

CREATE UNIQUE INDEX "FranchiseApplication_one_open_per_user" ON "FranchiseApplication"("userId") WHERE "status" NOT IN ('REJECTED', 'WITHDRAWN');
