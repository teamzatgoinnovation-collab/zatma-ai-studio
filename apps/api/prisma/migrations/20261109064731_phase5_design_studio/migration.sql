-- CreateEnum
CREATE TYPE "DesignStatus" AS ENUM ('DRAFT', 'GENERATING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "brand_kit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "logoFileId" TEXT,
    "colors" JSONB NOT NULL,
    "fonts" JSONB NOT NULL,
    "tagline" TEXT,
    "website" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "email" TEXT,
    "address" TEXT,
    "guidelines" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_kit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "brandKitId" TEXT,
    "title" TEXT NOT NULL,
    "prompt" TEXT,
    "sizePreset" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "document" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "status" "DesignStatus" NOT NULL DEFAULT 'DRAFT',
    "generationJobId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "thumbnailFileId" TEXT,
    "caption" TEXT,
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "design_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_version" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "designId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "document" JSONB NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "design_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'General',
    "sizePreset" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "document" JSONB NOT NULL,
    "thumbnailFileId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "template_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "brand_kit_organizationId_idx" ON "brand_kit"("organizationId");

-- CreateIndex
CREATE INDEX "design_organizationId_updatedAt_idx" ON "design"("organizationId", "updatedAt");

-- CreateIndex
CREATE INDEX "design_version_designId_createdAt_idx" ON "design_version"("designId", "createdAt");

-- CreateIndex
CREATE INDEX "template_organizationId_createdAt_idx" ON "template"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "brand_kit" ADD CONSTRAINT "brand_kit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_kit" ADD CONSTRAINT "brand_kit_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design" ADD CONSTRAINT "design_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design" ADD CONSTRAINT "design_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design" ADD CONSTRAINT "design_brandKitId_fkey" FOREIGN KEY ("brandKitId") REFERENCES "brand_kit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design" ADD CONSTRAINT "design_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_version" ADD CONSTRAINT "design_version_designId_fkey" FOREIGN KEY ("designId") REFERENCES "design"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_version" ADD CONSTRAINT "design_version_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template" ADD CONSTRAINT "template_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
