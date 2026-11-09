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
│   ├── ui/                  Shared React UI primitives (shadcn/ui style)
│   └── sdk/                 Typed API client consumed by web
├── infrastructure/
│   └── docker/              docker-compose (Postgres, Redis, MinIO) + Dockerfiles
├── docs/
└── .github/workflows/       CI
```

## 2. Runtime topology

```
Browser ──► Next.js web (apps/web) ──► NestJS API (apps/api, /api/v1/*)
   │                                    │  ├─ Better Auth handler  (/api/auth/*)
   │                                    │  ├─ Prisma ──► PostgreSQL
   │  (cookies: same-site session)      │  ├─ BullMQ producers ──► Redis
   └────────────────────────────────────┘  └─ S3 client ──► MinIO (dev) / Cloudflare R2 (prod)

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

## 6. AI provider abstraction (implemented in Phase 4)

```ts
interface AITextProvider  { id: string; generateText(i: TextGenerationInput): Promise<TextGenerationResult> }
interface AIImageProvider { id: string; generateImage(i: ImageGenerationInput): Promise<ImageGenerationResult> }
interface AIVideoProvider { id: string; generateVideo(i: VideoGenerationInput): Promise<VideoGenerationResult> }
```

* `AIProviderRegistry` holds the registered providers by capability, the per-org and default
  provider selection, and an ordered fallback chain.
* Every call is metered into `AiUsage`: tokens, images, seconds of video, cost in micro-USD,
  and the credits charged. Credits are checked against plan limits before work is enqueued.
* API keys exist only in the API's environment and never reach the browser.
* Candidates: OpenAI, Anthropic and Google Gemini for text; OpenAI and Google for images;
  pluggable video vendors.

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

## 8. AI Design Studio: layered composition (Phase 5)

Image models are poor at rendering exact text, especially Malayalam and Arabic. So a design is
stored as a **layer document** (JSON) that is rendered with Konva/Fabric:

```
Canvas (preset size + safe areas)
├── background   (AI image or solid/gradient)
├── decorative   (shapes, overlays)
├── product      (uploaded or AI image)
├── logo         (from Brand Kit)
├── headline     (live text: font, color, script-aware)
├── description  (live text)
├── cta          (live text + shape)
└── footer       (contact, WhatsApp, website)
```
The AI produces a *design brief*, the *copy* and a *background image*. A composition engine
then lays them out according to the brand kit and template rules. All text stays editable.

## 9. Tooling versions

Exact versions are pinned in each `package.json` and the `pnpm-lock.yaml`. Major versions
chosen in Phase 1:

| Area | Choice |
|---|---|
| Runtime | Node.js 22 LTS, pnpm 10 |
| Language | TypeScript 6.0 (strict) |
| Frontend | Next.js 16, React 19, Tailwind CSS 4, TanStack Query 5, React Hook Form, Zod 4, next-themes, Lucide |
| Backend | NestJS 12 (native ESM), Prisma 7 (`prisma-client` generator + `@prisma/adapter-pg`), Better Auth 1.x, BullMQ, nestjs-pino, @nestjs/swagger, @nestjs/throttler, Helmet |
| Data | PostgreSQL 16, Redis 7, S3-compatible storage (MinIO dev / R2 prod) |
| Tests | Vitest (API unit + e2e with Supertest against a real Postgres), Playwright (E2E) |
| Build | Turborepo, Docker, GitHub Actions |

**Why Vitest rather than Jest:** NestJS 12 and Better Auth both ship as ESM only. Vitest runs
ESM natively, using SWC to emit decorator metadata. Jest would need experimental VM modules.

**Why Prisma 7 rather than 8:** Prisma 8 is still a release candidate, and Better Auth's peer
range is `prisma ^7`.
