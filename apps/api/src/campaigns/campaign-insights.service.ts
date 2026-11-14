import { Injectable } from '@nestjs/common';
import type { Paginated } from '@zatma/types';
import {
  CAMPAIGN_CHANNELS,
  toCents,
  type AudiencePreviewDto,
  type AudienceSegment,
  type CampaignAnalyticsDto,
  type CampaignCalendarEntry,
  type CampaignCalendarQuery,
  type CampaignChannel,
  type CampaignRange,
  type ContentPlanItem,
  type LeadDto,
  type ManualStatus,
  type MarketingCampaignType,
} from '@zatma/validation';
import { notFound } from '../common/errors.js';
import { fullName, leadInclude, ownerScope, toLeadDto } from '../crm/crm-common.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CampaignsService, sumByCurrency } from './campaigns.service.js';

const DAY = 86_400_000;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const pct = (num: number, den: number) => (den ? Math.round((num / den) * 1000) / 10 : null);

/** Lead sources that belong to each channel (for the per-channel breakdown). */
const CHANNEL_SOURCES: Record<CampaignChannel, string[]> = {
  social: ['facebook', 'instagram'],
  meta_ads: ['meta_ads'],
  google_ads: ['google_ads'],
  email: ['email'],
  whatsapp: ['whatsapp'],
  other: ['website', 'referral', 'walk_in', 'phone', 'event', 'import', 'other'],
};

@Injectable()
export class CampaignInsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignsService,
  ) {}

  private get db() {
    return this.prisma.tenant;
  }

  // ───────────── Leads ─────────────

  async leads(campaignId: string, q: { page: number; pageSize: number }): Promise<Paginated<LeadDto>> {
    await this.campaigns.row(campaignId);
    const where: Prisma.LeadWhereInput = { campaignId, deletedAt: null, ...ownerScope() };
    const [rows, total] = await Promise.all([
      this.db.lead.findMany({ where, include: leadInclude, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.db.lead.count({ where }),
    ]);
    return { data: rows.map(toLeadDto), meta: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) } };
  }

  // ───────────── Audience ─────────────

  /** CRM records matching a segment (for planning now and sending in Phase 14). Respects record ownership. */
  async audiencePreview(segment: AudienceSegment): Promise<AudiencePreviewDto> {
    const ci = (values: string[]) => values.map((v) => ({ equals: v, mode: 'insensitive' as const }));
    if (segment.kind === 'customers') {
      const where: Prisma.ContactWhereInput = {
        deletedAt: null,
        lifecycle: 'CUSTOMER',
        ...ownerScope(),
        ...(segment.sources.length ? { source: { in: segment.sources } } : {}),
        ...(segment.tags.length ? { tags: { hasSome: segment.tags } } : {}),
        ...(segment.cities.length || segment.countries.length
          ? { company: { is: { ...(segment.cities.length ? { OR: ci(segment.cities).map((city) => ({ city })) } : {}), ...(segment.countries.length ? { country: { in: segment.countries } } : {}) } } }
          : {}),
      };
      const [total, withEmail, withPhone, sample] = await Promise.all([
        this.db.contact.count({ where }),
        this.db.contact.count({ where: { ...where, email: { not: null } } }),
        this.db.contact.count({ where: { ...where, OR: [{ phone: { not: null } }, { whatsapp: { not: null } }] } }),
        this.db.contact.findMany({ where, take: 10, orderBy: { createdAt: 'desc' }, include: { company: { select: { city: true } } } }),
      ]);
      return { total, withEmail, withPhone, sample: sample.map((c) => ({ id: c.id, name: fullName(c), email: c.email, phone: c.phone, status: c.lifecycle, city: c.company?.city ?? null, score: null })) };
    }
    const where: Prisma.LeadWhereInput = {
      deletedAt: null,
      ...ownerScope(),
      ...(segment.statuses.length ? { status: { in: segment.statuses } } : { status: { notIn: ['CONVERTED', 'LOST'] } }),
      ...(segment.sources.length ? { source: { in: segment.sources } } : {}),
      ...(segment.tags.length ? { tags: { hasSome: segment.tags } } : {}),
      ...(segment.minScore !== null ? { score: { gte: segment.minScore } } : {}),
      AND: [...(segment.cities.length ? [{ OR: ci(segment.cities).map((city) => ({ city })) }] : []), ...(segment.countries.length ? [{ OR: ci(segment.countries).map((country) => ({ country })) }] : [])],
    };
    const [total, withEmail, withPhone, sample] = await Promise.all([
      this.db.lead.count({ where }),
      this.db.lead.count({ where: { ...where, email: { not: null } } }),
      this.db.lead.count({ where: { ...where, OR: [{ phone: { not: null } }, { whatsapp: { not: null } }] } }),
      this.db.lead.findMany({ where, take: 10, orderBy: [{ score: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }] }),
    ]);
    return { total, withEmail, withPhone, sample: sample.map((l) => ({ id: l.id, name: fullName(l), email: l.email, phone: l.phone, status: l.status, city: l.city, score: l.score })) };
  }

  // ───────────── Analytics ─────────────

  async analytics(campaignId: string, range: CampaignRange): Promise<CampaignAnalyticsDto> {
    const c = await this.campaigns.row(campaignId);
    const from = new Date(`${range.from}T00:00:00Z`);
    const toExcl = new Date(new Date(`${range.to}T00:00:00Z`).getTime() + DAY);
    const ads = await this.db.adCampaign.findMany({ where: { marketingCampaignId: campaignId, deletedAt: null }, select: { id: true, platform: true, currency: true } });
    const adById = new Map(ads.map((a) => [a.id, a]));
    const [linkDays, links, leads, deals, insights, posts] = await Promise.all([
      this.db.trackedLinkClickDaily.findMany({ where: { campaignId, date: { gte: from, lt: toExcl } }, select: { date: true, clicks: true, uniqueClicks: true, linkId: true } }),
      this.db.trackedLink.findMany({ where: { campaignId }, select: { id: true, channel: true } }),
      this.db.lead.findMany({ where: { campaignId, deletedAt: null, createdAt: { gte: from, lt: toExcl } }, select: { createdAt: true, source: true } }),
      this.db.deal.findMany({
        where: { deletedAt: null, status: 'WON', closedAt: { gte: from, lt: toExcl }, OR: [{ campaignId }, { lead: { campaignId } }] },
        select: { closedAt: true, value: true, currency: true },
      }),
      ads.length ? this.db.adInsightDaily.findMany({ where: { campaignId: { in: ads.map((a) => a.id) }, date: { gte: from, lt: toExcl } } }) : Promise.resolve([]),
      this.db.socialPost.count({ where: { campaignId, deletedAt: null, publishedAt: { gte: from, lt: toExcl } } }),
    ]);

    const days = new Map<string, { linkClicks: number; leads: number; won: number; adClicks: number; impressions: number; spend: { currency: string; cents: bigint }[] }>();
    for (let t = from.getTime(); t < toExcl.getTime(); t += DAY) days.set(dayKey(new Date(t)), { linkClicks: 0, leads: 0, won: 0, adClicks: 0, impressions: 0, spend: [] });
    const at = (d: Date) => days.get(dayKey(d));
    for (const r of linkDays) at(r.date)!.linkClicks += r.clicks;
    for (const l of leads) at(l.createdAt)!.leads++;
    for (const d of deals) at(d.closedAt!)!.won++;
    for (const i of insights) {
      const day = at(i.date)!;
      day.adClicks += i.clicks;
      day.impressions += i.impressions;
      day.spend.push({ currency: adById.get(i.campaignId)!.currency, cents: toCents(i.spend.toFixed(2)) });
    }

    const linkChannel = new Map(links.map((l) => [l.id, l.channel]));
    const plans = this.campaigns.toDto(c).channelPlans;
    const sources = new Map<string, number>();
    for (const l of leads) sources.set(l.source, (sources.get(l.source) ?? 0) + 1);
    const contentCount = (ch: CampaignChannel) => (plans.find((p) => p.channel === ch)?.content as ContentPlanItem[] | undefined)?.length ?? 0;
    const postsTotal = await this.db.socialPost.count({ where: { campaignId, deletedAt: null } });
    const channels = (c.channels as CampaignChannel[]).filter((ch) => CAMPAIGN_CHANNELS.includes(ch)).map((channel) => {
      const platform = channel === 'meta_ads' ? 'META' : channel === 'google_ads' ? 'GOOGLE' : null;
      const chAds = platform ? ads.filter((a) => a.platform === platform) : [];
      const chAdIds = new Set(chAds.map((a) => a.id));
      return {
        channel,
        plannedBudget: plans.find((p) => p.channel === channel)?.plannedBudget ?? null,
        spend: sumByCurrency(insights.filter((i) => chAdIds.has(i.campaignId)).map((i) => ({ currency: adById.get(i.campaignId)!.currency, cents: toCents(i.spend.toFixed(2)) }))),
        leads: leads.filter((l) => CHANNEL_SOURCES[channel].includes(l.source)).length,
        linkClicks: linkDays.filter((d) => linkChannel.get(d.linkId) === channel).reduce((n, d) => n + d.clicks, 0),
        items: channel === 'social' ? postsTotal : platform ? chAds.length : contentCount(channel),
      };
    });

    const linkClicks = linkDays.reduce((n, d) => n + d.clicks, 0);
    return {
      range,
      totals: {
        linkClicks,
        uniqueClicks: linkDays.reduce((n, d) => n + d.uniqueClicks, 0),
        leads: leads.length,
        wonDeals: deals.length,
        wonValue: sumByCurrency(deals.map((d) => ({ currency: d.currency, cents: toCents(d.value.toFixed(2)) }))),
        spend: sumByCurrency(insights.map((i) => ({ currency: adById.get(i.campaignId)!.currency, cents: toCents(i.spend.toFixed(2)) }))),
        impressions: insights.reduce((n, i) => n + i.impressions, 0),
        adClicks: insights.reduce((n, i) => n + i.clicks, 0),
        platformLeads: insights.reduce((n, i) => n + i.leads, 0),
        platformConversions: insights.reduce((n, i) => n + i.conversions, 0),
        postsPublished: posts,
        clickToLead: pct(leads.length, linkClicks),
        leadToWon: pct(deals.length, leads.length),
      },
      daily: [...days.entries()].map(([date, d]) => ({ date, linkClicks: d.linkClicks, leads: d.leads, won: d.won, adClicks: d.adClicks, impressions: d.impressions, spend: sumByCurrency(d.spend) })),
      leadsBySource: [...sources.entries()].sort((a, b) => b[1] - a[1]).map(([source, count]) => ({ source, count })),
      channels,
    };
  }

  // ───────────── Calendar ─────────────

  async calendar(q: CampaignCalendarQuery): Promise<CampaignCalendarEntry[]> {
    const from = new Date(q.from);
    const to = new Date(q.to);
    if (q.campaignId && !(await this.db.campaign.findFirst({ where: { id: q.campaignId, deletedAt: null }, select: { id: true } }))) throw notFound('Campaign');
    const campaignWhere: Prisma.CampaignWhereInput = {
      deletedAt: null,
      ...(q.campaignId ? { id: q.campaignId } : {}),
      ...(q.workspaceId ? { workspaceId: q.workspaceId } : {}),
    };
    const campaigns = await this.db.campaign.findMany({
      where: { ...campaignWhere, startAt: { not: null, lt: to }, OR: [{ endAt: null }, { endAt: { gte: from } }] },
      orderBy: { startAt: 'asc' },
      take: 300,
      include: { plans: { select: { channel: true, content: true } } },
    });
    const ids = q.campaignId ? [q.campaignId] : (await this.db.campaign.findMany({ where: campaignWhere, select: { id: true }, take: 2000 })).map((c) => c.id);
    const [posts, ads, tasks] = await Promise.all([
      this.db.socialPost.findMany({ where: { campaignId: { in: ids }, deletedAt: null, OR: [{ scheduledAt: { gte: from, lt: to } }, { scheduledAt: null, publishedAt: { gte: from, lt: to } }] }, take: 1000, orderBy: { scheduledAt: 'asc' } }),
      this.db.adCampaign.findMany({ where: { marketingCampaignId: { in: ids }, deletedAt: null, startAt: { lt: to }, OR: [{ endAt: null }, { endAt: { gte: from } }] }, take: 500 }),
      this.db.campaignTask.findMany({ where: { campaignId: { in: ids }, dueAt: { gte: from, lt: to } }, take: 1000, orderBy: { dueAt: 'asc' } }),
    ]);
    const out: CampaignCalendarEntry[] = [];
    for (const c of campaigns) {
      out.push({ kind: 'campaign', id: c.id, campaignId: c.id, title: c.name, start: c.startAt!.toISOString(), end: (c.endAt ?? c.startAt!).toISOString(), status: this.campaigns.statusOf({ ...c, manualStatus: c.manualStatus as ManualStatus | null }), type: c.type as MarketingCampaignType });
      for (const p of c.plans) {
        (p.content as ContentPlanItem[]).forEach((item, i) => {
          if (!item.date) return;
          const at = new Date(`${item.date}T09:00:00Z`);
          if (at >= from && at < to) out.push({ kind: 'content', id: `${c.id}:${p.channel}:${i}`, campaignId: c.id, title: item.title, start: at.toISOString(), channel: p.channel as CampaignChannel });
        });
      }
    }
    for (const p of posts) out.push({ kind: 'post', id: p.id, campaignId: p.campaignId, title: p.caption.slice(0, 80) || 'Untitled post', start: (p.scheduledAt ?? p.publishedAt)!.toISOString(), status: p.status });
    for (const a of ads) out.push({ kind: 'ad', id: a.id, campaignId: a.marketingCampaignId, title: a.name, start: (a.startAt ?? a.createdAt).toISOString(), end: a.endAt?.toISOString() ?? null, status: a.status, platform: a.platform });
    for (const t of tasks) out.push({ kind: 'task', id: t.id, campaignId: t.campaignId, title: t.title, start: t.dueAt!.toISOString(), done: t.done });
    return out;
  }
}
