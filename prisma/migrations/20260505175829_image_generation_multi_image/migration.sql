/*
  Warnings:

  - You are about to drop the column `imageFidelity` on the `ImageGeneration` table. All the data in the column will be lost.
  - You are about to drop the column `referenceImageId` on the `ImageGeneration` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "ImageGeneration" DROP CONSTRAINT "ImageGeneration_referenceImageId_fkey";

-- AlterTable
ALTER TABLE "ImageGeneration" DROP COLUMN "imageFidelity",
DROP COLUMN "referenceImageId",
ADD COLUMN     "n" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "sceneImageId" TEXT,
ADD COLUMN     "styleImageId" TEXT,
ADD COLUMN     "subjectImageIds" TEXT[];

-- AddForeignKey
ALTER TABLE "ImageGeneration" ADD CONSTRAINT "ImageGeneration_sceneImageId_fkey" FOREIGN KEY ("sceneImageId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImageGeneration" ADD CONSTRAINT "ImageGeneration_styleImageId_fkey" FOREIGN KEY ("styleImageId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
