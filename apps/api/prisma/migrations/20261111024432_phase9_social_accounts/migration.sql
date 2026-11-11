-- CreateEnum
CREATE TYPE "SocialConnectionStatus" AS ENUM ('ACTIVE', 'NEEDS_REAUTH', 'REVOKED');

-- CreateEnum
CREATE TYPE "SocialAccountStatus" AS ENUM ('ACTIVE', 'NEEDS_REAUTH', 'ERROR', 'DISCONNECTED');

-- CreateTable
CREATE TABLE "social_connection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "connectedById" TEXT,
    "externalUserId" TEXT NOT NULL,
    "displayName" TEXT,
    "accessTokenEncrypted" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT,
    "expiresAt" TIMESTAMP(3),
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "SocialConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastRefreshedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_account" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT,
    "avatarUrl" TEXT,
    "accountTokenEncrypted" TEXT,
    "capabilities" JSONB NOT NULL DEFAULT '{}',
    "status" "SocialAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastCheckedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "workspaceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "connectedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_webhook_event" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "object" TEXT,
    "objectId" TEXT,
    "field" TEXT,
    "payload" JSONB NOT NULL,
    "organizationId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "social_webhook_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "social_connection_organizationId_idx" ON "social_connection"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "social_connection_organizationId_provider_externalUserId_key" ON "social_connection"("organizationId", "provider", "externalUserId");

-- CreateIndex
CREATE INDEX "social_account_organizationId_status_idx" ON "social_account"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "social_account_organizationId_platform_externalId_key" ON "social_account"("organizationId", "platform", "externalId");

-- CreateIndex
CREATE INDEX "social_webhook_event_provider_receivedAt_idx" ON "social_webhook_event"("provider", "receivedAt");

-- AddForeignKey
ALTER TABLE "social_connection" ADD CONSTRAINT "social_connection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_connection" ADD CONSTRAINT "social_connection_connectedById_fkey" FOREIGN KEY ("connectedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_account" ADD CONSTRAINT "social_account_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_account" ADD CONSTRAINT "social_account_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "social_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_account" ADD CONSTRAINT "social_account_connectedById_fkey" FOREIGN KEY ("connectedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
