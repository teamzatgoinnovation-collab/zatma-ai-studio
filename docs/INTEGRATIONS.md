# Integrations

Every integration uses the **official API only**. Where credentials or platform approval are
missing, the integration is built behind an interface and marked **Pending** here. It is never
presented as connected.

| Integration | Purpose | Phase | Credentials / approvals required | Status |
|---|---|---|---|---|
| **Better Auth + Google OAuth** | Sign-in with Google | 1–2 | Google Cloud OAuth client (`GOOGLE_CLIENT_ID/SECRET`), consent screen, redirect URI `${WEB_URL}/api/auth/callback/google` | Implemented; button appears automatically once credentials are set |
| **Razorpay** | Subscriptions (INR, UPI, cards) | 2 | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, KYC-activated account, plans created | **Implemented** (checkout, plan change, cancel, webhooks). Live checkout disabled until keys and plan ids are set |
| **Stripe** | Subscriptions for GCC / international | later | `STRIPE_SECRET_KEY`, webhook secret | Pending |
| **OpenAI** | Text (Responses API) + image generation (`gpt-image-2`) | 4 | `OPENAI_API_KEY` (optional `OPENAI_TEXT_MODEL`, `OPENAI_IMAGE_MODEL`) | **Implemented**; enabled when the key is set |
| **Anthropic** | Text generation (`claude-opus-5-5`, server-side refusal fallback) | 4 | `ANTHROPIC_API_KEY` (optional `ANTHROPIC_TEXT_MODEL`, `ANTHROPIC_EFFORT`) | **Implemented**; enabled when the key is set |
| **Google Gemini** | Text (`gemini-3.8-flash`) + image (`gemini-3.1-flash-image`) generation | 4 | `GEMINI_API_KEY` (optional `GEMINI_TEXT_MODEL`, `GEMINI_IMAGE_MODEL`) | **Implemented**; enabled when the key is set |
| **Video provider(s)** | Text/image to video | 16 | Vendor key (TBD) | Pending |
| **S3-compatible storage** | Assets, exports | 1 | `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET` (moto S3 emulator in dev, Cloudflare R2 in prod; bucket CORS must allow PUT from the web origin) | Implemented (presigned upload, completion check, signed downloads) |
| **Meta Graph API: Pages** | Facebook Page publishing, insights | 9–10 | Meta App, Business verification, App Review: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts` | Pending |
| **Meta Graph API: Instagram** | IG Business/Creator publishing | 9–10 | `instagram_basic`, `instagram_content_publish`, IG account linked to a Page | Pending |
| **Meta Marketing API** | Ad accounts, campaigns, insights | 11 | `ads_management`, `ads_read`, `business_management`, Advanced Access | Pending |
| **Meta Lead Ads** | Lead capture into CRM | 13 | `leads_retrieval`, webhook subscription (`leadgen`) | Pending |
| **WhatsApp Business Platform (Cloud API)** | Messaging, templates | 14 | WABA, verified phone number, permanent system-user token, template approvals | Pending |
| **LinkedIn** | Company page posts, ads | 10–11 | LinkedIn app with Community Management API / Marketing Developer Platform access | Pending |
| **TikTok** | Video posting, ads | 10–11 | Content Posting API audit, TikTok for Business API | Pending |
| **YouTube Data API** | Video uploads | 10 | Google OAuth with `youtube.upload`, quota approval | Pending |
| **Google Ads API** | Search/display/video campaigns, leads | 11 | Developer token (Basic access), OAuth, MCC | Pending |
| **Pinterest API** | Pins | 10 | Pinterest app, standard access | Pending |
| **Resend** | Transactional email (verification, reset, invitations, billing) | 2 | `RESEND_API_KEY`, `EMAIL_FROM`, verified sending domain (SPF/DKIM/DMARC on zatgoinnovation.com) | **Implemented**; dev uses the capture inbox (`/api/v1/dev/emails`) |
| **Marketing email provider** | Bulk campaigns | 14 | TBD (Resend Broadcasts / Amazon SES) | Pending |
| **Google Calendar / Gmail** | Follow-ups, email tracking | 7+ | Google OAuth scopes (restricted-scope verification for Gmail) | Pending |

## Platform rules we must respect
* Publishing capabilities depend on account type (e.g. Instagram requires a Business or Creator account) and on approved permissions.
* Respect rate limits (Graph API BUC limits) using BullMQ rate limiters per org and per account.
* Webhooks are verified (`X-Hub-Signature-256` for Meta, `X-Razorpay-Signature` for Razorpay).
* Never claim that a post was published or a campaign is active until the platform API confirms it.

## Go-live checklists (Phase 2)

### Resend
1. Add and verify the sending domain (e.g. `mail.zatgoinnovation.com`) in Resend, publishing the SPF, DKIM and DMARC records.
2. Set `EMAIL_TRANSPORT=resend`, `RESEND_API_KEY` and `EMAIL_FROM="ZatGo AI Marketing <no-reply@mail.zatgoinnovation.com>"`. Production refuses to boot with the `capture` transport.

### Razorpay Subscriptions
1. Activate the account (KYC) and enable Subscriptions.
2. Create one Razorpay **Plan** per paid plan and interval: Starter, Professional and Business, monthly and yearly. Store the ids in `plan.razorpayPlanIdMonthly` and `plan.razorpayPlanIdYearly`.
3. Add a webhook pointing to `https://api.marketing.zatgoinnovation.com/api/v1/billing/webhooks/razorpay` with these events: `subscription.authenticated`, `subscription.activated`, `subscription.charged`, `subscription.pending`, `subscription.halted`, `subscription.cancelled`, `subscription.completed`, `subscription.updated`, `subscription.resumed` and `payment.failed`.
4. Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET`. All three are required together.
5. Test the whole flow in test mode before switching to live keys.

### Google sign-in
Create an OAuth client (Web) in Google Cloud with the authorised redirect URI `${WEB_URL}/api/auth/callback/google`, then set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

### Object storage CORS
Browsers upload directly to the bucket with presigned PUT URLs, so the bucket's CORS rules must allow `PUT` and `GET` from the web origin.

`GET` is also required by the design editor: it draws stored images onto a canvas with `crossOrigin="anonymous"`. Without a matching `Access-Control-Allow-Origin` on `GET`, the canvas is tainted and PNG/JPG/PDF export fails with a clear error message. Example rule: origins `https://app.example.com`, methods `GET, PUT, HEAD`, headers `*`, expose `ETag`.
