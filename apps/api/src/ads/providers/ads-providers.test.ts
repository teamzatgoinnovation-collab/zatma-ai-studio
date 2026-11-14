import { describe, expect, it } from 'vitest';
import type { GoogleRsa, MetaCreative } from '@zatma/validation';
import { isRetryable, ProviderAuthError, ProviderError, type FetchLike } from '../../social/providers/provider.js';
import type { AdsCtx, CampaignPlan } from './ads-provider.js';
import { GoogleAdsAdapter } from './google-ads.js';
import { MetaAdsAdapter } from './meta-ads.js';

type Reply = { status?: number; body?: unknown };
type Route = (url: URL, init: RequestInit) => Reply | undefined;
function fakeFetch(routes: Route[]) {
  const calls: Array<{ method: string; url: URL; init: RequestInit; form?: Record<string, string>; json?: unknown }> = [];
  const impl: FetchLike = async (u, init = {}) => {
    const url = new URL(u);
    const form = init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : undefined;
    const json = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method ?? 'GET', url, init, form, json });
    for (const r of routes) {
      const res = r(url, init);
      if (res) return new Response(JSON.stringify(res.body ?? {}), { status: res.status ?? 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: { message: `unexpected ${init.method ?? 'GET'} ${url.pathname}` } }), { status: 404 });
  };
  return { impl, calls };
}
const ctx = (over: Partial<AdsCtx['account']> = {}, state: Record<string, unknown> = {}): AdsCtx & { saved: Record<string, unknown> } => {
  const saved = { ...state };
  return { token: 'tok', account: { externalId: 'act_42', currency: 'INR', ...over }, state: saved, saved, saveState: async (p) => void Object.assign(saved, p) };
};

const META = { appId: 'app', appSecret: 'secret', graphVersion: 'v24.0', graphUrl: 'https://graph.test', oauthUrl: 'https://www.fb.test' };
const creative: MetaCreative = { pageId: '1001', primaryText: 'Onam offers', headline: 'Onam Sale', description: '', cta: 'LEARN_MORE', link: 'https://zatgo.com/onam', imageFileId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', imageWidth: 1080, imageHeight: 1080 };
const metaPlan = (over: Partial<CampaignPlan> = {}, cr: Partial<MetaCreative> = {}): CampaignPlan => ({
  name: 'Onam Traffic',
  objective: 'TRAFFIC',
  budgetType: 'DAILY',
  budgetAmount: '500.50',
  currency: 'INR',
  endAt: '2026-11-30T18:30:00Z',
  groups: [{ localId: 'g1', name: 'Kerala', targeting: { locations: [{ key: '1100', name: 'Kerala', type: 'region' }, { key: 'IN', name: 'India', type: 'country' }], ageMin: 25, ageMax: 55, genders: [], interests: [{ id: '6003', name: 'Shopping' }], locales: [] }, ads: [{ localId: 'a1', name: 'Ad 1', creative: { ...creative, ...cr }, image: async () => ({ bytes: Buffer.from('jpegbytes'), fileName: 'onam.jpg' }) }] }],
  ...over,
});
const G = (p: string) => (u: URL) => u.pathname === `/v24.0/${p}`;

describe('MetaAdsAdapter', () => {
  it('reads lead-form submissions for an ad, newer than the watermark, across pages', async () => {
    const { impl, calls } = fakeFetch([
      (u) =>
        u.pathname === '/v24.0/ad-1/leads' && !u.searchParams.get('after')
          ? { body: { data: [{ id: 'L1', created_time: '2026-11-12T05:00:00+0000', form_id: 'F1', field_data: [{ name: 'FULL_NAME', values: ['Deepa Nair'] }, { name: 'phone_number', values: ['+919847000099'] }] }], paging: { next: 'https://graph.test/v24.0/ad-1/leads?after=c2&access_token=tok' } } }
          : undefined,
      (u) => (u.searchParams.get('after') === 'c2' ? { body: { data: [{ id: 'L2', created_time: '2026-11-12T06:00:00+0000', field_data: [] }] } } : undefined),
    ]);
    const leads = await new MetaAdsAdapter(META, impl).listLeads(ctx(), 'ad-1', new Date('2026-11-12T00:00:00Z'));
    expect(leads).toEqual([
      { externalId: 'L1', createdAt: '2026-11-12T05:00:00+0000', formId: 'F1', fields: { full_name: 'Deepa Nair', phone_number: '+919847000099' } },
      { externalId: 'L2', createdAt: '2026-11-12T06:00:00+0000', formId: null, fields: {} },
    ]);
    const first = calls[0]!.url;
    expect(JSON.parse(first.searchParams.get('filtering')!)).toEqual([{ field: 'time_created', operator: 'GREATER_THAN', value: Date.UTC(2026, 10, 12) / 1000 }]);
    expect(first.searchParams.get('appsecret_proof')).toMatch(/^[0-9a-f]{64}$/);
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('requests Marketing API permissions at login', () => {
    const url = new URL(new MetaAdsAdapter(META).authorizeUrl({ state: 's', redirectUri: 'https://api.test/cb' }));
    expect(url.searchParams.get('scope')).toContain('ads_management');
    expect(url.searchParams.get('scope')).toContain('pages_manage_ads');
  });

  it('creates campaign → ad set → image → creative → ad, all PAUSED, with budgets in minor units', async () => {
    const f = fakeFetch([
      (u, i) => (G('act_42/campaigns')(u) && i.method === 'POST' ? { body: { id: 'c1' } } : undefined),
      (u) => (G('act_42/adsets')(u) ? { body: { id: 's1' } } : undefined),
      (u) => (G('act_42/adimages')(u) ? { body: { images: { 'onam.jpg': { hash: 'h1' } } } } : undefined),
      (u) => (G('act_42/adcreatives')(u) ? { body: { id: 'cr1' } } : undefined),
      (u) => (G('act_42/ads')(u) ? { body: { id: 'ad1' } } : undefined),
    ]);
    const c = ctx();
    const res = await new MetaAdsAdapter(META, f.impl).createCampaign(metaPlan(), c);
    expect(res).toEqual({ campaignId: 'c1', groups: { g1: 's1' }, ads: { a1: 'ad1' } });
    expect(f.calls.map((x) => x.url.pathname.split('/').pop())).toEqual(['campaigns', 'adsets', 'adimages', 'adcreatives', 'ads']);
    const [camp, adset, img, cr, ad] = f.calls;
    expect(camp!.form).toMatchObject({ objective: 'OUTCOME_TRAFFIC', status: 'PAUSED', daily_budget: '50050', special_ad_categories: '[]' });
    expect(adset!.form).toMatchObject({ status: 'PAUSED', campaign_id: 'c1', optimization_goal: 'LINK_CLICKS', end_time: '2026-11-30T18:30:00Z' });
    expect(JSON.parse(adset!.form!.targeting!)).toMatchObject({ geo_locations: { countries: ['IN'], regions: [{ key: '1100' }] }, age_min: 25, flexible_spec: [{ interests: [{ id: '6003', name: 'Shopping' }] }] });
    expect(img!.form).toMatchObject({ bytes: Buffer.from('jpegbytes').toString('base64') });
    expect(JSON.parse(cr!.form!.object_story_spec!)).toEqual({ page_id: '1001', link_data: { image_hash: 'h1', message: 'Onam offers', name: 'Onam Sale', link: 'https://zatgo.com/onam', call_to_action: { type: 'LEARN_MORE', value: { link: 'https://zatgo.com/onam' } } } });
    expect(ad!.form).toMatchObject({ status: 'PAUSED', adset_id: 's1' });
    expect(f.calls.every((x) => /^[0-9a-f]{64}$/.test(x.url.searchParams.get('appsecret_proof') ?? ''))).toBe(true);
    expect(f.calls.some((x) => x.form?.status === 'ACTIVE')).toBe(false);
  });

  it('resumes after a failure without recreating finished steps', async () => {
    let failAds = true;
    let campaigns = 0;
    const f = fakeFetch([
      (u, i) => (G('act_42/campaigns')(u) && i.method === 'POST' ? (campaigns++, { body: { id: 'c1' } }) : undefined),
      (u) => (G('act_42/adsets')(u) ? { body: { id: 's1' } } : undefined),
      (u) => (G('act_42/adimages')(u) ? { body: { images: { x: { hash: 'h1' } } } } : undefined),
      (u) => (G('act_42/adcreatives')(u) ? { body: { id: 'cr1' } } : undefined),
      (u) => {
        if (!G('act_42/ads')(u)) return undefined;
        if (failAds) {
          failAds = false;
          return { status: 500, body: { error: { message: 'Please reduce the amount of data', code: 1, is_transient: true } } };
        }
        return { body: { id: 'ad1' } };
      },
    ]);
    const a = new MetaAdsAdapter(META, f.impl);
    const c = ctx();
    expect(isRetryable(await a.createCampaign(metaPlan(), c).catch((e) => e))).toBe(true);
    expect(c.saved).toMatchObject({ campaignId: 'c1', groups: { g1: 's1' }, images: { a1: 'h1' }, creatives: { a1: 'cr1' } });
    await a.createCampaign(metaPlan(), c);
    expect(campaigns).toBe(1);
    expect(f.calls.filter((x) => x.url.pathname.endsWith('/adcreatives'))).toHaveLength(1);
  });

  it('builds WhatsApp message ads and lead form ads', async () => {
    const f = fakeFetch([
      (u, i) => (G('act_42/campaigns')(u) && i.method === 'POST' ? { body: { id: 'c1' } } : undefined),
      (u) => (G('act_42/adsets')(u) ? { body: { id: 's1' } } : undefined),
      (u) => (G('act_42/adimages')(u) ? { body: { images: { x: { hash: 'h1' } } } } : undefined),
      (u) => (G('1001')(u) ? { body: { access_token: 'page-token' } } : undefined),
      (u) => (G('1001/leadgen_forms')(u) ? { body: { id: 'form1' } } : undefined),
      (u) => (G('act_42/adcreatives')(u) ? { body: { id: 'cr1' } } : undefined),
      (u) => (G('act_42/ads')(u) ? { body: { id: 'ad1' } } : undefined),
    ]);
    const a = new MetaAdsAdapter(META, f.impl);
    await a.createCampaign(metaPlan({ objective: 'MESSAGES' }, { messaging: { channel: 'WHATSAPP', whatsappNumber: '+919847012345' } }), ctx());
    const adset = f.calls.find((x) => x.url.pathname.endsWith('/adsets'))!;
    expect(adset.form).toMatchObject({ optimization_goal: 'CONVERSATIONS', destination_type: 'WHATSAPP' });
    expect(JSON.parse(adset.form!.promoted_object!)).toEqual({ page_id: '1001', whatsapp_phone_number: '+919847012345' });
    expect(JSON.parse(f.calls.find((x) => x.url.pathname.endsWith('/adcreatives'))!.form!.object_story_spec!).link_data.call_to_action).toEqual({ type: 'WHATSAPP_MESSAGE', value: { app_destination: 'WHATSAPP' } });

    f.calls.length = 0;
    await a.createCampaign(metaPlan({ objective: 'LEADS' }, { leadForm: { name: 'Onam enquiry', questions: ['FULL_NAME', 'PHONE'], privacyPolicyUrl: 'https://zatgo.com/privacy' } }), ctx());
    expect(f.calls.find((x) => x.url.pathname.endsWith('/campaigns'))!.form!.objective).toBe('OUTCOME_LEADS');
    const lf = f.calls.find((x) => x.url.pathname.endsWith('/leadgen_forms'))!;
    expect(lf.url.searchParams.get('access_token')).toBe('page-token');
    expect(JSON.parse(lf.form!.questions!)).toEqual([{ type: 'FULL_NAME' }, { type: 'PHONE' }]);
    expect(JSON.parse(f.calls.find((x) => x.url.pathname.endsWith('/adcreatives'))!.form!.object_story_spec!).link_data.call_to_action).toEqual({ type: 'SIGN_UP', value: { lead_gen_form_id: 'form1' } });
  });

  it('activates ads and ad sets before the campaign; pausing touches only the campaign', async () => {
    const f = fakeFetch([() => ({ body: { success: true } })]);
    const a = new MetaAdsAdapter(META, f.impl);
    const ids = { campaignId: 'c1', groupIds: ['s1'], adIds: ['ad1', 'ad2'] };
    await a.setStatus(ctx(), ids, 'ACTIVE');
    expect(f.calls.map((x) => [x.url.pathname.split('/').pop(), x.form!.status])).toEqual([
      ['ad1', 'ACTIVE'],
      ['ad2', 'ACTIVE'],
      ['s1', 'ACTIVE'],
      ['c1', 'ACTIVE'],
    ]);
    f.calls.length = 0;
    await a.setStatus(ctx(), ids, 'PAUSED');
    expect(f.calls.map((x) => x.url.pathname.split('/').pop())).toEqual(['c1']);
  });

  it('parses insights, surfaces user-facing errors and maps token errors', async () => {
    const f = fakeFetch([
      (u) =>
        G('act_42/insights')(u)
          ? { body: { data: [{ campaign_id: 'c1', date_start: '2026-11-10', impressions: '1200', reach: '900', clicks: '45', spend: '312.4', actions: [{ action_type: 'lead', value: '3' }, { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '2' }] }] } }
          : undefined,
    ]);
    expect(await new MetaAdsAdapter(META, f.impl).insights(ctx(), ['c1'], '2026-11-10', '2026-11-10')).toEqual([{ campaignId: 'c1', date: '2026-11-10', impressions: 1200, reach: 900, clicks: 45, spend: '312.40', leads: 3, conversions: 5 }]);
    const bad = fakeFetch([() => ({ status: 400, body: { error: { message: 'Invalid parameter', code: 100, error_user_title: 'Budget too low', error_user_msg: 'Your budget must be at least ₹86.00 per day.' } } })]);
    const err = await new MetaAdsAdapter(META, bad.impl).createCampaign(metaPlan(), ctx()).catch((e) => e);
    expect(err.message).toBe('Budget too low: Your budget must be at least ₹86.00 per day.');
    expect(isRetryable(err)).toBe(false);
    const expired = fakeFetch([() => ({ status: 400, body: { error: { message: 'Session has expired', code: 190 } } })]);
    await expect(new MetaAdsAdapter(META, expired.impl).listAdAccounts('t')).rejects.toBeInstanceOf(ProviderAuthError);
  });
});

const GADS = { clientId: 'gc', clientSecret: 'gs', developerToken: 'dev-tok', apiVersion: 'v22', apiUrl: 'https://googleads.test', authUrl: 'https://accounts.test/auth', tokenUrl: 'https://oauth.test/token', revokeUrl: 'https://oauth.test/revoke' };
const rsa: GoogleRsa = { headlines: ['Van Sales ERP', 'Free for 1 month', 'Built for Kerala'], descriptions: ['Manage vans, stock and collections.', 'WhatsApp us for a demo.'], finalUrl: 'https://zatgo.com/van-sales' };
const googlePlan: CampaignPlan = {
  name: 'Van Sales Search',
  objective: 'SEARCH',
  budgetType: 'DAILY',
  budgetAmount: '800',
  currency: 'INR',
  groups: [{ localId: 'g1', name: 'ERP keywords', targeting: { locations: [{ id: '2356', name: 'India' }], languages: [{ id: '1000', name: 'English' }], keywords: [{ text: 'van sales software', matchType: 'PHRASE' }] }, ads: [{ localId: 'a1', name: 'RSA 1', creative: rsa }] }],
};

describe('GoogleAdsAdapter', () => {
  it('lists client accounts under a manager with the developer token and login-customer-id', async () => {
    const f = fakeFetch([
      (u) => (u.pathname === '/v22/customers:listAccessibleCustomers' ? { body: { resourceNames: ['customers/1110000000'] } } : undefined),
      (u, i) => (u.pathname === '/v22/customers/1110000000/googleAds:search' && (i.body as string).includes('FROM customer_client') ? { body: { results: [{ customerClient: { id: '2220000000', descriptiveName: 'ZatGo India', currencyCode: 'INR', timeZone: 'Asia/Kolkata', manager: false, status: 'ENABLED' } }] } } : undefined),
      (u) => (u.pathname === '/v22/customers/1110000000/googleAds:search' ? { body: { results: [{ customer: { id: '1110000000', descriptiveName: 'ZatGo MCC', currencyCode: 'INR', timeZone: 'Asia/Kolkata', manager: true, status: 'ENABLED' } }] } } : undefined),
    ]);
    const accounts = await new GoogleAdsAdapter(GADS, f.impl).listAdAccounts('tok');
    expect(accounts).toEqual([{ externalId: '2220000000', name: 'ZatGo India', currency: 'INR', timezone: 'Asia/Kolkata', status: 'ACTIVE', manager: false, loginCustomerId: '1110000000' }]);
    const h = new Headers(f.calls[1]!.init.headers);
    expect([h.get('developer-token'), h.get('login-customer-id'), h.get('authorization')]).toEqual(['dev-tok', '1110000000', 'Bearer tok']);
  });

  it('validates the whole plan, then creates it atomically with the campaign PAUSED and budgets in micros', async () => {
    const f = fakeFetch([
      (u, i) => {
        if (u.pathname !== '/v22/customers/2220000000/googleAds:mutate') return undefined;
        const body = JSON.parse(i.body as string);
        if (body.validateOnly) return { body: {} };
        const kinds: Record<string, string> = { campaignBudgetOperation: 'campaignBudgetResult', campaignOperation: 'campaignResult', campaignCriterionOperation: 'campaignCriterionResult', adGroupOperation: 'adGroupResult', adGroupCriterionOperation: 'adGroupCriterionResult', adGroupAdOperation: 'adGroupAdResult' };
        return { body: { mutateOperationResponses: body.mutateOperations.map((op: Record<string, unknown>, n: number) => ({ [kinds[Object.keys(op)[0]!]!]: { resourceName: `customers/2220000000/x/${n + 100}` } })) } };
      },
    ]);
    const c = ctx({ externalId: '2220000000', loginCustomerId: '1110000000' });
    const res = await new GoogleAdsAdapter(GADS, f.impl).createCampaign(googlePlan, c);
    expect(f.calls).toHaveLength(2);
    expect(f.calls[0]!.json).toMatchObject({ validateOnly: true, partialFailure: false });
    const ops = (f.calls[1]!.json as { mutateOperations: Array<Record<string, { create: Record<string, unknown> }>> }).mutateOperations;
    expect(ops[0]!.campaignBudgetOperation!.create).toMatchObject({ amountMicros: '800000000', resourceName: 'customers/2220000000/campaignBudgets/-1' });
    expect(ops[1]!.campaignOperation!.create).toMatchObject({ status: 'PAUSED', advertisingChannelType: 'SEARCH', campaignBudget: 'customers/2220000000/campaignBudgets/-1' });
    expect(ops.find((o) => o.adGroupAdOperation)!.adGroupAdOperation!.create).toMatchObject({ ad: { finalUrls: ['https://zatgo.com/van-sales'], responsiveSearchAd: { headlines: [{ text: 'Van Sales ERP' }, { text: 'Free for 1 month' }, { text: 'Built for Kerala' }] } } });
    expect(ops.find((o) => o.adGroupCriterionOperation)!.adGroupCriterionOperation!.create).toMatchObject({ keyword: { text: 'van sales software', matchType: 'PHRASE' } });
    expect(res).toMatchObject({ budgetId: 'customers/2220000000/x/100', campaignId: 'customers/2220000000/x/101' });
    expect(new Headers(f.calls[1]!.init.headers).get('login-customer-id')).toBe('1110000000');
    // Saved: calling again does not create anything twice
    await new GoogleAdsAdapter(GADS, f.impl).createCampaign(googlePlan, c);
    expect(f.calls).toHaveLength(2);
  });

  it('changes only campaign status and budget, reads insights in micros, and explains token problems', async () => {
    const f = fakeFetch([
      (u) => (u.pathname.endsWith('/googleAds:mutate') ? { body: { mutateOperationResponses: [{}] } } : undefined),
      (u) => (u.pathname.endsWith('/googleAds:search') ? { body: { results: [{ campaign: { resourceName: 'customers/2/campaigns/9' }, segments: { date: '2026-11-10' }, metrics: { impressions: '500', clicks: '40', costMicros: '256750000', conversions: 2.0 } }] } } : undefined),
    ]);
    const a = new GoogleAdsAdapter(GADS, f.impl);
    const ids = { campaignId: 'customers/2/campaigns/9', budgetId: 'customers/2/campaignBudgets/7', groupIds: [], adIds: [] };
    await a.setStatus(ctx({ externalId: '2' }), ids, 'ACTIVE');
    expect((f.calls[0]!.json as { mutateOperations: unknown[] }).mutateOperations).toEqual([{ campaignOperation: { update: { resourceName: 'customers/2/campaigns/9', status: 'ENABLED' }, updateMask: 'status' } }]);
    await a.updateBudget(ctx({ externalId: '2' }), ids, 'DAILY', '1000');
    expect((f.calls[1]!.json as { mutateOperations: unknown[] }).mutateOperations).toEqual([{ campaignBudgetOperation: { update: { resourceName: 'customers/2/campaignBudgets/7', amountMicros: '1000000000' }, updateMask: 'amount_micros' } }]);
    expect(await a.insights(ctx({ externalId: '2' }), ['customers/2/campaigns/9'], '2026-11-10', '2026-11-10')).toEqual([{ campaignId: 'customers/2/campaigns/9', date: '2026-11-10', impressions: 500, reach: 0, clicks: 40, spend: '256.75', conversions: 2, leads: 0 }]);
    expect((f.calls[2]!.json as { query: string }).query).toContain("segments.date BETWEEN '2026-11-10' AND '2026-11-10' AND campaign.id IN (9)");

    const notApproved = fakeFetch([() => ({ status: 403, body: { error: { code: 403, status: 'PERMISSION_DENIED', message: 'The caller does not have permission', details: [{ errors: [{ errorCode: { authorizationError: 'DEVELOPER_TOKEN_NOT_APPROVED' }, message: 'The developer token is not approved.' }] }] } } })]);
    const e1 = await new GoogleAdsAdapter(GADS, notApproved.impl).listAdAccounts('t').catch((e) => e);
    expect(e1.message).toContain('developer token is not approved');
    const quota = fakeFetch([() => ({ status: 429, body: { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Too many requests' } } })]);
    expect(isRetryable(await new GoogleAdsAdapter(GADS, quota.impl).listAdAccounts('t').catch((e) => e))).toBe(true);
    const policy = fakeFetch([() => ({ status: 400, body: { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Request contains an invalid argument.', details: [{ errors: [{ errorCode: { policyFindingError: 'POLICY_FINDING' }, message: 'Ad text uses excessive capitalization.' }] }] } } })]);
    const e3 = await new GoogleAdsAdapter(GADS, policy.impl).createCampaign(googlePlan, ctx({ externalId: '2' })).catch((e) => e);
    expect([e3 instanceof ProviderError, e3.message, isRetryable(e3)]).toEqual([true, 'Ad text uses excessive capitalization.', false]);
    const auth = fakeFetch([() => ({ status: 401, body: { error: { code: 401, status: 'UNAUTHENTICATED', message: 'Request had invalid authentication credentials.' } } })]);
    await expect(new GoogleAdsAdapter(GADS, auth.impl).listAdAccounts('t')).rejects.toBeInstanceOf(ProviderAuthError);
  });
});
