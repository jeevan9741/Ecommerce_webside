-- AlterTable
ALTER TABLE "CourseVideo" ADD COLUMN     "categoryId" TEXT;

-- CreateTable
CREATE TABLE "CourseCategory" (
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryPackage" (
    "categoryId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CategoryPackage_pkey" PRIMARY KEY ("categoryId","courseId")
);

-- CreateIndex
CREATE UNIQUE INDEX "CourseCategory_slug_key" ON "CourseCategory"("slug");

-- CreateIndex
CREATE INDEX "CourseCategory_parentId_displayOrder_idx" ON "CourseCategory"("parentId", "displayOrder");

-- CreateIndex
CREATE INDEX "CategoryPackage_courseId_idx" ON "CategoryPackage"("courseId");

-- CreateIndex
CREATE INDEX "CourseVideo_categoryId_displayOrder_idx" ON "CourseVideo"("categoryId", "displayOrder");

-- AddForeignKey
ALTER TABLE "CourseVideo" ADD CONSTRAINT "CourseVideo_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CourseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseCategory" ADD CONSTRAINT "CourseCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CourseCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryPackage" ADD CONSTRAINT "CategoryPackage_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CourseCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryPackage" ADD CONSTRAINT "CategoryPackage_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Seed: the course category library (idempotent). Package links are set by admins in the category manager.
INSERT INTO "CourseCategory" ("id", "parentId", "name", "slug", "displayOrder", "updatedAt") VALUES
  ('cat_meesho', NULL, 'Meesho', 'meesho', 0, CURRENT_TIMESTAMP),
  ('cat_flipkart', NULL, 'Flipkart', 'flipkart', 1, CURRENT_TIMESTAMP),
  ('cat_amazon', NULL, 'Amazon', 'amazon', 2, CURRENT_TIMESTAMP),
  ('cat_instagram_marketing', NULL, 'Instagram Marketing', 'instagram-marketing', 3, CURRENT_TIMESTAMP),
  ('cat_facebook_marketing', NULL, 'Facebook Marketing', 'facebook-marketing', 4, CURRENT_TIMESTAMP),
  ('cat_youtube_marketing', NULL, 'YouTube Marketing', 'youtube-marketing', 5, CURRENT_TIMESTAMP),
  ('cat_dropshipping', NULL, 'Dropshipping', 'dropshipping', 6, CURRENT_TIMESTAMP),
  ('cat_ecommerce_training_academy', NULL, 'E-Commerce Training Academy', 'ecommerce-training-academy', 7, CURRENT_TIMESTAMP),
  ('cat_meesho_affiliate', 'cat_meesho', 'Meesho Affiliate', 'meesho-affiliate', 0, CURRENT_TIMESTAMP),
  ('cat_meesho_reselling', 'cat_meesho', 'Meesho Reselling', 'meesho-reselling', 1, CURRENT_TIMESTAMP),
  ('cat_meesho_seller', 'cat_meesho', 'Meesho Seller', 'meesho-seller', 2, CURRENT_TIMESTAMP),
  ('cat_flipkart_affiliate', 'cat_flipkart', 'Flipkart Affiliate', 'flipkart-affiliate', 0, CURRENT_TIMESTAMP),
  ('cat_flipkart_reselling', 'cat_flipkart', 'Flipkart Reselling', 'flipkart-reselling', 1, CURRENT_TIMESTAMP),
  ('cat_flipkart_seller', 'cat_flipkart', 'Flipkart Seller', 'flipkart-seller', 2, CURRENT_TIMESTAMP),
  ('cat_amazon_affiliate', 'cat_amazon', 'Amazon Affiliate', 'amazon-affiliate', 0, CURRENT_TIMESTAMP),
  ('cat_amazon_reselling', 'cat_amazon', 'Amazon Reselling', 'amazon-reselling', 1, CURRENT_TIMESTAMP),
  ('cat_amazon_seller', 'cat_amazon', 'Amazon Seller', 'amazon-seller', 2, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;
