-- Homepage demo videos become per platform (a homepage category) and language.

-- Platforms offered on the homepage, with the card descriptions.
ALTER TABLE "CourseCategory" ADD COLUMN     "showOnHomepage" BOOLEAN NOT NULL DEFAULT false;

UPDATE "CourseCategory" SET "showOnHomepage" = true,
  "description" = COALESCE("description", 'Start a zero-investment reselling or seller business on India''s fastest-growing marketplace.')
  WHERE "slug" = 'meesho';
UPDATE "CourseCategory" SET "showOnHomepage" = true,
  "description" = COALESCE("description", 'Learn to list, price and grow on Flipkart as a seller, reseller or affiliate.')
  WHERE "slug" = 'flipkart';
UPDATE "CourseCategory" SET "showOnHomepage" = true,
  "description" = COALESCE("description", 'Master Amazon selling — from account setup and listings to your first orders and ads.')
  WHERE "slug" = 'amazon';

-- Existing demos (one per language) belong to Meesho; then the column becomes required.
ALTER TABLE "DemoVideo" ADD COLUMN     "categoryId" TEXT;
UPDATE "DemoVideo" SET "categoryId" = (SELECT "id" FROM "CourseCategory" WHERE "slug" = 'meesho') WHERE "categoryId" IS NULL;
ALTER TABLE "DemoVideo" ALTER COLUMN "categoryId" SET NOT NULL;

-- One demo per language AND platform (was: one per language).
DROP INDEX "DemoVideo_languageId_key";

-- CreateIndex
CREATE INDEX "DemoVideo_categoryId_idx" ON "DemoVideo"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "DemoVideo_languageId_categoryId_key" ON "DemoVideo"("languageId", "categoryId");

-- AddForeignKey
ALTER TABLE "DemoVideo" ADD CONSTRAINT "DemoVideo_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CourseCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Shopify joins the category library and the homepage platforms.
INSERT INTO "CourseCategory" ("id", "parentId", "name", "slug", "description", "displayOrder", "showOnHomepage", "updatedAt") VALUES
  ('cat_shopify', NULL, 'Shopify', 'shopify', 'Build and launch your own branded online store on Shopify — from setup to your first sales.', 3, true, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

-- Platform order everywhere (homepage and Course Library): Meesho, Amazon, Flipkart, Shopify, then the rest.
UPDATE "CourseCategory" c SET "displayOrder" = o.pos
FROM (VALUES ('meesho', 0), ('amazon', 1), ('flipkart', 2), ('shopify', 3), ('instagram-marketing', 4),
             ('facebook-marketing', 5), ('youtube-marketing', 6), ('dropshipping', 7), ('ecommerce-training-academy', 8)) AS o(slug, pos)
WHERE c."slug" = o.slug AND c."parentId" IS NULL;
