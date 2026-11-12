-- CreateEnum
CREATE TYPE "AdPlatform" AS ENUM ('META', 'GOOGLE');

-- CreateEnum
CREATE TYPE "AdCampaignStatus" AS ENUM ('DRAFT', 'PUBLISHING', 'PAUSED', 'ACTIVE', 'COMPLETED', 'ARCHIVED', 'ERROR');

-- CreateEnum
CREATE TYPE "AdBudgetType" AS ENUM ('DAILY', 'LIFETIME');

-- CreateTable
CREATE TABLE "ad_account" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "platform" "AdPlatform" NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "loginCustomerId" TEXT,
    "monthlySpendCap" DECIMAL(14,2),
    "workspaceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_campaign" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "platform" "AdPlatform" NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "status" "AdCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "source" TEXT NOT NULL DEFAULT 'CREATED',
    "budgetType" "AdBudgetType" NOT NULL DEFAULT 'DAILY',
    "budgetAmount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "externalId" TEXT,
    "budgetExternalId" TEXT,
    "syncState" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "createdById" TEXT,
    "activatedById" TEXT,
    "activatedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_group" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PAUSED',
    "externalId" TEXT,
    "targeting" JSONB NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "adGroupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PAUSED',
    "externalId" TEXT,
    "creative" JSONB NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_insight_daily" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "spend" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "leads" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_insight_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_approval" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "maxSpend" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "budgetAmount" DECIMAL(14,2) NOT NULL,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_approval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ad_account_organizationId_platform_externalId_key" ON "ad_account"("organizationId", "platform", "externalId");

-- CreateIndex
CREATE INDEX "ad_campaign_organizationId_status_idx" ON "ad_campaign"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ad_campaign_adAccountId_externalId_key" ON "ad_campaign"("adAccountId", "externalId");

-- CreateIndex
CREATE INDEX "ad_group_campaignId_idx" ON "ad_group"("campaignId");

-- CreateIndex
CREATE INDEX "ad_adGroupId_idx" ON "ad"("adGroupId");

-- CreateIndex
CREATE INDEX "ad_insight_daily_organizationId_date_idx" ON "ad_insight_daily"("organizationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ad_insight_daily_campaignId_date_key" ON "ad_insight_daily"("campaignId", "date");

-- CreateIndex
CREATE INDEX "ad_approval_campaignId_idx" ON "ad_approval"("campaignId");

-- AddForeignKey
ALTER TABLE "ad_account" ADD CONSTRAINT "ad_account_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_account" ADD CONSTRAINT "ad_account_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "social_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_campaign" ADD CONSTRAINT "ad_campaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_campaign" ADD CONSTRAINT "ad_campaign_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_campaign" ADD CONSTRAINT "ad_campaign_adAccountId_fkey" FOREIGN KEY ("adAccountId") REFERENCES "ad_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_campaign" ADD CONSTRAINT "ad_campaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_campaign" ADD CONSTRAINT "ad_campaign_activatedById_fkey" FOREIGN KEY ("activatedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_group" ADD CONSTRAINT "ad_group_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_group" ADD CONSTRAINT "ad_group_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "ad_campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad" ADD CONSTRAINT "ad_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad" ADD CONSTRAINT "ad_adGroupId_fkey" FOREIGN KEY ("adGroupId") REFERENCES "ad_group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_insight_daily" ADD CONSTRAINT "ad_insight_daily_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_insight_daily" ADD CONSTRAINT "ad_insight_daily_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "ad_campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_approval" ADD CONSTRAINT "ad_approval_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_approval" ADD CONSTRAINT "ad_approval_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "ad_campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_approval" ADD CONSTRAINT "ad_approval_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Plan entitlement: connected ad accounts (Meta + Google Ads). -1 = unlimited.
UPDATE "plan" SET "limits" = "limits" || jsonb_build_object('adAccounts',
  CASE "code"
    WHEN 'FREE' THEN 0
    WHEN 'STARTER' THEN 1
    WHEN 'PROFESSIONAL' THEN 3
    WHEN 'BUSINESS' THEN 10
    ELSE -1
  END);
