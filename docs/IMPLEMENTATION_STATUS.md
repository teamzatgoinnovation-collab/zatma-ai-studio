# Implementation Status

| Phase | Name | Status |
|---|---|---|
| 0 | Project planning & documentation | ✅ Completed |
| 1 | Foundation & architecture | ✅ Completed |
| 2 | Authentication, organizations & SaaS billing | ✅ Completed |
| 3 | Modern SaaS UI/UX | ✅ Completed |
| 4 | AI provider integration | ✅ Completed |
| 5 | AI Design Studio | ✅ Completed |
| 6 | AI Copywriter | ✅ Completed (awaiting approval for Phase 7) |
| 7 | CRM core | ⏳ Pending |
| 8 | AI lead scoring & intelligence | ⏳ Pending |
| 9 | Social media account integration | ⏳ Pending |
| 10 | Social content management | ⏳ Pending |
| 11 | Meta Ads manager | ⏳ Pending |
| 12 | Campaign management | ⏳ Pending |
| 13 | Marketing automation | ⏳ Pending |
| 14 | Email & WhatsApp marketing | ⏳ Pending |
| 15 | Landing pages & lead capture | ⏳ Pending |
| 16 | AI Video Studio | ⏳ Pending |
| 17 | Analytics & reporting | ⏳ Pending |
| 18 | Notifications & collaboration | ⏳ Pending |
| 19 | Super admin | ⏳ Pending |
| 20 | Security, testing & QA | ⏳ Pending |
| 21 | Deployment & infrastructure | ⏳ Pending |
| 22 | Final integration & verification | ⏳ Pending |

## Phase 0: Project planning (✅ Completed)
* Repository inspected: the directory was empty (greenfield), so there was no existing code to preserve.
* Decisions: pnpm + Turborepo monorepo; Next.js web + NestJS API; Prisma/PostgreSQL; Redis/BullMQ;
  Better Auth (organizations plugin); Razorpay-first billing behind a `PaymentProvider` interface;
  provider-agnostic AI layer.
* Deliverables: `PROJECT_OVERVIEW`, `ARCHITECTURE`, `DEVELOPMENT_ROADMAP`, `DATABASE_DESIGN`,
  `API_DOCUMENTATION`, `SECURITY`, `INTEGRATIONS`, `IMPLEMENTATION_STATUS`.

## Phase 1: Foundation & architecture (✅ Completed)

### Features implemented
* **Monorepo:** pnpm workspaces + Turborepo with `apps/web`, `apps/api` and `packages/{types,validation,sdk,ui,config}`.
* **API (NestJS 12, ESM):**
  * Global prefix and URI versioning (`/api/v1`), Helmet, CORS allow-list, and a Pino structured logger with request ids and redaction.
  * Rate limiting through `@nestjs/throttler`, plus Better Auth's own limits on the auth endpoints.
  * Every error uses the same envelope, and environment config is validated with Zod (the app fails fast on bad config).
  * Swagger is served at `/api/docs`.
* **Auth:** Better Auth (email/password, organization plugin, Google OAuth wired but off until credentials are set) at `/api/auth/*`.
  New sessions resume the user's most recently joined organization.
* **Multi-tenancy:**
  * The `AuthGuard` checks session → active organization → membership → permissions.
  * An AsyncLocalStorage `TenantContext` carries the tenant through each request.
  * A Prisma `tenantScoped` extension filters and injects `organizationId`, and fails closed when there's no tenant context.
  * Another org's resources return 404.
* **RBAC:** permission-based, with 8 org roles mapped to permissions in `@zatma/types` and deny-by-default routes. `SUPER_ADMIN` is reserved for the platform (Phase 19).
* **Organization provisioning:** a new org automatically gets a default workspace, a Free subscription, an audit entry and a welcome-notification job.
* **Modules:** Users, Organizations, Workspaces (CRUD), Audit log (interceptor + listing), Storage (S3/R2 presigned uploads), Notifications (BullMQ queue + worker), AI provider registry (interfaces + catalogue), Billing (plan catalogue, subscription, `PaymentProvider` interface), Health.
* **Web (Next.js 16):**
  * Sign-up, sign-in and organization onboarding (create an org or pick an existing one).
  * Protected app shell with the full module sidebar (upcoming modules are marked by phase).
  * Live dashboard showing org, plan, members, health, workspaces (create/delete), AI providers and audit activity.
  * Light/dark themes, a responsive layout, Indigo/Cyan design tokens and Inter.
  * Same-origin `/api` proxy so cookies stay first-party.
* **Infrastructure:** Docker Compose (Postgres, Redis, MinIO + bucket init, plus API and web under the `app` profile), API and web Dockerfiles, and a GitHub Actions CI pipeline (lint → typecheck → unit → e2e → build).

### Database changes
Migration `20261109015514_init`: `user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`, `workspace`, `audit_log`, `plan`, `subscription`, `ai_usage`, `stored_file` plus enums. Seed: 5 plans (Free, Starter, Professional, Business, Agency).

### APIs
See [API_DOCUMENTATION.md](./API_DOCUMENTATION.md#phase-1-endpoints) and Swagger at `/api/docs`.

### Tests and results (all passing)
| Suite | Result |
|---|---|
| Lint (ESLint, all packages) | ✅ 0 errors |
| Typecheck (strict TS, all packages) | ✅ |
| Unit (`types` 6, `validation` 5, `sdk` 3, `api` 10) | ✅ 24 passed |
| API e2e against real PostgreSQL + Redis | ✅ 21 passed |
| Production build (API + Next.js) | ✅ |
| Browser flow (Playwright): sign-up → validation → create org → dashboard → add workspace → theme → mobile → sign-out → protected redirect → sign-in | ✅ no console errors |

The e2e suite includes the **tenant isolation** cases. A member of Org B:
* can't list, read, update or delete Org A's workspaces;
* can't inject an `organizationId`;
* can't switch into Org A, and the failed switch clears the active org (fails closed);
* gets `NOT_A_MEMBER` with a forged session;
* sees only their own org's members, audit log and subscription.

The tenant-scoped client also fails closed without a context. A Viewer can read but not write.

### Remaining issues / notes
* **Docker images and Compose were not built here.** The development container has no Docker daemon, so verification used locally installed PostgreSQL 16 and Redis 7. CI runs the same steps on GitHub Actions.
* **MinIO upload round-trip not run.** Presigned URL generation is tested, but no object storage server was running here. (Resolved in Phase 2: the open-source MinIO server is archived, so local S3 now uses moto, and a real browser upload was verified.)
* **Deferred to Phase 2 by design:** email verification, password reset, invitations and Razorpay. Google OAuth needs credentials.
* **AI adapters are not implemented yet (Phase 4).** The registry reports providers honestly as "Not configured" or not implemented.

### Next phase
**Phase 2: Authentication, organizations & SaaS management.** It covers email verification and password reset (email provider), Google OAuth, invitations and member role management, organization settings and logo upload, account deletion, Razorpay subscriptions (checkout, webhooks, upgrade/downgrade/cancel, invoices) and plan usage limits.

## Phase 2: Authentication, organizations & SaaS billing (✅ Completed)

### Features implemented
* **Email:**
  * Resend transport for production, plus a capture transport for dev and tests with an inbox at `GET /api/v1/dev/emails` (not registered in production).
  * Delivery runs through a BullMQ `email` queue with retries and rate limiting.
  * Branded, HTML-escaped templates: verify email, reset password, invitation, delete account, trial ending and payment failed.
  * Links in emails always point at the public web URL.
* **Authentication:**
  * Email verification is required (configurable). Users can resend the link, and verification signs them in automatically.
  * Forgot and reset password: the link is single-use, lasts 1 hour, and the reset revokes every session.
  * Change password (signs out other devices), plus a list of active sessions with revoke.
  * Account deletion with an email confirmation. Sole owners are blocked (with an eligibility check up front), and organizations where the user is the only member are deleted with the account.
  * Google OAuth: the button appears only once credentials exist, and accounts link only for Google-verified emails.
* **Organizations & team:**
  * Invitations by email: 7-day expiry, resend, cancel, and accept or decline. The accept page also handles invitees who are signed out or don't have an account yet.
  * Role changes and member removal take effect immediately, guarded by permissions and audited.
  * Org switcher in the top bar, and the organization profile settings page (time zone, currency, language, industry, website).
  * Logo upload: presigned PUT → upload completion check (size and type) → served through a signed URL.
  * Owner-only organization deletion, blocked while a paid subscription is live.
* **Subscriptions & billing (Razorpay):**
  * `RazorpayProvider` implements customers, subscriptions, plan changes and cancellation against the REST API.
  * Webhooks are verified with HMAC-SHA256 over the raw body and are idempotent through the `billing_event` table.
  * Plan changes: upgrades apply immediately; downgrades are scheduled for period end and blocked while usage exceeds the target plan's limits.
  * Cancelling a paid plan takes effect at period end; cancelling a trial ends it immediately.
  * Failed payments move the subscription to PAST_DUE with a grace period (`BILLING_GRACE_DAYS`) and email the owners. When the grace period ends, the organization drops to Free.
  * New organizations get a 14-day Professional trial (`TRIAL_PLAN`, `TRIAL_DAYS`). An hourly BullMQ job sends trial reminders and handles trial and grace-period expiry.
  * Invoices and payments are recorded from webhooks.
  * Without keys, a `DisabledPaymentProvider` makes every payment action return `503 BILLING_NOT_CONFIGURED`, and the UI explains that payments aren't enabled yet.
* **Usage limits:** `UsageService` enforces plan limits on members (members plus pending invitations), workspaces and storage, returning `402 PLAN_LIMIT_REACHED`. AI credits and social accounts are tracked for Phases 4 and 9.
* **Web pages:** verify email, forgot and reset password, accept invitation, Team, Settings (Organization and Account tabs), and Billing (plans with a monthly/yearly toggle, usage meters, Razorpay Checkout, invoices).
* **Infrastructure:** the open-source MinIO server is archived, so local S3 in Docker Compose is now the moto emulator, and its bucket CORS rules are created automatically.

### Database changes
Migration `20261109023403_phase2_billing`:
* `plan`: added `razorpayPlanIdMonthly` and `razorpayPlanIdYearly`.
* `subscription`: added `pendingPlanId`, `pendingInterval`, `graceUntil`, `providerCustomerId` and `trialReminderSentAt`.
* New tables `invoice` and `payment` (both tenant-scoped) and `billing_event` (platform-level).

### Tests and results (all passing)
| Suite | Result |
|---|---|
| Lint, all packages | ✅ |
| Typecheck, all packages | ✅ |
| Unit tests (types 6, validation 5, sdk 3, api 19) | ✅ 33 passed |
| API e2e against real PostgreSQL + Redis (6 files) | ✅ 52 passed |
| Production build (API + web) | ✅ |
| Browser flow (Playwright) | ✅ |

Unit tests cover Razorpay signatures, event parsing and the HTTP client, email escaping, and the env rules.

The e2e suites cover:
* **Auth flows:** verification required, verification link, tampered tokens, reset with session revocation, no account enumeration, and deletion eligibility and confirmation.
* **Team:** invite, accept and public details; unknown roles and non-admins rejected; role change takes effect; removal; member and workspace limits.
* **Billing:** trial, disabled billing, checkout validation, owner-only management, checkout calls, bad signatures, activation, invoice and idempotency, upgrade and downgrade, downgrade blocked by limits, PAST_DUE and grace, cancellation to Free, maintenance job, ending a trial.
* **Storage and logo:** upload completion checks, logo plus signed URLs, non-logo files rejected, other tenants' files rejected, storage limit.
* **Tenant isolation:** extended to invitations, invoices and subscriptions.

The browser flow ran against the real API, PostgreSQL, Redis and the moto S3 server:
1. Sign up, then confirm that sign-in is blocked while the email is unverified.
2. Verify through the emailed link, onboard, and see the trial on the Billing page with the "payments not enabled" notice.
3. Invite a designer. As the invitee, open the email link, create an account, verify, and accept.
4. As the owner, change the invitee's role, and confirm their access updates.
5. Upload a logo directly to S3, and save the organization settings.
6. Check the account tab and its session list.
7. Reset the password through the emailed link, then sign in with the new password.
8. Take dark-mode and mobile screenshots.

The only console error is the intentional 403 from the unverified sign-in attempt.

### Remaining issues and pending setup
* **Razorpay live checkout untested.** It has not been run against real Razorpay, because there are no keys yet. Request shapes follow Razorpay's documented API and are tested with a fake client. To go live, follow the checklist in [INTEGRATIONS.md](./INTEGRATIONS.md#razorpay-subscriptions): keys, plan ids and webhook.
* **Resend not tested with real delivery.** It needs `RESEND_API_KEY` and a verified sending domain.
* **Google sign-in needs credentials.** It requires `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
* **Organizations with a pending paid plan** (checkout started but not yet activated) keep their trial until Razorpay sends `subscription.activated`.
* **Undoing a scheduled cancellation is not possible in-app.** Razorpay can't undo cancel-at-period-end, so the customer re-subscribes after the period ends.
* **Docker images still not built here** (no Docker daemon in this environment).

### Next phase
**Phase 3: Modern SaaS UI/UX.** It covers:
* the full design system and component library
* command search, breadcrumbs and a notifications panel
* collapsible sidebar groups for every module
* consistent loading, empty and error states
* an accessibility pass and responsive polish

## Phase 3: Modern SaaS UI/UX (✅ Completed)

### Features implemented
* **Design system** (see [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md)):
  * Tokens for light and dark themes, including contrast-safe status text colours.
  * Radix-based `Dialog`, `Sheet`, `DropdownMenu` and `Tooltip`, plus a cmdk `Command` palette.
  * `PageHeader`, `EmptyState`, `ErrorState`, `Spinner`, `Meter` and `Kbd`.
* **App shell:**
  * Nested sidebar matching the full module tree (AI Studio, CRM, Marketing, Advertising, Analytics, AI Assistant, Team, Billing, Settings). Groups open automatically for the current page, and planned modules carry phase badges.
  * The sidebar collapses to icons with tooltips, and that choice persists in a cookie so the server renders it without flicker.
  * Org switcher in the sidebar (top bar on mobile), and an off-canvas mobile navigation.
  * Top bar: breadcrumbs, ⌘K / Ctrl K search, activity bell (organization audit trail with unread badge), and a user menu with theme switching and sign-out.
  * Command palette covering every page, quick actions, theme switching and organization switching.
  * Skip link, landmarks, visible focus rings and reduced-motion support.
* **Module layouts:**
  * Every sidebar entry resolves to a page. Section overviews show a card per module.
  * Modules that haven't shipped show their purpose, their planned capabilities from the spec, and related features available now.
  * No mock or sample data anywhere. Unknown module paths return 404.
* **Page states:**
  * Route-level `loading`, `error` and `not-found`, plus `global-error`.
  * Existing pages (Dashboard, Team, Billing, Settings) use the shared page header and error states.
  * The dashboard's activity feed uses human-readable sentences.

### Tests and results (all passing)
| Suite | Result |
|---|---|
| Lint and typecheck, all packages | ✅ |
| Web unit and component tests (Vitest + Testing Library) | ✅ 24 passed (navigation config, breadcrumbs, sidebar behaviour, module pages, state components, activity helpers, redirect safety, palette shortcut) |
| Existing unit tests | ✅ 33 passed |
| Existing API e2e tests | ✅ 52 passed |
| Production build | ✅ |
| Browser checks (Playwright) | ✅ no console errors |
| Accessibility (axe, WCAG 2.1 AA) | ✅ 0 serious or critical violations |

The browser checks covered:
* skip link focus order
* activity bell: unread badge, then cleared
* ⌘K search → navigation
* breadcrumbs, and auto-expanded sidebar groups
* section overview
* collapsing the sidebar and keeping that state after a reload
* the 404 page
* switching to dark theme from the user menu
* mobile navigation sheet, with no horizontal overflow

The axe checks ran on: sign-in, dashboard (light and dark), command palette, module page, section overview, Team, Billing, Settings and Account.

### Remaining notes
* The activity bell shows the audit trail. Real notifications (assignments, follow-ups due, campaign results) arrive in Phase 18.
* Not every Phase 3 page has to exist yet: module pages for future phases are roadmap layouts by design. Each is replaced by the real module in its phase.

### Next phase
**Phase 4: AI provider integration.** It covers:
* OpenAI, Anthropic and Gemini adapters behind the existing interfaces
* model selection and fallback
* queued generation jobs
* token, cost and credit metering against plan limits
* usage logging

## Phase 4: AI provider integration (✅ Completed)

### Features implemented
* **Provider adapters** (official SDKs, each enabled only when its key is set):
  * **Anthropic** text, `claude-opus-5-5`: effort `medium`, server-side refusal fallback, no sampling parameters.
  * **OpenAI** text, `gpt-6.1-sol` through the Responses API (JSON mode supported), and images, `gpt-image-2` (base64 PNG, priced by tokens).
  * **Gemini** text, `gemini-3.8-flash`, and images, `gemini-3.1-flash-image` (aspect ratio mapped from the canvas, priced per image).
  * All models are configurable through env vars.
* **Fallback and selection:**
  * Default order: text anthropic → openai → gemini, images openai → gemini.
  * An organization can choose a preferred provider (`PATCH /ai/settings`), and a single request can override it.
  * Retryable failures (rate limit, outage, refusal, empty output, auth) fall through to the next provider. Invalid requests stop the chain.
* **Metering:**
  * Every attempt writes `ai_usage`: tokens, cost in µUSD, credits, latency, error kind and purpose.
  * Credits are checked against the plan before each call.
  * `GET /ai/usage` shows usage by provider without revealing cost.
* **Queue:** a `generation_job` table plus the BullMQ `ai-generation` queue. Each job runs in its tenant's context. Generated images are stored privately and returned as signed URLs.
* **Languages:** generation supports English, Malayalam, Arabic, Hindi, Tamil, Kannada and Telugu, with native-script instructions.
* **Web:**
  * New **Settings → AI** tab: provider status and models, preferred providers with the effective order, a credits meter with a per-provider breakdown, and a "Try it" playground with language choice that shows the provider, model, credits and any fallback.
  * The dashboard and command palette link to it.

### Database changes
Migration `20261109033914_phase4_ai`:
* New `generation_job` table.
* `ai_usage`: added `purpose`, `jobId`, `errorKind` and `latencyMs`.
* `organization`: added `aiSettings`.
* `GenerationJob` is a tenant-scoped model.

### Tests and results (all passing)
| Suite | Result |
|---|---|
| API unit tests (adapters with fake SDK clients, pricing, error mapping, instructions) | ✅ 32 passed (13 new) |
| API e2e tests (11 files) | ✅ 62 passed (10 new AI) |
| Web unit tests | ✅ 24 passed |
| Lint, typecheck, build | ✅ |

The adapter unit tests verify the exact request parameters for each provider and that a refusal becomes a retryable error.

The 10 new AI e2e tests cover:
* no providers configured → 503
* fallback with per-attempt metering
* organization and per-request preference
* a non-retryable error stopping the chain
* all providers refusing
* an image job through the queue to private storage with signed URLs
* a failed job reporting a safe error
* input validation
* the plan credit limit (402)
* permissions (Viewer and Designer) and tenant isolation of jobs and usage

**Browser run against the real SDK clients:** the Anthropic and OpenAI SDKs were pointed at a local HTTP stand-in through `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL`.
* Anthropic received exactly: `claude-opus-5-5`, `output_config.effort=medium`, `fallbacks:"default"` with the `server-side-fallback-2026-07-01` beta, no `temperature`, and the Malayalam instruction.
* OpenAI images received `gpt-image-2`, `1024x1024`, PNG.
* The image was stored in S3 (moto), and the signed URL downloaded with a 200.
* axe found no serious or critical violations on the AI tab, and there were no console errors.

### Remaining issues / notes
* **Not called against real provider APIs.** No keys yet; requests follow each SDK's documented types and were checked against a local stand-in. Add `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and/or `GEMINI_API_KEY` to enable them.
* **Model IDs and prices** were taken from the providers' pricing pages in November 2026. Review `apps/api/src/ai/ai-pricing.ts` when providers change prices. Gemini Flash and Gemini 4 Argon prices are scheduled to rise on 1 Jan 2027 and 1 Dec 2026.
* **Video generation** (Phase 16) and **platform-level provider management** (Phase 19, Super Admin) are out of scope here.

### Next phase
**Phase 5: AI Design Studio.**
* Prompt → design brief → copy → background image → layered editable design.
* Canvas editor (Konva/Fabric) with platform size presets.
* Brand Kit, and export to PNG, JPG and PDF.

## Phase 5: AI Design Studio (✅ Completed)

### Features implemented
* **Layered design model** (`packages/validation/src/design.ts`):
  * Seven platform size presets with safe areas: Instagram Post and Story, Facebook Post and Cover, LinkedIn Post, YouTube Thumbnail, WhatsApp Status.
  * A strict Zod document schema: a colour, gradient or image background, plus text, image and shape layers. Images are referenced only by stored-file id, never by URL. Max 60 layers.
  * A font catalogue with a script-aware default per language (Noto Sans for Malayalam, Arabic with RTL, Hindi, Tamil, Kannada, Telugu).
* **Generation pipeline** (`apps/api/src/design/`), run on the BullMQ `design-generation` queue inside the tenant's context:
  1. **Brief and copy** as JSON from the text provider chain: headline, subheadline, body, CTA, badge, caption, hashtags, layout and a background prompt. Invalid output gets one repair retry, then fails with `AI_BRIEF_INVALID`.
  2. **Optional background image** from the image chain. The prompt forbids any text in the image. If there's no image provider or the call fails, a brand gradient is used and the design still succeeds.
  3. **Deterministic composition** (`composer.ts`): four layouts, everything kept inside the safe area, font size fitted to text length and script, brand colours and fonts, a logo layer, a CTA pill and a footer with website, phone and WhatsApp. **All text stays as live, editable layers**; nothing is baked into the image.
* **Design API:**
  * Brand kits: CRUD, with a single default per organization.
  * Designs: list and search, blank or from a template, generate (202), get (with signed asset URLs), autosave, duplicate, soft delete, thumbnail.
  * Optimistic concurrency: `revision` on every save; a stale save gets `409 REVISION_CONFLICT`.
  * Versions (save and restore) and organization templates.
  * Every file id in a document must be an uploaded file of the same organization.
* **Web: AI Studio:**
  * **AI Design Generator** (`/studio/design`): prompt box with examples (including the spec's Malayalam ZatGo Van Sales ERP ad), size chips, language, brand kit, AI-background toggle (disabled without an image provider) and a credit estimate. Below it, the design library with search, duplicate, delete and "Blank design".
  * **AI Poster Generator** (`/studio/posters`): the same generator with occasion presets (Onam, Vishu, Eid, Diwali, Christmas, Ramadan, Grand opening, Flash sale) and story-size defaults.
  * **Editor** (`/studio/design/[id]`, react-konva):
    * Select, drag, resize and rotate with snapping guides to canvas edges and centre; double-click text to type on the canvas.
    * Layers panel (show/hide, lock, reorder), Add panel (heading, paragraph, rectangle, ellipse, image upload, brand logo), Background panel (colour, gradient, image with overlay), Copy panel (caption and hashtags with copy buttons).
    * Properties panel: text content, font, size, weight, line height, letter spacing, alignment, colour, CTA pill; shape fill and border; image fit, corner radius and replace; position, size, rotation and opacity; arrange and duplicate.
    * Undo/redo (100 steps), align to canvas, zoom (fit, steps), grid, keyboard shortcuts (arrows, Shift+arrows, Delete, Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, Ctrl+D).
    * Debounced autosave with a save-state indicator, a conflict banner with reload, and a warning before closing with unsaved changes.
    * Export PNG and JPG at full preset resolution, and PDF (jsPDF). Thumbnails are uploaded automatically for the library.
    * Version history dialog, Save as template, Duplicate.
    * Read-only mode for roles without `design:write`.
    * Fonts are loaded from Google Fonts and awaited before Konva measures text. Script fonts fall back to Inter for Latin characters.
  * **Brand Kit** (`/studio/brand-kit`): logo upload, five colours, heading and body fonts, tagline, contact details, AI guidelines, default kit.
  * **Templates** (`/studio/templates`): grouped by category, "Use template" and delete.
  * Navigation: AI Studio, Design, Posters, Templates and Brand Kit are now live. Video (Phase 16) and Copywriter (Phase 6) still show their phase.
* **Accessibility fixes** found by axe this phase: darker light-theme status colours for toasts, and dark text on the dark-theme destructive badge.

### Database changes
Migrations `20261109064731_phase5_design_studio` and `20261109065106_design_generation_options`:
* New tables `brand_kit`, `design` (with `DesignStatus`, `revision`, `generationOptions`, soft delete), `design_version` and `template`.
* All four are tenant-scoped models.
* Upload purposes gain `THUMBNAIL`.

### APIs
See `API_DOCUMENTATION.md` → Phase 5 endpoints (brand kits, designs, versions, templates).

### Tests and results (all passing)
| Suite | Result |
|---|---|
| API unit tests (composer, brief parsing) | ✅ 65 passed (33 new) |
| API e2e tests (15 files) | ✅ 70 passed (8 new design) |
| Web unit tests (editor reducer, geometry, export, fonts, studio helpers, nav) | ✅ 47 passed (23 new) |
| Lint, typecheck, build | ✅ |

The composer tests check, for every preset, that layers stay inside the canvas and safe area, plus long-text scaling, Arabic RTL, brand colours, fonts, logo and footer, and the gradient fallback.

The 8 design e2e tests cover:
* brand kit CRUD and the default rule
* Malayalam generation with a stored AI background, metered credits and version 1
* the gradient fallback without an image provider, and the JSON repair retry
* `FAILED` with `AI_BRIEF_INVALID` after two invalid briefs
* 503 with no text provider, and 402 at the credit limit
* revision conflicts (409) and rejection of another organization's files
* versions and restore, duplicate, thumbnail, templates and delete
* permissions (Viewer reads only) and tenant isolation of designs, brand kits and templates

**Browser run (Playwright, real local services):** API with the real Anthropic and OpenAI SDKs pointed at a local stand-in, S3 (moto) with GET/PUT CORS, and a production web build. 28 checks passed with no console errors:
* A brand kit was created with an uploaded logo and became the default.
* The spec's Malayalam ZatGo prompt opened the editor with a 7-layer document: Malayalam headline, subheadline, body, badge, WhatsApp CTA, footer and logo, over a stored AI background, using Noto Sans Malayalam.
* Edits worked: the headline text and colour, keyboard nudge, drag on the canvas, undo/redo with buttons and shortcuts, an image upload as a new layer, and reordering.
* After a reload, autosave had persisted the colour, position and text (revision 2).
* PNG export was 1080×1080; PDF export was a valid PDF.
* A named version was saved; Save as template worked, and "Use template" started a new design.
* The library showed a thumbnail.
* axe reported no serious or critical violations on the brand kit, generator, editor (light and dark), templates and posters pages.
* On an iPhone 14 viewport there was no horizontal page scroll.

### Remaining issues / notes
* **Not run against real provider APIs** (no keys yet). Generation uses the Phase 4 chain; add `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY` / `GEMINI_API_KEY`.
* **Bucket CORS must allow `GET`** from the web origin, otherwise the canvas cannot export designs containing stored images (see `INTEGRATIONS.md`).
* **Editor fonts come from Google Fonts.** Self-hosting them is a deployment option (Phase 21).
* **Global industry/festival template collections** are not included. Templates are organization-owned; curated platform templates belong to Super Admin (Phase 19).
* **Export file names are ASCII** because browsers drop non-ASCII names for downloaded blobs (a Malayalam-only title exports as `design-<size>.png`).
* **Not yet available:** multi-select, group editing, and resizing a design to another preset.

### Next phase
**Phase 6: AI Copywriter.** Headlines, captions, hashtags and ad copy in seven languages, with tone, audience, goal and platform controls, variants, regeneration and translation, saved as copy assets that can link to campaigns.

## Phase 6: AI Copywriter (✅ Completed)

### Features implemented
* **Copy model** (`packages/validation/src/copy.ts`):
  * 11 copy types: headline, social caption, hashtags, ad primary text, ad headline, ad description, product description, call to action, WhatsApp message, email subject, SMS.
  * 10 platforms, 8 tones and 6 goals.
  * Recommended lengths per type, plus the hard limits the platforms enforce: Instagram 2,200 characters and 30 hashtags, LinkedIn 3,000, Google Ads headlines 30 and descriptions 90, email subjects 150, and others.
  * Length is counted in user-perceived characters (a Malayalam conjunct or an emoji counts once).
  * SMS shows its segment count: 160 characters per message in the basic (GSM-7) alphabet, 70 for Malayalam, Arabic and emoji.
* **Generation** (`apps/api/src/copy/`):
  * Requests run synchronously through the Phase 4 provider chain (purpose `copywriter`), returning 1–5 variants that each take a different angle.
  * The prompts ask for native script in every language: natural Kerala Malayalam, and Modern Standard Arabic for GCC audiences.
  * The model may only use facts from the request and the brand kit (website, phone, WhatsApp, email, address, guidelines); it must not invent prices, dates or contact details.
  * Invalid JSON gets one repair retry, then fails with `AI_OUTPUT_INVALID`.
  * Hashtags are normalised and de-duplicated, and every variant carries its length check.
* **Translation:** one request localises copy into up to 6 languages. Afterwards, the service checks that every number, phone number and URL in the source appears in each translation, and adds a warning when one is missing or changed. Arabic-Indic digits count as equal.
* **Rewriting:** shorter, longer, more formal, more casual, more persuasive, add or remove emojis, or a custom instruction.
* **Copy library:** saved copy (`copy_asset`) with the request it came from and its sibling variants.
  * Search, plus filters by type, language and favourites (favourites are listed first).
  * Edit and soft delete.
  * Optional links to a brand kit, a source design and a future campaign (Phase 12).
* **Design translation:** `POST /designs/:id/translate` creates a new design with every text layer, the caption and the hashtags localised in one AI call.
  * Fonts switch only when the current font can't render the target script.
  * Direction and alignment follow the language (Arabic is right-to-left).
  * Font sizes shrink so the longer text fits each box.
  * Images and layout are kept; the original design is unchanged, and the copy gets its own first version.
* **Permissions:** new `copy:read` (every role) and `copy:write` (Owner, Admin, Marketing Manager, Designer).
* **Web:**
  * **AI Copywriter** (`/studio/copywriter`):
    * **Write tab:** type chips, a brief with examples (including the spec's Malayalam ZatGo Van Sales ERP prompt), language, platform, tone, goal, audience, keywords, brand kit, variant count, and emoji and hashtag toggles.
    * Each variant card shows its character count against the limit (with over-limit and SMS-segment details) and offers Copy, Save, Rewrite (with Undo) and Translate. Translations show side by side, right-to-left for Arabic, with any warnings and their own Copy and Save.
    * **Library tab:** search, filters, favourites, edit and delete.
  * **Design editor:**
    * "Rewrite with AI" on text layers. The result is a normal edit, so Ctrl+Z undoes it.
    * "Translate design" in the top bar opens the translated copy.
    * "Save to library" on the caption and hashtags (linked to the design).
  * Navigation: AI Copywriter is live.
* **Fixed (Phase 5 bug found by the new tests):** the editor's "Add button pill" used a corner radius of 999, which the document schema rejects (max 500), so autosave failed after adding a pill. It now uses 500, which the canvas still draws as a full pill.

### Database changes
Migration `20261109094751_phase6_copywriter`: new tenant-scoped table `copy_asset`, linked to organization, workspace, brand kit, source design and creator, with indexes on `(organizationId, updatedAt)` and `(organizationId, kind)`.

### APIs
See `API_DOCUMENTATION.md` → Phase 6 endpoints.

### Tests and results (all passing)
| Suite | Result |
|---|---|
| Validation unit (counting, limits, SMS, hashtags, translation safeguards, schemas) | ✅ 14 passed (9 new) |
| Types unit (permissions) | ✅ 7 passed (1 new) |
| API unit (prompts, output parsing, font and RTL localisation) | ✅ 71 passed (6 new) |
| API e2e (16 files) | ✅ 79 passed (9 new copy) |
| Web unit | ✅ 51 passed (4 new) |
| Lint, typecheck, build | ✅ |

The 9 copy e2e tests cover:
* Malayalam generation: brand facts and limits included, credits metered.
* The repair retry, and `AI_OUTPUT_INVALID` after two bad replies.
* Hashtag normalisation, and over-limit Google Ads headlines.
* Translation into Malayalam and Arabic, with the missing-number and missing-URL warning.
* Rewrite.
* Library: save, filter, favourite, edit and delete.
* 503 with no provider; 402 at the credit limit.
* Permissions (Viewer reads only, Designer writes) and tenant isolation, including another organization's brand kit.
* Design translation to Arabic: right-to-left, Noto Sans Arabic, shrunk text, original unchanged, version note, `SAME_LANGUAGE`.

**Browser run (Playwright, production build, real Anthropic SDK pointed at a local stand-in):** 24 checks passed with no console errors.
* Copywriter:
  * The Malayalam ZatGo example produced 3 variants with counts against the 300-character recommendation; the brand kit's WhatsApp number reached the prompt.
  * Save, rewrite shorter and undo all worked.
  * Translation to Arabic (right-to-left) and English, and saving a translation, worked.
  * In the Library: language and favourite filters, and editing, worked.
* Editor:
  * "Rewrite with AI" on the headline, then Ctrl+Z, restored the original.
  * The caption was saved with its design link.
  * Translate design → Arabic opened a new right-to-left design with Noto Sans Arabic.
* Accessibility and layout:
  * axe found no serious or critical violations on the copywriter (light and dark), the translate dialog, the library and the Arabic editor.
  * No horizontal scroll on an iPhone 14 viewport.

### Remaining issues / notes
* **Not run against real provider APIs** (no keys yet).
* **Copy quality:** the prompts are tuned for native Malayalam and Gulf Arabic, but real output should be reviewed by native speakers once keys are added.
* **Campaign links:** `campaignId` has no foreign key yet; it gets one with campaigns in Phase 12.
* **Translated design titles** keep the source title plus the language name (for example "… (Arabic)").

### Next phase
**Phase 7: CRM core.** Leads, contacts, companies, customers, deals, a drag-and-drop sales pipeline, activities and follow-ups, with import/export, duplicate detection, assignment and full activity history.
