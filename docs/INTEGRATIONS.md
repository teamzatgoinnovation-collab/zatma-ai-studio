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
| **Meta Graph API: Pages** | Facebook Page connection (P9), publishing and insights (P10) | 9–10 | Meta App (`META_APP_ID/SECRET`), Business verification, App Review: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `pages_manage_metadata`, `business_management` | **Connection implemented** (OAuth, long-lived tokens, Page discovery, health checks, webhooks, deauthorize and data deletion). Enabled when keys are set; real accounts need App Review. Publishing is Phase 10 |
| **Meta Graph API: Instagram** | IG Business/Creator connection (P9) and publishing (P10) | 9–10 | `instagram_basic`, `instagram_content_publish`, IG account linked to a Page | **Connection implemented** (discovered through the linked Page). Publishing is Phase 10 |
| **Meta Marketing API** | Ad accounts, campaigns, insights | 11 | `ads_management`, `ads_read`, `business_management`, Advanced Access | Pending |
| **Meta Lead Ads** | Lead capture into CRM | 13 | `leads_retrieval`, webhook subscription (`leadgen`) | Pending |
| **WhatsApp Business Platform (Cloud API)** | Messaging, templates | 14 | WABA, verified phone number, permanent system-user token, template approvals | Pending |
| **LinkedIn** | Company Page connection (P9), posts (P10), ads (P11) | 9–11 | LinkedIn app (`LINKEDIN_CLIENT_ID/SECRET`) with **Community Management API** access | **Connection implemented** (OAuth, refresh, administered Pages, health, revoke). Enabled when keys are set |
| **TikTok** | Video posting, ads | 10–11 | Content Posting API audit, TikTok for Business API | Pending |
| **YouTube Data API** | Channel connection (P9), video uploads (P10) | 9–10 | Separate Google OAuth client (`YOUTUBE_CLIENT_ID/SECRET`) with `youtube.readonly` + `youtube.upload`, consent-screen verification, quota | **Connection implemented** (OAuth + PKCE, offline refresh, channels, health, revoke). Enabled when keys are set |
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

## Social accounts (Phase 9)

Each platform is switched on independently: set its app keys **and** `TOKEN_ENCRYPTION_KEYS`, then restart the API. Until then
**Marketing → Social Accounts** shows the platform as *Not configured*. Nothing is simulated.

### Token encryption key (required for every platform)
Generate a key and set it with an id (`kid`) prefix:

```bash
echo "k1:$(openssl rand -base64 32)"
```

`TOKEN_ENCRYPTION_KEYS=k1:<base64>`. To rotate, put the new key first: `k2:<new>,k1:<old>`. New tokens are encrypted with
`k2` and old tokens still decrypt with `k1`. Every reconnect or refresh re-encrypts with the newest key. Store the keys in the
secret manager, never in git. **Losing the keys means every account must be reconnected.**

### Redirect URIs
Register these exactly (production `API_URL` shown):

| Platform | Redirect URI |
|---|---|
| Meta | `https://api.marketing.zatgoinnovation.com/api/v1/social/oauth/meta/callback` |
| LinkedIn | `https://api.marketing.zatgoinnovation.com/api/v1/social/oauth/linkedin/callback` |
| YouTube (Google) | `https://api.marketing.zatgoinnovation.com/api/v1/social/oauth/google/callback` |

The page's provider cards (and `GET /api/v1/social/providers`) also show the exact URI for the current environment.

### Meta (Facebook Pages + Instagram)
1. Create a **Business** app at developers.facebook.com and add **Facebook Login for Business**. Add the redirect URI above under *Valid OAuth Redirect URIs*.
2. Permissions requested: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `pages_manage_metadata`, `instagram_basic`, `instagram_content_publish`, `business_management`. Each needs **App Review** (with a screencast of the connect flow) plus **Business Verification** before people outside the app's roles can connect.
3. **Webhooks**: callback `…/api/v1/social/webhooks/meta`, verify token = `META_WEBHOOK_VERIFY_TOKEN`; subscribe the Page object (Phase 10+ uses `feed`) and the app-level `permissions` field (revocations).
4. **Deauthorize callback URL**: `…/api/v1/social/meta/deauthorize`. **Data deletion request URL**: `…/api/v1/social/meta/data-deletion`.
5. Set `META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` (any long random string). `META_GRAPH_VERSION` defaults to `v24.0`. Bump it when Meta deprecates a version.
6. Instagram accounts must be **Business or Creator** accounts linked to a Facebook Page. They appear in the picker under their Page.
7. Meta user tokens last about 60 days and cannot be refreshed. The daily health job asks the person to reconnect 7 days before expiry (in-app badge, activity entry and email).

### LinkedIn (company Pages)
1. Create an app at linkedin.com/developers, associated with the ZatGo company Page, and add the redirect URI.
2. Request the **Community Management API** product (needs a vetting application). Scopes requested: `openid profile w_organization_social r_organization_social rw_organization_admin`.
3. Set `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`. `LINKEDIN_API_VERSION` (`YYYYMM`, default `202510`) is sent as the `LinkedIn-Version` header. Keep it within LinkedIn's supported window (about 12 months).
4. Only Pages where the person is an **approved ADMINISTRATOR** are listed. Refresh tokens are used when LinkedIn issues them (Marketing/Community apps).

### YouTube (Google)
1. In Google Cloud, enable **YouTube Data API v3** and create an OAuth client (Web) **separate from the sign-in client**. Add the redirect URI.
2. Scopes: `youtube.readonly`, `youtube.upload`. Both are *sensitive*, so the OAuth consent screen must be **verified** before going public. Request quota if publishing volume needs more than the default 10,000 units/day.
3. Set `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET`. The flow uses PKCE, `access_type=offline` and `prompt=consent` so a refresh token is always issued.

### Verifying without real keys (development)
All base URLs can be overridden (`META_GRAPH_URL`, `META_OAUTH_URL`, `LINKEDIN_API_URL`, `LINKEDIN_OAUTH_URL`, `GOOGLE_OAUTH_URL`,
`GOOGLE_TOKEN_URL`, `GOOGLE_REVOKE_URL`, `YOUTUBE_API_URL`). Phase 9 was verified end to end against a local stand-in that serves the same
endpoints and checks client secrets, redirect URIs, `appsecret_proof` and PKCE. Never set these overrides in production.
