import { randomBytes } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdPlatform } from '@zatma/validation';
import { AIProviderRegistry } from '../src/ai/ai-provider.registry.js';
import type { AITextProvider } from '../src/ai/ai-provider.interfaces.js';
import { AdsRegistry } from '../src/ads/ads-registry.js';
import type { AdAccountInfo, AdsCtx, AdsPlatformAdapter, CampaignIds, CreatedCampaign, PlatformLead } from '../src/ads/providers/ads-provider.js';
import { CampaignsService } from '../src/campaigns/campaigns.service.js';
import { CampaignsWorkerService } from '../src/campaigns/campaigns.worker.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SocialProviderRegistry } from '../src/social/social-registry.js';
import { TokenCipher } from '../src/social/token-cipher.js';
import { createTestApp } from './harness.js';
import { api, createOrg, inviteAndAccept, signUp, type TestUser } from './helpers.js';

const KEY = `k1:${randomBytes(32).toString('base64')}`;
const DAY = 86_400_000;

/** Ad platform stand-in that records every call, so tests can prove nothing was activated. */
class FakeAds implements AdsPlatformAdapter {
  readonly scopes = ['ads'];
  readonly name = 'meta_ads';
  readonly usesPkce = false;
  readonly platform: AdPlatform = 'META';
  readonly oauthId = 'meta_ads' as const;
  calls: Array<{ op: string; args: unknown }> = [];
  leads: Record<string, PlatformLead[]> = {};
  constructor(private readonly accounts: AdAccountInfo[]) {}
  authorizeUrl({ state }: { state: string }) {
    return `https://auth.fake/meta_ads?state=${state}`;
  }
  async exchangeCode() {
    return { accessToken: 'ads-token', refreshToken: null, expiresAt: new Date(Date.now() + 30 * DAY), scopes: this.scopes, externalUserId: 'ads-user', displayName: 'Ads user' };
  }
  async revoke() {}
  async listAdAccounts() {
    return this.accounts;
  }
  async createCampaign(): Promise<CreatedCampaign> {
    throw new Error('not used');
  }
  async setStatus(_ctx: AdsCtx, ids: CampaignIds, status: 'ACTIVE' | 'PAUSED') {
    this.calls.push({ op: 'setStatus', args: { ids, status } });
  }
  async updateBudget() {
    this.calls.push({ op: 'updateBudget', args: null });
  }
  async listCampaigns() {
    return [];
  }
  async insights() {
    return [];
  }
  async searchTargeting() {
    return [];
  }
  async listLeads(_ctx: AdsCtx, adId: string, since: Date | null) {
    this.calls.push({ op: 'listLeads', args: { adId, since: since?.toISOString() ?? null } });
    return (this.leads[adId] ?? []).filter((l) => !since || new Date(l.createdAt) > since);
  }
}

function textProvider(reply: string): AITextProvider {
  return { id: 'anthropic', name: 'Anthropic', defaultModel: 'claude-opus-5-5', generateText: async () => ({ text: reply, model: 'claude-opus-5-5', usage: { inputTokens: 900, outputTokens: 500, costMicroUsd: 12_000 }, finishReason: 'stop' as const }) } as AITextProvider;
}

describe('Campaign management (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let owner: TestUser;
  let manager: TestUser;
  let viewer: TestUser;
  let agent: TestUser;
  let orgId: string;
  let ws: string;
  let meta: FakeAds;
  let adAccountId: string;
  let campaign: { id: string; code: string; utmCampaign: string };

  const start = new Date(Date.now() + 2 * DAY).toISOString();
  const end = new Date(Date.now() + 12 * DAY).toISOString();

  beforeAll(async () => {
    app = await createTestApp({ env: { TOKEN_ENCRYPTION_KEYS: KEY, META_APP_ID: 'a', META_APP_SECRET: 's' } });
    prisma = app.get(PrismaService);
    app.get(SocialProviderRegistry).reset(new TokenCipher(KEY));
    const ads = app.get(AdsRegistry);
    ads.reset();
    meta = new FakeAds([{ externalId: 'act_77', name: 'Campaign Ads', currency: 'INR', timezone: 'Asia/Kolkata', status: 'ACTIVE', manager: false }]);
    ads.register(meta);

    owner = await signUp(app, 'Cam Owner');
    orgId = await createOrg(app, owner, 'Campaign Org');
    ws = (await api(app, owner).get('/workspaces').expect(200)).body.data[0].id;
    manager = await signUp(app, 'Mona Manager');
    await inviteAndAccept(app, owner, manager, orgId, 'marketing_manager');
    viewer = await signUp(app, 'Vera Viewer');
    await inviteAndAccept(app, owner, viewer, orgId, 'viewer');
    agent = await signUp(app, 'Sam Sales');
    await inviteAndAccept(app, owner, agent, orgId, 'sales_agent');

    const s = await api(app, owner).post('/ads/connect/meta_ads', {}).expect(200);
    const st = new URL(s.body.authorizeUrl).searchParams.get('state');
    const cb = await api(app, owner).get(`/ads/oauth/meta_ads/callback?code=c&state=${st}`).expect(302);
    adAccountId = (await api(app, owner).post('/ads/accounts', { connectionId: new URL(cb.headers.location as string).searchParams.get('connection'), externalIds: ['act_77'] }).expect(201)).body[0].id;
  });
  afterAll(async () => {
    await app.close();
  });

  /** An ad campaign already on the platform (created through Phase 11), in the given state. */
  const platformAd = async (status: 'ACTIVE' | 'PAUSED', objective = 'TRAFFIC', marketingCampaignId: string | null = null) =>
    prisma.system.adCampaign.create({
      data: {
        organizationId: orgId,
        workspaceId: ws,
        adAccountId,
        platform: 'META',
        name: `${objective} ${status}`,
        objective,
        status,
        budgetType: 'DAILY',
        budgetAmount: '500',
        currency: 'INR',
        externalId: `ext-${randomBytes(4).toString('hex')}`,
        marketingCampaignId,
        adGroups: { create: [{ organizationId: orgId, name: 'Set', targeting: {}, ads: { create: [{ organizationId: orgId, name: 'Ad', creative: {}, externalId: `ad-${randomBytes(4).toString('hex')}` }] } }] },
      },
      include: { adGroups: { include: { ads: true } } },
    });

  it('creates campaigns with a code, type defaults, budget checks and the plan limit', async () => {
    await api(app, viewer).post('/campaigns', { workspaceId: ws, name: 'Nope', type: 'SOCIAL' }).expect(403);
    await api(app, manager).post('/campaigns', { workspaceId: ws, name: 'Bad', type: 'FESTIVAL', startAt: end, endAt: start }).expect(400);
    await api(app, manager)
      .post('/campaigns', { workspaceId: ws, name: 'Over', type: 'FESTIVAL', budgetAmount: '1000', channelPlans: [{ channel: 'meta_ads', plannedBudget: '800' }, { channel: 'social', plannedBudget: '300' }] })
      .expect(422);
    const c = (
      await api(app, manager)
        .post('/campaigns', {
          workspaceId: ws,
          name: 'Onam Sale 2026',
          type: 'FESTIVAL',
          objective: 'SALES',
          startAt: start,
          endAt: end,
          budgetAmount: '50000',
          channelPlans: [
            { channel: 'meta_ads', plannedBudget: '30000' },
            { channel: 'whatsapp', notes: 'Broadcast to past customers', content: [{ title: 'Onam greeting', date: start.slice(0, 10) }] },
          ],
        })
        .expect(201)
    ).body;
    expect(c).toMatchObject({ code: 'CMP-0001', status: 'DRAFT', type: 'FESTIVAL', currency: 'INR', utmCampaign: 'onam-sale-2026', channels: ['social', 'meta_ads', 'whatsapp'], budgetAmount: '50000.00', readinessIssues: [] });
    expect(c.channelPlans.find((p: { channel: string }) => p.channel === 'whatsapp').content[0].title).toBe('Onam greeting');
    expect(c.owner.name).toBe('Mona Manager');
    campaign = c;
    const second = (await api(app, owner).post('/campaigns', { workspaceId: ws, name: 'Retention', type: 'CUSTOMER_RETENTION' }).expect(201)).body;
    expect(second).toMatchObject({ code: 'CMP-0002', channels: ['email', 'whatsapp'], readinessIssues: ['Set a start date', 'Set an end date'] });
    // The trial plan allows a limited number of active campaigns.
    const usage = (await api(app, owner).get('/billing/usage').expect(200)).body.metrics.find((m: { metric: string }) => m.metric === 'campaigns');
    expect(usage.used).toBe(2);
    // PATCH without defaults keeps everything else.
    const patched = (await api(app, manager).patch(`/campaigns/${c.id}`, { description: 'Kerala-wide' }).expect(200)).body;
    expect(patched).toMatchObject({ description: 'Kerala-wide', objective: 'SALES', budgetAmount: '50000.00' });
    expect(patched.channelPlans.find((p: { channel: string }) => p.channel === 'meta_ads').plannedBudget).toBe('30000.00');
    expect((await api(app, viewer).get('/campaigns?type=FESTIVAL').expect(200)).body.data.map((x: { code: string }) => x.code)).toEqual(['CMP-0001']);
    expect((await api(app, viewer).get('/campaigns?q=cmp-2').expect(200)).body.data.map((x: { code: string }) => x.code)).toEqual(['CMP-0002']);
    await api(app, owner).delete(`/campaigns/${second.id}`).expect(204);
  });

  it('derives the status from the dates once ready, and the sweeper persists it', async () => {
    expect((await api(app, manager).post(`/campaigns/${campaign.id}/ready`, { ready: true }).expect(200)).body.status).toBe('SCHEDULED');
    const draft = (await api(app, manager).post('/campaigns', { workspaceId: ws, name: 'Undated', type: 'SOCIAL' }).expect(201)).body;
    const r = await api(app, manager).post(`/campaigns/${draft.id}/ready`, { ready: true }).expect(422);
    expect(r.body.code).toBe('CAMPAIGN_NOT_READY');
    // Move the dates into the past: the stored status follows after the sweep.
    await prisma.system.campaign.update({ where: { id: draft.id }, data: { startAt: new Date(Date.now() - 5 * DAY), endAt: new Date(Date.now() - DAY), readyAt: new Date() } });
    expect(await app.get(CampaignsService).sweepStatuses(orgId)).toBeGreaterThanOrEqual(1);
    expect((await prisma.system.campaign.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe('COMPLETED');
    expect((await api(app, viewer).get('/campaigns?status=COMPLETED').expect(200)).body.data.map((x: { id: string }) => x.id)).toEqual([draft.id]);
  });

  it('links posts, ads, designs and copy within the workspace only', async () => {
    const post = await prisma.system.socialPost.create({ data: { organizationId: orgId, workspaceId: ws, caption: 'Onam is here', status: 'SCHEDULED', scheduledAt: new Date(Date.now() + 3 * DAY) } });
    const active = await platformAd('ACTIVE');
    await api(app, manager).post(`/campaigns/${campaign.id}/attach`, { kind: 'post', ids: [post.id] }).expect(200);
    await api(app, manager).post(`/campaigns/${campaign.id}/attach`, { kind: 'ad_campaign', ids: [active.id] }).expect(200);
    await api(app, viewer).post(`/campaigns/${campaign.id}/attach`, { kind: 'post', ids: [post.id] }).expect(403);
    // Something from another organization cannot be attached.
    const other = await signUp(app, 'Other Owner');
    await createOrg(app, other, 'Other Org');
    const otherWs = (await api(app, other).get('/workspaces').expect(200)).body.data[0].id;
    const foreign = (await api(app, other).post('/campaigns', { workspaceId: otherWs, name: 'Foreign', type: 'SOCIAL' }).expect(201)).body;
    await api(app, other).post(`/campaigns/${foreign.id}/attach`, { kind: 'post', ids: [post.id] }).expect(422);
    await api(app, other).get(`/campaigns/${campaign.id}`).expect(404);
    const content = (await api(app, viewer).get(`/campaigns/${campaign.id}/content`).expect(200)).body;
    expect(content.posts.map((p: { id: string }) => p.id)).toEqual([post.id]);
    expect(content.adCampaigns.map((a: { id: string; status: string }) => [a.id, a.status])).toEqual([[active.id, 'ACTIVE']]);
    const dto = (await api(app, viewer).get(`/campaigns/${campaign.id}`).expect(200)).body;
    expect(dto.counts).toMatchObject({ posts: 1, adCampaigns: 1 });
    // Posts created for the campaign carry the link.
    const p2 = (await api(app, manager).post('/social/posts', { workspaceId: ws, caption: 'Draft for Onam', campaignId: campaign.id }).expect(201)).body;
    expect(p2.campaignId).toBe(campaign.id);
    await api(app, manager).post('/social/posts', { workspaceId: ws, caption: 'x', campaignId: foreign.id }).expect(404);
  });

  it('pauses ads and unschedules posts on pause, and resume never activates anything', async () => {
    const before = meta.calls.length;
    const res = (await api(app, manager).post(`/campaigns/${campaign.id}/pause`, { pauseAds: true, unschedulePosts: true }).expect(200)).body;
    expect(res.campaign.status).toBe('PAUSED');
    expect(res.ads.map((a: { ok: boolean }) => a.ok)).toEqual([true]);
    expect(res.posts.map((p: { ok: boolean }) => p.ok)).toEqual([true]);
    expect(meta.calls.slice(before).map((c) => [c.op, (c.args as { status: string }).status])).toEqual([['setStatus', 'PAUSED']]);
    const content = (await api(app, viewer).get(`/campaigns/${campaign.id}/content`).expect(200)).body;
    expect(content.adCampaigns[0].status).toBe('PAUSED');
    expect(content.posts.find((p: { caption: string }) => p.caption === 'Onam is here').status).toBe('DRAFT');
    await api(app, manager).post(`/campaigns/${campaign.id}/pause`, {}).expect(409);

    const resumed = (await api(app, owner).post(`/campaigns/${campaign.id}/resume`).expect(200)).body;
    expect(resumed.campaign.status).toBe('SCHEDULED');
    expect(resumed.pausedAds.map((a: { name: string }) => a.name)).toEqual(['TRAFFIC ACTIVE']);
    // The proof: no call to the ad platform at all, and the ad campaign is still paused.
    expect(meta.calls.slice(before).filter((c) => (c.args as { status?: string } | null)?.status === 'ACTIVE')).toEqual([]);
    expect(meta.calls.length).toBe(before + 1);
    expect((await prisma.system.adCampaign.findFirstOrThrow({ where: { marketingCampaignId: campaign.id } })).status).toBe('PAUSED');
    // Ad pausing needs ads permission; without it the item is reported, not done.
    const ad2 = await platformAd('ACTIVE', 'TRAFFIC', campaign.id);
    const c2 = (await api(app, owner).post('/campaigns', { workspaceId: ws, name: 'Agent test', type: 'META_ADS' }).expect(201)).body;
    await api(app, owner).post(`/campaigns/${c2.id}/attach`, { kind: 'ad_campaign', ids: [ad2.id] }).expect(200);
    await api(app, agent).post(`/campaigns/${c2.id}/pause`, { pauseAds: true }).expect(403); // Sales Agent cannot manage campaigns
    await api(app, owner).post(`/campaigns/${c2.id}/cancel`, { pauseAds: false }).expect(200);
    expect((await prisma.system.adCampaign.findUniqueOrThrow({ where: { id: ad2.id } })).status).toBe('ACTIVE');
    await api(app, owner).post(`/campaigns/${c2.id}/resume`).expect(409);
    await api(app, owner).patch(`/campaigns/${c2.id}`, { name: 'x2' }).expect(409);
  });

  it('creates tracked links and counts clicks without storing visitor data', async () => {
    await api(app, manager).post(`/campaigns/${campaign.id}/links`, { destinationUrl: 'javascript:alert(1)' }).expect(400);
    const link = (await api(app, manager).post(`/campaigns/${campaign.id}/links`, { destinationUrl: 'https://shop.example.in/onam?ref=fb#offer', channel: 'meta_ads', label: 'Ad link' }).expect(201)).body;
    expect(link.shortUrl).toMatch(/\/r\/[A-Za-z0-9]{8}$/);
    const tracked = new URL(link.trackedUrl);
    expect([tracked.searchParams.get('utm_source'), tracked.searchParams.get('utm_medium'), tracked.searchParams.get('utm_campaign'), tracked.searchParams.get('ref'), tracked.hash]).toEqual(['facebook', 'paid_social', 'onam-sale-2026', 'fb', '#offer']);

    const ua = 'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile';
    const hit = await api(app).get(`/r/${link.slug}`).set('User-Agent', ua).expect(302);
    expect(hit.headers.location).toBe(link.trackedUrl);
    expect(hit.headers['cache-control']).toBe('no-store');
    await api(app).get(`/r/${link.slug}`).set('User-Agent', ua).expect(302); // same visitor: not unique
    await api(app).get(`/r/${link.slug}`).set('User-Agent', 'Mozilla/5.0 (iPhone) Safari/18').expect(302);
    await api(app).get(`/r/${link.slug}`).set('User-Agent', 'facebookexternalhit/1.1').expect(302); // link preview: not counted
    await api(app).get('/r/doesnotexist').set('User-Agent', ua).expect(404);
    await api(app).get('/r/../../etc').expect(404);
    const links = (await api(app, viewer).get(`/campaigns/${campaign.id}/links`).expect(200)).body;
    expect(links[0]).toMatchObject({ clicks: 3, uniqueClicks: 2 });
    const day = (await prisma.system.trackedLinkClickDaily.findFirstOrThrow({ where: { linkId: link.id } })) as Record<string, unknown>;
    expect(Object.keys(day).sort()).toEqual(['campaignId', 'clicks', 'date', 'id', 'linkId', 'organizationId', 'uniqueClicks']);
    await api(app, manager).delete(`/campaigns/${campaign.id}/links/${link.id}`).expect(204);
    await api(app).get(`/r/${link.slug}`).set('User-Agent', ua).expect(404);
  });

  it('attributes leads by UTM (first touch) and counts conversions', async () => {
    const lead = (await api(app, owner).post('/crm/leads', { firstName: 'Anu', phone: '9847000001', source: 'meta_ads', utm: { source: 'facebook', campaign: 'onam-sale-2026' } }).expect(201)).body;
    expect(lead.campaign).toMatchObject({ id: campaign.id, code: 'CMP-0001' });
    expect(lead.utm).toEqual({ source: 'facebook', campaign: 'onam-sale-2026' });
    const none = (await api(app, owner).post('/crm/leads', { firstName: 'Bina', utm: { campaign: 'unknown-slug' } }).expect(201)).body;
    expect(none.campaign).toBeNull();
    await api(app, owner).post('/crm/leads', { firstName: 'C', campaignId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b' }).expect(422);
    // Manual attribution respects CRM access.
    await api(app, manager).post(`/campaigns/${campaign.id}/attach`, { kind: 'lead', ids: [none.id] }).expect(403);
    await api(app, owner).post(`/campaigns/${campaign.id}/attach`, { kind: 'lead', ids: [none.id] }).expect(200);
    // Converting a lead carries the campaign to the deal; winning it is a conversion.
    const conv = (await api(app, owner).post(`/crm/leads/${lead.id}/convert`, { createDeal: true, dealValue: 12000 }).expect(201)).body;
    const won = await prisma.system.deal.update({ where: { id: conv.deal.id }, data: { status: 'WON', closedAt: new Date() } });
    expect(won.campaignId).toBe(campaign.id);
    const today = new Date().toISOString().slice(0, 10);
    const a = (await api(app, viewer).get(`/campaigns/${campaign.id}/analytics?from=${today}&to=${today}`).expect(200)).body;
    expect(a.totals).toMatchObject({ leads: 2, wonDeals: 1, wonValue: [{ currency: 'INR', amount: '12000.00' }], linkClicks: 3, uniqueClicks: 2, clickToLead: 66.7, leadToWon: 50 });
    expect(a.leadsBySource.map((s: { source: string }) => s.source).sort()).toEqual(['meta_ads', 'other']);
    expect(a.channels.find((c: { channel: string }) => c.channel === 'meta_ads')).toMatchObject({ plannedBudget: '30000.00', leads: 1, linkClicks: 3, items: 1 });
    const leads = (await api(app, viewer).get(`/campaigns/${campaign.id}/leads`).expect(200)).body;
    expect(leads.meta.total).toBe(2);
    // A Sales Agent sees only their own leads in the campaign.
    expect((await api(app, agent).get(`/campaigns/${campaign.id}/leads`).expect(200)).body.meta.total).toBe(0);
  });

  it('imports Meta lead-form submissions once, attributed to the campaign', async () => {
    const leadsAd = await platformAd('ACTIVE', 'LEADS', campaign.id);
    const adId = leadsAd.adGroups[0]!.ads[0]!.externalId!;
    meta.leads[adId] = [
      { externalId: 'L1', createdAt: new Date(Date.now() - 3_600_000).toISOString(), formId: 'F1', fields: { full_name: 'Deepa Nair', phone_number: '+919847000099', email: 'Deepa@Example.in', city: 'Kochi', budget: '₹5,000' } },
      { externalId: 'L2', createdAt: new Date(Date.now() - 1_800_000).toISOString(), formId: 'F1', fields: { full_name: 'Anu', phone_number: '9847000001' } },
    ];
    const w = app.get(CampaignsWorkerService);
    expect((await w.pullLeads(orgId)).created).toBe(1);
    const imported = await prisma.system.lead.findFirstOrThrow({ where: { organizationId: orgId, externalRef: 'meta:L1' } });
    expect(imported).toMatchObject({ firstName: 'Deepa', lastName: 'Nair', email: 'deepa@example.in', city: 'Kochi', source: 'meta_ads', campaignId: campaign.id, customFields: { budget: '₹5,000' } });
    // Anu already exists: no duplicate, a note on the existing record instead.
    expect(await prisma.system.lead.count({ where: { organizationId: orgId, firstName: 'Anu' } })).toBe(1);
    // Second run asks only for newer leads and creates nothing.
    expect((await w.pullLeads(orgId)).created).toBe(0);
    const last = meta.calls.filter((c) => c.op === 'listLeads').at(-1)!.args as { since: string };
    expect(last.since).toBe(meta.leads[adId]![1]!.createdAt);
    // No lead pull ever touches ad status.
    expect(meta.calls.filter((c) => c.op === 'setStatus' && (c.args as { status: string }).status === 'ACTIVE')).toEqual([]);
  });

  it('manages assets, tasks, the audience preview and the calendar', async () => {
    const design = await prisma.system.design.create({ data: { organizationId: orgId, workspaceId: ws, title: 'Onam poster', sizePreset: 'ig_square', width: 1080, height: 1080, document: {} } });
    const assets = (await api(app, manager).post(`/campaigns/${campaign.id}/assets`, { designId: design.id, label: 'Hero' }).expect(201)).body;
    expect(assets.map((a: { kind: string; name: string; label: string }) => [a.kind, a.name, a.label])).toEqual([['design', 'Onam poster', 'Hero']]);
    await api(app, manager).post(`/campaigns/${campaign.id}/assets`, { designId: design.id }).expect(201); // idempotent
    expect((await api(app, viewer).get(`/campaigns/${campaign.id}/assets`).expect(200)).body).toHaveLength(1);
    await api(app, manager).delete(`/campaigns/${campaign.id}/assets/${assets[0].id}`).expect(204);

    const task = (await api(app, manager).post(`/campaigns/${campaign.id}/tasks`, { title: 'Approve poster', dueAt: start }).expect(201)).body;
    expect((await api(app, manager).patch(`/campaigns/${campaign.id}/tasks/${task.id}`, { done: true }).expect(200)).body).toMatchObject({ done: true, title: 'Approve poster' });

    const prev = (await api(app, owner).post('/campaigns/audience/preview', { kind: 'leads', sources: ['meta_ads'], cities: ['kochi'] }).expect(200)).body;
    expect(prev).toMatchObject({ total: 1, withPhone: 1, withEmail: 1 });
    expect(prev.sample[0].name).toBe('Deepa Nair');
    await api(app, viewer).post('/campaigns/audience/preview', { kind: 'leads' }).expect(200);

    const from = new Date(Date.now() - DAY).toISOString();
    const to = new Date(Date.now() + 30 * DAY).toISOString();
    const cal = (await api(app, viewer).get(`/campaigns/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&campaignId=${campaign.id}`).expect(200)).body;
    // The post was returned to drafts when the campaign was paused, so it is no longer on the calendar.
    expect(cal.map((e: { kind: string }) => e.kind).sort()).toEqual(['campaign', 'content', 'task']);
    expect(cal.find((e: { kind: string }) => e.kind === 'content').title).toBe('Onam greeting');
  });

  it('returns an AI plan as a draft only, with an exact budget split', async () => {
    app.get(AIProviderRegistry).register(
      'TEXT',
      textProvider(
        JSON.stringify({
          name: 'Diwali Lights Sale',
          type: 'FESTIVAL',
          objective: 'SALES',
          description: 'Diwali offers across Kerala',
          channels: ['social', 'meta_ads', 'whatsapp'],
          budgetSplit: [{ channel: 'meta_ads', percent: 70 }, { channel: 'social', percent: 0 }, { channel: 'whatsapp', percent: 30 }],
          audience: { description: 'Families in Kerala', locations: ['Kochi'], interests: ['Shopping'], ageMin: 25, ageMax: 55 },
          contentPlan: [{ channel: 'social', title: 'Teaser post', day: 0 }, { channel: 'whatsapp', title: 'Offer broadcast', day: 99 }],
          tasks: [{ title: 'Book photographer', day: -3 }],
          rationale: 'Festival demand peaks the week before Diwali.',
        }),
      ),
    );
    const before = await prisma.system.campaign.count({ where: { organizationId: orgId } });
    const plan = (await api(app, manager).post('/campaigns/ai/plan', { brief: 'Diwali sale on lights and decor across Kerala', totalBudget: '10000', startAt: start, endAt: end }).expect(200)).body;
    expect(plan.draft).toMatchObject({ name: 'Diwali Lights Sale', type: 'FESTIVAL', utmCampaign: 'diwali-lights-sale', budgetAmount: '10000', channels: ['social', 'meta_ads', 'whatsapp'] });
    expect(plan.draft.channelPlans.map((p: { channel: string; plannedBudget: string | null }) => [p.channel, p.plannedBudget])).toEqual([
      ['social', null],
      ['meta_ads', '7000.00'],
      ['whatsapp', '3000.00'],
    ]);
    // Content dates are clamped to the campaign's span.
    expect(plan.draft.channelPlans.find((p: { channel: string }) => p.channel === 'whatsapp').content[0].date).toBe(end.slice(0, 10));
    expect(plan.tasks[0].title).toBe('Book photographer');
    expect(await prisma.system.campaign.count({ where: { organizationId: orgId } })).toBe(before);
    await api(app, viewer).post('/campaigns/ai/plan', { brief: 'Diwali sale on lights and decor' }).expect(403);
  });
});
