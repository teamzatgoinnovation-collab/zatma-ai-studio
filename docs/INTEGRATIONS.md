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
| **Meta Graph API: Pages** | Facebook Page connection (P9), publishing and insights (P10) | 9–10 | Meta App (`META_APP_ID/SECRET`), Business verification, App Review: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `pages_manage_metadata`, `business_management` | **Connection implemented** (OAuth, long-lived tokens, Page discovery, health checks, webhooks, deauthorize and data deletion). Enabled when keys are set; real accounts need App Review. **Publishing implemented (P10)**: feed text, photo, multi-photo, video |
| **Meta Graph API: Instagram** | IG Business/Creator connection (P9) and publishing (P10) | 9–10 | `instagram_basic`, `instagram_content_publish`, IG account linked to a Page | **Connection and publishing implemented** (single image, carousel, Reels via the Content Publishing API) |
| **Meta Marketing API** | Ad accounts, campaigns, ad sets, ads, lead forms, insights | 11 | Same Meta app; `ads_management`, `ads_read`, `business_management`, `pages_manage_ads`, Advanced Access + App Review | **Implemented** (paused creation, approved activation, insights, import). Enabled when Meta keys are set |
| **Meta Lead Ads** | Lead capture into CRM | 13 | `leads_retrieval`, webhook subscription (`leadgen`) | Pending |
| **WhatsApp Business Platform (Cloud API)** | Messaging, templates | 14 | WABA, verified phone number, permanent system-user token, template approvals | Pending |
| **LinkedIn** | Company Page connection (P9), posts (P10), ads (P11) | 9–11 | LinkedIn app (`LINKEDIN_CLIENT_ID/SECRET`) with **Community Management API** access | **Connection and publishing implemented** (Posts API with text, images, multi-image and video) |
| **TikTok** | Video posting, ads | 10–11 | Content Posting API audit, TikTok for Business API | Pending |
| **YouTube Data API** | Channel connection (P9), video uploads (P10) | 9–10 | Separate Google OAuth client (`YOUTUBE_CLIENT_ID/SECRET`) with `youtube.readonly` + `youtube.upload`, consent-screen verification, quota | **Connection and upload implemented** (resumable upload of one video per post) |
| **Google Ads API** | Search campaigns (responsive search ads), insights | 11 | `GOOGLE_ADS_CLIENT_ID/SECRET`, `GOOGLE_ADS_DEVELOPER_TOKEN` (Basic access), optional MCC `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | **Implemented** (Search only; Display/Video/Performance Max later). Enabled when keys are set |
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

## Social publishing (Phase 10)

Posts are published only after a person confirms. **Publish now** sends `{ confirm: true }` after a confirmation dialog; a scheduled post goes out at the time someone chose.
A post is never shown as published until the platform returns a post id.

| Platform | Endpoints used (official) | Media rules enforced before sending |
|---|---|---|
| Facebook Page | `POST /{page}/feed` (text, or `attached_media` for several photos), `POST /{page}/photos` (`url`, `published=false` for multi-photo), `POST /{page}/videos` (`file_url`); `GET /{id}?fields=permalink_url` | Up to 10 images or 1 video; 63,206 characters |
| Instagram Business | `POST /{ig}/media` (`image_url`; `media_type=REELS` + `video_url`; `is_carousel_item` children + `media_type=CAROUSEL`), `GET /{container}?fields=status_code`, `POST /{ig}/media_publish` | Media required; 1 image, a carousel of 2–10, or one Reel of 3 s–15 min; JPEG; aspect ratio 4:5–1.91:1; 2,200 characters; 30 hashtags |
| LinkedIn Page | `POST /rest/images?action=initializeUpload` + `PUT`; `POST /rest/videos?action=initializeUpload` + multipart `PUT`s (ETags) + `finalizeUpload` + `GET /rest/videos/{urn}`; `POST /rest/posts` (id in `x-restli-id`) | Up to 20 images or 1 MP4 video (3 s–30 min); 3,000 characters; commentary escaped as "little text", with hashtags as `{hashtag|\\#|tag}` |
| YouTube | `POST {YOUTUBE_UPLOAD_URL}/videos?uploadType=resumable&part=snippet,status`, then chunked `PUT`s (8 MiB) with `Content-Range`; resumes with `bytes */size` | Exactly one video; title 1–100 characters without `<` or `>`; privacy and made-for-kids required; description 5,000 characters |

**Media delivery:**
* Meta fetches media itself from a signed storage URL valid for 1 hour. The bucket must be reachable from the internet: Cloudflare R2 or S3, not a private network.
* LinkedIn and YouTube receive bytes the API streams from storage in ranges, so large videos never sit in memory.

**Retries:**
* Network errors, HTTP 429 and 5xx responses, and Meta transient codes (1, 2, 4, 17, 32, 341, 613) are retried up to 5 times, waiting 30 s, 2 min, 8 min and 32 min.
* Each step's progress (photo ids, container ids, upload URNs and ETags, the YouTube session) is saved, so a retry never repeats a finished step and never posts twice.
* Token errors mark the account *Reconnect needed* and email the person who connected it.

**Quotas and review:**
* YouTube uploads cost about 1,600 quota units each, so the default 10,000 units/day allows about 6 uploads. Request more quota before launch.
* Instagram allows 100 API-published posts per 24 hours per account.
* Meta App Review must cover `pages_manage_posts` and `instagram_content_publish`; LinkedIn needs `w_organization_social`.

**Verification without keys:** the stand-in server used in Phase 9 also implements these endpoints and checks `appsecret_proof`, upload sizes, ETags, `LinkedIn-Version` headers and resumable `Content-Range` handling.

## Ads (Phase 11)

**Spending is never automatic:**
* Every campaign, ad set, ad group and ad is created **PAUSED**.
* Only a person with `ads:approve` (Owner/Admin) can activate a campaign or raise a running budget. They confirm the maximum possible spend in a dialog, and the server recomputes and rejects it if the figure is higher.
* An optional monthly **spend cap** per ad account blocks activation above it.
* Background jobs only read (insights, imports, status mirroring); they never activate or raise budgets.

### Meta Marketing API
1. Use the same Meta app as Phase 9 (`META_APP_ID` / `META_APP_SECRET`). Add the **Marketing API** product, and add `{API_URL}/api/v1/ads/oauth/meta_ads/callback` to the Valid OAuth Redirect URIs.
2. Request App Review for `ads_management`, `ads_read`, `business_management`, `pages_manage_ads` (lead forms and Page creatives) and `leads_retrieval` (Phase 12: reading instant-form submissions into the CRM). Apply for **Advanced Access** to the Ads Management Standard Access tier, and complete Business Verification.
3. **Endpoints used** (Graph `META_GRAPH_VERSION`, every call with `appsecret_proof`):
   * Accounts: `GET /me/adaccounts`.
   * Creation: `POST /act_{id}/adimages` (bytes), `/act_{id}/campaigns` (`status=PAUSED`, CBO `daily_budget` / `lifetime_budget` in minor units), `/act_{id}/adsets` (targeting, optimisation goal by objective), `/{page}/leadgen_forms` (with the Page token), `/act_{id}/adcreatives`, `/act_{id}/ads` (`status=PAUSED`).
   * Status and budget: `POST /{id}` `status` / budget.
   * Data: `GET /act_{id}/insights` (`level=campaign`, `time_increment=1`); `GET /search?type=adgeolocation|adinterest|adlocale`.
   * Leads (Phase 12): `GET /{ad_id}/leads?fields=id,created_time,form_id,field_data` with a `time_created GREATER_THAN` filter, paged. Read-only; run every 15 minutes for Lead ads created in ZatGo or imported. Connections made before Phase 12 must be reconnected once to grant `leads_retrieval`.
4. **Objective mapping:**

   | Objective | Meta objective | Optimisation goal |
   |---|---|---|
   | Traffic | OUTCOME_TRAFFIC | LINK_CLICKS |
   | Engagement | OUTCOME_ENGAGEMENT | POST_ENGAGEMENT |
   | Messages | OUTCOME_ENGAGEMENT | CONVERSATIONS (WHATSAPP / MESSENGER destination) |
   | Awareness | OUTCOME_AWARENESS | REACH |
   | Leads | OUTCOME_LEADS | LEAD_GENERATION (ON_AD instant form) |

5. **Activation order:** ads, then ad sets, then the campaign last, so spending can only begin at the final call.
6. Budgets below the account currency's minimum are rejected by Meta, and the message (e.g. "Budget too low…") is shown as returned.

### Google Ads API
1. In a Google Cloud project, enable the **Google Ads API** and create an OAuth client (Web), separate from sign-in and YouTube. Add the redirect URI `{API_URL}/api/v1/ads/oauth/google_ads/callback`. Scope: `https://www.googleapis.com/auth/adwords` (sensitive, so the consent screen must be verified).
2. Apply for a **developer token** in the Google Ads manager (MCC) account's API Center. Test access works only with test accounts; **Basic access** is needed for real accounts. Set `GOOGLE_ADS_DEVELOPER_TOKEN` as a server secret: it is sent only as the `developer-token` header and is never returned to clients.
3. Optional: set `GOOGLE_ADS_LOGIN_CUSTOMER_ID` to the manager account. Client accounts discovered under a manager use that manager's id automatically.
4. Set `GOOGLE_ADS_API_VERSION` (default `v22`). Google supports each version for about 12 months; bump it as versions sunset.
5. **Endpoints used:**
   * Discovery: `customers:listAccessibleCustomers`; `customers/{id}/googleAds:search` (GAQL for customer and customer_client, campaigns, daily metrics with `segments.date`, language constants); `geoTargetConstants:suggest`.
   * Creation: `customers/{id}/googleAds:mutate`, called first with `validateOnly: true` and then for real, atomically (`partialFailure: false`) with temporary resource ids: budget, campaign (`SEARCH`, `PAUSED`, Maximize clicks), location and language criteria, ad group, keywords, responsive search ad.
   * Changes: activation is `campaignOperation.update` to `status=ENABLED`; budget changes are `campaignBudgetOperation.update` of `amount_micros`.
6. Money is converted exactly: amounts are stored as decimals, Meta uses minor units (zero-decimal currencies such as JPY are handled), and Google uses micros.

### Verification without keys
The local stand-in implements these Marketing API and Google Ads endpoints. It refuses any campaign, ad set or ad that is not created PAUSED, enforces the developer-token header, and returns daily insights. The base URLs are overridable (`META_GRAPH_URL`, `GOOGLE_ADS_API_URL`); never override them in production.

## Campaign tracking (Phase 12)
* **Tracked links** are served by ZatGo itself at `{WEB_URL}/r/{slug}` (the web app proxies to `GET /api/v1/r/{slug}`). No third-party shortener is used. Point your production domain at the web app; nothing else is needed.
* **UTM attribution:** a lead created with `utm.campaign` equal to a campaign's UTM slug is attributed to it. Pass the landing page's UTM parameters when creating leads from your own forms (Phase 15 landing pages will do this automatically).
* **Meta lead forms:** see `leads_retrieval` above.
* **Email and WhatsApp** channels can be planned on a campaign now; sending needs the Phase 14 integrations.
