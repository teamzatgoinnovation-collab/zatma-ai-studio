# Implementation Status

| Phase | Name | Status |
|---|---|---|
| 0 | Project planning & documentation | ✅ Completed |
| 1 | Foundation & architecture | ✅ Completed |
| 2 | Authentication, organizations & SaaS billing | ✅ Completed |
| 3 | Modern SaaS UI/UX | ✅ Completed |
| 4 | AI provider integration | ✅ Completed |
| 5 | AI Design Studio | ✅ Completed |
| 6 | AI Copywriter | ✅ Completed |
| 7 | CRM core | ✅ Completed |
| 8 | AI lead scoring & intelligence | ✅ Completed |
| 9 | Social media account integration | ✅ Completed (real accounts need app keys) |
| 10 | Social publishing & content calendar | ✅ Completed (live posting needs platform keys and App Review) |
| 11 | Ads manager (Meta + Google Ads) | ✅ Completed (awaiting approval for Phase 12; live use needs Marketing API access and a Google Ads developer token) |
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

## Phase 7: CRM core (✅ Completed)

### Features implemented
* **Shared CRM model** (`packages/validation/src/crm.ts`):
  * Lead statuses, sources, lifecycles, deal statuses, stage kinds, activity types and priorities.
  * Strict create, update and list schemas with search, filters and sorting.
  * **Phone numbers** are normalised to the international (E.164) format. The organization's currency sets the default country code: +91 for INR, +971 for AED, +966 for SAR, and so on. This handles trunk zeros (098… / 050…) and the 00 prefix.
  * **Duplicate keys:** emails are normalised, and company names are compared without legal suffixes (Pvt Ltd, LLP, LLC, FZE, W.L.L …).
  * **CSV:** an RFC 4180 parser (quotes, newlines in fields, BOM, comma or semicolon), capped at 5,000 rows and 2 MB; an exporter that neutralises spreadsheet formulas; and automatic column mapping from common header names.
* **API** (`apps/api/src/crm/`):
  * **Leads:** CRUD, filters (status, source, owner, tag, search), bulk status / assign / tag / delete.
  * **Duplicate detection:** creating a lead or contact whose email or phone already exists returns 409 `DUPLICATE_RECORD` with the matches; `allowDuplicate` overrides it. A lookup endpoint lets forms warn early.
  * **Lead conversion** (one transaction): creates or links a contact (matched by email or phone) and a company (matched by name), optionally creates a deal in the first stage of the default pipeline, moves the lead's activities across, and marks the lead CONVERTED.
  * **Contacts and companies:** CRUD and timelines. **Customers** are contacts with lifecycle CUSTOMER, shown with their lifetime won value.
  * **Pipelines:** a default pipeline is created on first use (New Lead → Contacted → Qualified → Proposal → Negotiation → Won / Lost). Stages can be added, edited and reordered; a stage can only be deleted when it is empty, or after its deals are moved.
  * **Deals:**
    * CRUD.
    * A Kanban board with counts and value totals per column.
    * Moves use fractional positions, renumbering a column when needed.
    * Won and Lost stages close the deal (status, probability, close date); a lost deal needs a reason.
    * Winning a deal makes its contact a customer.
  * **Activities:**
    * Types: call, WhatsApp, email, meeting, note, task and follow-up.
    * Logging a contact activity sets "last contacted" and moves a NEW lead to CONTACTED.
    * Open tasks keep "next follow-up" up to date.
    * Follow-ups are listed by overdue / today / next 7 days / all, using the user's time zone.
  * **CSV import:** preview with automatic mapping; the job runs on the BullMQ `crm-import` queue as the importing user; duplicates can be skipped, have their empty fields filled in, or be created anyway; errors are recorded per row; the plan limit is enforced; progress can be polled.
  * **CSV export** for leads, contacts, companies and deals, respecting the current filters and the user's visibility.
  * **Summary:** leads by status, open pipeline value, deals won this month, follow-ups due today and overdue.
  * Every write is audited.
* **Record visibility:**
  * Owner, Admin and CRM Manager see and manage everything.
  * **Sales Agents** see and edit only records they own: other records return 404, they cannot reassign, and everything they create is owned by them.
  * Read-only roles see everything but cannot change it.
  * Companies are shared reference data that everyone can see; Sales Agents can edit only the ones they own.
* **Plan limit:** a new `crmRecords` entitlement (contacts + leads): Free 500, Starter 5,000, Professional 25,000, Business 100,000, Agency unlimited. It is enforced on create and import, and shown on the Billing usage page.
* **Web** (`/crm/*`, all live):
  * **Overview:** stats and leads-by-status bars.
  * **Lists:** Leads, Contacts, Customers, Companies and Deals, with search, filters, owner filter (managers), pagination, CSV export, and bulk status / assign / delete on leads.
  * **Create/edit sheets:** field errors, a duplicate warning on blur with "Create anyway", and an owner picker (managers only; defaults to the current user).
  * **CSV import dialog:** upload → column mapping → duplicate policy and tag → progress → result with per-row errors.
  * **Detail pages** for leads, contacts and companies:
    * Fields, plus Call / WhatsApp (`wa.me`) / Email quick actions.
    * An activity composer (log call / WhatsApp / email / meeting / note, or schedule a follow-up) and a timeline.
    * Convert (contact, company and deal), and delete for managers.
  * **Sales Pipeline:** a Kanban with native drag and drop, a "Move to" menu and Alt+←/→ keyboard moves; confirmation for Won and a reason for Lost; column totals; owner filter and search; a deal side panel with its own timeline.
  * **Activities** list and **Follow-ups:** Overdue / Today / Next 7 days / All, with complete and reopen.

### Database changes
Migration `20261109110234_phase7_crm`:
* New tenant-scoped tables `company`, `contact`, `lead`, `pipeline`, `pipeline_stage`, `deal`, `activity` and `crm_import`, with enums for status, lifecycle, stage kind, activity type and priority.
* Duplicate-key and owner indexes, and soft delete everywhere.
* `lead.score` / `scoreReason` are reserved for Phase 8 and `contact.consent` for Phase 14.
* A data update adds `crmRecords` to every plan's limits.

### APIs
See `API_DOCUMENTATION.md` → Phase 7 endpoints.

### Tests and results (all passing)
| Suite | Result |
|---|---|
| Validation unit (phone/email/company normalisation, CSV parse/export, auto-mapping, schemas) | ✅ 24 passed (10 new) |
| API unit (visibility scope, Kanban positions, import helpers, time zones) | ✅ 76 passed (5 new) |
| API e2e | ✅ 86 passed (7 new CRM) |
| Web unit (money/date/query helpers, Kanban reorder, nav) | ✅ 55 passed (4 new) |
| Lint, typecheck, build | ✅ |

The CRM e2e tests cover:
* Lead CRUD, filters and search.
* Duplicates in another phone format (409, and `allowDuplicate`).
* Activities updating the dates and status; follow-up ranges.
* Conversion with company re-use and moved history.
* Pipeline moves, ordering, totals, win → customer, and the lost reason.
* Stage rules.
* CSV import with mapping, skipped duplicates, per-row errors and formula-safe export.
* The plan limit on create and import.
* Sales Agent visibility, assignment and delete rules; Viewer read-only; CRM Manager delete.
* Tenant isolation for every entity.

**Browser run (Playwright, production build, real local services):** 25 checks passed with no console errors.
* A lead created from the sheet is owned by its creator.
* A duplicate warning appears for the same phone typed differently, and creating it is blocked with "Create anyway".
* CSV import of Kerala and UAE leads: columns mapped automatically, 4 created and 1 duplicate skipped.
* The source filter and CSV export work.
* The WhatsApp link opens `wa.me/91…`.
* Logging WhatsApp moved the lead to Contacted, and a follow-up was scheduled.
* Converting created a contact, company and ₹1,50,000 deal, with the history moved.
* Dragging the deal to Proposal, then Won, made the contact a customer.
* The follow-up appeared under "Next 7 days" and was completed.
* A Sales Agent sees only their own lead and has no owner picker.
* axe found no serious or critical violations on the import dialog, leads, lead detail, pipeline (light and dark), follow-ups and overview.
* No horizontal scroll on mobile.

### Remaining issues / notes
* **Not included here:** AI lead scoring and next-best-action are Phase 8. Sending WhatsApp, email and SMS from the CRM is Phase 14; the quick actions open the user's own phone, WhatsApp or email app.
* **Custom fields** are stored and returned by the API, but there is no UI yet to define or edit them.
* **Companies are visible to Sales Agents** (shared reference data) even when owned by a colleague; their contacts and deals stay owner-scoped.
* **Imports** are capped at 5,000 rows and 2 MB per file. Larger files must be split.

### Next phase
**Phase 8: AI lead scoring & intelligence.** Explainable, configurable lead scores using the fields reserved in this phase, next-best-action suggestions and AI-drafted follow-up messages.

## Phase 8: AI lead scoring & intelligence (✅ Completed)

### Features implemented
* **Explainable lead score** (`packages/validation/src/scoring.ts`): a deterministic, pure 0–100 score that is the sum of 12 weighted signals. Each signal records its points and a plain-language reason.
  * **Fit:** reachability (phone, WhatsApp, email); business lead (has a company); decision maker (whole-word match on job title); target industry and city; source quality (referral > walk-in > website / WhatsApp > ads > import).
  * **Engagement:** recency of contact (15 / 12 / 8 / 4 points for 3 / 7 / 14 / 30 days); interactions in the last 14 days; an upcoming follow-up; qualification status.
  * **Risk:** no contact for more than 30 days (−10); an overdue follow-up (−8).
  * Unqualified and lost leads score 0, with the reason shown.
  * Grades are Hot, Warm and Cold, with configurable thresholds (70 / 40 by default).
  * **AI never sets the score.**
* **Scoring settings** per organization (`organization.crmSettings.scoring`): a weight per signal (off, 0.5×, 1×, 1.5×, 2×, 3×), target industries and cities, decision-maker keywords, and the thresholds. Managers edit them in **Settings → CRM scoring**; saving recalculates every lead on the BullMQ `crm-scoring` queue.
* **Score updates:**
  * Immediately on lead create and update, bulk status changes, CSV import, and any activity change (log, complete, delete, follow-up).
  * A nightly scheduled job (21:30 UTC, 03:00 IST) refreshes recency decay and overdue penalties for every organization.
* **AI insights** (optional, metered with purpose `crm`, cached on the lead):
  * A summary, the next best action (call, WhatsApp, email, meeting, nurture or disqualify, plus when) with its reason, talking points, and a drafted WhatsApp or email follow-up in the chosen language.
  * Grounded only in the lead's own fields, its activity history, its score breakdown and the brand kit; the model is told never to invent prices, dates, promises or contacts.
  * One repair retry, then `AI_OUTPUT_INVALID`.
  * "Schedule it" turns the suggestion into a high-priority follow-up.
* **AI-drafted messages for contacts:** WhatsApp, email or SMS, with a goal (follow up, re-engage, thank you, meeting request, offer) and an optional extra note. Nothing is sent: the user copies the text or opens it in WhatsApp.
* **Web:**
  * **Leads list:** a score column (grade and value, with the top reasons as a tooltip and screen-reader text), a "Highest score" sort and a grade filter.
  * **Lead detail:** a "Lead score" card with a meter and every signal's points and reason, and an "AI insights" card with language choice, Generate / Refresh, next best action with Schedule it, talking points, and the drafted message with Copy and Open in WhatsApp (Arabic shown right-to-left).
  * **Contact detail:** a "Draft message" dialog.
  * **CRM overview:** Hot / Warm / Cold counts and a "Call first" list of the top five open leads with their reasons.
  * **Settings → CRM scoring:** weight sliders, ideal-customer fields and thresholds (read-only for non-managers).
* **Accessibility fix:** the shared red "danger" badge had 3.78:1 contrast in the light theme. It now uses a new `--destructive-text` token, as the success and warning badges do. This also improves the "Lost" and "Overdue" badges from Phase 7.

### Database changes
Migration `20261110152942_phase8_lead_scoring`:
* `lead` gains `scoreGrade`, `scoreBreakdown` (JSON), `scoredAt`, `aiInsights` (JSON) and `aiInsightsAt`, plus an index on `(organizationId, score)`.
* `organization` gains `crmSettings` (JSON).

### APIs
See `API_DOCUMENTATION.md` → Phase 8 endpoints.

### Tests and results (all passing)
| Suite | Result |
|---|---|
| Validation unit (every signal, decay, penalties, weights and targets, caps, thresholds, determinism, settings and insights schemas, due dates) | ✅ 32 passed (8 new) |
| API unit (insights prompt grounding, activity summaries) | ✅ 78 passed (2 new) |
| API e2e | ✅ 93 passed (7 new) |
| Web unit | ✅ 56 passed (1 new) |
| Lint, typecheck, build | ✅ |

The 7 scoring e2e tests cover:
* Scores on create and the full breakdown.
* The score rising with a call, rising with a planned follow-up, falling when it becomes overdue, and 0 when lost.
* Sort and grade filter; the summary's grade counts and Call-first list (lost leads excluded).
* Settings validation, then the queued recalculation applying new weights and thresholds.
* Insights: 503 with no provider; a repair retry; cached and metered; invalid output → 422.
* A grounded draft message for a contact.
* Sales Agents can't see others' scores or insights, or change settings; Viewers can read scores but not generate insights; tenant isolation, with each organization keeping its own defaults.

**Browser run (Playwright, production build, real Anthropic SDK pointed at a local stand-in):** 18 checks passed with no console errors.
* The lead scored 57 (Warm) on create.
* "Highest score" sort and the grade filter worked.
* Five explained signals were shown.
* Logging a call raised the score to 75 (Hot).
* Malayalam AI insights were generated, with a `wa.me` link carrying the drafted text.
* "Schedule it" added a follow-up (+6, giving 81).
* Turning source quality off and raising Hot to 80 rescored the lead to 69 (Warm).
* The overview's Call-first list puts the lead first.
* A contact email draft was generated.
* axe found no serious or critical violations on the leads, lead detail (light and dark), scoring settings, overview and draft dialog.
* No horizontal scroll on mobile.

### Remaining issues / notes
* **Not run against real provider APIs** (no keys yet). Malayalam and Arabic drafts should be reviewed by native speakers once keys are added.
* **The score is rule-based by design.** A learned model (for example, trained on won and lost history) can be added later behind the same breakdown format.
* **The nightly job time** (21:30 UTC) is platform-wide, not per organization time zone.

### Next phase
**Phase 9: Social media account integration.** OAuth connections for Facebook Pages, Instagram Business, LinkedIn and YouTube, with encrypted token storage, refresh, health checks and account selection per workspace. This needs app credentials from each platform.

## Phase 9: Social media account integration (✅ Completed; platform keys pending)

### Features implemented
* **Platforms:** Facebook Pages and Instagram Business accounts (Meta), LinkedIn company Pages, and YouTube channels. Each uses the platform's official OAuth and REST API (`apps/api/src/social/providers/`), with `fetch` only and no SDKs.
  * **Meta:** Facebook Login dialog; code exchange, then a long-lived token (`fb_exchange_token`); `/me/accounts` with pagination for Pages, their Page tokens and linked Instagram Business accounts. `appsecret_proof` is sent on every call. Graph error 190 and similar map to "reconnect needed".
  * **LinkedIn:** 3-legged OAuth; `organizationAcls` (approved ADMINISTRATOR) then `organizations/{id}`. Versioned REST headers; refresh and revoke.
  * **YouTube:** Google OAuth with PKCE, offline access and forced consent; `channels?mine=true`; refresh (`invalid_grant` means reconnect needed); revoke.
* **A platform is enabled only when its keys are set.** Otherwise the UI shows *Not configured* with the exact variables an admin must set and a link to the setup guide. Nothing is faked.
* **Encrypted token storage:**
  * AES-256-GCM `TokenCipher` with key ids for rotation, and the row identity bound as associated data.
  * Grants (`social_connection`) are stored separately from publishable accounts (`social_account`), so one login can provide many Pages.
* **Connect flow:**
  * Server-side single-use OAuth state (Redis, 10 minutes) bound to the signed-in user, with a same-site return path.
  * A friendly result when the user cancels or the link expires.
  * After the redirect, the **Choose accounts** dialog lists every Page, Instagram account, LinkedIn Page or channel the login can manage, marks the ones already connected, and assigns them to workspaces.
  * **Reconnect** updates the same grant in place and reactivates its accounts.
* **Account management:**
  * Status badges (Active / Reconnect needed / Error), last check time and who connected the account.
  * **Check now**; **Workspaces** (empty means all); **Disconnect** with confirmation. Disconnecting the last account of a login revokes it on the platform and deletes the tokens.
  * A plan usage meter. The `socialAccounts` plan limit is now real: it counts connected accounts and is enforced when adding.
* **Token health:**
  * Tokens are refreshed automatically within 5 minutes of expiry.
  * A daily BullMQ job (`social-health`, 22:15 UTC) refreshes grants that expire within 7 days, flags Meta grants for reconnection 7 days before expiry (Meta user tokens can't be refreshed), and checks every account.
  * The first time an account needs re-authorisation, it writes an activity entry and emails the person who connected it.
* **Meta platform callbacks:**
  * Webhook verification challenge, and signed events (`X-Hub-Signature-256` over the raw body) stored for later phases.
  * `permissions` revocations, the deauthorize callback and the data-deletion callback (with confirmation URL and status page) are all handled.
* **Web:** a new live nav leaf, **Marketing → Social Accounts** (`/marketing/accounts`), with provider cards, the account picker, a workspaces dialog, error alerts, and a read-only view for users without `social:connect`. Activity-feed labels were added for all social events.

### Database changes
Migration `20261111024432_phase9_social_accounts`:
* New enums: `SocialConnectionStatus`, `SocialAccountStatus`.
* New tables: `social_connection`, `social_account` (both tenant-scoped through the Prisma tenant extension) and `social_webhook_event`.

### APIs
See `API_DOCUMENTATION.md` → Phase 9 endpoints. New env variables are listed in `apps/api/.env.example` and in `INTEGRATIONS.md` → Social accounts.

### Tests and results (all passing)
| Suite | Result |
|---|---|
| Validation unit (connect, return-path and account schemas) | ✅ 34 passed (2 new) |
| API unit (token cipher: round trip, tampering, wrong associated data, rotation; each adapter against a fake `fetch`: URLs, scopes, PKCE, long-lived upgrade, pagination, error mapping) | ✅ 91 passed (13 new) |
| API e2e | ✅ 102 passed (9 new) |
| Web unit (error messages, workspace summary, sorting) | ✅ 59 passed (3 new) |
| Lint, typecheck, build | ✅ |

The 9 social e2e tests cover:
* The providers list and the *Not configured* state (503).
* The connect round trip, with encrypted tokens at rest and the associated data checked.
* Rejected callbacks: reused state, another user's state, no session, cancelled, failed exchange, and an absolute `returnTo`.
* PKCE and automatic refresh for YouTube.
* Re-auth detection with the email and audit entry, then reconnecting in place.
* The health job: Meta grants near expiry, and failed refreshes.
* Meta webhooks: challenge, valid and invalid signatures, deauthorize, data deletion and its status page.
* Disconnect revoking the grant only after the last account.
* Plan limit (402), tenant isolation (404), Viewer read-only and Marketing Manager connect.
* No token or ciphertext appears in any response.

**Browser run (Playwright, production build, API pointed at a local stand-in for Meta, LinkedIn and Google):** 25 checks passed with no console errors. The stand-in checks client secrets, redirect URIs, `appsecret_proof` and PKCE the way the real services do.
* Three platforms shown as configured.
* Meta: the redirect returns to a clean URL; the picker shows 2 Pages and 1 Instagram account; one Page and its Instagram account are connected to the "Kochi Store" workspace.
* LinkedIn and YouTube were connected, with PKCE used for YouTube.
* The usage meter showed 4 of 10.
* Check now worked.
* After the YouTube grant was invalidated: *Reconnect needed*, the email was sent, Reconnect worked, and the account was Active again.
* The workspace change was saved.
* Disconnecting LinkedIn revoked the token at the platform.
* No tokens in API responses.
* The error alert was shown.
* axe found no serious or critical violations: empty, picker, connected, reconnect, dark theme, and *Not configured* (API restarted without keys).
* No horizontal scroll on mobile.

### Remaining issues / notes
* **Real accounts need platform credentials and approvals:**
  * Meta App Review and Business Verification.
  * LinkedIn Community Management API access.
  * Google OAuth consent-screen verification for the YouTube scopes.

  Setup steps, redirect URIs and webhook URLs are in `INTEGRATIONS.md`. Not tested against live platform APIs yet.
* **TikTok and Pinterest** are not part of this phase. They follow the same adapter interface when added.
* **Webhook events are stored but not yet acted on** (beyond revocations). Phases 10 and 13 consume them.
* **The health job time** (22:15 UTC) is platform-wide.

### Next phase
**Phase 10: Social content management.** Compose posts with platform previews and validation, a content calendar, scheduling, and publishing to the accounts connected here, with status tracking and retries.

## Phase 10: Social publishing & content calendar (✅ Completed; platform keys pending)

### Features implemented
* **Publishing to Facebook Pages, Instagram Business, LinkedIn Pages and YouTube** through each platform's official API (see INTEGRATIONS → Social publishing).
  * Supported: text, a single image, multi-image (Facebook up to 10, Instagram carousel 2–10, LinkedIn up to 20) and video (Facebook video, Instagram Reels, LinkedIn video, YouTube upload).
  * Every step saves its progress (`providerState`), so retries resume instead of re-posting.
* **Composer** (`/marketing/social/new`):
  * Choose accounts (filtered by workspace; accounts needing reconnection are disabled).
  * Write once with hashtag chips; customise the text per account; YouTube title, visibility and made-for-kids.
  * **Media:**
    * Upload images or video; dimensions and duration are read in the browser, and PNG/WebP are converted to JPEG so they work on Instagram.
    * **Add design** renders a saved design at full size off-screen with the editor's canvas and adds it as a JPEG.
    * Alt text for each image.
  * **Insert copy** from the AI Copywriter library.
  * **Live checks** with the shared platform rules: character limits counted in graphemes, so Malayalam counts correctly; hashtags; media counts, types, aspect ratio and duration. Problems block publishing; warnings only inform.
  * Platform-shaped previews showing where each feed cuts the text ("…more").
* **Actions:**
  * Save draft; Submit for approval.
  * Schedule, in the organization's time zone, with the user's local time shown when it differs.
  * **Publish now**, behind a confirmation that lists the accounts.
* **Approval workflow:**
  * Designers draft and submit; managers approve or request changes, with a note and an email to the author.
  * **Settings → Publishing** can require approval for everyone. No self-approval except Owner and Admin, and editing an approved post needs approval again.
* **Post page:** per-account status, live links ("View post"), the failure reason and **Retry**, Unschedule, Duplicate, Delete. It refreshes while publishing.
* **Posts list:** tabs (All, Drafts, Pending approval, Scheduled, Published, Failed) and the monthly quota meter.
* **Content calendar:**
  * Month, Week, Day and List views in the organization's time zone, with workspace and platform filters.
  * **Drag a scheduled post to another day** (the time is kept), or use the keyboard-accessible "Reschedule" button on each post.
  * "+" on any future day starts a post for 10:00 that day.
* **Marketing overview** (`/marketing`): scheduled in the next 7 days, posts this month, waiting for approval, accounts and failed posts needing attention, and an "Up next" list. The Marketing section is now live in the navigation.
* **Entry points:** "Schedule post" in the design editor and on copy library items.
* **Queue and reliability:**
  * The `social-publish` queue runs delayed jobs per post and one job per account.
  * Retries back off over 30 s, 2 min, 8 min and 32 min (5 attempts).
  * One publish at a time per account; a sweeper every minute; compare-and-set locks; audit entries and failure emails.
* **Plan limit:** `postsPerMonth` counts published plus scheduled posts per account per UTC month (Free 10, Starter 60, Professional 300, Business 1,500, Agency unlimited). It is checked when scheduling, publishing and retrying.
* **Also fixed: a data-loss bug in earlier phases.**
  * Cause: Zod 4 still applies `.default()` inside `.partial()`.
  * Effect: `PATCH /crm/leads/:id { firstName }` silently reset the lead's status to New, its source to Other, and cleared its tags and custom fields. Contacts, companies, deals and pipeline stages (a Won stage reverted to Open) were affected the same way.
  * Fix: the new `withoutDefaults()` helper. A scan confirms no update schema injects defaults any more; scoring settings are a full replace by design.

### Database changes
Migration `20261111052314_phase10_social_publishing`:
* Enums `SocialPostStatus` and `SocialPostTargetStatus`.
* Tables `social_post` and `social_post_target` (tenant-scoped).
* `organization.socialSettings`.
* Plan limits updated with `postsPerMonth`.

### APIs
See `API_DOCUMENTATION.md` → Phase 10 endpoints. New env `YOUTUBE_UPLOAD_URL` (default `https://www.googleapis.com/upload/youtube/v3`). The upload purpose `POST_MEDIA` allows images up to 20 MB and MP4/MOV videos up to 250 MB.

### Tests and results (all passing)
| Suite | Result |
|---|---|
| Validation unit | ✅ 48 passed (14 new) |
| API unit | ✅ 103 passed (12 new) |
| API e2e | ✅ 111 passed (9 new) |
| Web unit | ✅ 64 passed (5 new) |
| Lint, typecheck, build | ✅ |

**Validation unit tests:**
* Every platform rule, grapheme counting, hashtags (including Malayalam combining marks), media kinds and counts, aspect ratio, Reel duration, and the YouTube fields.
* Schedule and calendar bounds, time zones (IST, Gulf Standard Time and London across the clock change), the quota window, upload size and type per purpose.
* PATCH schemas don't inject defaults.

**API unit tests:** each adapter against a fake `fetch`:
* Facebook multi-photo that resumes without re-uploading.
* Instagram carousel, polling while processing, a single publish, expired-container restart, and permanent errors.
* LinkedIn little-text escaping, image upload, and multipart video resuming after a failed part.
* YouTube chunked upload that resumes from the stored session, and a new session after expiry.
* Error classification.

**API e2e tests:**
* Settings per role.
* Drafts: workspace and account checks, media from storage only, a caption-only edit keeping accounts and media, dry-run validation, duplicate, delete.
* Publish now needs `confirm`, then reaches all four platforms; usage counts.
* Schedule, reschedule (old job removed), cancel, calendar range.
* The full approval flow, including emails and self-approval rules.
* Partial failure, then a retry without re-posting.
* Transient error retried with saved progress; Instagram processing; token error leading to *Reconnect needed* and an email.
* The sweeper recovers a lost job.
* Quota 402, tenant isolation, read-only Viewer.
* No tokens in responses.
* New CRM regression test: partial updates keep status, source, tags, custom fields and stage kind.

**Browser run** (Playwright, production build, real BullMQ workers, API pointed at the extended local stand-in): **34 checks passed with no console errors.**
* Design rendered at 1080×1080 and published to Facebook (the photo fetched from storage), Instagram and LinkedIn (hashtag markup); live links appeared.
* YouTube resumable upload of a real MP4 (65,496 bytes received).
* Instagram text-only blocked live.
* Forced LinkedIn failure: *Partly published*, the reason shown and emailed, then Retry published it.
* A Designer submitted; the Owner approved (author emailed) and scheduled it, and the queue published it on time.
* Calendar drag moved a post to the next day at the same time.
* axe found no serious or critical violations on the composer, published and partly-published post pages, calendar (month, list, dark), overview, publishing settings and posts list.
* No horizontal scroll on the mobile composer or calendar.
* Found and fixed during the run: the calendar month title showed the first grid cell's month ("October" on 11 November).

### Remaining issues / notes
* **Live platforms not tested yet.** Publishing needs the app keys from Phase 9 plus App Review (`pages_manage_posts`, `instagram_content_publish`), LinkedIn `w_organization_social`, and YouTube consent-screen verification and quota.
* **Production storage must be internet-reachable** (Cloudflare R2 or S3) so Meta can fetch media from signed URLs.
* **Not included yet:** Instagram video carousels, first comments, location and user tags, thumbnails and captions for videos, and per-post analytics (Phase 17).
* **Monthly quota boundaries** are in UTC; schedules for later months are counted when that month starts.

### Next phase
**Phase 11: Meta Ads manager.** Ad account connection, an AI campaign builder (objective, audience, budget, creative from designs and copy), and campaign, ad set and ad management with insights. **Nothing will spend money without explicit approval.**

## Phase 11: Ads manager, Meta + Google Ads (✅ Completed; platform access pending)

### Features implemented
* **Connections:**
  * Meta Ads, through the same Meta app with Marketing API scopes.
  * Google Ads, through its own OAuth client with PKCE, offline access and a developer token; client accounts under a manager (MCC) are found automatically.
  * Choose ad accounts, assign workspaces, refresh, and remove.
  * New plan limit `adAccounts`.
* **Campaign builder** (`/ads/campaigns/new`), in 5 steps:
  1. Account and goal.
  2. Budget and schedule, with a live "most this can spend" figure and the cap context.
  3. Audience:
     * Meta: locations and interests searched on the platform, age, gender.
     * Google: locations, languages, keywords with broad/phrase/exact.
  4. Ad:
     * Meta: Facebook Page, an image from the **design library** (rendered at full size) or an upload, primary text / headline / description with counters, CTA, link; WhatsApp or Messenger for Messages; instant-form editor for Leads; up to 3 text variants.
     * Google: responsive search ad with 3–15 headlines and 2–4 descriptions, final URL and paths.
  5. Review, with live validation from the shared rules.
* **Draft with AI:**
  * Proposes a name, a budget (capped at the user's maximum), an audience, ad text and keywords/RSA.
  * Locations and interests are resolved on the platform, and unresolved terms are reported.
  * Nothing is saved until the user saves.
* **Objectives:**
  * Meta: Traffic, Engagement, Messages (WhatsApp / Messenger), Awareness, Leads (instant forms).
  * Google: Search.
* **Spend control:**
  * Created **PAUSED** on the platform.
  * **Owner/Admin only** may activate or raise a running budget, through a dialog showing the maximum possible spend and requiring the campaign name to be typed. The server recomputes the maximum.
  * Optional **monthly spend cap** per ad account.
  * Every approval is recorded and audited, and other Owners/Admins are emailed.
  * Anyone managing ads can **pause**.
* **Campaign page:**
  * Status, structure, errors from the platform, and approval history.
  * **Results:** 8 KPI tiles and a daily spend chart (accessible columns with hover/focus tooltips and a table view), 7 or 30 days.
* **Background sync** (hourly and nightly):
  * Imports campaigns created in Ads Manager or Google Ads, mirrors status changes made on the platform, and stores daily insights.
  * **Never activates or raises budgets.**
* **Lists and navigation:**
  * A campaigns list with platform, status and account filters.
  * Account pages showing spend, committed spend and the cap meter.
  * The Advertising nav section is live; Ad Analytics remains Phase 17.

### Database changes
Migration `20261111071024_phase11_ads`:
* Tables `ad_account`, `ad_campaign`, `ad_group`, `ad`, `ad_insight_daily` and `ad_approval` (all tenant-scoped).
* Enums `AdPlatform`, `AdCampaignStatus` and `AdBudgetType`.
* Plan limits gained `adAccounts`.
* New permission `ads:approve` (Owner/Admin).

### APIs
See `API_DOCUMENTATION.md` → Phase 11 endpoints. New env: `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID`, `GOOGLE_ADS_API_VERSION`, `GOOGLE_ADS_API_URL`.

### Tests and results (all passing)
| Suite | Result |
|---|---|
| Validation unit | ✅ 55 passed (7 new) |
| API unit | ✅ 112 passed (9 new) |
| API e2e | ✅ 118 passed (7 new) |
| Web unit | ✅ 64 passed |
| Lint, typecheck, build | ✅ |

**Validation unit tests:**
* Exact money conversions (minor units, zero-decimal currencies, micros; no float drift).
* Maximum spend: lifetime, daily with an end date, open-ended to month end, a future start, and the share in this month.
* Objective requirements, creative limits, the RSA rules, and Google's daily-only and no-schedule rules.
* Spend confirmation schema; PATCH without defaults.

**API unit tests** (adapters against a fake `fetch`):
* **Meta:**
  * The full create chain with every object PAUSED, minor-unit budgets and `appsecret_proof`.
  * Resuming after a failure without recreating anything; WhatsApp message and lead-form ads.
  * Activation order and pause-only-the-campaign.
  * Insights parsing; user-facing error messages; token errors.
* **Google:**
  * Manager client discovery with the developer-token and `login-customer-id` headers.
  * `validateOnly` before an atomic create, with the campaign PAUSED and micros.
  * Status and budget updates; GAQL insights.
  * Errors: an unapproved developer token, quota retries, policy messages, and authentication errors.

**API e2e tests:**
* Connect and the plan limit; only Owner/Admin may set caps.
* Draft validation; creation PAUSED with resume after a transient failure; a permanent error shown.
* **Spend rules:**
  * A Manager gets 403.
  * Missing confirmation gets 400; a lower maximum gets `SPEND_CHANGED`; going over the cap gets `SPEND_CAP_EXCEEDED`.
  * An Owner succeeds, with approval, audit and the adapter call log checked.
  * A budget increase needs approval; a decrease doesn't; anyone managing ads can pause.
  * An Admin's approval emails the Owner.
* The sync imports and mirrors without ever activating (asserted on the call log); insights totals (CTR, CPC, CPM).
* Google Search creation; AI draft with platform-resolved targeting, a capped budget and unresolved terms reported, nothing saved.
* Tenant isolation, read-only Viewer, and account removal blocked while a campaign is active.

**Browser run** (Playwright, production build, real workers, API pointed at the extended local stand-in for the Meta Marketing API, Google Ads REST and an AI model): **27 checks passed with no console errors** (one expected 409 from the cap check).
* Meta and Google accounts connected; a cap set.
* An AI-drafted Meta Traffic campaign: Kochi and Shopping resolved on the platform, the budget capped at ₹1,500/day, two variants using a design rendered from the library.
* Review showed "most this can spend ₹28,500".
* Created with every object PAUSED.
* A Manager sees no Activate button.
* The Owner was blocked by a ₹10,000 cap, then activated within ₹50,000; the stand-in saw ads → ad set → campaign activated in that order.
* Insights chart with tooltip and a table view; the Manager paused it.
* An AI-drafted Google Search campaign was validated, then created PAUSED.
* axe found no serious or critical violations: account page, builder review, activate dialog, campaign results (light and dark), campaigns list.
* No horizontal scroll on mobile.

**Found and fixed during the run:**
* The chart used `role="img"` around focusable columns (axe nested-interactive); it is now a labelled group.
* The chart scaled its SVG, enlarging text and columns; it now renders at the real pixel width.
* Mobile date labels collided; they are now spaced by pixel width.
* One run showed an intermittent React hydration warning (#418) that did not reproduce in three later runs, even with URL tagging; it is noted for Phase 20 QA.

### Remaining issues / notes
* **Live platforms not tested yet.** Meta needs Marketing API App Review / Advanced Access and Business Verification; Google needs a developer token with Basic access and a verified consent screen.
* **Not built yet:**
  * Google Display, Video and Performance Max.
  * Meta video ads and carousels.
  * Automatic import of Meta lead-form leads into the CRM (Phase 13, `leads_retrieval`).
  * Conversion tracking (Pixel / CAPI, Google conversions).
* **Spend cap scope:** the cap counts recorded spend plus the committed maximum of campaigns activated in ZatGo. Campaigns activated directly on the platform are mirrored, and they count once their status syncs.
* **Insights** are as fresh as the hourly sync, and platforms may revise recent days. The nightly 30-day sync re-reads them.

### Next phase
**Phase 12: Campaign management.** Multi-channel campaigns that group organic posts, ads, budgets, audiences and leads, with schedule, assets and conversion tracking across channels.
