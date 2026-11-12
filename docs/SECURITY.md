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

## Social publishing (Phase 10)
* **Explicit consent for outward actions:**
  * Publishing now requires `{ confirm: true }` (400 without it), sent only after a dialog that lists every account.
  * Scheduling is a deliberate choice of time.
  * Nothing is published by default or retried after a permanent failure without a person clicking Retry.
* **Approval model:**
  * Permissions: `social:draft` (Designer and up) creates, edits and submits own drafts; `social:publish` (Owner, Admin, Marketing Manager) approves, rejects, schedules, publishes, cancels and retries.
  * With *Require approval* on, every post needs approval, and approvers cannot approve their own posts unless they are Owner or Admin.
  * Editing an approved post clears the approval (and unschedules it).
* **Integrity:**
  * Media must be files of the same organization that finished uploading; type and size come from storage, not the client.
  * Accounts must be connected and available in the post's workspace.
  * Platform rules are validated before scheduling and again before publishing.
* **No duplicate posts:**
  * A compare-and-set lock (`SCHEDULED` → `PUBLISHING` with the exact scheduled time) means only one job publishes a post; stale jobs after a reschedule do nothing.
  * One publish runs at a time per account (Redis lock).
  * Resumable progress is stored per account, so a retry continues where it stopped.
* **Media URLs:** platform-fetch URLs are signed for 1 hour, created per attempt, and never logged or returned to clients. App previews use the usual 5-minute signed URLs.
* **Recovery:** a sweeper every minute re-queues overdue posts and stuck uploads, so a restart or a lost Redis job delays a post but never drops it.
* **Quota:** published plus scheduled posts per UTC month are checked when scheduling, publishing and retrying (402 `PLAN_LIMIT_REACHED`).
* **PATCH semantics:** update schemas never inject defaults (`withoutDefaults`), so a partial update cannot reset fields it did not mention. This also fixed the CRM update endpoints; see the Phase 10 report.

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
* **Ads (Phase 11): no spend without an explicit, authorised decision.**
  * Everything is created PAUSED on Meta and Google.
  * Activation and budget increases on running campaigns need the `ads:approve` permission (Owner/Admin only) and `{ confirm: true, maxSpend }`. The server recomputes the maximum (lifetime budget, or daily budget × remaining days) and rejects it with 409 `SPEND_CHANGED` when its figure is higher than the one the approver saw.
  * Spend cap per ad account (set by Owner/Admin): the month's recorded spend, plus the remaining maximum of other active campaigns, plus the new maximum this month, must stay under the cap, or the request gets 409 `SPEND_CAP_EXCEEDED`.
  * Every decision is stored in `ad_approval` and audited, and the other Owners/Admins are emailed.
  * Pausing (which stops spend) is allowed for `ads:manage`.
  * The `ads-sync` jobs only read and mirror platform state. No code path in a job calls activation or budget changes, which the e2e tests assert on the adapter call log.
  * The UI also asks the approver to type the campaign name.
* **Ad platform credentials:** grants are stored with the same AES-256-GCM token encryption as social accounts. The Google Ads developer token is a server-side secret sent only as a request header.
* **AI-planned audiences** are resolved through the platforms' own search APIs; ids suggested by the model are never used. AI output is a draft only; it is never saved or published automatically.
* WhatsApp and email require recorded opt-in consent, and opt-out is honoured immediately (Phase 14).

## Operations (Phase 21)
Nightly encrypted Postgres backups with restore drills, Redis AOF persistence for queues,
HTTPS-only, dependency scanning in CI, and documented data retention.
