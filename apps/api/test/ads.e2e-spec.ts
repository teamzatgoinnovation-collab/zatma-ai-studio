import { randomBytes } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { maxSpend, type AdPlatform, type TargetingOption } from '@zatma/validation';
import { AIProviderRegistry } from '../src/ai/ai-provider.registry.js';
import type { AITextProvider } from '../src/ai/ai-provider.interfaces.js';
import { AdsRegistry } from '../src/ads/ads-registry.js';
import { AdsWorkerService } from '../src/ads/ads.worker.js';
import type { AdAccountInfo, AdsCtx, AdsPlatformAdapter, CampaignIds, CampaignPlan, CreatedCampaign, ImportedCampaign, InsightRow } from '../src/ads/providers/ads-provider.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import type { DiscoveredAccount, OAuthGrant, SocialProvider } from '../src/social/providers/provider.js';
import { ProviderError } from '../src/social/providers/provider.js';
import { SocialProviderRegistry } from '../src/social/social-registry.js';
import { TokenCipher } from '../src/social/token-cipher.js';
import { createTestApp, MemoryObjectStorage } from './harness.js';
import { api, createOrg, inviteAndAccept, signUp, waitForEmail, type TestUser } from './helpers.js';

const KEY = `k1:${randomBytes(32).toString('base64')}`;

/** Ad platform stand-in: logs every call so tests can prove what was (and was not) sent. */
class FakeAds implements AdsPlatformAdapter {
  readonly scopes = ['ads'];
  readonly name: string;
  readonly usesPkce = false;
  calls: Array<{ op: string; args: unknown }> = [];
  remote: ImportedCampaign[] = [];
  insightRows: InsightRow[] = [];
  failCreate: 'none' | 'transient' | 'permanent' = 'none';
  private n = 0;
  constructor(
    readonly platform: AdPlatform,
    readonly oauthId: 'meta_ads' | 'google_ads',
    private readonly accounts: AdAccountInfo[],
  ) {
    this.name = oauthId;
  }
  authorizeUrl({ state }: { state: string }) {
    return `https://auth.fake/${this.oauthId}?state=${state}`;
  }
  async exchangeCode(): Promise<OAuthGrant> {
    return { accessToken: `ads-token-${this.oauthId}`, refreshToken: null, expiresAt: new Date(Date.now() + 30 * 86_400_000), scopes: this.scopes, externalUserId: `${this.oauthId}-user`, displayName: 'Ads user' };
  }
  async revoke(token: string) {
    this.calls.push({ op: 'revoke', args: token });
  }
  async listAdAccounts() {
    return this.accounts;
  }
  async createCampaign(plan: CampaignPlan, ctx: AdsCtx): Promise<CreatedCampaign> {
    this.calls.push({ op: 'createCampaign', args: { plan, token: ctx.token, state: { ...ctx.state } } });
    if (!ctx.state.campaignId) await ctx.saveState({ campaignId: `cmp-${++this.n}` });
    if (this.failCreate === 'transient') {
      this.failCreate = 'none';
      throw new ProviderError('Service unavailable', 503);
    }
    if (this.failCreate === 'permanent') {
      this.failCreate = 'none';
      throw new ProviderError('Budget too low: Your budget must be at least ₹86.00 per day.', 400);
    }
    const id = ctx.state.campaignId as string;
    return { campaignId: id, budgetId: `${id}-budget`, groups: Object.fromEntries(plan.groups.map((g, i) => [g.localId, `${id}-g${i}`])), ads: Object.fromEntries(plan.groups.flatMap((g) => g.ads).map((a, i) => [a.localId, `${id}-a${i}`])) };
  }
  async setStatus(_ctx: AdsCtx, ids: CampaignIds, status: 'ACTIVE' | 'PAUSED') {
    this.calls.push({ op: 'setStatus', args: { ids, status } });
  }
  async updateBudget(_ctx: AdsCtx, ids: CampaignIds, type: string, amount: string) {
    this.calls.push({ op: 'updateBudget', args: { ids, type, amount } });
  }
  async listCampaigns() {
    return this.remote;
  }
  async insights(_ctx: AdsCtx, ids: string[]) {
    return this.insightRows.filter((r) => ids.includes(r.campaignId));
  }
  async searchTargeting(_ctx: AdsCtx, kind: string, q: string): Promise<TargetingOption[]> {
    if (q === 'Atlantis') return [];
    if (kind === 'location') return this.platform === 'META' ? [{ id: q === 'Kerala' ? '1100' : '2001', name: q, type: q === 'Kerala' ? 'region' : 'city', countryCode: 'IN' }] : [{ id: '2356', name: q, type: 'country' }];
    if (kind === 'interest') return [{ id: `int-${q.length}`, name: q, type: 'interest' }];
    return [{ id: '1000', name: 'English', type: 'language' }];
  }
}

/** Organic Meta stand-in so the org has a connected Facebook Page (required for Meta ad creatives). */
const socialMeta: SocialProvider = {
  id: 'meta',
  name: 'Meta',
  platforms: ['FACEBOOK_PAGE'],
  scopes: [],
  usesPkce: false,
  authorizeUrl: ({ state }) => `https://auth.fake/meta?state=${state}`,
  exchangeCode: async () => ({ accessToken: 'social', refreshToken: null, expiresAt: null, scopes: [], externalUserId: 'fb-user', displayName: 'Zain' }),
  listAccounts: async (): Promise<DiscoveredAccount[]> => [{ platform: 'FACEBOOK_PAGE', externalId: '1001', name: 'ZatGo Kochi', username: null, avatarUrl: null, accountToken: 'page', capabilities: {} }],
  checkAccount: async () => ({ status: 'ACTIVE' }),
  revoke: async () => undefined,
};

function textProvider(reply: string): AITextProvider {
  return { id: 'anthropic', name: 'Anthropic', defaultModel: 'claude-opus-5-5', generateText: async () => ({ text: reply, model: 'claude-opus-5-5', usage: { inputTokens: 900, outputTokens: 500, costMicroUsd: 12_000 }, finishReason: 'stop' as const }) } as AITextProvider;
}

describe('Ads manager (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const storage = new MemoryObjectStorage();
  let owner: TestUser;
  let manager: TestUser;
  let viewer: TestUser;
  let orgId: string;
  let ws: string;
  let meta: FakeAds;
  let google: FakeAds;
  let metaAccount: string;
  let googleAccount: string;
  let imageId: string;

  const connect = async (user: TestUser, provider: 'meta_ads' | 'google_ads', externalIds: string[]) => {
    const start = await api(app, user).post(`/ads/connect/${provider}`, {}).expect(200);
    const state = new URL(start.body.authorizeUrl).searchParams.get('state');
    const cb = await api(app, user).get(`/ads/oauth/${provider}/callback?code=c&state=${state}`).expect(302);
    const loc = new URL(cb.headers.location as string);
    expect(loc.pathname).toBe(provider === 'meta_ads' ? '/ads/meta' : '/ads/google');
    return (await api(app, user).post('/ads/accounts', { connectionId: loc.searchParams.get('connection'), externalIds }).expect(201)).body as Array<{ id: string }>;
  };
  const metaDraft = (over: Record<string, unknown> = {}, creative: Record<string, unknown> = {}) => ({
    workspaceId: ws,
    adAccountId: metaAccount,
    name: 'Onam traffic',
    objective: 'TRAFFIC',
    budgetType: 'DAILY',
    budgetAmount: '500',
    endAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
    adGroups: [
      {
        name: 'Kerala 25–55',
        targeting: { locations: [{ key: '1100', name: 'Kerala', type: 'region' }], ageMin: 25, ageMax: 55 },
        ads: [{ name: 'Ad 1', creative: { pageId: '1001', primaryText: 'Onam offers at ZatGo Kochi', headline: 'Onam Mega Sale', link: 'https://zatgo.com/onam', imageFileId: imageId, imageWidth: 1080, imageHeight: 1080, ...creative } }],
      },
    ],
    ...over,
  });
  const waitStatus = async (id: string, statuses: string[]) => {
    for (let i = 0; i < 100; i++) {
      const r = (await api(app, owner).get(`/ads/campaigns/${id}`).expect(200)).body;
      if (statuses.includes(r.status)) return r;
      await new Promise((res) => setTimeout(res, 100));
    }
    throw new Error(`campaign ${id} did not reach ${statuses}`);
  };

  beforeAll(async () => {
    app = await createTestApp({ env: { TOKEN_ENCRYPTION_KEYS: KEY, META_APP_ID: 'a', META_APP_SECRET: 's' }, storage });
    prisma = app.get(PrismaService);
    const social = app.get(SocialProviderRegistry);
    social.reset(new TokenCipher(KEY));
    social.register(socialMeta);
    const ads = app.get(AdsRegistry);
    ads.reset();
    meta = new FakeAds('META', 'meta_ads', [
      { externalId: 'act_42', name: 'ZatGo Ads', currency: 'INR', timezone: 'Asia/Kolkata', status: 'ACTIVE', manager: false },
      { externalId: 'act_43', name: 'ZatGo Dubai', currency: 'AED', timezone: 'Asia/Dubai', status: 'ACTIVE', manager: false },
    ]);
    google = new FakeAds('GOOGLE', 'google_ads', [{ externalId: '2220000000', name: 'ZatGo Search', currency: 'INR', timezone: 'Asia/Kolkata', status: 'ACTIVE', manager: false, loginCustomerId: '1110000000' }]);
    ads.register(meta);
    ads.register(google);

    owner = await signUp(app, 'Ads Owner');
    orgId = await createOrg(app, owner, 'Ads Org');
    ws = (await api(app, owner).get('/workspaces').expect(200)).body.data[0].id;
    manager = await signUp(app, 'Mia Manager');
    await inviteAndAccept(app, owner, manager, orgId, 'marketing_manager');
    viewer = await signUp(app, 'Vic Viewer');
    await inviteAndAccept(app, owner, viewer, orgId, 'viewer');

    // A connected Facebook Page, and an uploaded ad image.
    const s = await api(app, owner).post('/social/connect/meta', {}).expect(200);
    const st = new URL(s.body.authorizeUrl).searchParams.get('state');
    const cb = await api(app, owner).get(`/social/oauth/meta/callback?code=x&state=${st}`).expect(302);
    await api(app, owner).post('/social/accounts', { connectionId: new URL(cb.headers.location as string).searchParams.get('connection'), externalIds: ['1001'] }).expect(201);
    const up = await api(app, owner).post('/storage/uploads', { fileName: 'onam.jpg', mimeType: 'image/jpeg', sizeBytes: 3000, purpose: 'POST_MEDIA' }).expect(201);
    storage.put(up.body.key, { sizeBytes: 3000, contentType: 'image/jpeg' }, Buffer.alloc(3000, 2));
    await api(app, owner).post(`/storage/uploads/${up.body.fileId}/complete`).expect(201);
    imageId = up.body.fileId;
  });
  afterAll(async () => {
    await app.close();
  });

  it('lists providers and connects ad accounts within the plan limit', async () => {
    const providers = (await api(app, owner).get('/ads/providers').expect(200)).body;
    expect(providers.map((p: { id: string; configured: boolean; redirectUri: string }) => [p.id, p.configured, p.redirectUri.endsWith(`/api/v1/ads/oauth/${p.id}/callback`)])).toEqual([
      ['meta_ads', true, true],
      ['google_ads', true, true],
    ]);
    await api(app, viewer).post('/ads/connect/meta_ads', {}).expect(403);
    const m = await connect(owner, 'meta_ads', ['act_42']);
    metaAccount = m[0]!.id;
    googleAccount = (await connect(owner, 'google_ads', ['2220000000']))[0]!.id;
    const accounts = (await api(app, owner).get('/ads/accounts').expect(200)).body;
    expect(accounts.map((a: { platform: string; name: string; currency: string; spentThisMonth: string }) => [a.platform, a.name, a.currency, a.spentThisMonth])).toEqual([
      ['META', 'ZatGo Ads', 'INR', '0.00'],
      ['GOOGLE', 'ZatGo Search', 'INR', '0.00'],
    ]);
    expect(JSON.stringify(accounts)).not.toMatch(/ads-token|v1\.k1\./);
    const usage = (await api(app, owner).get('/billing/usage').expect(200)).body.metrics.find((x: { metric: string }) => x.metric === 'adAccounts');
    expect(usage.used).toBe(2);
    // Only Owner/Admin may set the spend cap.
    await api(app, manager).patch(`/ads/accounts/${metaAccount}`, { monthlySpendCap: '1000' }).expect(403);
    expect((await api(app, owner).patch(`/ads/accounts/${metaAccount}`, { monthlySpendCap: '100000' }).expect(200)).body.monthlySpendCap).toBe('100000.00');
  });

  it('validates drafts and creates campaigns on the platform PAUSED', async () => {
    await api(app, manager).post('/ads/campaigns', metaDraft({}, { pageId: '9999' })).expect(422);
    await api(app, manager).post('/ads/campaigns', metaDraft({ objective: 'SEARCH' })).expect(422);
    const check = (await api(app, manager).post('/ads/campaigns/validate', metaDraft({}, { link: undefined })).expect(200)).body;
    expect(check.issues.map((i: { code: string }) => i.code)).toContain('LINK_REQUIRED');
    expect(check.maxSpend).toEqual({ amount: '5000.00', days: 10, untilMonthEnd: false });

    const draft = (await api(app, manager).post('/ads/campaigns', metaDraft()).expect(201)).body;
    expect(draft).toMatchObject({ status: 'DRAFT', platform: 'META', currency: 'INR', budgetAmount: '500.00', maxSpend: { amount: '5000.00' }, createdBy: { name: 'Mia Manager' } });
    expect(draft.adGroups[0].ads[0].imageUrl).toContain('X-Amz-Signature');
    expect((await api(app, manager).patch(`/ads/campaigns/${draft.id}`, { name: 'Onam traffic (Kerala)' }).expect(200)).body.adGroups).toHaveLength(1);

    meta.failCreate = 'transient';
    await api(app, manager).post(`/ads/campaigns/${draft.id}/publish`).expect(200);
    // First attempt fails transiently; drive the retry directly instead of waiting 30 s.
    for (let i = 0; i < 50 && !meta.calls.some((c) => c.op === 'createCampaign'); i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 300));
    await app.get(AdsWorkerService).create({ organizationId: orgId, campaignId: draft.id }, false);
    const created = await waitStatus(draft.id, ['PAUSED']);
    expect(created).toMatchObject({ status: 'PAUSED', externalId: 'cmp-1', error: null });
    expect(created.adGroups[0].externalId).toBe('cmp-1-g0');
    const creates = meta.calls.filter((c) => c.op === 'createCampaign');
    expect((creates.at(-1)!.args as { state: { campaignId?: string } }).state.campaignId).toBe('cmp-1'); // resumed, not recreated
    expect((creates[0]!.args as { plan: CampaignPlan; token: string }).plan).toMatchObject({ name: 'Onam traffic (Kerala)', budgetAmount: '500.00', currency: 'INR' });
    expect(meta.calls.some((c) => c.op === 'setStatus')).toBe(false);
    await api(app, manager).patch(`/ads/campaigns/${draft.id}`, { name: 'x' }).expect(409);

    // A permanent platform error is shown and the draft can be fixed and retried.
    const bad = (await api(app, manager).post('/ads/campaigns', metaDraft({ name: 'Too cheap' })).expect(201)).body;
    meta.failCreate = 'permanent';
    await api(app, manager).post(`/ads/campaigns/${bad.id}/publish`).expect(200);
    expect((await waitStatus(bad.id, ['ERROR'])).error).toBe('Budget too low: Your budget must be at least ₹86.00 per day.');
    await api(app, manager).delete(`/ads/campaigns/${bad.id}`).expect(204);
  });

  it('lets only Owners/Admins start spending, with the maximum they saw and within the cap', async () => {
    const c = (await api(app, owner).get('/ads/campaigns?platform=META&status=PAUSED').expect(200)).body.data[0];
    const shown = c.maxSpend.amount;
    expect((await api(app, manager).post(`/ads/campaigns/${c.id}/activate`, { confirm: true, maxSpend: shown }).expect(403)).body.code).toBe('FORBIDDEN');
    await api(app, owner).post(`/ads/campaigns/${c.id}/activate`, { maxSpend: shown }).expect(400);
    const lower = (await api(app, owner).post(`/ads/campaigns/${c.id}/activate`, { confirm: true, maxSpend: '100' }).expect(409)).body;
    expect(lower).toMatchObject({ code: 'SPEND_CHANGED', details: { maxSpend: shown } });
    // Cap below this month's commitment blocks activation.
    await api(app, owner).patch(`/ads/accounts/${metaAccount}`, { monthlySpendCap: '1000' }).expect(200);
    expect((await api(app, owner).post(`/ads/campaigns/${c.id}/activate`, { confirm: true, maxSpend: shown }).expect(409)).body.code).toBe('SPEND_CAP_EXCEEDED');
    expect(meta.calls.some((x) => x.op === 'setStatus')).toBe(false);
    await api(app, owner).patch(`/ads/accounts/${metaAccount}`, { monthlySpendCap: '100000' }).expect(200);

    const active = (await api(app, owner).post(`/ads/campaigns/${c.id}/activate`, { confirm: true, maxSpend: shown }).expect(200)).body;
    expect(active).toMatchObject({ status: 'ACTIVE', activatedBy: { name: 'Ads Owner' }, approvals: [{ action: 'ACTIVATE', maxSpend: shown, currency: 'INR', by: 'Ads Owner' }] });
    expect(meta.calls.filter((x) => x.op === 'setStatus').map((x) => (x.args as { status: string }).status)).toEqual(['ACTIVE']);
    const audit = await prisma.system.auditLog.findFirst({ where: { organizationId: orgId, action: 'ads.campaign_activated' } });
    expect(audit?.metadata).toMatchObject({ maxSpend: shown });
    expect((await waitForEmail(app, owner.email, 'ad-spend-approved').catch(() => null)) === null).toBe(true); // the approver isn't emailed about their own decision

    // Raising a running budget needs approval; lowering it doesn't.
    expect((await api(app, manager).post(`/ads/campaigns/${c.id}/budget`, { budgetAmount: '800' }).expect(403)).body.code).toBe('SPEND_APPROVAL_REQUIRED');
    await api(app, owner).post(`/ads/campaigns/${c.id}/budget`, { budgetAmount: '800' }).expect(400);
    const newMax = maxSpend({ budgetType: 'DAILY', budgetAmount: '800', endAt: c.endAt }).amount;
    const raised = (await api(app, owner).post(`/ads/campaigns/${c.id}/budget`, { budgetAmount: '800', confirm: true, maxSpend: newMax }).expect(200)).body;
    expect(raised.approvals[0]).toMatchObject({ action: 'BUDGET_INCREASE' });
    expect((await api(app, manager).post(`/ads/campaigns/${c.id}/budget`, { budgetAmount: '300' }).expect(200)).body.budgetAmount).toBe('300.00');
    expect(meta.calls.filter((x) => x.op === 'updateBudget').map((x) => (x.args as { amount: string }).amount)).toEqual(['800', '300']);

    // Anyone managing ads can stop spending.
    expect((await api(app, manager).post(`/ads/campaigns/${c.id}/pause`).expect(200)).body.status).toBe('PAUSED');
    expect(meta.calls.filter((x) => x.op === 'setStatus').map((x) => (x.args as { status: string }).status)).toEqual(['ACTIVE', 'PAUSED']);
  });

  it('emails other Owners and Admins when an Admin approves spend', async () => {
    const admin = await signUp(app, 'Ada Admin');
    await inviteAndAccept(app, owner, admin, orgId, 'admin');
    const c = (await api(app, owner).get('/ads/campaigns?platform=META&status=PAUSED').expect(200)).body.data[0];
    await api(app, admin).post(`/ads/campaigns/${c.id}/activate`, { confirm: true, maxSpend: c.maxSpend.amount }).expect(200);
    const mail = await waitForEmail(app, owner.email, 'ad-spend-approved');
    expect(mail.subject).toMatch(/^Onam traffic \(Kerala\) can now spend up to ₹/);
    await api(app, admin).post(`/ads/campaigns/${c.id}/pause`).expect(200);
  });

  it('syncs insights and imported campaigns without ever activating anything', async () => {
    const c = (await api(app, owner).get('/ads/campaigns?platform=META').expect(200)).body.data.find((x: { externalId: string }) => x.externalId === 'cmp-1');
    const today = new Date().toISOString().slice(0, 10);
    meta.insightRows = [
      { campaignId: 'cmp-1', date: today, impressions: 12000, reach: 8000, clicks: 300, spend: '450.25', conversions: 0, leads: 0 },
      { campaignId: 'cmp-1', date: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10), impressions: 8000, reach: 6000, clicks: 100, spend: '320.00', conversions: 0, leads: 0 },
    ];
    meta.remote = [
      { externalId: 'cmp-1', name: 'Onam traffic (Kerala)', status: 'ACTIVE', objective: 'TRAFFIC', budgetType: 'DAILY', budgetAmount: '300.00', startAt: null, endAt: null },
      { externalId: 'legacy-9', name: 'Diwali (made in Ads Manager)', status: 'PAUSED', objective: 'AWARENESS', budgetType: 'DAILY', budgetAmount: '250.00', startAt: null, endAt: null },
    ];
    const before = meta.calls.length;
    await app.get(AdsWorkerService).sync(orgId, 7);
    expect(meta.calls.slice(before).filter((x) => x.op === 'setStatus' || x.op === 'updateBudget')).toEqual([]);
    const after = (await api(app, owner).get(`/ads/campaigns/${c.id}`).expect(200)).body;
    expect(after).toMatchObject({ status: 'ACTIVE', spend: '770.25' }); // mirrors an activation done in Ads Manager
    const imported = (await api(app, owner).get('/ads/campaigns?q=Diwali').expect(200)).body.data[0];
    expect(imported).toMatchObject({ source: 'IMPORTED', status: 'PAUSED', objective: 'AWARENESS', budgetAmount: '250.00' });
    const ins = (await api(app, owner).get(`/ads/campaigns/${c.id}/insights?from=2020-01-01&to=${today}`).expect(200)).body;
    expect(ins.totals).toMatchObject({ impressions: 20000, clicks: 400, spend: '770.25', ctr: 2, cpc: '1.92', cpm: '38.51' });
    expect(ins.daily).toHaveLength(2);
    const acct = (await api(app, owner).get('/ads/accounts?platform=META').expect(200)).body[0];
    expect(acct.spentThisMonth).toBe(new Date(Date.now() - 86_400_000).getUTCMonth() === new Date().getUTCMonth() ? '770.25' : '450.25');
    await api(app, owner).post(`/ads/campaigns/${c.id}/pause`).expect(200);
  });

  it('builds Google Search campaigns and AI drafts with platform-resolved targeting', async () => {
    const g = (await api(app, manager)
      .post('/ads/campaigns', {
        workspaceId: ws,
        adAccountId: googleAccount,
        name: 'Van Sales Search',
        objective: 'SEARCH',
        budgetAmount: '800',
        adGroups: [{ name: 'ERP', targeting: { locations: [{ id: '2356', name: 'India' }], keywords: [{ text: 'van sales software', matchType: 'PHRASE' }] }, ads: [{ name: 'RSA', creative: { headlines: ['Van Sales ERP', 'Free for 1 month', 'Built for Kerala'], descriptions: ['Manage vans, stock and collections.', 'WhatsApp us for a demo.'], finalUrl: 'https://zatgo.com/van-sales' } }] }],
      })
      .expect(201)).body;
    expect(g.maxSpend.untilMonthEnd).toBe(true);
    await api(app, manager).post(`/ads/campaigns/${g.id}/publish`).expect(200);
    expect((await waitStatus(g.id, ['PAUSED'])).externalId).toBe('cmp-1');
    expect((google.calls.find((x) => x.op === 'createCampaign')!.args as { plan: CampaignPlan }).plan.objective).toBe('SEARCH');

    const ai = app.get(AIProviderRegistry);
    ai.register(
      'TEXT',
      textProvider(
        JSON.stringify({
          name: 'Onam Sale – Kochi',
          objective: 'TRAFFIC',
          dailyBudget: '2500',
          locationQueries: ['Kochi', 'Atlantis'],
          interestQueries: ['Shopping'],
          ageMin: 22,
          ageMax: 50,
          variants: [{ primaryText: 'Onam offers at ZatGo Kochi.', headline: 'Onam Mega Sale', description: 'This week only' }],
          cta: 'SHOP_NOW',
          rationale: 'Local shoppers before Onam.',
        }),
      ),
    );
    const res = (await api(app, manager).post('/ads/campaigns/ai-draft', { adAccountId: metaAccount, brief: 'Promote our Onam sale at the Kochi store', budgetMax: '1500', link: 'https://zatgo.com/onam' }).expect(200)).body;
    expect(res.draft).toMatchObject({ name: 'Onam Sale – Kochi', objective: 'TRAFFIC', budgetAmount: '1500', adGroups: [{ targeting: { locations: [{ key: '2001', name: 'Kochi', type: 'city' }], interests: [{ id: 'int-8', name: 'Shopping' }], ageMin: 22 } }] });
    expect(res.unresolved).toEqual(['Atlantis']);
    expect(res.draft.adGroups[0].ads[0].creative).toMatchObject({ cta: 'SHOP_NOW', link: 'https://zatgo.com/onam' });
    expect(await prisma.system.adCampaign.count({ where: { organizationId: orgId, name: 'Onam Sale – Kochi' } })).toBe(0); // nothing saved
  });

  it('keeps ads isolated per organization and read-only for viewers', async () => {
    const other = await signUp(app, 'Other Ads');
    await createOrg(app, other, 'Other Ads Org');
    const c = (await api(app, owner).get('/ads/campaigns').expect(200)).body.data[0];
    await api(app, other).get(`/ads/campaigns/${c.id}`).expect(404);
    await api(app, other).patch(`/ads/accounts/${metaAccount}`, { workspaceIds: [] }).expect(404);
    expect((await api(app, other).get('/ads/campaigns').expect(200)).body.meta.total).toBe(0);
    expect((await api(app, viewer).get('/ads/campaigns').expect(200)).body.meta.total).toBeGreaterThan(1);
    await api(app, viewer).post(`/ads/campaigns/${c.id}/pause`).expect(403);
    await api(app, viewer).post('/ads/campaigns', metaDraft()).expect(403);
    // The account can't be removed while a campaign is spending.
    const paused = (await api(app, owner).get('/ads/campaigns?platform=META&status=PAUSED').expect(200)).body.data.find((x: { source: string }) => x.source === 'CREATED');
    await api(app, owner).post(`/ads/campaigns/${paused.id}/activate`, { confirm: true, maxSpend: paused.maxSpend.amount }).expect(200);
    expect((await api(app, owner).delete(`/ads/accounts/${metaAccount}`).expect(409)).body.code).toBe('ACTIVE_CAMPAIGNS');
    await api(app, owner).post(`/ads/campaigns/${paused.id}/pause`).expect(200);
  });
});
