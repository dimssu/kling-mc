-- AlterTable
ALTER TABLE "ImageGeneration" ADD COLUMN     "carouselId" TEXT,
ADD COLUMN     "poseLabel" TEXT,
ADD COLUMN     "slotIndex" INTEGER;

-- CreateTable
CREATE TABLE "ImageCarousel" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "n" INTEGER NOT NULL,
    "themePrompt" TEXT,
    "vibeLabel" TEXT,
    "subjectImageId" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "aspectRatio" TEXT,
    "estimatedCostUsd" DECIMAL(10,4) NOT NULL,
    "caption" TEXT,
    "captionTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "captionLocation" TEXT,
    "captionAccessibility" TEXT,
    "captionGeneratedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ImageCarousel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImageCarousel_ownerId_createdAt_idx" ON "ImageCarousel"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "ImageCarousel_status_idx" ON "ImageCarousel"("status");

-- CreateIndex
CREATE INDEX "ImageGeneration_carouselId_slotIndex_idx" ON "ImageGeneration"("carouselId", "slotIndex");

-- AddForeignKey
ALTER TABLE "ImageGeneration" ADD CONSTRAINT "ImageGeneration_carouselId_fkey" FOREIGN KEY ("carouselId") REFERENCES "ImageCarousel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
