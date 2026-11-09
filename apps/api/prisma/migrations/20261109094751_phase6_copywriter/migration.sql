-- CreateTable
CREATE TABLE "copy_asset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "language" TEXT NOT NULL DEFAULT 'en',
    "tone" TEXT,
    "platform" TEXT NOT NULL DEFAULT 'generic',
    "goal" TEXT,
    "audience" TEXT,
    "brief" TEXT,
    "variants" JSONB,
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "brandKitId" TEXT,
    "sourceDesignId" TEXT,
    "campaignId" TEXT,
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "copy_asset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "copy_asset_organizationId_updatedAt_idx" ON "copy_asset"("organizationId", "updatedAt");

-- CreateIndex
CREATE INDEX "copy_asset_organizationId_kind_idx" ON "copy_asset"("organizationId", "kind");

-- AddForeignKey
ALTER TABLE "copy_asset" ADD CONSTRAINT "copy_asset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copy_asset" ADD CONSTRAINT "copy_asset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copy_asset" ADD CONSTRAINT "copy_asset_brandKitId_fkey" FOREIGN KEY ("brandKitId") REFERENCES "brand_kit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copy_asset" ADD CONSTRAINT "copy_asset_sourceDesignId_fkey" FOREIGN KEY ("sourceDesignId") REFERENCES "design"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copy_asset" ADD CONSTRAINT "copy_asset_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
