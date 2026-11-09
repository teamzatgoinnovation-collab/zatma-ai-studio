# Integrations

Every integration uses the **official API only**. Where credentials or platform approval are
missing, the integration is built behind an interface and marked **Pending** here. It is never
presented as connected.

| Integration | Purpose | Phase | Credentials / approvals required | Status |
|---|---|---|---|---|
| **Better Auth + Google OAuth** | Sign-in with Google | 1–2 | Google Cloud OAuth client (`GOOGLE_CLIENT_ID/SECRET`), consent screen | Code wired; disabled until env set |
| **Razorpay** | Subscriptions (INR, UPI, cards) | 2 | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, KYC-activated account, plans created | Pending (interface in P1) |
| **Stripe** | Subscriptions for GCC / international | later | `STRIPE_SECRET_KEY`, webhook secret | Pending |
| **OpenAI** | Text + image generation | 4 | `OPENAI_API_KEY` | Pending (interface in P1) |
| **Anthropic** | Text generation | 4 | `ANTHROPIC_API_KEY` | Pending (interface in P1) |
| **Google Gemini** | Text + image generation | 4 | `GEMINI_API_KEY` | Pending (interface in P1) |
| **Video provider(s)** | Text/image to video | 16 | Vendor key (TBD) | Pending |
| **S3-compatible storage** | Assets, exports | 1 | `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET` (MinIO dev, Cloudflare R2 prod) | Implemented (presign) |
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
| **Email service provider** | Transactional + marketing email | 2, 14 | ESP API key (e.g. Amazon SES / Resend / Postmark), domain SPF/DKIM/DMARC | Pending |
| **Google Calendar / Gmail** | Follow-ups, email tracking | 7+ | Google OAuth scopes (restricted-scope verification for Gmail) | Pending |

## Platform rules we must respect
* Publishing capabilities depend on account type (e.g. Instagram requires a Business or Creator account) and on approved permissions.
* Respect rate limits (Graph API BUC limits) using BullMQ rate limiters per org and per account.
* Webhooks are verified (`X-Hub-Signature-256` for Meta, `X-Razorpay-Signature` for Razorpay).
* Never claim that a post was published or a campaign is active until the platform API confirms it.
