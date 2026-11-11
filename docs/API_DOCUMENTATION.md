# API Documentation

Live, always-current reference: **Swagger UI at `GET /api/docs`** (JSON at `/api/docs-json`)
when the API is running. This document covers conventions only.

## Base URLs
| Env | API | Auth |
|---|---|---|
| Local | `http://localhost:4000/api/v1` | `http://localhost:4000/api/auth/*` |
| Production (planned) | `https://api.marketing.zatgoinnovation.com/api/v1` | `…/api/auth/*` |

The web app reaches the API through a same-origin rewrite (`/api/*` → API) so session cookies
stay first-party.

## Authentication
* Sessions are managed by **Better Auth** and stored in an HTTP-only cookie (`zatma.session_token`).
* Auth endpoints (served by Better Auth under `/api/auth`) include:
  `POST /sign-up/email`, `POST /sign-in/email`, `POST /sign-out`, `GET /get-session`,
  `POST /organization/create`, `POST /organization/set-active`, `GET /organization/list`, …
* Everything under `/api/v1` requires a valid session unless marked `@Public()`.
* Tenant-scoped endpoints also require an **active organization** on the session. Without one they return
  `403 { code: "NO_ACTIVE_ORGANIZATION" }`.

## Versioning
URI versioning: `/api/v1/...`. Breaking changes ship under `/api/v2` and the old version is kept in parallel.

## Error envelope
Every non-2xx response has this shape:
```json
{
  "statusCode": 404,
  "code": "NOT_FOUND",
  "message": "Workspace not found",
  "details": null,
  "path": "/api/v1/workspaces/abc",
  "timestamp": "2026-11-09T10:00:00.000Z",
  "requestId": "6f1c…"
}
```
Validation errors use `400` with `code: "VALIDATION_ERROR"` and `details` = Zod issues.

## Pagination
List endpoints accept `?page=1&pageSize=20` (max 100) and return:
```json
{ "data": [ ... ], "meta": { "page": 1, "pageSize": 20, "total": 134, "totalPages": 7 } }
```

## Rate limiting
The default is 120 requests/minute per IP (`@nestjs/throttler`). Auth endpoints have their own
stricter limits from Better Auth. A request over the limit gets `429` with `code: "RATE_LIMITED"`.

## Phase 1 endpoints

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/api/v1/health` | public | DB + Redis health |
| GET | `/api/v1/users/me` | session | Current user + memberships |
| PATCH | `/api/v1/users/me` | session | Update name, locale, timezone |
| GET | `/api/v1/organizations/current` | `organization:read` | Active org profile + role + plan |
| PATCH | `/api/v1/organizations/current` | `organization:update` | Update org profile |
| GET | `/api/v1/organizations/current/members` | `member:read` | Members of the active org |
| GET | `/api/v1/workspaces` | `workspace:read` | List workspaces (paginated) |
| POST | `/api/v1/workspaces` | `workspace:create` | Create workspace |
| GET | `/api/v1/workspaces/:id` | `workspace:read` | Get workspace (404 across tenants) |
| PATCH | `/api/v1/workspaces/:id` | `workspace:update` | Update workspace |
| DELETE | `/api/v1/workspaces/:id` | `workspace:delete` | Delete workspace |
| GET | `/api/v1/audit-logs` | `audit:read` | Org audit trail (paginated) |
| POST | `/api/v1/storage/uploads` | `file:upload` | Presigned upload URL (type/size validated) |
| GET | `/api/v1/billing/plans` | public | Plan catalogue |
| GET | `/api/v1/billing/subscription` | `billing:read` | Active org subscription |
| GET | `/api/v1/ai/providers` | `ai:read` | Registered AI providers & configuration status |

## Phase 2 endpoints

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/api/v1/auth/providers` | public | Enabled sign-in methods (email, Google) and whether verification is required |
| GET | `/api/v1/users/me/deletion-eligibility` | session | Whether the account can be deleted (sole-owner check) |
| GET | `/api/v1/organizations/current/invitations` | `member:read` | Pending invitations |
| GET | `/api/v1/organizations/invitations/:id` | public | Minimal invitation details for the accept page |
| PUT | `/api/v1/organizations/current/logo` | `organization:update` | Set the logo to an uploaded `LOGO` image |
| DELETE | `/api/v1/organizations/current/logo` | `organization:update` | Remove the logo |
| POST | `/api/v1/storage/uploads/:id/complete` | `file:upload` | Confirm a presigned upload (verifies size and type) |
| GET | `/api/v1/files/:id/url` | `file:read` | 5-minute signed download URL |
| GET | `/api/v1/billing/subscription` | `billing:read` | Status, period, trial, pending change, `billingEnabled` |
| GET | `/api/v1/billing/usage` | `billing:read` | Usage against plan limits |
| GET | `/api/v1/billing/invoices` | `billing:read` | Invoices (paginated) |
| POST | `/api/v1/billing/checkout` | `billing:manage` | Start a Razorpay subscription and return Checkout parameters |
| POST | `/api/v1/billing/change-plan` | `billing:manage` | Upgrades apply immediately; downgrades apply at period end (blocked with `409 PLAN_LIMIT_EXCEEDED` if usage is over the target plan's limits) |
| POST | `/api/v1/billing/cancel` | `billing:manage` | Cancel at period end, or end a trial immediately |
| POST | `/api/v1/billing/webhooks/razorpay` | signature | Razorpay webhook receiver |
| GET | `/api/v1/dev/emails?to=` | dev only | Captured emails (not registered in production) |

**Better Auth endpoints used by the web app** (under `/api/auth`):
* Account: `send-verification-email`, `verify-email`, `request-password-reset`, `reset-password`, `change-password`, `list-sessions`, `revoke-session`, `delete-user` (+ `/callback`), `sign-in/social`.
* Organizations: `organization/invite-member`, `accept-invitation`, `reject-invitation`, `cancel-invitation`, `update-member-role`, `remove-member`, `delete`, `set-active`, `list`.

New error codes:
* `PLAN_LIMIT_REACHED` (402)
* `PLAN_LIMIT_EXCEEDED`, `CHECKOUT_REQUIRED`, `SUBSCRIPTION_EXISTS`, `NOTHING_TO_CANCEL` (409)
* `BILLING_NOT_CONFIGURED`, `PLAN_NOT_CONFIGURED` (503)
* `INVALID_SIGNATURE` (400)
* `UPLOAD_MISSING` (409), `UPLOAD_MISMATCH` (422), `INVALID_LOGO` (422)
* `SOLE_OWNER`, `ACTIVE_SUBSCRIPTION`, `EMAIL_NOT_VERIFIED` (from Better Auth)

## Phase 4 endpoints

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/api/v1/ai/providers` | `ai:read` | Providers, whether active, default models. Keys are never returned |
| GET | `/api/v1/ai/settings` | `ai:read` | Preferred providers and effective fallback order |
| PATCH | `/api/v1/ai/settings` | `organization:update` | `{ textProvider?, imageProvider? }` (`null` = platform default) |
| POST | `/api/v1/ai/text` | `ai:generate` | Synchronous text generation (`prompt`, `system?`, `language?`, `responseFormat?`, `maxOutputTokens ≤ 8000`, `provider?`, `purpose`). Throttled to 20/min |
| POST | `/api/v1/ai/jobs` | `ai:generate` | Queue `{ type: 'TEXT' \| 'IMAGE', input }`, returning `202` with the job. Throttled to 20/min |
| GET | `/api/v1/ai/jobs` / `/api/v1/ai/jobs/:id` | `ai:read` | Job status and output. Images come back as 5-minute signed URLs |
| GET | `/api/v1/ai/usage` | `ai:read` | Credits used and limit this period, a per-provider breakdown, and recent requests |

Error codes:
* `AI_PROVIDER_UNAVAILABLE` (503): no provider is configured.
* `AI_PROVIDERS_FAILED` (503): every provider failed.
* `AI_CONTENT_REFUSED` (422): declined by the safety filters.
* `AI_REQUEST_REJECTED` (422): the provider rejected the request as invalid.
* `AI_PROVIDER_NOT_AVAILABLE` (422): the preferred provider isn't configured.
* `PLAN_LIMIT_REACHED` (402): the plan's AI credits are used up.

## Phase 5 endpoints

Brand kits, designs and templates are tenant-scoped. Another organization's ids return `404`.

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/api/v1/brand-kits` | `design:read` | Brand kits, default first. `logoUrl` is a short-lived signed URL |
| GET | `/api/v1/brand-kits/:id` | `design:read` | One brand kit |
| POST | `/api/v1/brand-kits` | `design:write` | Create (`name`, `colors`, `fonts`, `logoFileId?`, contact details, `guidelines?`). The first kit becomes the default. Max 20 |
| PATCH | `/api/v1/brand-kits/:id` | `design:write` | Partial update |
| POST | `/api/v1/brand-kits/:id/default` | `design:write` | Make this the organization's default |
| DELETE | `/api/v1/brand-kits/:id` | `design:write` | Delete. If it was the default, the oldest remaining kit becomes default |
| GET | `/api/v1/designs` | `design:read` | Paginated library (`page`, `pageSize`, `q`, `workspaceId`) with thumbnail URLs |
| POST | `/api/v1/designs` | `design:write` | Blank design from a preset, or from a template (`templateId`) |
| POST | `/api/v1/designs/generate` | `design:write` + `ai:generate` | `{ prompt, sizePreset, language, brandKitId?, aiBackground, occasion? }` → `202 { design, jobId }` with status `GENERATING`. Poll `GET /designs/:id`. Throttled to 10/min |
| GET | `/api/v1/designs/:id` | `design:read` | Document, caption, hashtags, status, error, `revision`, and `assets` (fileId → signed URL) |
| PATCH | `/api/v1/designs/:id` | `design:write` | `{ revision, title?, document? }`. Stale revision → `409 REVISION_CONFLICT` with `currentRevision` |
| POST | `/api/v1/designs/:id/duplicate` | `design:write` | Copy as a new design |
| DELETE | `/api/v1/designs/:id` | `design:write` | Soft delete |
| PUT | `/api/v1/designs/:id/thumbnail` | `design:write` | `{ fileId }` of an uploaded image (purpose `THUMBNAIL`) |
| GET | `/api/v1/designs/:id/versions` | `design:read` | Saved versions, newest first |
| POST | `/api/v1/designs/:id/versions` | `design:write` | Save a snapshot `{ note? }` |
| POST | `/api/v1/designs/:id/versions/:versionId/restore` | `design:write` | Restore a snapshot (bumps the revision and records a new version) |
| POST | `/api/v1/designs/:id/save-as-template` | `design:write` | `{ name, category }` |
| GET | `/api/v1/templates` | `design:read` | Organization templates |
| DELETE | `/api/v1/templates/:id` | `design:write` | Delete a template |

Error codes:
* `REVISION_CONFLICT` (409): the design changed since it was loaded.
* `DESIGN_GENERATING` (409): the design can't be edited while it's being generated.
* `DESIGN_NOT_READY` (409): only finished designs can become templates.
* `SIZE_MISMATCH` (422): the document's size doesn't match the design.
* `INVALID_ASSET` (422): a referenced file isn't an uploaded image of this organization.
* `AI_PROVIDER_UNAVAILABLE` (503), `PLAN_LIMIT_REACHED` (402): as in Phase 4.
* A generation failure is reported on the design (`status: FAILED`, `error.code`, for example `AI_BRIEF_INVALID`).

## Phase 6 endpoints

| Method | Path | Permission | Description |
|---|---|---|---|
| POST | `/api/v1/copy/generate` | `copy:write` + `ai:generate` | `{ kind, brief, language, tone, platform, goal, audience?, keywords[], brandKitId?, variants 1–5, includeEmojis, includeHashtags }` → `{ variants: [{ text, hashtags, limits }], provider, model, credits }`. Nothing is saved. Throttled to 20/min |
| POST | `/api/v1/copy/translate` | `copy:write` + `ai:generate` | `{ text, hashtags[], sourceLanguage?, targetLanguages[1–6], tone? }` → `{ translations: [{ language, text, hashtags, warnings[] }] }`. Warnings list numbers, phone numbers or URLs that changed |
| POST | `/api/v1/copy/rewrite` | `copy:write` + `ai:generate` | `{ text, language, action: shorter \| longer \| more_formal \| more_casual \| more_persuasive \| add_emojis \| remove_emojis \| custom, instruction? }` → `{ text }` |
| GET | `/api/v1/copy-assets` | `copy:read` | Saved copy, favourites first (`page`, `pageSize`, `q`, `kind`, `language`, `favorite=true\|false`, `workspaceId`) |
| GET | `/api/v1/copy-assets/:id` | `copy:read` | One saved item |
| POST | `/api/v1/copy-assets` | `copy:write` | Save `{ kind, content, hashtags[], language, platform, tone?, goal?, audience?, brief?, variants[]?, brandKitId?, sourceDesignId?, favorite }` |
| PATCH | `/api/v1/copy-assets/:id` | `copy:write` | `{ content?, hashtags?, favorite? }` |
| DELETE | `/api/v1/copy-assets/:id` | `copy:write` | Soft delete |
| POST | `/api/v1/designs/:id/translate` | `design:write` + `ai:generate` | `{ language }` → the new translated design (`201`). Text layers, caption and hashtags are localised; fonts, direction and sizes adapt |

Every `limits` object reports:
* `count`: user-perceived characters.
* `recommended` and `max`: the soft recommendation and the hard platform limit.
* `long` and `overLimit`: whether the text exceeds each.
* `hashtagCount` and `maxHashtags`.
* `sms`: the encoding and number of segments, for SMS copy.

Error codes:
* `AI_OUTPUT_INVALID` (422): the AI reply was unusable after one repair attempt.
* `SAME_LANGUAGE` (422): the design is already in that language.
* `NOTHING_TO_TRANSLATE` (422): the design has no text to translate.
* `DESIGN_GENERATING` (409): the design is still being generated.
* `AI_PROVIDER_UNAVAILABLE` (503) and `PLAN_LIMIT_REACHED` (402): as in Phase 4.

## Phase 7 endpoints

All CRM routes are under `/api/v1/crm` and scoped to the organization.

**Who sees what:**
* **Sales Agents** (`crm:write` without `crm:delete`) only see and change records they own. Other records return `404`.
* Managers (`crm:delete`) and read-only roles see everything.

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/crm/summary` | `crm:read` | Leads by status, open pipeline value, won this month, follow-ups due today and overdue |
| GET / POST | `/crm/leads` | read / write | List (`q`, `status`, `source`, `ownerId`, `tag`, `sort`, `order`, `page`, `pageSize`) / create. A duplicate email or phone → `409 DUPLICATE_RECORD` unless `allowDuplicate: true` |
| GET | `/crm/leads/duplicates` | read | `?email&phone&excludeLeadId&excludeContactId` → matching leads and contacts |
| GET | `/crm/leads/export.csv` | read | CSV of the filtered list (formula-safe, UTF-8 BOM) |
| POST | `/crm/leads/bulk` | write | `{ ids, action: assign \| status \| tag \| delete, … }` (delete needs `crm:delete`) |
| GET / PATCH / DELETE | `/crm/leads/:id` | read / write / delete | Get, update, soft delete |
| GET | `/crm/leads/:id/timeline` | read | Activities and deals |
| POST | `/crm/leads/:id/convert` | write | `{ createCompany, createDeal, dealName?, dealValue?, pipelineId? }` → `{ lead, contact, deal }` |
| GET / POST | `/crm/contacts` | read / write | List (`lifecycle`, `companyId`, …) / create |
| GET | `/crm/customers` | read | Contacts with lifecycle CUSTOMER and their `wonValue` |
| GET / PATCH / DELETE | `/crm/contacts/:id` | read / write / delete | Contact, plus `/timeline` and `/export.csv` on the collection |
| GET / POST | `/crm/companies` | read / write | List / create (also `/export.csv`) |
| GET / PATCH / DELETE | `/crm/companies/:id` | read / write / delete | Company, plus `/timeline` (activities, deals, contacts) |
| GET / POST | `/crm/pipelines` | read / delete | Pipelines with stages (the default is created on first use) / create |
| GET | `/crm/pipelines/:id/board` | read | Kanban columns with deals, counts and totals (`ownerId`, `q`) |
| PATCH / DELETE | `/crm/pipelines/:id` | delete | Rename or make default / delete (empty, non-default) |
| POST / PATCH / DELETE | `/crm/pipelines/:id/stages[/:stageId]` | delete | Add, edit, delete (`?moveDealsTo=` when not empty). Reorder with `POST …/stages/reorder { stageIds }` |
| GET / POST | `/crm/deals` | read / write | List (`status`, `pipelineId`, `stageId`, `contactId`, `companyId`, …) / create (also `/export.csv`) |
| GET / PATCH / DELETE | `/crm/deals/:id` | read / write / delete | Deal, plus `/timeline` |
| POST | `/crm/deals/:id/move` | write | `{ stageId, beforeId?, lostReason? }`. Won and Lost stages close the deal; Lost needs a reason (`LOST_REASON_REQUIRED`) |
| GET / POST | `/crm/activities` | read / write | List (`type`, `status`, `ownerId`, record ids, `q`) / create (linked to at least one record; tasks and follow-ups need `dueAt`) |
| PATCH / DELETE | `/crm/activities/:id` | write | Update or complete (`completed: true`) / delete |
| GET | `/crm/follow-ups` | read | `?range=overdue\|today\|week\|all&owner=me\|all&tz=` open items by due date |
| POST | `/crm/import/preview` | write | `{ fileId, entity }` → headers, sample rows, row count, suggested mapping |
| POST | `/crm/import` | write | `{ fileId, entity, mapping, dedupe: skip\|update\|create, tag? }` → `202` job |
| GET | `/crm/import/:id` | read | `{ status, total, processed, created, updated, skipped, errors[] }` |

Error codes:
* `DUPLICATE_RECORD` (409, `details.duplicates`).
* `ALREADY_CONVERTED` (409).
* `CANNOT_ASSIGN` (403, a Sales Agent assigning to someone else).
* `INVALID_OWNER` (422).
* `NOT_OWNER` (403, editing a colleague's company).
* `STAGE_NOT_EMPTY`, `STAGE_REQUIRED`, `DEFAULT_PIPELINE`, `PIPELINE_NOT_EMPTY` (409).
* `INVALID_STAGE`, `LOST_REASON_REQUIRED` (422).
* `INVALID_FILE`, `FILE_TOO_LARGE`, `INVALID_CSV`, `INVALID_MAPPING` (422).
* `PLAN_LIMIT_REACHED` (402, metric `crmRecords`).

## Phase 8 endpoints

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/crm/leads?sort=score&grade=HOT\|WARM\|COLD` | `crm:read` | Leads sorted by score (empty scores last) and filtered by grade. Items include `score`, `scoreGrade` and `scoreReason` (top reasons) |
| GET | `/crm/leads/:id/score` | `crm:read` | `{ score, grade, signals: [{ key, label, points, detail }], reason, scoredAt }`, recomputed for today |
| GET | `/crm/leads/:id/insights` | `crm:read` | `{ insights: LeadInsights \| null }` (last generated) |
| POST | `/crm/leads/:id/insights` | `crm:write` + `ai:generate` | `{ language? }` → `{ summary, nextBestAction: { action, reason, when }, talkingPoints[], followUpMessage: { channel, subject?, text }, language, generatedAt, provider, model, credits }`. Throttled to 20/min; metered as `crm` |
| POST | `/crm/contacts/:id/draft-message` | `crm:write` + `ai:generate` | `{ channel: whatsapp\|email\|sms, goal: follow_up\|reengage\|thank_you\|meeting_request\|offer, language?, context? }` → `{ subject, text, … }`. Nothing is sent |
| GET | `/crm/scoring/settings` | `crm:read` | `{ weights, targetIndustries, targetCities, decisionMakerKeywords, hotThreshold, warmThreshold }` (defaults when not set) |
| PATCH | `/crm/scoring/settings` | `crm:delete` | Replace the settings (weights 0–3; warm must be below hot) |
| POST | `/crm/scoring/recalculate` | `crm:delete` | `202 { queued: true }`: rescores every lead of the organization |

`GET /crm/summary` also returns `leadsByGrade` and `callFirst` (the top five open leads by score, scoped to what the user can see).

Error codes: `AI_PROVIDER_UNAVAILABLE` (503), `PLAN_LIMIT_REACHED` (402), `AI_OUTPUT_INVALID` (422).

## Phase 9 endpoints

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/social/providers` | `social:read` | `[{ id: meta\|linkedin\|google, name, platforms[], configured, unavailableReason, scopes[], redirectUri }]` |
| POST | `/social/connect/:provider` | `social:connect` | `{ returnTo?: "/path", reconnectConnectionId? }` → `{ authorizeUrl }`. Navigate the browser there. Throttled to 20/min. `503 SOCIAL_PROVIDER_NOT_CONFIGURED` when keys are missing |
| GET | `/social/oauth/:provider/callback` | public (session checked) | Platform redirect target. Validates the single-use state against the signed-in user, stores the encrypted grant, then 302s to `WEB_URL{returnTo}?connection=<id>` or `?error=access_denied\|invalid_state\|provider_error\|not_configured&provider=` |
| GET | `/social/connections/:id/available` | `social:connect` | Pages, Instagram accounts, LinkedIn Pages or channels the grant can manage: `[{ platform, externalId, name, username, avatarUrl, alreadyAdded }]` |
| GET | `/social/accounts` | `social:read` | `SocialAccountDto[]`: `{ id, platform, externalId, name, username, avatarUrl, status: ACTIVE\|NEEDS_REAUTH\|ERROR\|DISCONNECTED, lastCheckedAt, lastError, workspaceIds[], connection: { id, provider, displayName, status, expiresAt, scopes }, connectedBy }`. No tokens |
| POST | `/social/accounts` | `social:connect` | `{ connectionId, externalIds[], workspaceIds? }` → the added accounts (upsert; `402 PLAN_LIMIT_REACHED`, `422 ACCOUNT_NOT_AVAILABLE`, `404` for unknown workspaces) |
| PATCH | `/social/accounts/:id` | `social:connect` | `{ workspaceIds[] }` (empty means every workspace) |
| POST | `/social/accounts/:id/check` | `social:connect` | Runs a health check now (refreshing the grant first if it is about to expire) and returns the account |
| DELETE | `/social/accounts/:id` | `social:connect` | 204. Revokes and deletes the grant when no other account uses it |
| GET | `/social/webhooks/meta` | public | Meta verification challenge (`hub.verify_token`) |
| POST | `/social/webhooks/meta` | public, signed | `X-Hub-Signature-256` over the raw body; events are stored in `social_webhook_event`. `permissions` revocations mark grants REVOKED |
| POST | `/social/meta/deauthorize` | public, `signed_request` | Marks the person's grants REVOKED |
| POST | `/social/meta/data-deletion` | public, `signed_request` | Deletes the person's grants and accounts → `{ url, confirmation_code }` |
| GET | `/social/meta/data-deletion/:code` | public | Deletion status page for Meta |

Error codes: `SOCIAL_PROVIDER_NOT_CONFIGURED` (503), `SOCIAL_REAUTH_REQUIRED` (409), `SOCIAL_PROVIDER_ERROR` (502), `ACCOUNT_NOT_AVAILABLE` (422), `INVALID_SIGNATURE` (401), `INVALID_SIGNED_REQUEST` (400).

## Phase 10 endpoints

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/social/settings` | `social:read` | `{ requireApproval, canPublish, canDraft }` |
| PATCH | `/social/settings` | `social:publish` + `organization:update` | `{ requireApproval }` |
| GET | `/social/posts?status&platform&workspaceId&q&page&pageSize` | `social:read` | Paginated `SocialPostDto` (targets, per-account status and results, first-media preview URL) |
| POST | `/social/posts/validate` | `social:draft` | Dry run: `{ caption, hashtags, media, targets }` → `{ ok, targets: [{ platform, socialAccountId, issues: [{ level, code, message }] }] }` |
| POST | `/social/posts` | `social:draft` | `{ workspaceId, caption, hashtags[], media: [{ fileId, kind, mimeType, width, height, durationSec?, sizeBytes, altText? }], targets: [{ socialAccountId, captionOverride?, options?: { title, privacy, madeForKids } }], sourceDesignId?, copyAssetId? }` → draft |
| GET / PATCH / DELETE | `/social/posts/:id` | read / `social:draft` | Edit until publishing starts (drafters only their own drafts). Delete removes the post from ZatGo only (already-published posts stay on the platforms) |
| POST | `/social/posts/:id/duplicate` | `social:draft` | Copy into a new draft |
| POST | `/social/posts/:id/submit` | `social:draft` | Draft → `PENDING_APPROVAL` (must pass validation) |
| POST | `/social/posts/:id/approve` | `social:publish` | `{ note? }`; emails the author. `403 SELF_APPROVAL_NOT_ALLOWED` when approval is required |
| POST | `/social/posts/:id/reject` | `social:publish` | `{ note }` (required); back to draft, emails the author |
| POST | `/social/posts/:id/schedule` | `social:publish` | `{ scheduledAt (ISO with offset), timezone (IANA) }`; in the future, at most 6 months ahead. Re-scheduling replaces the job |
| POST | `/social/posts/:id/publish` | `social:publish` | `{ confirm: true }` required. Publishes now through the queue |
| POST | `/social/posts/:id/cancel` | `social:publish` | Scheduled → draft |
| POST | `/social/posts/:id/targets/:targetId/retry` | `social:publish` | Retries one failed account |
| GET | `/social/calendar?from&to&workspaceId&platform&status` | `social:read` | Up to 62 days: `[{ id, status, at, caption, thumbnailUrl, platforms, accounts }]` |

Statuses:
* Post: `DRAFT`, `PENDING_APPROVAL`, `SCHEDULED`, `PUBLISHING`, `PUBLISHED`, `PARTIALLY_PUBLISHED`, `FAILED`.
* Per account: `PENDING`, `PUBLISHING`, `PUBLISHED`, `FAILED`.

Error codes: `POST_INVALID` (422, with per-target issues), `NO_TARGETS`, `ACCOUNT_NOT_IN_WORKSPACE`, `MEDIA_NOT_FOUND`, `ACCOUNT_NEEDS_ATTENTION` (409), `APPROVAL_REQUIRED` (409), `POST_LOCKED` (409), `INVALID_STATUS` (409), `SCHEDULE_IN_PAST`, `SCHEDULE_TOO_FAR`, `PLAN_LIMIT_REACHED` (402, metric `postsPerMonth`).

Uploads: `POST /storage/uploads` accepts `purpose: POST_MEDIA` for JPEG, PNG, WebP (up to 20 MB) and MP4 or MOV (up to 250 MB).
