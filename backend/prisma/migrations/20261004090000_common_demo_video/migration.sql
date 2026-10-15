-- Homepage demo videos are no longer per platform: one common demo per language (English is the
-- default and the fallback). New demos are saved without a platform; existing demos keep theirs
-- (the app no longer reads it), so no demo-video data is changed.
ALTER TABLE "DemoVideo" ALTER COLUMN "categoryId" DROP NOT NULL;
