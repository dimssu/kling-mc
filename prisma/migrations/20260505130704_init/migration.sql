-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "durationSec" DOUBLE PRECISION,
    "width" INTEGER,
    "height" INTEGER,
    "storageKey" TEXT NOT NULL,
    "thumbnailKey" TEXT,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Generation" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'kling_official',
    "providerTaskId" TEXT,
    "externalTaskId" TEXT NOT NULL,
    "sourceVideoId" TEXT NOT NULL,
    "referenceImageId" TEXT NOT NULL,
    "outputAssetId" TEXT,
    "prompt" TEXT,
    "modelName" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "characterOrientation" TEXT NOT NULL,
    "keepOriginalSound" BOOLEAN NOT NULL DEFAULT true,
    "watermarkEnabled" BOOLEAN NOT NULL DEFAULT false,
    "estimatedCostUsd" DECIMAL(10,4) NOT NULL,
    "actualCostUsd" DECIMAL(10,4),
    "finalUnitDeduction" TEXT,
    "errorCode" INTEGER,
    "errorMessage" TEXT,
    "rawProviderPayload" JSONB,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Generation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MediaAsset_ownerId_kind_createdAt_idx" ON "MediaAsset"("ownerId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "MediaAsset_ownerId_isFavorite_idx" ON "MediaAsset"("ownerId", "isFavorite");

-- CreateIndex
CREATE UNIQUE INDEX "Generation_providerTaskId_key" ON "Generation"("providerTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "Generation_externalTaskId_key" ON "Generation"("externalTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "Generation_outputAssetId_key" ON "Generation"("outputAssetId");

-- CreateIndex
CREATE INDEX "Generation_ownerId_status_createdAt_idx" ON "Generation"("ownerId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Generation_ownerId_isFavorite_idx" ON "Generation"("ownerId", "isFavorite");

-- CreateIndex
CREATE INDEX "Generation_status_submittedAt_idx" ON "Generation"("status", "submittedAt");

-- AddForeignKey
ALTER TABLE "Generation" ADD CONSTRAINT "Generation_sourceVideoId_fkey" FOREIGN KEY ("sourceVideoId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Generation" ADD CONSTRAINT "Generation_referenceImageId_fkey" FOREIGN KEY ("referenceImageId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Generation" ADD CONSTRAINT "Generation_outputAssetId_fkey" FOREIGN KEY ("outputAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
