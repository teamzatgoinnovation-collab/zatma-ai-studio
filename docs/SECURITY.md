# Security

## Tenant isolation
* Every tenant table has `organizationId`. The tenant comes from the **session and membership**,
  never from request bodies, query strings or headers.
* `OrgGuard` verifies membership on every tenant-scoped request.
* The Prisma `tenantScoped` extension injects the tenant filter and throws on tenant-model
  queries made without a tenant context. Cross-tenant lookups return **404**.
* Automated e2e tests (`apps/api/test/tenant-isolation.e2e-spec.ts`) prove that Org A cannot read,
  update or delete Org B's resources. Every new tenant resource must add a case.

## Authentication
* Better Auth with scrypt password hashing, HTTP-only `SameSite=Lax` cookies (`Secure` in production),
  session rotation, and CSRF origin checks via `trustedOrigins`.
* Email verification and password reset are added in Phase 2. Google OAuth is enabled only when credentials are configured.
* Auth endpoints are rate-limited by Better Auth, and all others by `@nestjs/throttler`.

## Authorization
* Permission-based RBAC (`packages/types/src/permissions.ts`). Controllers declare required
  permissions, and `PermissionsGuard` denies by default when a handler declares none and is not
  `@Public()` or `@SessionOnly()`.
* `SUPER_ADMIN` is a platform role kept in a separate table (Phase 19). It is never granted through org membership.

## Secrets
* All secrets come from environment variables, validated at boot. `.env` is git-ignored and `.env.example` documents the variables.
* AI and payment provider keys exist only in the API process. Nothing is exposed to `NEXT_PUBLIC_*`.
* Third-party OAuth tokens (Meta, LinkedIn, …) are stored encrypted with AES-256-GCM under
  `TOKEN_ENCRYPTION_KEY`. They are never returned in API responses (Phase 9).

## Input & output
* All input is validated with Zod (shared schemas in `packages/validation`). Unknown keys are stripped.
* Prisma uses parameterised queries. Raw SQL is forbidden unless reviewed.
* Helmet sets security headers. CORS is an allow-list (`WEB_ORIGIN`). React escapes output, and any user HTML
  (landing pages, Phase 15) is sanitised server-side.

## File uploads
* Uploads use presigned PUT URLs to private buckets. The MIME allow-list is enforced, size is capped per plan, and keys are namespaced
  `org/<organizationId>/<uuid>`. Files are served through short-lived signed GET URLs.

## Auditing & logging
* An `AuditInterceptor` records every mutating request (actor, org, action, resource, IP).
* Structured logs come from Pino with request ids, and auth headers, cookies and tokens are redacted.

## Advertising & messaging safety
* No ad spend happens without explicit confirmation showing the account, objective and budget (Phase 11).
* WhatsApp and email require recorded opt-in consent, and opt-out is honoured immediately (Phase 14).

## Operations (Phase 21)
Nightly encrypted Postgres backups with restore drills, Redis AOF persistence for queues,
HTTPS-only, dependency scanning in CI, and documented data retention.
