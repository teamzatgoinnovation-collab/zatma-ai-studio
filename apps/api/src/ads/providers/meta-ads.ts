import { createHmac } from 'node:crypto';
import { toMetaMinor, fromMetaMinor, type AdObjective, type MetaCreative, type MetaTargeting, type TargetingOption } from '@zatma/validation';
import { MetaProvider, type MetaConfig } from '../../social/providers/meta.provider.js';
import { form, ProviderAuthError, ProviderError, requestJson, type FetchLike } from '../../social/providers/provider.js';
import type { AdAccountInfo, AdsCtx, AdsPlatformAdapter, CampaignIds, CampaignPlan, CreatedCampaign, ImportedCampaign, InsightRow, PlatformLead } from './ads-provider.js';

/** Marketing API permissions (plus the Page access needed for ad creatives and lead forms). */
export const META_ADS_SCOPES = ['ads_management', 'ads_read', 'business_management', 'pages_show_list', 'pages_read_engagement', 'pages_manage_ads', 'leads_retrieval'];

const OBJECTIVE: Partial<Record<AdObjective, string>> = { TRAFFIC: 'OUTCOME_TRAFFIC', ENGAGEMENT: 'OUTCOME_ENGAGEMENT', MESSAGES: 'OUTCOME_ENGAGEMENT', AWARENESS: 'OUTCOME_AWARENESS', LEADS: 'OUTCOME_LEADS' };
const FROM_OBJECTIVE: Record<string, AdObjective> = { OUTCOME_TRAFFIC: 'TRAFFIC', LINK_CLICKS: 'TRAFFIC', OUTCOME_ENGAGEMENT: 'ENGAGEMENT', POST_ENGAGEMENT: 'ENGAGEMENT', MESSAGES: 'MESSAGES', OUTCOME_AWARENESS: 'AWARENESS', REACH: 'AWARENESS', BRAND_AWARENESS: 'AWARENESS', OUTCOME_LEADS: 'LEADS', LEAD_GENERATION: 'LEADS' };

/** Graph errors: 190 = token, 10/200-299 = permission → reconnect. User-facing text comes from error_user_msg when present. */
const metaAuth = (status: number, body: unknown) => {
  const code = (body as { error?: { code?: number } } | null)?.error?.code;
  return status === 401 || code === 190 || code === 10 || (typeof code === 'number' && code >= 200 && code < 300);
};

export class MetaAdsAdapter implements AdsPlatformAdapter {
  readonly platform = 'META' as const;
  readonly oauthId = 'meta_ads' as const;
  readonly name = 'Meta Ads';
  readonly scopes = META_ADS_SCOPES;
  readonly usesPkce = false;
  private readonly login: MetaProvider;

  constructor(
    private readonly cfg: MetaConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    this.login = new MetaProvider(cfg, fetchImpl, META_ADS_SCOPES);
  }

  authorizeUrl(p: { state: string; redirectUri: string }) {
    return this.login.authorizeUrl(p);
  }
  exchangeCode(p: { code: string; redirectUri: string }) {
    return this.login.exchangeCode(p);
  }
  revoke(token: string) {
    return this.login.revoke(token);
  }

  private url(path: string, params: Record<string, string>, token: string): string {
    const u = new URL(`${this.cfg.graphUrl.replace(/\/$/, '')}/${this.cfg.graphVersion}/${path.replace(/^\//, '')}`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    u.searchParams.set('access_token', token);
    u.searchParams.set('appsecret_proof', createHmac('sha256', this.cfg.appSecret).update(token).digest('hex'));
    return u.toString();
  }

  private async call<T>(method: 'GET' | 'POST', path: string, token: string, params: Record<string, string | undefined> = {}): Promise<T> {
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined)) as Record<string, string>;
    try {
      return method === 'GET'
        ? await requestJson<T>(this.fetchImpl, this.url(path, clean, token), { authErrors: metaAuth })
        : await requestJson<T>(this.fetchImpl, this.url(path, {}, token), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(clean), authErrors: metaAuth });
    } catch (e) {
      // Prefer Meta's user-facing explanation (e.g. "Budget too low") over the technical message.
      if (e instanceof ProviderError) {
        const err = (e.body as { error?: { error_user_title?: string; error_user_msg?: string } } | null)?.error;
        if (err?.error_user_msg) throw new ProviderError(`${err.error_user_title ? `${err.error_user_title}: ` : ''}${err.error_user_msg}`, e.status, e.body);
      }
      throw e;
    }
  }

  async listAdAccounts(token: string): Promise<AdAccountInfo[]> {
    const res = await this.call<{ data: Array<{ id: string; name: string; currency: string; timezone_name: string; account_status: number }> }>('GET', 'me/adaccounts', token, { fields: 'id,name,currency,timezone_name,account_status', limit: '100' });
    return res.data.map((a) => ({ externalId: a.id, name: a.name, currency: a.currency, timezone: a.timezone_name, status: a.account_status === 1 ? 'ACTIVE' : 'DISABLED', manager: false }));
  }

  private targeting(t: MetaTargeting) {
    const countries = t.locations.filter((l) => l.type === 'country').map((l) => l.key);
    const regions = t.locations.filter((l) => l.type === 'region').map((l) => ({ key: l.key }));
    const cities = t.locations.filter((l) => l.type === 'city').map((l) => ({ key: l.key, radius: l.radiusKm ?? 25, distance_unit: 'kilometer' }));
    const zips = t.locations.filter((l) => l.type === 'zip').map((l) => ({ key: l.key }));
    return {
      geo_locations: { ...(countries.length ? { countries } : {}), ...(regions.length ? { regions } : {}), ...(cities.length ? { cities } : {}), ...(zips.length ? { zips } : {}) },
      age_min: t.ageMin,
      age_max: t.ageMax,
      ...(t.genders.length ? { genders: t.genders } : {}),
      ...(t.interests.length ? { flexible_spec: [{ interests: t.interests.map((i) => ({ id: i.id, name: i.name })) }] } : {}),
      ...(t.locales.length ? { locales: t.locales.map((l) => l.key) } : {}),
    };
  }

  private adSetGoal(objective: AdObjective, creative: MetaCreative) {
    switch (objective) {
      case 'TRAFFIC':
        return { optimization_goal: 'LINK_CLICKS', destination_type: 'WEBSITE' };
      case 'ENGAGEMENT':
        return { optimization_goal: 'POST_ENGAGEMENT', destination_type: 'ON_POST' };
      case 'MESSAGES':
        return {
          optimization_goal: 'CONVERSATIONS',
          destination_type: creative.messaging?.channel === 'WHATSAPP' ? 'WHATSAPP' : 'MESSENGER',
          promoted_object: JSON.stringify({ page_id: creative.pageId, ...(creative.messaging?.whatsappNumber ? { whatsapp_phone_number: creative.messaging.whatsappNumber } : {}) }),
        };
      case 'AWARENESS':
        return { optimization_goal: 'REACH' };
      case 'LEADS':
        return { optimization_goal: 'LEAD_GENERATION', destination_type: 'ON_AD', promoted_object: JSON.stringify({ page_id: creative.pageId }) };
      default:
        throw new ProviderError(`${objective} is not a Meta objective`, 422);
    }
  }

  private linkData(objective: AdObjective, c: MetaCreative, imageHash: string, formId?: string) {
    const base = { image_hash: imageHash, message: c.primaryText, ...(c.headline ? { name: c.headline } : {}), ...(c.description ? { description: c.description } : {}) };
    if (objective === 'MESSAGES') {
      const whatsapp = c.messaging?.channel === 'WHATSAPP';
      return { ...base, link: whatsapp ? 'https://api.whatsapp.com/send' : 'https://fb.com/messenger_doc/', call_to_action: { type: whatsapp ? 'WHATSAPP_MESSAGE' : 'MESSAGE_PAGE', value: { app_destination: whatsapp ? 'WHATSAPP' : 'MESSENGER' } } };
    }
    if (objective === 'LEADS') return { ...base, link: 'http://fb.me/', call_to_action: { type: c.cta === 'LEARN_MORE' ? 'SIGN_UP' : c.cta, value: { lead_gen_form_id: formId } } };
    const link = c.link ?? `https://www.facebook.com/${c.pageId}`;
    return { ...base, link, call_to_action: { type: c.cta, value: { link } } };
  }

  /** campaign → ad sets → images → (lead forms) → creatives → ads, all PAUSED; each id saved as soon as it exists. */
  async createCampaign(plan: CampaignPlan, ctx: AdsCtx): Promise<CreatedCampaign> {
    const act = ctx.account.externalId;
    const s = ctx.state as { campaignId?: string; groups?: Record<string, string>; images?: Record<string, string>; forms?: Record<string, string>; creatives?: Record<string, string>; ads?: Record<string, string> };
    const save = (patch: Record<string, unknown>) => ctx.saveState(patch);
    const budgetKey = plan.budgetType === 'DAILY' ? 'daily_budget' : 'lifetime_budget';

    if (!s.campaignId) {
      const objective = OBJECTIVE[plan.objective];
      if (!objective) throw new ProviderError(`${plan.objective} is not available on Meta`, 422);
      const r = await this.call<{ id: string }>('POST', `${act}/campaigns`, ctx.token, {
        name: plan.name,
        objective,
        status: 'PAUSED',
        special_ad_categories: '[]',
        buying_type: 'AUCTION',
        bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
        [budgetKey]: toMetaMinor(plan.budgetAmount, plan.currency),
      });
      s.campaignId = r.id;
      await save({ campaignId: r.id });
    }
    const groups = { ...(s.groups ?? {}) };
    const images = { ...(s.images ?? {}) };
    const forms = { ...(s.forms ?? {}) };
    const creatives = { ...(s.creatives ?? {}) };
    const ads = { ...(s.ads ?? {}) };
    for (const g of plan.groups) {
      const first = g.ads[0]!.creative as MetaCreative;
      if (!groups[g.localId]) {
        const r = await this.call<{ id: string }>('POST', `${act}/adsets`, ctx.token, {
          name: g.name,
          campaign_id: s.campaignId,
          status: 'PAUSED',
          billing_event: 'IMPRESSIONS',
          targeting: JSON.stringify({ ...this.targeting(g.targeting as MetaTargeting), targeting_automation: { advantage_audience: 0 } }),
          ...(plan.startAt ? { start_time: plan.startAt } : {}),
          ...(plan.endAt ? { end_time: plan.endAt } : {}),
          ...this.adSetGoal(plan.objective, first),
        });
        groups[g.localId] = r.id;
        await save({ groups });
      }
      for (const ad of g.ads) {
        const c = ad.creative as MetaCreative;
        if (!images[ad.localId]) {
          const img = await ad.image!();
          const r = await this.call<{ images: Record<string, { hash: string }> }>('POST', `${act}/adimages`, ctx.token, { bytes: img.bytes.toString('base64'), name: img.fileName });
          const hash = Object.values(r.images)[0]?.hash;
          if (!hash) throw new ProviderError('Meta did not return an image hash', 502);
          images[ad.localId] = hash;
          await save({ images });
        }
        if (plan.objective === 'LEADS' && !forms[ad.localId]) {
          const lf = c.leadForm!;
          const page = await this.call<{ access_token?: string }>('GET', c.pageId, ctx.token, { fields: 'access_token' });
          if (!page.access_token) throw new ProviderAuthError('No access to the Facebook Page for lead forms (pages_manage_ads)');
          const r = await this.call<{ id: string }>('POST', `${c.pageId}/leadgen_forms`, page.access_token, {
            name: `${lf.name} ${Date.now().toString(36)}`,
            questions: JSON.stringify(lf.questions.map((type) => ({ type }))),
            privacy_policy: JSON.stringify({ url: lf.privacyPolicyUrl, link_text: 'Privacy policy' }),
            ...(lf.intro ? { context_card: JSON.stringify({ title: lf.name, content: [lf.intro], style: 'PARAGRAPH_STYLE' }) } : {}),
            ...(lf.thankYouUrl ? { thank_you_page: JSON.stringify({ title: 'Thank you', body: 'We will contact you soon.', button_type: 'VIEW_WEBSITE', website_url: lf.thankYouUrl }) } : {}),
          });
          forms[ad.localId] = r.id;
          await save({ forms });
        }
        if (!creatives[ad.localId]) {
          const r = await this.call<{ id: string }>('POST', `${act}/adcreatives`, ctx.token, {
            name: `${ad.name} creative`,
            object_story_spec: JSON.stringify({ page_id: c.pageId, link_data: this.linkData(plan.objective, c, images[ad.localId]!, forms[ad.localId]) }),
          });
          creatives[ad.localId] = r.id;
          await save({ creatives });
        }
        if (!ads[ad.localId]) {
          const r = await this.call<{ id: string }>('POST', `${act}/ads`, ctx.token, { name: ad.name, adset_id: groups[g.localId], creative: JSON.stringify({ creative_id: creatives[ad.localId] }), status: 'PAUSED' });
          ads[ad.localId] = r.id;
          await save({ ads });
        }
      }
    }
    return { campaignId: s.campaignId, groups, ads };
  }

  /** Activation turns ads and ad sets on first and the campaign last, so spending can only start at the final step. */
  async setStatus(ctx: AdsCtx, ids: CampaignIds, status: 'ACTIVE' | 'PAUSED'): Promise<void> {
    const order = status === 'ACTIVE' ? [...ids.adIds, ...ids.groupIds, ids.campaignId] : [ids.campaignId];
    for (const id of order) await this.call('POST', id, ctx.token, { status });
  }

  async updateBudget(ctx: AdsCtx, ids: CampaignIds, budgetType: 'DAILY' | 'LIFETIME', amount: string): Promise<void> {
    await this.call('POST', ids.campaignId, ctx.token, { [budgetType === 'DAILY' ? 'daily_budget' : 'lifetime_budget']: toMetaMinor(amount, ctx.account.currency) });
  }

  async listCampaigns(ctx: AdsCtx): Promise<ImportedCampaign[]> {
    const res = await this.call<{ data: Array<{ id: string; name: string; objective: string; status: string; effective_status?: string; daily_budget?: string; lifetime_budget?: string; start_time?: string; stop_time?: string }> }>('GET', `${ctx.account.externalId}/campaigns`, ctx.token, {
      fields: 'id,name,objective,status,effective_status,daily_budget,lifetime_budget,start_time,stop_time',
      limit: '200',
    });
    return res.data.map((c) => ({
      externalId: c.id,
      name: c.name,
      status: c.status === 'ACTIVE' ? (c.stop_time && new Date(c.stop_time) < new Date() ? 'COMPLETED' : 'ACTIVE') : c.status === 'ARCHIVED' || c.status === 'DELETED' ? 'ARCHIVED' : 'PAUSED',
      objective: FROM_OBJECTIVE[c.objective] ?? 'TRAFFIC',
      budgetType: c.lifetime_budget && c.lifetime_budget !== '0' ? 'LIFETIME' : 'DAILY',
      budgetAmount: c.daily_budget && c.daily_budget !== '0' ? fromMetaMinor(c.daily_budget, ctx.account.currency) : c.lifetime_budget && c.lifetime_budget !== '0' ? fromMetaMinor(c.lifetime_budget, ctx.account.currency) : null,
      startAt: c.start_time ?? null,
      endAt: c.stop_time ?? null,
    }));
  }

  async insights(ctx: AdsCtx, campaignIds: string[], from: string, to: string): Promise<InsightRow[]> {
    if (!campaignIds.length) return [];
    const out: InsightRow[] = [];
    let next: string | null = this.url(`${ctx.account.externalId}/insights`, {
      level: 'campaign',
      time_increment: '1',
      time_range: JSON.stringify({ since: from, until: to }),
      fields: 'campaign_id,date_start,impressions,reach,clicks,spend,actions',
      filtering: JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: campaignIds }]),
      limit: '500',
    }, ctx.token);
    for (let page = 0; next && page < 20; page++) {
      const res: { data: Array<{ campaign_id: string; date_start: string; impressions?: string; reach?: string; clicks?: string; spend?: string; actions?: Array<{ action_type: string; value: string }> }>; paging?: { next?: string } } = await requestJson(this.fetchImpl, next, { authErrors: metaAuth });
      for (const r of res.data) {
        const act = (types: string[]) => (r.actions ?? []).filter((a) => types.includes(a.action_type)).reduce((n, a) => n + Number(a.value), 0);
        const leads = act(['lead', 'onsite_conversion.lead_grouped']);
        out.push({
          campaignId: r.campaign_id,
          date: r.date_start,
          impressions: Number(r.impressions ?? 0),
          reach: Number(r.reach ?? 0),
          clicks: Number(r.clicks ?? 0),
          spend: Number(r.spend ?? 0).toFixed(2),
          leads,
          conversions: leads + act(['onsite_conversion.messaging_conversation_started_7d']),
        });
      }
      next = res.paging?.next ?? null;
    }
    return out;
  }

  /** `GET /{ad_id}/leads` (needs `leads_retrieval`), newest first, filtered by time_created and paged. */
  async listLeads(ctx: AdsCtx, adId: string, since: Date | null): Promise<PlatformLead[]> {
    const out: PlatformLead[] = [];
    const params: Record<string, string> = { fields: 'id,created_time,form_id,field_data', limit: '100' };
    if (since) params.filtering = JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: Math.floor(since.getTime() / 1000) }]);
    let next: string | null = this.url(`${adId}/leads`, params, ctx.token);
    for (let page = 0; next && page < 20; page++) {
      const res: { data: Array<{ id: string; created_time: string; form_id?: string; field_data?: Array<{ name: string; values?: string[] }> }>; paging?: { next?: string } } = await requestJson(this.fetchImpl, next, { authErrors: metaAuth });
      for (const l of res.data) {
        out.push({ externalId: l.id, createdAt: l.created_time, formId: l.form_id ?? null, fields: Object.fromEntries((l.field_data ?? []).map((f) => [f.name.toLowerCase(), (f.values ?? []).join(', ').slice(0, 500)])) });
      }
      next = res.paging?.next ?? null;
    }
    return out;
  }

  async searchTargeting(ctx: AdsCtx, kind: 'location' | 'interest' | 'language', q: string): Promise<TargetingOption[]> {
    if (kind === 'location') {
      const r = await this.call<{ data: Array<{ key: string; name: string; type: string; country_code?: string; region?: string; country_name?: string }> }>('GET', 'search', ctx.token, { type: 'adgeolocation', q, location_types: JSON.stringify(['country', 'region', 'city']), limit: '10' });
      return r.data.map((d) => ({ id: d.key, name: d.name, type: d.type, countryCode: d.country_code, description: [d.region, d.country_name].filter(Boolean).join(', ') || undefined }));
    }
    if (kind === 'interest') {
      const r = await this.call<{ data: Array<{ id: string; name: string; audience_size_upper_bound?: number; path?: string[] }> }>('GET', 'search', ctx.token, { type: 'adinterest', q, limit: '10' });
      return r.data.map((d) => ({ id: d.id, name: d.name, type: 'interest', description: d.path?.slice(0, -1).join(' › ') }));
    }
    const r = await this.call<{ data: Array<{ key: number; name: string }> }>('GET', 'search', ctx.token, { type: 'adlocale', q, limit: '10' });
    return r.data.map((d) => ({ id: String(d.key), name: d.name, type: 'language' }));
  }
}
