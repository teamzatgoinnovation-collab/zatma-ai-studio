import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import {
  buildTrackedUrl,
  CAMPAIGN_CHANNEL_INFO,
  type CampaignChannel,
  type TrackedLinkDto,
  type TrackedLinkInput,
  type UpdateTrackedLinkInput,
} from '@zatma/validation';
import { AuditService } from '../audit/audit.service.js';
import { AppException, notFound } from '../common/errors.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import type { TrackedLink } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS } from '../redis/redis.module.js';

const SLUG_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Link previews and crawlers fetch links without a person clicking; they are redirected but not counted. */
const BOT_UA = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|skype|embedly|quora link|pinterest|vkshare|headless|lighthouse/i;

export function newSlug(length = 8): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => SLUG_ALPHABET[b % SLUG_ALPHABET.length]).join('');
}

const today = () => new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');

/**
 * Tracked short links (`/r/{slug}`). A click increments counters; nothing about the visitor is stored. Unique clicks
 * are estimated with a keyed hash of IP + user agent held in Redis for 24 hours only.
 */
@Injectable()
export class CampaignTrackingService {
  private readonly logger = new Logger(CampaignTrackingService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  private get db() {
    return this.prisma.tenant;
  }

  shortUrl(slug: string) {
    return `${this.env.WEB_URL}/r/${slug}`;
  }

  trackedUrl(l: Pick<TrackedLink, 'destinationUrl' | 'utmSource' | 'utmMedium' | 'utmContent' | 'utmTerm'>, utmCampaign: string) {
    return buildTrackedUrl(l.destinationUrl, { source: l.utmSource, medium: l.utmMedium, campaign: utmCampaign, content: l.utmContent, term: l.utmTerm });
  }

  toDto(l: TrackedLink, utmCampaign: string): TrackedLinkDto {
    return {
      id: l.id,
      slug: l.slug,
      shortUrl: this.shortUrl(l.slug),
      destinationUrl: l.destinationUrl,
      trackedUrl: this.trackedUrl(l, utmCampaign),
      label: l.label,
      channel: l.channel as CampaignChannel,
      utmSource: l.utmSource,
      utmMedium: l.utmMedium,
      utmContent: l.utmContent,
      utmTerm: l.utmTerm,
      clicks: l.clicks,
      uniqueClicks: l.uniqueClicks,
      createdAt: l.createdAt.toISOString(),
    };
  }

  private async campaign(id: string) {
    const c = await this.db.campaign.findFirst({ where: { id, deletedAt: null }, select: { id: true, organizationId: true, utmCampaign: true, manualStatus: true } });
    if (!c) throw notFound('Campaign');
    return c;
  }

  async list(campaignId: string): Promise<TrackedLinkDto[]> {
    const c = await this.campaign(campaignId);
    const rows = await this.db.trackedLink.findMany({ where: { campaignId, deletedAt: null }, orderBy: { createdAt: 'desc' } });
    return rows.map((l) => this.toDto(l, c.utmCampaign));
  }

  async create(campaignId: string, input: TrackedLinkInput): Promise<TrackedLinkDto> {
    const c = await this.campaign(campaignId);
    if (c.manualStatus === 'CANCELLED') throw new AppException(HttpStatus.CONFLICT, 'CAMPAIGN_CANCELLED', 'A cancelled campaign cannot get new links');
    const count = await this.db.trackedLink.count({ where: { campaignId, deletedAt: null } });
    if (count >= 100) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'TOO_MANY_LINKS', 'A campaign can have up to 100 tracked links');
    const info = CAMPAIGN_CHANNEL_INFO[input.channel];
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const l = await this.db.trackedLink.create({
          data: {
            organizationId: c.organizationId,
            campaignId,
            slug: newSlug(),
            destinationUrl: input.destinationUrl,
            label: input.label,
            channel: input.channel,
            utmSource: input.utmSource ?? info.utmSource,
            utmMedium: input.utmMedium ?? info.utmMedium,
            utmContent: input.utmContent ?? null,
            utmTerm: input.utmTerm ?? null,
          },
        });
        await this.audit.record('campaigns.link_created', 'campaign', campaignId, { linkId: l.id, destination: new URL(l.destinationUrl).hostname });
        return this.toDto(l, c.utmCampaign);
      } catch (e) {
        if ((e as { code?: string }).code === 'P2002') continue; // slug collision: try another
        throw e;
      }
    }
    throw new AppException(HttpStatus.INTERNAL_SERVER_ERROR, 'SLUG_UNAVAILABLE', 'Could not create a short link, try again');
  }

  async update(campaignId: string, linkId: string, input: UpdateTrackedLinkInput): Promise<TrackedLinkDto> {
    const c = await this.campaign(campaignId);
    const l = await this.db.trackedLink.findFirst({ where: { id: linkId, campaignId, deletedAt: null } });
    if (!l) throw notFound('Link');
    const updated = await this.db.trackedLink.update({
      where: { id: linkId },
      data: {
        ...(input.destinationUrl !== undefined ? { destinationUrl: input.destinationUrl } : {}),
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.channel !== undefined ? { channel: input.channel } : {}),
        ...(input.utmSource !== undefined ? { utmSource: input.utmSource } : {}),
        ...(input.utmMedium !== undefined ? { utmMedium: input.utmMedium } : {}),
        ...(input.utmContent !== undefined ? { utmContent: input.utmContent } : {}),
        ...(input.utmTerm !== undefined ? { utmTerm: input.utmTerm } : {}),
      },
    });
    return this.toDto(updated, c.utmCampaign);
  }

  async remove(campaignId: string, linkId: string): Promise<void> {
    await this.campaign(campaignId);
    const res = await this.db.trackedLink.updateMany({ where: { id: linkId, campaignId, deletedAt: null }, data: { deletedAt: new Date() } });
    if (!res.count) throw notFound('Link');
    await this.audit.record('campaigns.link_deleted', 'campaign', campaignId, { linkId });
  }

  // ───────────── Public redirect ─────────────

  /**
   * Resolves a slug to its tracked destination and counts the click. Runs without a tenant (public endpoint), so it
   * uses the system client and only ever reads the one link. Returns null for unknown or deleted links.
   */
  async resolve(slug: string, visitor: { ip: string | undefined; userAgent: string | undefined; method: string }): Promise<string | null> {
    if (!/^[A-Za-z0-9]{6,16}$/.test(slug)) return null;
    const db = this.prisma.system;
    const l = await db.trackedLink.findUnique({ where: { slug }, include: { campaign: { select: { utmCampaign: true, deletedAt: true } } } });
    if (!l || l.deletedAt || l.campaign.deletedAt) return null;
    const url = this.trackedUrl(l, l.campaign.utmCampaign);
    const ua = visitor.userAgent ?? '';
    if (visitor.method === 'GET' && ua && !BOT_UA.test(ua)) {
      await this.count(l, visitor.ip ?? '', ua).catch((e) => this.logger.warn(`Click count failed for ${l.id}: ${(e as Error).message}`));
    }
    return url;
  }

  private async count(l: TrackedLink, ip: string, ua: string) {
    const date = today();
    const day = date.toISOString().slice(0, 10);
    // Keyed hash so the Redis key reveals nothing about the visitor; expires after a day.
    const key = `trk:u:${l.id}:${day}:${createHmac('sha256', this.env.BETTER_AUTH_SECRET).update(`${ip}|${ua}`).digest('base64url').slice(0, 22)}`;
    const unique = (await this.redis.set(key, '1', 'EX', 86_400, 'NX')) === 'OK';
    const inc = { clicks: { increment: 1 }, ...(unique ? { uniqueClicks: { increment: 1 } } : {}) };
    const db = this.prisma.system;
    await db.$transaction([
      db.trackedLink.update({ where: { id: l.id }, data: inc }),
      db.trackedLinkClickDaily.upsert({
        where: { linkId_date: { linkId: l.id, date } },
        create: { organizationId: l.organizationId, campaignId: l.campaignId, linkId: l.id, date, clicks: 1, uniqueClicks: unique ? 1 : 0 },
        update: inc,
      }),
    ]);
  }
}
