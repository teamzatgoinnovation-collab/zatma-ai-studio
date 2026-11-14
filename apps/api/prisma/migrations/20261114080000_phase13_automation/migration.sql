-- CreateEnum
CREATE TYPE "AutomationStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "AutomationRunStatus" AS ENUM ('RUNNING', 'WAITING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AutomationStepStatus" AS ENUM ('SUCCEEDED', 'FAILED', 'SKIPPED', 'WAITING');

-- CreateTable
CREATE TABLE "automation_workflow" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "AutomationStatus" NOT NULL DEFAULT 'DRAFT',
    "graph" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "triggerKind" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "ownerId" TEXT,
    "activatedAt" TIMESTAMP(3),
    "pausedReason" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastFailureEmailAt" TIMESTAMP(3),
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_workflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_run" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "graphSnapshot" JSONB NOT NULL,
    "triggerKind" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "dedupeKey" TEXT NOT NULL,
    "status" "AutomationRunStatus" NOT NULL DEFAULT 'RUNNING',
    "skipReason" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "resumeNodeId" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "automation_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_run_step" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "nodeType" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "status" "AutomationStepStatus" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "output" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "automation_run_step_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_enrollment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "leadId" TEXT,
    "contactId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'automation',
    "workflowId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "automation_workflow_organizationId_status_idx" ON "automation_workflow"("organizationId", "status");

-- CreateIndex
CREATE INDEX "automation_workflow_organizationId_triggerKind_status_idx" ON "automation_workflow"("organizationId", "triggerKind", "status");

-- CreateIndex
CREATE INDEX "automation_run_organizationId_startedAt_idx" ON "automation_run"("organizationId", "startedAt");

-- CreateIndex
CREATE INDEX "automation_run_workflowId_startedAt_idx" ON "automation_run"("workflowId", "startedAt");

-- CreateIndex
CREATE INDEX "automation_run_workflowId_entityType_entityId_startedAt_idx" ON "automation_run"("workflowId", "entityType", "entityId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "automation_run_workflowId_dedupeKey_key" ON "automation_run"("workflowId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "automation_run_step_runId_nodeId_key" ON "automation_run_step"("runId", "nodeId");

-- CreateIndex
CREATE INDEX "campaign_enrollment_organizationId_campaignId_idx" ON "campaign_enrollment"("organizationId", "campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_enrollment_campaignId_leadId_key" ON "campaign_enrollment"("campaignId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_enrollment_campaignId_contactId_key" ON "campaign_enrollment"("campaignId", "contactId");

-- AddForeignKey
ALTER TABLE "automation_workflow" ADD CONSTRAINT "automation_workflow_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_workflow" ADD CONSTRAINT "automation_workflow_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_workflow" ADD CONSTRAINT "automation_workflow_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "automation_workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_run_step" ADD CONSTRAINT "automation_run_step_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_run_step" ADD CONSTRAINT "automation_run_step_runId_fkey" FOREIGN KEY ("runId") REFERENCES "automation_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_enrollment" ADD CONSTRAINT "campaign_enrollment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_enrollment" ADD CONSTRAINT "campaign_enrollment_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_enrollment" ADD CONSTRAINT "campaign_enrollment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_enrollment" ADD CONSTRAINT "campaign_enrollment_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Plan entitlement: automation runs per month. -1 = unlimited.
UPDATE "plan" SET "limits" = "limits" || jsonb_build_object('automationRuns',
  CASE "code"
    WHEN 'FREE' THEN 100
    WHEN 'STARTER' THEN 2000
    WHEN 'PROFESSIONAL' THEN 10000
    WHEN 'BUSINESS' THEN 50000
    ELSE -1
  END);
