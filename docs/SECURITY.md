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
* Email verification is required before sign-in (`REQUIRE_EMAIL_VERIFICATION`). Verification links expire after 24 hours.
* Password reset links are single-use and expire after 1 hour. A reset revokes every existing session. The reset request answers identically whether or not the email exists.
* Changing a password signs out other devices. Users can list and revoke sessions.
* Account deletion needs an emailed confirmation link opened in the user's own signed-in session. Sole owners of organizations with other members are blocked.
* An organization with a live paid subscription can't be deleted until the subscription is cancelled.
* Invitations expire after 7 days, require a verified email to accept, and count toward the plan's member limit.
* Google OAuth is enabled only when credentials are configured. Accounts are linked only when Google has verified the email.
* Email links always use the public web origin, and client-supplied callback URLs must be trusted origins. `?next=` redirects accept same-site relative paths only.
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

## AI providers
* Provider API keys exist only in the API process environment. The browser talks to `/api/v1/ai/*` only.
* Prompts and outputs are never logged. Metering stores token counts, cost, model and a normalised error kind, never provider error text or content.
* Plan credits are checked before every call. Generation endpoints have their own throttle (20/min).
* Generated images are written to private object storage under the organization's prefix and served through short-lived signed URLs.

## Payments
* Razorpay webhooks are verified with HMAC-SHA256 over the raw request body, compared in constant time. Invalid signatures get a 400.
* Every event is stored in `billing_event`, unique on (provider, eventId). Redelivered events are no-ops, and a failed event is retried by Razorpay because the endpoint returns non-2xx.
* Plans change only when the provider confirms (webhook), never because the browser reported success.
* Only owners hold `billing:manage`. Key secrets never leave the API; the browser receives only the public key id.

## Advertising & messaging safety
* No ad spend happens without explicit confirmation showing the account, objective and budget (Phase 11).
* WhatsApp and email require recorded opt-in consent, and opt-out is honoured immediately (Phase 14).

## Operations (Phase 21)
Nightly encrypted Postgres backups with restore drills, Redis AOF persistence for queues,
HTTPS-only, dependency scanning in CI, and documented data retention.
