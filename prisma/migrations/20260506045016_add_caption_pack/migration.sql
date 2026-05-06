-- AlterTable
ALTER TABLE "Generation" ADD COLUMN     "caption" TEXT,
ADD COLUMN     "captionAccessibility" TEXT,
ADD COLUMN     "captionLocation" TEXT,
ADD COLUMN     "captionPackEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "captionPackGeneratedAt" TIMESTAMP(3),
ADD COLUMN     "captionTags" TEXT[];

-- AlterTable
ALTER TABLE "ImageGeneration" ADD COLUMN     "caption" TEXT,
ADD COLUMN     "captionAccessibility" TEXT,
ADD COLUMN     "captionLocation" TEXT,
ADD COLUMN     "captionPackEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "captionPackGeneratedAt" TIMESTAMP(3),
ADD COLUMN     "captionTags" TEXT[];
