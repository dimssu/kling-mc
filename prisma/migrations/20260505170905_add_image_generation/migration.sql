-- CreateTable
CREATE TABLE "ImageGeneration" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'kling_official',
    "providerTaskId" TEXT,
    "externalTaskId" TEXT NOT NULL,
    "referenceImageId" TEXT NOT NULL,
    "outputAssetId" TEXT,
    "prompt" TEXT,
    "negativePrompt" TEXT,
    "modelName" TEXT NOT NULL,
    "imageFidelity" DOUBLE PRECISION,
    "aspectRatio" TEXT,
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

    CONSTRAINT "ImageGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ImageGeneration_providerTaskId_key" ON "ImageGeneration"("providerTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "ImageGeneration_externalTaskId_key" ON "ImageGeneration"("externalTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "ImageGeneration_outputAssetId_key" ON "ImageGeneration"("outputAssetId");

-- CreateIndex
CREATE INDEX "ImageGeneration_ownerId_status_createdAt_idx" ON "ImageGeneration"("ownerId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ImageGeneration_ownerId_isFavorite_idx" ON "ImageGeneration"("ownerId", "isFavorite");

-- CreateIndex
CREATE INDEX "ImageGeneration_status_submittedAt_idx" ON "ImageGeneration"("status", "submittedAt");

-- AddForeignKey
ALTER TABLE "ImageGeneration" ADD CONSTRAINT "ImageGeneration_referenceImageId_fkey" FOREIGN KEY ("referenceImageId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImageGeneration" ADD CONSTRAINT "ImageGeneration_outputAssetId_fkey" FOREIGN KEY ("outputAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
