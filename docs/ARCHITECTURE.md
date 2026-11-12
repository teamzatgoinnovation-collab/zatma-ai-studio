# Architecture

## 1. Monorepo layout (pnpm workspaces + Turborepo)

```
zatma-ai-studio/
├── apps/
│   ├── web/                 Next.js (App Router) frontend
│   └── api/                 NestJS REST API + BullMQ workers
├── packages/
│   ├── types/               Shared TS types: roles, permissions, API shapes
│   ├── validation/          Shared Zod schemas (used by web forms and API pipes)
│   ├── config/              Shared tsconfig / ESLint / Prettier presets
│   ├── ui/                  Shared React UI primitives (Radix + cmdk, see DESIGN_SYSTEM.md)
│   └── sdk/                 Typed API client consumed by web
├── infrastructure/
│   └── docker/              docker-compose (Postgres, Redis, S3 emulator) + Dockerfiles
├── docs/
└── .github/workflows/       CI
```

## 2. Runtime topology

```
Browser ──► Next.js web (apps/web) ──► NestJS API (apps/api, /api/v1/*)
   │                                    │  ├─ Better Auth handler  (/api/auth/*)
   │                                    │  ├─ Prisma ──► PostgreSQL
   │  (cookies: same-site session)      │  ├─ BullMQ producers ──► Redis
   └────────────────────────────────────┘  └─ S3 client ──► S3 emulator (dev) / Cloudflare R2 (prod)

BullMQ workers (same codebase, separate process in prod)
   ├─ notifications   ├─ ai-generation (Phase 4+)   ├─ social-publish (Phase 10)
   └─ automation (Phase 13)   └─ video-render (Phase 16)
```

* The web app talks to the API through `packages/sdk`, using cookie-based sessions
  (`credentials: 'include'`). In development, Next.js rewrites `/api/*` to the API origin so
  cookies stay first-party.
* Long-running or rate-limited work (AI generation, publishing, automation, email/WhatsApp
  sends) always goes through BullMQ queues. It never runs inside a request.

## 3. Backend module map

| Module | Phase | Responsibility |
|---|---|---|
| `ConfigModule` | 1 | Typed, validated env (Zod). The app fails fast on misconfiguration |
| `PrismaModule` | 1 | Prisma client (driver adapter `pg`), tenant-scoping extension |
| `AuthModule` | 1→2 | Better Auth (email/password, organizations, Google OAuth), session guard |
| `UsersModule` | 1 | Current user profile |
| `OrganizationsModule` | 1→2 | Org profile, members, invitations, settings |
| `WorkspaceModule` | 1 | Workspaces (brands / client accounts) within an org |
| `AuditLogModule` | 1 | Mutation audit trail |
| `StorageModule` | 1 | S3-compatible storage, presigned uploads |
| `NotificationModule` | 1→18 | Notification queue + in-app/email delivery |
| `AIProviderModule` | 1→4 | Provider interfaces, registry, fallback, usage metering |
| `BillingModule` | 1→2 | Plans, subscriptions, `PaymentProvider` (Razorpay first) |
| `HealthModule` | 1 | DB + Redis health |
| `DesignModule`, `CopyModule`, `CrmModule`, `SocialModule`, `CampaignModule`, `AutomationModule`, … | 5+ | Feature modules |

## 4. Multi-tenancy strategy

* **Model:** shared database, shared schema. Every tenant-owned table has a non-null
  `organizationId` column with an index, and every foreign key path stays within one org.
* **Resolution:** Better Auth's session carries `activeOrganizationId`. `SessionGuard` loads
  the session. `OrgGuard` then checks that the user is a **member** of that org and loads the
  member's role.
* **Propagation:** the resolved `{ userId, organizationId, role, permissions }` is stored in an
  `AsyncLocalStorage`-backed `TenantContext` for the lifetime of the request (and of any job,
  since jobs carry `organizationId` explicitly).
* **Enforcement (defence in depth):**
  1. Services always filter by `organizationId` taken from `TenantContext`, never from the
     client payload.
  2. A Prisma client extension (`tenantScoped`) injects `organizationId` into `where`/`data`
     for tenant models and throws if a query runs on a tenant model with no tenant context.
  3. Lookups by id use `findFirst({ where: { id, organizationId } })`, so another org's ids
     return **404**, not 403. This avoids leaking whether the id exists.
  4. Automated e2e tests check cross-tenant access for every new tenant resource.

## 5. Authorization (RBAC)

Roles: `SUPER_ADMIN` (platform level, separate from orgs), `ORGANIZATION_OWNER`, `ADMIN`,
`MARKETING_MANAGER`, `CRM_MANAGER`, `SALES_AGENT`, `DESIGNER`, `ANALYST`, `VIEWER`.

Checks are made on **permissions**, never on role names. `packages/types/src/permissions.ts`
defines permission strings such as `organization:update`, `workspace:create` and `lead:read`,
plus a `ROLE_PERMISSIONS` map. Controllers declare `@RequirePermissions('workspace:create')`.
Later phases can add per-org custom roles without touching controllers.

## 6. AI provider layer (implemented in Phase 4)

```
POST /ai/text ─┐                     ┌─ AnthropicTextProvider  (claude-opus-5-5, @anthropic-ai/sdk)
POST /ai/jobs ─┼─► AIService ─► chain┼─ OpenAITextProvider     (gpt-6.1-sol, Responses API)
               │   │                 └─ GeminiTextProvider     (gemini-3.8-flash, @google/genai)
               │   ├─ plan credit pre-check (UsageService)
               │   ├─ per-attempt metering → ai_usage (tokens, cost µUSD, credits, latency, errorKind)
               │   └─ images → StorageService (private S3, signed URLs)
               └─► BullMQ `ai-generation` → AIGenerationProcessor (TenantContext per job) → generation_job
```

* **Interfaces:** `AITextProvider`, `AIImageProvider` and `AIVideoProvider` in `apps/api/src/ai/ai-provider.interfaces.ts`. Video adapters ship in Phase 16.
* **Registration:** an adapter is registered at boot only when its API key is set.
* **Provider order:** comes from `AI_TEXT_PROVIDERS` / `AI_IMAGE_PROVIDERS`. An organization can prefer a different first provider (`organization.aiSettings`), and a single request can override it (`provider`).
* **Fallback:**
  * Retryable failures move on to the next provider: rate limits, outages, auth problems, refusals, empty output.
  * A bad request (`invalid_request`) stops the chain with a 422.
  * If every provider declines on safety grounds, the response is `AI_CONTENT_REFUSED`.
  * The SDKs themselves retry transient errors twice before an adapter reports a failure.
* **Anthropic:**
  * No sampling parameters are sent, because current models reject them.
  * Effort is set with `output_config.effort` (`ANTHROPIC_EFFORT`, default `medium`).
  * Server-side refusal fallback is on: beta `server-side-fallback-2026-07-01` with `fallbacks: "default"`.
  * Cost is priced by `response.model`, the model that actually served the request.
* **Credits vs. cost:**
  * Customers see **credits**: 1 per started 4,000 text tokens, 4 per image. They count against `Plan.limits.aiCredits` and are checked before every call.
  * Provider **cost** is recorded in micro-USD per attempt for margin reporting and never returned to clients. Prices live in `ai-pricing.ts`, and unknown models are priced at the provider's highest rate.
* **Security:** keys exist only in the API process. Responses never include provider error text, only a normalised code.

## 7. Payment provider abstraction (implemented in Phase 2)

```ts
interface PaymentProvider {
  id: 'razorpay' | 'stripe';
  createCustomer(org): Promise<ExternalCustomer>;
  createSubscription(org, plan, interval): Promise<CheckoutSession>;
  cancelSubscription(externalId, atPeriodEnd: boolean): Promise<void>;
  verifyWebhook(rawBody: Buffer, signature: string): WebhookEvent;
}
```
Razorpay comes first (INR, UPI, India). Stripe follows for GCC and international. Webhooks are
the source of truth for subscription state.

## 8. AI Design Studio: layered composition (implemented in Phase 5)

Image models are poor at rendering exact text, especially Malayalam and Arabic. So a design is
stored as a **layer document** (JSON, validated by `designDocumentSchema`) and rendered in the
browser with Konva:

```
Canvas (preset size + safe areas)
├── background   (AI image with overlay, gradient or colour)
├── logo         (image layer, from the Brand Kit)
├── badge        (text with pill)
├── headline     (live text: font, colour, script-aware)
├── subheadline / body (live text)
├── cta          (live text with pill)
├── product      (uploaded image layers)
└── footer       (website · phone · WhatsApp)
```

Pipeline (`DesignService.startGeneration` → `design-generation` queue → `DesignGenerationService.run`):
1. **Brief:** the text chain returns JSON (copy, layout, palette, background prompt). It is validated with Zod; one repair retry is allowed.
2. **Background:** the image chain is asked for a text-free image. Any failure falls back to a brand gradient.
3. **Compose:** `composeDesign()` is pure and deterministic. It picks a layout (`hero-center`, `split-left`, `bottom-band`, `story-stack`) from the brief and aspect ratio, sizes text by length and script width, keeps everything in the safe area, and applies the brand kit.
4. **Save:** the design becomes `READY` with revision 1, and version 1 is recorded.

Editing is client-side (a pure reducer with undo/redo history). Saves are `PATCH`es carrying the
last-seen `revision` (optimistic concurrency). Images are always referenced by stored-file id;
the API resolves them to short-lived signed URLs, which the canvas loads with CORS so export is not tainted.

## 8a. AI Copywriter (implemented in Phase 6)

`CopyService.runJson()` is the shared path for structured text calls. It builds the prompt, calls `AIService.generateTextFor` (fallback, credits, metering), validates the reply with Zod and retries once with the parse error, then fails with `AI_OUTPUT_INVALID`. Generation, translation, rewriting and design translation all use it.

Safeguards:
* **Facts:** the system prompts allow only facts from the request and the brand kit; prices, dates and contact details are never invented.
* **Native writing:** each language has its own guidance (native script, Kerala Malayalam, GCC Arabic).
* **Translation check:** `missingTokens()` compares the numbers, phone numbers and URLs in the source and each translation (with Arabic-Indic digits normalised) and surfaces any difference as a warning instead of failing.
* **Limits:** `checkLimits()` counts user-perceived characters (`Intl.Segmenter`) against each platform's limits and SMS segments, so the UI can flag copy that would be truncated or rejected.
* **Design translation:** layout is kept. Each text layer gets a font that can render the target script (`fontForLanguage`), the right direction and alignment, and a size that fits its box (`fitFontSize` from the composer).

## 8b. CRM (implemented in Phase 7)

**Record-level access:**
* On top of tenant isolation, `ownerScope()` (`apps/api/src/crm/crm-common.ts`) adds `ownerId = currentUser` to every lead, contact, deal and activity query for users who can write but not delete (Sales Agents).
* Out-of-scope records therefore return 404, exactly like other tenants' records.
* `resolveOwner()` makes Sales Agents own what they create, and checks that any assigned owner is a member of the organization.

**Duplicates:** each lead and contact stores `emailNormalized` and `phoneNormalized` (international format, default country from the organization's currency). Creates check both leads and contacts across the whole organization, so colleagues don't create the same person twice.

**Kanban ordering:** deals carry a float `position`. A move takes the midpoint between its neighbours; when the gap runs out, the column is renumbered. Moving into a Won or Lost stage sets status, probability and `closedAt`.

**Import pipeline:**
1. Upload with the `IMPORT` purpose, then preview (parse and auto-map columns).
2. A `crm_import` row is created and the `crm-import` queue picks it up.
3. The worker runs in a tenant context rebuilt from the importer's membership (role and permissions), so ownership and visibility rules apply.
4. Rows go through the same services as the API; the plan capacity is counted down per created contact or lead; per-row errors are capped at 200.

## 8c. Lead scoring vs AI insights (Phase 8)

Two separate layers:

1. **Score (deterministic):**
   * `scoreLead(input, settings, now)` is a pure function shared by the API and the tests. The API stores the score, grade, reason and full signal breakdown on the lead.
   * It runs synchronously after lead and activity writes. The `crm-scoring` queue handles "recalculate all" and the nightly decay pass, which runs inside each organization's tenant context.
   * Because it is rules plus weights, every point can be explained and audited, and it costs nothing to run.
2. **Insights (AI, on request):** `CrmAiService` sends the lead's own fields, its last 12 activities, the score breakdown and the default brand kit through `CopyService.runJson` (provider chain, credits, JSON validation and repair). The result is cached on the lead. AI output never changes the score, status or owner; a suggestion only becomes an activity when a user clicks "Schedule it".

## 9. Tooling versions

Exact versions are pinned in each `package.json` and the `pnpm-lock.yaml`. Major versions
chosen in Phase 1:

| Area | Choice |
|---|---|
| Runtime | Node.js 22 LTS, pnpm 10 |
| Language | TypeScript 6.0 (strict) |
| Frontend | Next.js 16, React 19, Tailwind CSS 4, TanStack Query 5, React Hook Form, Zod 4, next-themes, Lucide |
| Backend | NestJS 12 (native ESM), Prisma 7 (`prisma-client` generator + `@prisma/adapter-pg`), Better Auth 1.x, BullMQ, nestjs-pino, @nestjs/swagger, @nestjs/throttler, Helmet |
| Data | PostgreSQL 16, Redis 7, S3-compatible storage (moto S3 emulator dev / R2 prod) |
| Tests | Vitest (API unit + e2e with Supertest against a real Postgres), Playwright (E2E) |
| Build | Turborepo, Docker, GitHub Actions |

**Why Vitest rather than Jest:** NestJS 12 and Better Auth both ship as ESM only. Vitest runs
ESM natively, using SWC to emit decorator metadata. Jest would need experimental VM modules.

**Why Prisma 7 rather than 8:** Prisma 8 is still a release candidate, and Better Auth's peer
range is `prisma ^7`.

## Social publishing (Phase 10)

The flow is `PublishingService` (API) → `social-publish` queue → `PublishingWorkerService`:
1. **Schedule or publish now:** the post becomes `SCHEDULED` and a delayed job `post-<id>-<scheduledAtMs>` is queued. Rescheduling or cancelling removes it, and stale jobs are ignored by a compare-and-set.
2. **Post job:** `SCHEDULED` → `PUBLISHING`, then one `target` job per account.
3. **Target job:**
   * Takes the per-account Redis lock.
   * Builds the request: token from `SocialService.publishingTarget`, final text from `composeText`, media as signed URLs or byte ranges.
   * Calls the platform adapter's `publish()` and persists `providerState` after every step.
   * The outcome is *published*, *processing* (re-queued after `retryAfterMs`), *retryable* (backoff, up to 5 attempts), *auth* (account flagged, email) or *permanent* (failure email).
4. **Finalize:** when every target is done, the post becomes `PUBLISHED`, `PARTIALLY_PUBLISHED` or `FAILED` (compare-and-set, audited once).
5. **Sweeper** (every minute): re-queues overdue scheduled posts and stuck targets, and settles finished posts.

On the web, the composer validates live with the shared `validatePost` (`packages/validation/src/publishing.ts`), the same rules the API enforces.

## Ads (Phase 11)

* **Request path:** `AdsService` and `AdsAccountsService` (API) → `ads-sync` queue → `AdsWorkerService`.
* **Adapters:** `apps/api/src/ads/providers/`, Meta Marketing API and Google Ads REST behind one `AdsPlatformAdapter` interface.
* **Creation:** jobs call `createCampaign` (always PAUSED) and save each created id to `syncState`, so retries resume.
* **Spend decisions:** `activate` and `changeBudget` run only in request handlers with `ads:approve`, a confirmed `maxSpend` (recomputed by the server) and the cap check. They write `ad_approval`, audit and email.
* **Sync:** hourly (3 days) and nightly (30 days). It imports external campaigns, mirrors platform status, and upserts `ad_insight_daily`. It never activates.
