-- Course completion certificates, and watched-range progress tracking (additive only).

-- AlterTable
ALTER TABLE "VideoProgress" ADD COLUMN     "lastReportAt" TIMESTAMP(3),
ADD COLUMN     "watchedRanges" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "CourseCertificate" (
    "id" TEXT NOT NULL,
    "certificateNo" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "studentName" TEXT NOT NULL,
    "courseTitle" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lessonCount" INTEGER NOT NULL DEFAULT 0,
    "issuedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "CourseCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CourseCertificate_certificateNo_key" ON "CourseCertificate"("certificateNo");

-- CreateIndex
CREATE INDEX "CourseCertificate_courseId_idx" ON "CourseCertificate"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseCertificate_userId_courseId_key" ON "CourseCertificate"("userId", "courseId");

-- AddForeignKey
ALTER TABLE "CourseCertificate" ADD CONSTRAINT "CourseCertificate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseCertificate" ADD CONSTRAINT "CourseCertificate_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Default signatory printed on certificates (editable in Admin → Course Certificates).
INSERT INTO "SiteSetting" ("key", "value", "updatedAt")
VALUES ('certificateSignatory', '{"name": "Umesh Chauhan", "title": "Founder & CEO"}', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
