import { createHash } from 'node:crypto';
import { fromMicros, toMicros, type GoogleRsa, type GoogleTargeting, type TargetingOption } from '@zatma/validation';
import { expiresIn, form, ProviderAuthError, ProviderError, requestJson, type FetchLike } from '../../social/providers/provider.js';
import type { AdAccountInfo, AdsCtx, AdsPlatformAdapter, CampaignIds, CampaignPlan, CreatedCampaign, ImportedCampaign, InsightRow } from './ads-provider.js';

export interface GoogleAdsConfig {
  clientId: string;
  clientSecret: string;
  developerToken: string;
  /** Default manager (MCC) account used as login-customer-id. */
  loginCustomerId?: string;
  apiVersion: string;
  apiUrl: string;
  authUrl: string;
  tokenUrl: string;
  revokeUrl: string;
}

export const GOOGLE_ADS_SCOPES = ['https://www.googleapis.com/auth/adwords'];

interface GoogleErrorBody {
  error?: { code?: number; status?: string; message?: string; details?: Array<{ errors?: Array<{ message?: string; errorCode?: Record<string, string> }> }> };
}

const digits = (id: string) => id.replace(/\D/g, '');

/** Google Ads API (REST): Search campaigns with responsive search ads; everything is created PAUSED. */
export class GoogleAdsAdapter implements AdsPlatformAdapter {
  readonly platform = 'GOOGLE' as const;
  readonly oauthId = 'google_ads' as const;
  readonly name = 'Google Ads';
  readonly scopes = GOOGLE_ADS_SCOPES;
  readonly usesPkce = true;

  constructor(
    private readonly cfg: GoogleAdsConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  authorizeUrl({ state, redirectUri, codeChallenge }: { state: string; redirectUri: string; codeChallenge?: string }): string {
    const u = new URL(this.cfg.authUrl);
    u.searchParams.set('client_id', this.cfg.clientId);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', this.scopes.join(' '));
    u.searchParams.set('access_type', 'offline');
    u.searchParams.set('prompt', 'consent');
    u.searchParams.set('state', state);
    if (codeChallenge) {
      u.searchParams.set('code_challenge', codeChallenge);
      u.searchParams.set('code_challenge_method', 'S256');
    }
    return u.toString();
  }

  private token(body: URLSearchParams) {
    return requestJson<{ access_token: string; refresh_token?: string; expires_in?: number; scope?: string }>(this.fetchImpl, this.cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      authErrors: (s, b) => s === 401 || (s === 400 && (b as { error?: string } | null)?.error === 'invalid_grant'),
    });
  }

  async exchangeCode({ code, redirectUri, codeVerifier }: { code: string; redirectUri: string; codeVerifier?: string }) {
    const t = await this.token(form({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret, code_verifier: codeVerifier }));
    const customers = await this.accessible(t.access_token);
    return {
      accessToken: t.access_token,
      refreshToken: t.refresh_token ?? null,
      expiresAt: expiresIn(t.expires_in),
      scopes: t.scope ? t.scope.split(' ') : this.scopes,
      // Google Ads has no user id without extra scopes; the accessible customer set identifies the grant.
      externalUserId: `gads-${createHash('sha256').update(customers.sort().join(',')).digest('hex').slice(0, 16)}`,
      displayName: `Google Ads (${customers.length} account${customers.length === 1 ? '' : 's'})`,
    };
  }

  async refresh({ refreshToken }: { refreshToken: string }) {
    const t = await this.token(form({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret }));
    return { accessToken: t.access_token, refreshToken: t.refresh_token ?? refreshToken, expiresAt: expiresIn(t.expires_in), scopes: t.scope ? t.scope.split(' ') : this.scopes };
  }

  async revoke(token: string): Promise<void> {
    await requestJson(this.fetchImpl, `${this.cfg.revokeUrl}?token=${encodeURIComponent(token)}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  }

  private base(path: string) {
    return `${this.cfg.apiUrl.replace(/\/$/, '')}/${this.cfg.apiVersion}/${path}`;
  }

  /** Every call carries the developer token (server-side secret) and, for client accounts, the manager login id. */
  private async call<T>(path: string, token: string, body?: unknown, loginCustomerId?: string | null): Promise<T> {
    const login = loginCustomerId ?? this.cfg.loginCustomerId;
    try {
      return await requestJson<T>(this.fetchImpl, this.base(path), {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${token}`, 'developer-token': this.cfg.developerToken, 'Content-Type': 'application/json', ...(login ? { 'login-customer-id': digits(login) } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        authErrors: (s, b) => s === 401 || (b as GoogleErrorBody | null)?.error?.status === 'UNAUTHENTICATED',
      });
    } catch (e) {
      if (e instanceof ProviderError) {
        const err = (e.body as GoogleErrorBody | null)?.error;
        const first = err?.details?.flatMap((d) => d.errors ?? [])[0];
        const code = first?.errorCode ? Object.values(first.errorCode)[0] : undefined;
        if (code === 'DEVELOPER_TOKEN_NOT_APPROVED' || code === 'DEVELOPER_TOKEN_PROHIBITED') {
          throw new ProviderError('The Google Ads developer token is not approved for this account yet (needs Basic access).', 403, e.body);
        }
        // RESOURCE_EXHAUSTED → 429 so it is retried; policy and validation errors keep Google's message.
        const status = err?.status === 'RESOURCE_EXHAUSTED' ? 429 : e.status;
        throw new ProviderError(first?.message ?? err?.message ?? e.message, status, e.body);
      }
      if (e instanceof ProviderAuthError) throw e;
      throw e;
    }
  }

  private async accessible(token: string): Promise<string[]> {
    const r = await this.call<{ resourceNames?: string[] }>('customers:listAccessibleCustomers', token, undefined, null);
    return (r.resourceNames ?? []).map((n) => n.split('/')[1]!);
  }

  private async search<T>(customerId: string, token: string, query: string, login?: string | null): Promise<T[]> {
    const rows: T[] = [];
    let pageToken: string | undefined;
    for (let i = 0; i < 50; i++) {
      const r = await this.call<{ results?: T[]; nextPageToken?: string }>(`customers/${digits(customerId)}/googleAds:search`, token, { query, ...(pageToken ? { pageToken } : {}) }, login);
      rows.push(...(r.results ?? []));
      if (!r.nextPageToken) break;
      pageToken = r.nextPageToken;
    }
    return rows;
  }

  async listAdAccounts(token: string): Promise<AdAccountInfo[]> {
    const out = new Map<string, AdAccountInfo>();
    for (const id of await this.accessible(token)) {
      type Row = { customer: { id: string; descriptiveName?: string; currencyCode: string; timeZone: string; manager?: boolean; status?: string } };
      const [row] = await this.search<Row>(id, token, 'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager, customer.status FROM customer', id).catch(() => [] as Row[]);
      if (!row) continue;
      const c = row.customer;
      if (c.manager) {
        type Client = { customerClient: { id: string; descriptiveName?: string; currencyCode: string; timeZone: string; manager?: boolean; status?: string } };
        const clients = await this.search<Client>(id, token, 'SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.time_zone, customer_client.manager, customer_client.status FROM customer_client WHERE customer_client.level = 1', id);
        for (const { customerClient: k } of clients) {
          if (k.manager || out.has(k.id)) continue;
          out.set(k.id, { externalId: k.id, name: k.descriptiveName || k.id, currency: k.currencyCode, timezone: k.timeZone, status: k.status === 'ENABLED' ? 'ACTIVE' : 'DISABLED', manager: false, loginCustomerId: id });
        }
      } else if (!out.has(c.id)) {
        out.set(c.id, { externalId: c.id, name: c.descriptiveName || c.id, currency: c.currencyCode, timezone: c.timeZone, status: c.status === 'ENABLED' ? 'ACTIVE' : 'DISABLED', manager: false });
      }
    }
    return [...out.values()];
  }

  /** One atomic googleAds:mutate with temporary ids, validated first with validateOnly. Campaign status PAUSED. */
  async createCampaign(plan: CampaignPlan, ctx: AdsCtx): Promise<CreatedCampaign> {
    const s = ctx.state as { created?: CreatedCampaign };
    if (s.created) return s.created;
    const cid = digits(ctx.account.externalId);
    const rn = (kind: string, n: number) => `customers/${cid}/${kind}/-${n}`;
    const ops: unknown[] = [];
    const budget = rn('campaignBudgets', 1);
    const campaign = rn('campaigns', 2);
    ops.push({ campaignBudgetOperation: { create: { resourceName: budget, name: `${plan.name} budget ${Date.now()}`, amountMicros: toMicros(plan.budgetAmount), deliveryMethod: 'STANDARD', explicitlyShared: false } } });
    ops.push({
      campaignOperation: {
        create: {
          resourceName: campaign,
          name: plan.name,
          status: 'PAUSED',
          advertisingChannelType: 'SEARCH',
          campaignBudget: budget,
          maximizeClicks: {},
          networkSettings: { targetGoogleSearch: true, targetSearchNetwork: true, targetContentNetwork: false, targetPartnerSearchNetwork: false },
          containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
        },
      },
    });
    const first = plan.groups[0]!.targeting as GoogleTargeting;
    for (const l of first.locations) ops.push({ campaignCriterionOperation: { create: { campaign, location: { geoTargetConstant: `geoTargetConstants/${l.id}` } } } });
    for (const l of first.languages) ops.push({ campaignCriterionOperation: { create: { campaign, language: { languageConstant: `languageConstants/${l.id}` } } } });
    let n = 3;
    const groupTemp: Record<string, string> = {};
    const adOrder: string[] = [];
    for (const g of plan.groups) {
      const ag = rn('adGroups', n++);
      groupTemp[g.localId] = ag;
      ops.push({ adGroupOperation: { create: { resourceName: ag, campaign, name: g.name, status: 'ENABLED', type: 'SEARCH_STANDARD' } } });
      for (const k of (g.targeting as GoogleTargeting).keywords) ops.push({ adGroupCriterionOperation: { create: { adGroup: ag, status: 'ENABLED', keyword: { text: k.text, matchType: k.matchType } } } });
      for (const ad of g.ads) {
        const r = ad.creative as GoogleRsa;
        adOrder.push(ad.localId);
        ops.push({
          adGroupAdOperation: {
            create: {
              adGroup: ag,
              status: 'ENABLED',
              ad: { name: ad.name, finalUrls: [r.finalUrl], responsiveSearchAd: { headlines: r.headlines.map((text) => ({ text })), descriptions: r.descriptions.map((text) => ({ text })), ...(r.path1 ? { path1: r.path1 } : {}), ...(r.path2 ? { path2: r.path2 } : {}) } },
            },
          },
        });
      }
    }
    const path = `customers/${cid}/googleAds:mutate`;
    await this.call(path, ctx.token, { mutateOperations: ops, validateOnly: true, partialFailure: false }, ctx.account.loginCustomerId);
    type Res = { mutateOperationResponses: Array<Record<string, { resourceName: string }>> };
    const res = await this.call<Res>(path, ctx.token, { mutateOperations: ops, partialFailure: false }, ctx.account.loginCustomerId);
    const names = res.mutateOperationResponses.map((r) => Object.values(r)[0]!.resourceName);
    const kindOf = (r: Record<string, unknown>) => Object.keys(r)[0];
    const pick = (kind: string) => res.mutateOperationResponses.filter((r) => kindOf(r) === kind).map((r) => Object.values(r)[0]!.resourceName);
    const created: CreatedCampaign = {
      budgetId: pick('campaignBudgetResult')[0],
      campaignId: pick('campaignResult')[0]!,
      groups: Object.fromEntries(plan.groups.map((g, i) => [g.localId, pick('adGroupResult')[i]!])),
      ads: Object.fromEntries(adOrder.map((id, i) => [id, pick('adGroupAdResult')[i]!])),
    };
    if (!created.campaignId || names.length !== ops.length) throw new ProviderError('Google Ads returned an unexpected response', 502);
    await ctx.saveState({ created });
    return created;
  }

  /** Only the campaign status changes: ad groups and ads are enabled inside a paused campaign. */
  async setStatus(ctx: AdsCtx, ids: CampaignIds, status: 'ACTIVE' | 'PAUSED'): Promise<void> {
    await this.call(`customers/${digits(ctx.account.externalId)}/googleAds:mutate`, ctx.token, { mutateOperations: [{ campaignOperation: { update: { resourceName: ids.campaignId, status: status === 'ACTIVE' ? 'ENABLED' : 'PAUSED' }, updateMask: 'status' } }] }, ctx.account.loginCustomerId);
  }

  async updateBudget(ctx: AdsCtx, ids: CampaignIds, _type: 'DAILY' | 'LIFETIME', amount: string): Promise<void> {
    if (!ids.budgetId) throw new ProviderError('This campaign has no budget id; refresh it first', 422);
    await this.call(`customers/${digits(ctx.account.externalId)}/googleAds:mutate`, ctx.token, { mutateOperations: [{ campaignBudgetOperation: { update: { resourceName: ids.budgetId, amountMicros: toMicros(amount) }, updateMask: 'amount_micros' } }] }, ctx.account.loginCustomerId);
  }

  async listCampaigns(ctx: AdsCtx): Promise<ImportedCampaign[]> {
    type Row = { campaign: { resourceName: string; name: string; status: string; advertisingChannelType: string; endDate?: string; startDate?: string }; campaignBudget?: { amountMicros?: string } };
    const rows = await this.search<Row>(ctx.account.externalId, ctx.token, "SELECT campaign.resource_name, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.amount_micros FROM campaign WHERE campaign.status != 'REMOVED'", ctx.account.loginCustomerId);
    return rows.map((r) => ({
      externalId: r.campaign.resourceName,
      name: r.campaign.name,
      status: r.campaign.status === 'ENABLED' ? 'ACTIVE' : 'PAUSED',
      objective: 'SEARCH',
      budgetType: 'DAILY',
      budgetAmount: r.campaignBudget?.amountMicros ? fromMicros(r.campaignBudget.amountMicros) : null,
      startAt: null,
      endAt: null,
    }));
  }

  async insights(ctx: AdsCtx, campaignIds: string[], from: string, to: string): Promise<InsightRow[]> {
    if (!campaignIds.length) return [];
    const ids = campaignIds.map((rn) => rn.split('/').pop()).join(',');
    type Row = { campaign: { resourceName: string }; segments: { date: string }; metrics: { impressions?: string; clicks?: string; costMicros?: string; conversions?: number | string } };
    const rows = await this.search<Row>(
      ctx.account.externalId,
      ctx.token,
      `SELECT campaign.resource_name, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE segments.date BETWEEN '${from}' AND '${to}' AND campaign.id IN (${ids})`,
      ctx.account.loginCustomerId,
    );
    return rows.map((r) => ({
      campaignId: r.campaign.resourceName,
      date: r.segments.date,
      impressions: Number(r.metrics.impressions ?? 0),
      reach: 0,
      clicks: Number(r.metrics.clicks ?? 0),
      spend: fromMicros(r.metrics.costMicros ?? '0'),
      conversions: Math.round(Number(r.metrics.conversions ?? 0)),
      leads: 0,
    }));
  }

  async searchTargeting(ctx: AdsCtx, kind: 'location' | 'interest' | 'language', q: string): Promise<TargetingOption[]> {
    if (kind === 'location') {
      type S = { geoTargetConstantSuggestions?: Array<{ geoTargetConstant: { id: string; name: string; countryCode?: string; targetType?: string; canonicalName?: string } }> };
      const r = await this.call<S>('geoTargetConstants:suggest', ctx.token, { locale: 'en', locationNames: { names: [q] } }, ctx.account.loginCustomerId);
      return (r.geoTargetConstantSuggestions ?? []).slice(0, 10).map(({ geoTargetConstant: g }) => ({ id: g.id, name: g.name, type: (g.targetType ?? 'location').toLowerCase(), countryCode: g.countryCode, description: g.canonicalName }));
    }
    if (kind === 'language') {
      type Row = { languageConstant: { id: string; name: string } };
      const safe = q.replace(/[^\p{L} ]/gu, '').slice(0, 40);
      const rows = await this.search<Row>(ctx.account.externalId, ctx.token, `SELECT language_constant.id, language_constant.name FROM language_constant WHERE language_constant.name LIKE '%${safe}%'`, ctx.account.loginCustomerId);
      return rows.slice(0, 10).map((r) => ({ id: r.languageConstant.id, name: r.languageConstant.name, type: 'language' }));
    }
    return [];
  }
}
