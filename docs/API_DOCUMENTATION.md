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
