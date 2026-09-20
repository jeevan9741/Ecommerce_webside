-- DropForeignKey
ALTER TABLE "CourseContent" DROP CONSTRAINT "CourseContent_courseId_fkey";

-- DropIndex
DROP INDEX "DemoVideo_languageCode_key";

-- AlterTable
ALTER TABLE "Course" DROP COLUMN "languages";

-- AlterTable
ALTER TABLE "DemoVideo" DROP COLUMN "languageCode",
DROP COLUMN "languageName",
ADD COLUMN     "languageId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "preferredLanguageId" TEXT;

-- DropTable
DROP TABLE "CourseContent";

-- CreateTable
CREATE TABLE "Language" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nativeName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Language_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseLanguageVideo" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "languageId" TEXT NOT NULL,
    "videoUrl" TEXT,
    "subtitleUrl" TEXT,
    "ebookUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseLanguageVideo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Language_code_key" ON "Language"("code");

-- CreateIndex
CREATE INDEX "Language_isActive_idx" ON "Language"("isActive");

-- CreateIndex
CREATE INDEX "CourseLanguageVideo_courseId_idx" ON "CourseLanguageVideo"("courseId");

-- CreateIndex
CREATE INDEX "CourseLanguageVideo_languageId_idx" ON "CourseLanguageVideo"("languageId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseLanguageVideo_courseId_languageId_key" ON "CourseLanguageVideo"("courseId", "languageId");

-- CreateIndex
CREATE UNIQUE INDEX "DemoVideo_languageId_key" ON "DemoVideo"("languageId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_preferredLanguageId_fkey" FOREIGN KEY ("preferredLanguageId") REFERENCES "Language"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseLanguageVideo" ADD CONSTRAINT "CourseLanguageVideo_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseLanguageVideo" ADD CONSTRAINT "CourseLanguageVideo_languageId_fkey" FOREIGN KEY ("languageId") REFERENCES "Language"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemoVideo" ADD CONSTRAINT "DemoVideo_languageId_fkey" FOREIGN KEY ("languageId") REFERENCES "Language"("id") ON DELETE CASCADE ON UPDATE CASCADE;

