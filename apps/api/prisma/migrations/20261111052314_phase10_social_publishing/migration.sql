-- CreateEnum
CREATE TYPE "SocialPostStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'PARTIALLY_PUBLISHED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "SocialPostTargetStatus" AS ENUM ('PENDING', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELED');

-- AlterTable
ALTER TABLE "organization" ADD COLUMN     "socialSettings" JSONB;

-- CreateTable
CREATE TABLE "social_post" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "caption" TEXT NOT NULL DEFAULT '',
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "media" JSONB NOT NULL DEFAULT '[]',
    "status" "SocialPostStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "timezone" TEXT,
    "publishedAt" TIMESTAMP(3),
    "sourceDesignId" TEXT,
    "copyAssetId" TEXT,
    "campaignId" TEXT,
    "createdById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_post_target" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "socialAccountId" TEXT,
    "platform" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "captionOverride" TEXT,
    "options" JSONB NOT NULL DEFAULT '{}',
    "status" "SocialPostTargetStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "providerState" JSONB NOT NULL DEFAULT '{}',
    "externalId" TEXT,
    "externalUrl" TEXT,
    "error" TEXT,
    "errorCode" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_post_target_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "social_post_organizationId_status_scheduledAt_idx" ON "social_post"("organizationId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "social_post_organizationId_workspaceId_scheduledAt_idx" ON "social_post"("organizationId", "workspaceId", "scheduledAt");

-- CreateIndex
CREATE INDEX "social_post_target_organizationId_status_publishedAt_idx" ON "social_post_target"("organizationId", "status", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "social_post_target_postId_socialAccountId_key" ON "social_post_target"("postId", "socialAccountId");

-- AddForeignKey
ALTER TABLE "social_post" ADD CONSTRAINT "social_post_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_post" ADD CONSTRAINT "social_post_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_post" ADD CONSTRAINT "social_post_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_post" ADD CONSTRAINT "social_post_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_post_target" ADD CONSTRAINT "social_post_target_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_post_target" ADD CONSTRAINT "social_post_target_postId_fkey" FOREIGN KEY ("postId") REFERENCES "social_post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_post_target" ADD CONSTRAINT "social_post_target_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "social_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Plan entitlement: social posts published or scheduled per UTC month. -1 = unlimited.
UPDATE "plan" SET "limits" = "limits" || jsonb_build_object('postsPerMonth',
  CASE "code"
    WHEN 'FREE' THEN 10
    WHEN 'STARTER' THEN 60
    WHEN 'PROFESSIONAL' THEN 300
    WHEN 'BUSINESS' THEN 1500
    ELSE -1
  END);
