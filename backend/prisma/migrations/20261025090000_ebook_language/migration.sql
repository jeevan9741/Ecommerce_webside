-- E-book language (additive only): nullable, so e-books uploaded before this keep working;
-- the admin API requires it for new uploads.

-- AlterTable
ALTER TABLE "EBook" ADD COLUMN     "languageId" TEXT;

-- AddForeignKey
ALTER TABLE "EBook" ADD CONSTRAINT "EBook_languageId_fkey" FOREIGN KEY ("languageId") REFERENCES "Language"("id") ON DELETE SET NULL ON UPDATE CASCADE;
