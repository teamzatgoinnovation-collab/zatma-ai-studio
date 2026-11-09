# ZatGo AI Marketing: Project Overview

| | |
|---|---|
| **Product** | ZatGo AI Marketing (codename *ZatMa AI Studio*) |
| **Company** | ZatGo Innovation |
| **Type** | Multi-tenant AI Marketing Automation + CRM SaaS |
| **Tagline** | *Create. Market. Grow. Powered by AI.* |

## Vision
A single platform where a small business, SME or marketing agency can turn a plain-language
prompt into finished marketing (designs, copy, video, campaigns), publish it to the channels
its customers use, capture the resulting leads in a CRM, and measure what worked.

Example prompt the product must handle end-to-end:

> Create a Malayalam advertisement for ZatGo Van Sales ERP. Highlight 1 month free, monthly
> subscription, and WhatsApp contact. Use a modern blue enterprise design.

From that prompt the platform produces: an editable poster (with the exact text rendered as live
text layers, not baked into a generated image), copy in Malayalam / English / Arabic, captions,
hashtags, platform-specific sizes, optional video, a campaign, scheduled publishing, and tracking.

## Four core systems

| System | Purpose |
|---|---|
| **AI Studio** (Create) | Text-to-design, text-to-image, text-to-video, AI copywriter, brand kit, templates |
| **CRM** (Sell) | Leads, contacts, companies, customers, deals, Kanban pipeline, activities, follow-ups, AI lead scoring |
| **Marketing & Automation** (Market) | Campaigns, social publishing, content calendar, email, WhatsApp, landing pages, visual automation builder |
| **Advertising & Analytics** (Analyze) | Meta Ads, Google Ads, marketing / CRM / sales analytics, AI insights |

Cross-cutting: organizations & teams, RBAC, subscriptions & billing (Razorpay first), AI credits,
notifications, audit logs, super-admin console.

## Module list
AI Design Studio · AI Copywriter · AI Video Studio · Brand Kit · Template Library ·
CRM (Leads, Contacts, Companies, Customers, Deals, Pipeline, Activities, Follow-ups) ·
AI CRM Assistant · AI Lead Scoring · Social Accounts · Social Publishing · Content Calendar ·
Meta Ads Manager · Google Ads · Campaign Manager · Marketing Automation · Email Marketing ·
WhatsApp Marketing · Landing Pages & Lead Capture · Analytics · AI Marketing Assistant ·
Team Management · Notifications · Subscription & Billing · Super Admin.

## Target markets & languages
- **Markets:** Kerala and the rest of India first; GCC second; international later.
- **Languages for generated content:** English, Malayalam, Arabic (RTL), Hindi, Tamil, Kannada, Telugu.
- **Currency:** INR default, organization-configurable (AED, SAR, USD, …).

## Supported platforms (all through official APIs only)
Meta (Facebook + Instagram), WhatsApp Business Platform, LinkedIn, TikTok, YouTube, Google Ads,
Pinterest. Each needs its own credentials, permissions and, in most cases, app review. See
[INTEGRATIONS.md](./INTEGRATIONS.md).

## Product principles
1. **Real, not mocked.** No mock data, fake integrations or placeholder features presented as done.
2. **Human in the loop for money.** No ad spend without explicit user confirmation.
3. **Editable output.** AI output is a starting point the user can fully edit.
4. **Tenant isolation first.** One organization can never see another's data.
5. **Provider-agnostic AI.** Text, image and video providers can be swapped by cost, quality or speed.
6. **Phase-by-phase delivery.** Each phase is tested and verified before the next one starts.

## Suggested plans (starting point, not market-researched)
| Plan | Price (INR / month) | Headline limits |
|---|---|---|
| Free | ₹0 | Limited AI designs, basic CRM |
| Starter | ₹499 | 100 AI designs, CRM, basic publishing |
| Professional | ₹1,499 | 500 AI designs, scheduling, campaigns, automation |
| Business | ₹3,999 | Multi-brand, advanced CRM, team collaboration |
| Agency | Custom | Multiple client orgs, team management, white-label |

Ad spend is always billed by the ad platform directly, never through the subscription.
