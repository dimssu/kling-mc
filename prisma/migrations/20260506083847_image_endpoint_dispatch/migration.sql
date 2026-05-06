-- AlterTable
ALTER TABLE "ImageCarousel" ADD COLUMN     "endpoint" TEXT NOT NULL DEFAULT 'image2image',
ADD COLUMN     "imageReference" TEXT;

-- AlterTable
ALTER TABLE "ImageGeneration" ADD COLUMN     "endpoint" TEXT NOT NULL DEFAULT 'multi-image2image',
ADD COLUMN     "imageReference" TEXT;
