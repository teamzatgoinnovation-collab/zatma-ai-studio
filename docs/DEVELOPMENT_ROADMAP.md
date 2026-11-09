# Development Roadmap

Phases are delivered **one at a time**. Each phase ends with lint, typecheck, tests and build,
an update to `IMPLEMENTATION_STATUS.md`, a phase report and a commit, and then **waits for
approval** before the next phase starts.

| # | Phase | Priority | Depends on | Key outcome |
|---|---|---|---|---|
| 0 | Project planning & docs | Critical | n/a | Architecture, DB design, roadmap, status tracker |
| 1 | Foundation & architecture | Critical | 0 | Monorepo, Next.js + NestJS, Prisma/Postgres, Redis/BullMQ, Docker, Swagger, base auth, tenancy, RBAC |
| 2 | Auth, organizations & SaaS billing | Critical | 1 | Full auth flows, invitations, org settings, Razorpay subscriptions, usage limits |
| 3 | Modern SaaS UI/UX | Critical | 1, 2 | Design system, full sidebar/topbar shell, command search, theming, states |
| 4 | AI provider integration | Critical | 1 | Provider interfaces + OpenAI/Anthropic/Gemini adapters, queueing, metering, fallback |
| 5 | AI Design Studio | Critical | 3, 4 | Prompt → brief → copy → image → layered editable design, editor, export, brand kit |
| 6 | AI Copywriter | Critical | 4 | Multi-language copy, tones, variants, translation |
| 7 | CRM core | Critical | 2, 3 | Leads, contacts, companies, customers, deals, Kanban, activities, follow-ups |
| 8 | AI lead scoring & intelligence | High | 4, 7 | Explainable, configurable scoring, next-best-action |
| 9 | Social account integration | Critical | 2 | Meta OAuth, Pages/IG business accounts, encrypted tokens, webhooks |
| 10 | Social publishing & calendar | Critical | 5, 9 | Compose, schedule (BullMQ), publish, retry, calendar views |
| 11 | Meta Ads manager | High | 9, 12 | Ad accounts, campaigns, ad sets, ads, insights, explicit spend approval |
| 12 | Campaign management | Critical | 5, 6, 7 | Unified campaigns across channels |
| 13 | Marketing automation | High | 7, 12 | React Flow builder, triggers/conditions/actions, run logs, loop prevention |
| 14 | Email & WhatsApp marketing | High | 7, 13 | ESP + WhatsApp Cloud API, consent, opt-out, templates |
| 15 | Landing pages & lead capture | High | 7, 13 | AI landing pages, forms, spam protection, attribution |
| 16 | AI Video Studio | Medium | 4, 5 | Script → storyboard → render (provider), MP4 export |
| 17 | Analytics & reporting | High | 7, 10–12 | Marketing/CRM/sales/campaign analytics, AI analyst, export |
| 18 | Notifications & collaboration | High | 2 | In-app/email notifications, comments, sharing, tasks |
| 19 | Super admin | Critical | 2, 4 | Platform metrics, org management, provider config |
| 20 | Security, testing & QA | Critical | all | Hardening, full test pyramid, E2E business flow |
| 21 | Deployment & infrastructure | Critical | 20 | Docker prod, HTTPS, backups, monitoring, CI/CD |
| 22 | Final integration & verification | Critical | all | End-to-end business workflow verified |

## Recommended delivery waves
1. **Wave A (Phases 0–7):** SaaS foundation, AI design and copy, working CRM. This is a product that can be sold.
2. **Wave B (Phases 8–12):** Social and Meta publishing, ads and campaigns.
3. **Wave C (Phases 13–17):** Automation, messaging, landing pages, video, analytics.
4. **Wave D (Phases 18–22):** Collaboration, admin, hardening, production deployment.

## External dependencies to start early (they take time)
* **Meta app review:** `pages_manage_posts`, `instagram_content_publish`, `ads_management`,
  `leads_retrieval`, `business_management`. This requires a verified business, a privacy
  policy URL and screencasts.
* **WhatsApp Business Platform:** a verified business, a phone number, and template approvals.
* **Razorpay:** KYC-activated account and subscription plans created in the dashboard.
* **Google Ads API:** a developer token (needs basic access approval).
* **AI provider keys** with billing enabled.
