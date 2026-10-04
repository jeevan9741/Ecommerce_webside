-- Homepage demo videos are no longer per platform: one common demo per language (English is the
-- default and the fallback). Existing demos are kept and detached from their platform.
ALTER TABLE "DemoVideo" ALTER COLUMN "categoryId" DROP NOT NULL;
UPDATE "DemoVideo" SET "categoryId" = NULL;
