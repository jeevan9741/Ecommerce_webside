-- AlterTable
ALTER TABLE "CourseVideo" ADD COLUMN     "languageId" TEXT;

-- AlterTable
ALTER TABLE "DemoVideo" ADD COLUMN     "description" TEXT,
ADD COLUMN     "durationSeconds" INTEGER,
ADD COLUMN     "publicUrl" TEXT,
ADD COLUMN     "sizeBytes" BIGINT,
ADD COLUMN     "thumbnailKey" TEXT,
ADD COLUMN     "thumbnailUrl" TEXT,
ADD COLUMN     "title" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AddForeignKey
ALTER TABLE "CourseVideo" ADD CONSTRAINT "CourseVideo_languageId_fkey" FOREIGN KEY ("languageId") REFERENCES "Language"("id") ON DELETE SET NULL ON UPDATE CASCADE;

