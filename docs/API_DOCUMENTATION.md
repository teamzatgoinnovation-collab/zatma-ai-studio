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
