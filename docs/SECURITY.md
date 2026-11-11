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
* Third-party OAuth tokens (Meta, LinkedIn, YouTube) are stored encrypted (see *Social account tokens*). They are never
  returned in API responses or written to logs.

## Input & output
* All input is validated with Zod (shared schemas in `packages/validation`). Unknown keys are stripped.
* Prisma uses parameterised queries. Raw SQL is forbidden unless reviewed.
* Helmet sets security headers. CORS is an allow-list (`WEB_ORIGIN`). React escapes output, and any user HTML
  (landing pages, Phase 15) is sanitised server-side.

## CRM data (Phase 7)

* **Ownership scoping:** Sales Agents see and change only the leads, contacts, deals and activities they own. This is enforced in every query (`ownerScope()`), not just in the UI, and out-of-scope ids return 404. Only managers can assign owners, and only to members of the organization.
* **CSV import:**
  * Only uploaded files of the same organization are read.
  * Files are limited to 2 MB and 5,000 rows, and parsed server-side by a strict RFC 4180 parser.
  * Every row is validated with the same Zod schemas as the API.
  * Imports run with the importing user's role.
* **CSV export:** cells starting with `=`, `+`, `-`, `@`, tab or CR are prefixed with `'` so spreadsheets don't run them as formulas (CSV injection). Exports respect the user's filters and visibility.
* **WhatsApp:** the CRM only builds `wa.me` click-to-chat links. Messages are sent from the user's own app until the WhatsApp Business API integration (Phase 14), which will add consent tracking.

## AI on CRM data (Phase 8)

* Prompts for insights and drafted messages contain only the requesting organization's own record (lead or contact fields, recent activity subjects and bodies, score signals) and its brand kit. Ownership scoping applies before anything is sent, so Sales Agents cannot generate insights for colleagues' leads.
* AI output is advisory. It cannot change scores, statuses or owners, and messages are never sent automatically.
* Calls are metered (purpose `crm`) against the plan's AI credits, and throttled to 20/min per client.

## Social account tokens (Phase 9)
* **Encryption at rest:** AES-256-GCM with a random 96-bit IV per value, stored as `v1.<kid>.<iv>.<tag>.<ciphertext>`.
  * Keys come from `TOKEN_ENCRYPTION_KEYS` (`kid:base64(32 bytes)`, comma-separated). The first key encrypts and all keys decrypt, which allows rotation.
  * The organization, provider or platform, and external id are bound as **additional authenticated data**, so a ciphertext copied to another row or tenant fails to decrypt.
  * The API refuses to boot if a platform is configured without encryption keys.
* **OAuth state:** 32 random bytes, stored server-side in Redis for 10 minutes and single-use (`GETDEL`).
  * The state carries the organization, the user, the PKCE verifier and a same-site `returnTo` path (absolute URLs are rejected, which prevents open redirects).
  * The callback only stores a grant when the **signed-in session user matches** the user who started the flow. Anything else, including reuse, expiry or a logged-out browser, ends in `?error=invalid_state`.
* **PKCE (S256)** for Google. Meta calls add `appsecret_proof` (HMAC-SHA256 of the token with the app secret).
* **Least exposure:**
  * DTOs expose only status, names and expiry.
  * Tokens are decrypted only inside the API for an outbound platform call.
  * Platform errors are trimmed and never include tokens.
* **Revocation:** disconnecting the last account of a login revokes the grant on the platform (Meta `DELETE /me/permissions`, LinkedIn `/revoke`, Google `/revoke`) before the tokens are deleted.
  * Meta deauthorize callbacks and `permissions` webhooks mark grants **REVOKED**.
  * Data-deletion requests delete the grants and the accounts added through them, and return Meta's confirmation URL and code.
* **Webhooks and callbacks:**
  * Meta webhooks verify `X-Hub-Signature-256` over the raw body in constant time (401 otherwise).
  * The GET challenge needs `META_WEBHOOK_VERIFY_TOKEN`.
  * `signed_request` payloads are HMAC-verified.
* **Health:** a daily job refreshes grants that expire within 7 days and checks every account. When an account first needs re-authorisation, it writes an audit entry and emails the person who connected it.
* **Permissions:** `social:read` lists accounts; `social:connect` (Owner, Admin, Marketing Manager) connects, assigns, checks and disconnects them. The plan's `socialAccounts` limit is enforced when accounts are added.

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
