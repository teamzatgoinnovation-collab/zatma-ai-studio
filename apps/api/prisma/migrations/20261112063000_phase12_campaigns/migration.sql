-- campaignId on copy_asset and social_post had no foreign key before this phase and no campaigns existed,
-- so any value present cannot point at a campaign; clear it before adding the constraints.
UPDATE "copy_asset" SET "campaignId" = NULL WHERE "campaignId" IS NOT NULL;
UPDATE "social_post" SET "campaignId" = NULL WHERE "campaignId" IS NOT NULL;

-- CreateEnum
CREATE TYPE "MarketingCampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "ad_campaign" ADD COLUMN     "marketingCampaignId" TEXT;

-- AlterTable
ALTER TABLE "deal" ADD COLUMN     "campaignId" TEXT;

-- AlterTable
ALTER TABLE "design" ADD COLUMN     "campaignId" TEXT;

-- AlterTable
ALTER TABLE "lead" ADD COLUMN     "campaignId" TEXT,
ADD COLUMN     "externalRef" TEXT,
ADD COLUMN     "utm" JSONB;

-- CreateTable
CREATE TABLE "campaign" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "objective" TEXT NOT NULL DEFAULT 'AWARENESS',
    "description" TEXT NOT NULL DEFAULT '',
    "ownerId" TEXT,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "status" "MarketingCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "manualStatus" "MarketingCampaignStatus",
    "readyAt" TIMESTAMP(3),
    "budgetAmount" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "audience" JSONB NOT NULL DEFAULT '{}',
    "utmCampaign" TEXT NOT NULL,
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_channel_plan" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "plannedBudget" DECIMAL(14,2),
    "notes" TEXT NOT NULL DEFAULT '',
    "content" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_channel_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_asset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "fileId" TEXT,
    "designId" TEXT,
    "copyAssetId" TEXT,
    "label" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_task" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "done" BOOLEAN NOT NULL DEFAULT false,
    "assigneeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracked_link" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "destinationUrl" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "channel" TEXT NOT NULL DEFAULT 'other',
    "utmSource" TEXT NOT NULL,
    "utmMedium" TEXT NOT NULL,
    "utmContent" TEXT,
    "utmTerm" TEXT,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "uniqueClicks" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tracked_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracked_link_click_daily" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "uniqueClicks" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tracked_link_click_daily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaign_organizationId_status_idx" ON "campaign"("organizationId", "status");

-- CreateIndex
CREATE INDEX "campaign_organizationId_utmCampaign_idx" ON "campaign"("organizationId", "utmCampaign");

-- CreateIndex
CREATE INDEX "campaign_organizationId_startAt_idx" ON "campaign"("organizationId", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_organizationId_number_key" ON "campaign"("organizationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_channel_plan_campaignId_channel_key" ON "campaign_channel_plan"("campaignId", "channel");

-- CreateIndex
CREATE INDEX "campaign_asset_campaignId_idx" ON "campaign_asset"("campaignId");

-- CreateIndex
CREATE INDEX "campaign_task_campaignId_dueAt_idx" ON "campaign_task"("campaignId", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "tracked_link_slug_key" ON "tracked_link"("slug");

-- CreateIndex
CREATE INDEX "tracked_link_campaignId_idx" ON "tracked_link"("campaignId");

-- CreateIndex
CREATE INDEX "tracked_link_click_daily_campaignId_date_idx" ON "tracked_link_click_daily"("campaignId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "tracked_link_click_daily_linkId_date_key" ON "tracked_link_click_daily"("linkId", "date");

-- CreateIndex
CREATE INDEX "ad_campaign_marketingCampaignId_idx" ON "ad_campaign"("marketingCampaignId");

-- CreateIndex
CREATE INDEX "copy_asset_campaignId_idx" ON "copy_asset"("campaignId");

-- CreateIndex
CREATE INDEX "deal_campaignId_idx" ON "deal"("campaignId");

-- CreateIndex
CREATE INDEX "design_campaignId_idx" ON "design"("campaignId");

-- CreateIndex
CREATE INDEX "lead_campaignId_idx" ON "lead"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "lead_organizationId_externalRef_key" ON "lead"("organizationId", "externalRef");

-- CreateIndex
CREATE INDEX "social_post_campaignId_idx" ON "social_post"("campaignId");

-- AddForeignKey
ALTER TABLE "design" ADD CONSTRAINT "design_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copy_asset" ADD CONSTRAINT "copy_asset_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal" ADD CONSTRAINT "deal_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_post" ADD CONSTRAINT "social_post_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_campaign" ADD CONSTRAINT "ad_campaign_marketingCampaignId_fkey" FOREIGN KEY ("marketingCampaignId") REFERENCES "campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_channel_plan" ADD CONSTRAINT "campaign_channel_plan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_channel_plan" ADD CONSTRAINT "campaign_channel_plan_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_asset" ADD CONSTRAINT "campaign_asset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_asset" ADD CONSTRAINT "campaign_asset_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_asset" ADD CONSTRAINT "campaign_asset_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "stored_file"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_asset" ADD CONSTRAINT "campaign_asset_designId_fkey" FOREIGN KEY ("designId") REFERENCES "design"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_asset" ADD CONSTRAINT "campaign_asset_copyAssetId_fkey" FOREIGN KEY ("copyAssetId") REFERENCES "copy_asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_task" ADD CONSTRAINT "campaign_task_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_task" ADD CONSTRAINT "campaign_task_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_task" ADD CONSTRAINT "campaign_task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracked_link" ADD CONSTRAINT "tracked_link_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracked_link" ADD CONSTRAINT "tracked_link_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracked_link_click_daily" ADD CONSTRAINT "tracked_link_click_daily_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracked_link_click_daily" ADD CONSTRAINT "tracked_link_click_daily_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracked_link_click_daily" ADD CONSTRAINT "tracked_link_click_daily_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "tracked_link"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Plan entitlement: active (not completed or cancelled) campaigns. -1 = unlimited.
UPDATE "plan" SET "limits" = "limits" || jsonb_build_object('campaigns',
  CASE "code"
    WHEN 'FREE' THEN 2
    WHEN 'STARTER' THEN 10
    WHEN 'PROFESSIONAL' THEN 50
    WHEN 'BUSINESS' THEN 200
    ELSE -1
  END);
