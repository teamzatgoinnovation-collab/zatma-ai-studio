-- AlterTable
ALTER TABLE "plan" ADD COLUMN     "razorpayPlanIdMonthly" TEXT,
ADD COLUMN     "razorpayPlanIdYearly" TEXT;

-- AlterTable
ALTER TABLE "subscription" ADD COLUMN     "graceUntil" TIMESTAMP(3),
ADD COLUMN     "pendingInterval" "BillingInterval",
ADD COLUMN     "pendingPlanId" TEXT,
ADD COLUMN     "providerCustomerId" TEXT,
ADD COLUMN     "trialReminderSentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "invoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "number" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "invoiceUrl" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "method" TEXT,
    "errorReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_event" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "organizationId" TEXT,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoice_externalId_key" ON "invoice"("externalId");

-- CreateIndex
CREATE INDEX "invoice_organizationId_issuedAt_idx" ON "invoice"("organizationId", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_externalId_key" ON "payment"("externalId");

-- CreateIndex
CREATE INDEX "payment_organizationId_createdAt_idx" ON "payment"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "billing_event_organizationId_idx" ON "billing_event"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "billing_event_provider_eventId_key" ON "billing_event"("provider", "eventId");

-- CreateIndex
CREATE INDEX "subscription_status_idx" ON "subscription"("status");

-- AddForeignKey
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_pendingPlanId_fkey" FOREIGN KEY ("pendingPlanId") REFERENCES "plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
