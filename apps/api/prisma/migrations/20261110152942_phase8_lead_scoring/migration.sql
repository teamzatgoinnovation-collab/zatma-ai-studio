-- AlterTable
ALTER TABLE "lead" ADD COLUMN     "aiInsights" JSONB,
ADD COLUMN     "aiInsightsAt" TIMESTAMP(3),
ADD COLUMN     "scoreBreakdown" JSONB,
ADD COLUMN     "scoreGrade" TEXT,
ADD COLUMN     "scoredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "organization" ADD COLUMN     "crmSettings" JSONB;

-- CreateIndex
CREATE INDEX "lead_organizationId_score_idx" ON "lead"("organizationId", "score");
