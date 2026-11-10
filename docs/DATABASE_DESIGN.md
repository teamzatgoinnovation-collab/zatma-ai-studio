# Database Design

PostgreSQL 16 with Prisma 7. Conventions:

* Primary keys are `String @id` holding cuid/uuid-style ids (Better Auth generates ids for its own tables).
* Every **tenant-owned** table has `organizationId String` + `@@index([organizationId])` and an
  `onDelete: Cascade` relation to `Organization`.
* `createdAt` / `updatedAt` on every table. Soft delete (`deletedAt`) is used only where history
  matters (CRM records, campaigns).
* Money is stored as `Decimal(14,2)` + an ISO-4217 `currency`. AI cost is stored as integer micro-USD.
* Secrets (OAuth tokens) are stored encrypted (`*Encrypted` columns, AES-256-GCM).

Status legend: ✅ implemented · 🕓 planned (phase)

## Identity & tenancy

| Table | Status | Key fields |
|---|---|---|
| `user` | ✅ P1 | id, name, email (unique), emailVerified, image, locale, timezone |
| `session` | ✅ P1 | id, token (unique), userId, expiresAt, ipAddress, userAgent, **activeOrganizationId** |
| `account` | ✅ P1 | id, userId, providerId, accountId, password (hash), OAuth tokens |
| `verification` | ✅ P1 | identifier, value, expiresAt |
| `organization` | ✅ P1 | id, name, slug (unique), logo, website, industry, timezone, defaultLanguage, currency, metadata, aiSettings (P4: preferred providers) |
| `member` | ✅ P1 | id, organizationId, userId, role; unique(organizationId,userId) |
| `invitation` | ✅ P1 | id, organizationId, email, role, status, expiresAt, inviterId |
| `workspace` | ✅ P1 | id, organizationId, name, description, isDefault |
| `audit_log` | ✅ P1 | id, organizationId?, actorId?, action, resourceType, resourceId, metadata, ip, createdAt |
| `platform_admin` | 🕓 P19 | userId; super admin is separate from org roles |

## Billing & usage

| Table | Status | Key fields |
|---|---|---|
| `plan` | ✅ P1 (seeded), P2 | code (FREE/STARTER/PROFESSIONAL/BUSINESS/AGENCY), name, priceMonthly, priceYearly, currency, limits (JSON: aiCredits, storageMb, members, socialAccounts, workspaces), razorpayPlanIdMonthly/Yearly |
| `subscription` | ✅ P2 | organizationId (unique), planId, status, interval, provider, externalId, providerCustomerId, currentPeriodStart/End, trialEndsAt, trialReminderSentAt, cancelAtPeriodEnd, pendingPlanId/pendingInterval (scheduled downgrade), graceUntil |
| `invoice` | ✅ P2 | organizationId, subscriptionId, provider, externalId (unique), number, amount, currency, status, periodStart/End, invoiceUrl, issuedAt |
| `payment` | ✅ P2 | organizationId, invoiceId, provider, externalId (unique), amount, currency, status, method, errorReason |
| `billing_event` | ✅ P2 | provider + eventId (unique, idempotency), type, organizationId, payload, processedAt, error. Platform-level |
| `ai_usage` | ✅ P1, P4 | organizationId, userId?, capability (TEXT/IMAGE/VIDEO/EMBEDDING), provider, model, inputTokens, outputTokens, units, costMicroUsd, credits, status, purpose, jobId, errorKind, latencyMs. One row per provider attempt |
| `stored_file` | ✅ P1 | organizationId, uploadedById, key (unique), bucket, mimeType, sizeBytes, purpose, status |

## AI Studio

| Table | Phase | Key fields |
|---|---|---|
| `brand_kit` | ✅ P5 | organizationId, workspaceId?, name, isDefault, logoFileId?, colors (JSON: primary/secondary/accent/background/text), fonts (JSON: heading/body), tagline, website, phone, whatsapp, email, address, guidelines |
| `design` | ✅ P5 | organizationId, workspaceId, brandKitId?, title, prompt, sizePreset, width, height, language, document (JSON layers), revision, status (DRAFT/GENERATING/READY/FAILED), generationOptions, generationJobId, thumbnailFileId, caption, hashtags[], errorCode/errorMessage, createdById, deletedAt |
| `design_version` | ✅ P5 | organizationId, designId, revision, document, note, createdById |
| `template` | ✅ P5 | organizationId, name, category, sizePreset, width, height, document, thumbnailFileId, createdById (global templates: Phase 19) |
| `generation_job` | ✅ P4 | organizationId, userId, type, status (QUEUED/RUNNING/SUCCEEDED/FAILED), purpose, input, output (text or fileIds), errorCode/errorMessage, provider, model, credits, timestamps |
| `copy_asset` | ✅ P6 | organizationId, workspaceId, kind, content, hashtags[], language, tone, platform, goal, audience, brief, variants (JSON), favorite, brandKitId?, sourceDesignId?, campaignId? (FK in P12), createdById, deletedAt |
| `video` | P16 | organizationId, script, storyboard, fileId, status, durationSec |

## CRM (Phase 7)

| Table | Key fields |
|---|---|
| `lead` ✅ | organizationId, firstName, lastName, email/emailNormalized, phone/phoneNormalized, whatsapp, jobTitle, company, website, industry, city, country, status, source, sourceDetail, notes, tags[], customFields, ownerId, score/scoreReason (P8), lastContactedAt, nextFollowUpAt, convertedContactId/DealId/At, deletedAt |
| `contact` ✅ | organizationId, companyId?, firstName, lastName, email/phone (+ normalized), whatsapp, jobTitle, lifecycle (LEAD/PROSPECT/CUSTOMER/CHURNED), source, notes, tags[], customFields, ownerId, lastContactedAt, nextFollowUpAt, consent (P14), deletedAt |
| `company` ✅ | organizationId, name, nameNormalized, website, industry, size, phone, email, address, city, country, tags[], customFields, ownerId, deletedAt |
| `pipeline`, `pipeline_stage` ✅ | organizationId, name, isDefault / pipelineId, name, order, probability, kind (OPEN/WON/LOST) |
| `deal` ✅ | organizationId, name, value Decimal(14,2), currency, pipelineId, stageId, position (float), probability, status (OPEN/WON/LOST), lostReason, expectedCloseAt, closedAt, source, contactId?, companyId?, leadId?, tags[], notes, ownerId, deletedAt |
| `activity` ✅ | organizationId, type (CALL/EMAIL/MEETING/WHATSAPP/NOTE/TASK/FOLLOW_UP), subject, body, dueAt, completedAt, priority, outcome, ownerId, createdById, leadId/contactId/companyId/dealId, deletedAt |
| `crm_import` ✅ | organizationId, userId, entity, fileId, options, status, total/processed/created/updated/skipped, errors (JSON), error |
| `segment` | organizationId, name, definition (JSON filter) (planned, P12/P14) |
| `consent` | organizationId, contactId, channel, status, source, capturedAt (planned, P14 compliance) |

## Marketing, social & ads (planned)

| Table | Phase | Key fields |
|---|---|---|
| `social_account` | P9 | organizationId, platform, externalId, name, accessTokenEncrypted, refreshTokenEncrypted, expiresAt, scopes, status |
| `social_post` | P10 | organizationId, campaignId?, caption, mediaFileIds, status, scheduledAt, timezone |
| `social_post_target` | P10 | postId, socialAccountId, externalPostId, status, error, publishedAt |
| `ad_account`, `ad_campaign`, `ad_set`, `ad` | P11 | organizationId, platform ids, objective, budget, status (mirrors the platform) |
| `campaign` | P12 | organizationId, name, type, objective, audience, startAt, endAt, budget, status, ownerId |
| `automation`, `automation_node`, `automation_run`, `automation_run_step` | P13 | graph JSON, trigger, run logs |
| `email_template`, `email_campaign`, `email_event` | P14 | |
| `whatsapp_template`, `whatsapp_message` | P14 | |
| `landing_page`, `form`, `form_submission` | P15 | |
| `metric_daily` | P17 | organizationId, source, entityType, entityId, date, metrics (JSON) |
| `notification` | P18 | organizationId, userId, type, payload, readAt |
| `comment` | P18 | organizationId, resourceType, resourceId, authorId, body |

## Phase 1 ER summary

```
user 1─* member *─1 organization 1─* workspace
user 1─* session (activeOrganizationId → organization)
user 1─* account
organization 1─* invitation
organization 1─1 subscription *─1 plan
organization 1─* ai_usage, stored_file, audit_log
```
