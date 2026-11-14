import { describe, expect, it } from 'vitest';
import {
  aiCampaignPlanOutputSchema,
  buildTrackedUrl,
  campaignAssetSchema,
  campaignAudienceSchema,
  createMarketingCampaignSchema,
  deriveStatus,
  parseUtm,
  readinessIssues,
  slugifyUtm,
  splitBudget,
  trackedLinkSchema,
  updateMarketingCampaignSchema,
} from './campaigns.js';

const base = { manualStatus: null, readyAt: '2026-11-01T00:00:00Z', startAt: '2026-11-10T00:00:00Z', endAt: '2026-11-20T00:00:00Z', channels: ['social'] };
const at = (s: string) => new Date(s);

describe('deriveStatus', () => {
  it('follows the dates once ready', () => {
    expect(deriveStatus(base, at('2026-11-09T23:59:59Z'))).toBe('SCHEDULED');
    expect(deriveStatus(base, at('2026-11-10T00:00:00Z'))).toBe('ACTIVE');
    expect(deriveStatus(base, at('2026-11-19T23:59:59Z'))).toBe('ACTIVE');
    expect(deriveStatus(base, at('2026-11-20T00:00:00Z'))).toBe('COMPLETED');
  });
  it('stays draft until ready, dated and with a channel', () => {
    expect(deriveStatus({ ...base, readyAt: null }, at('2026-11-12T00:00:00Z'))).toBe('DRAFT');
    expect(deriveStatus({ ...base, endAt: null }, at('2026-11-12T00:00:00Z'))).toBe('DRAFT');
    expect(deriveStatus({ ...base, channels: [] }, at('2026-11-12T00:00:00Z'))).toBe('DRAFT');
    expect(deriveStatus({ ...base, endAt: base.startAt }, at('2026-11-12T00:00:00Z'))).toBe('DRAFT');
  });
  it('manual statuses win over the dates', () => {
    expect(deriveStatus({ ...base, manualStatus: 'PAUSED' }, at('2026-11-12T00:00:00Z'))).toBe('PAUSED');
    expect(deriveStatus({ ...base, manualStatus: 'CANCELLED', readyAt: null }, at('2026-11-30T00:00:00Z'))).toBe('CANCELLED');
  });
  it('lists what blocks readiness', () => {
    expect(readinessIssues({ startAt: null, endAt: null, channels: [] })).toEqual(['Set a start date', 'Set an end date', 'Choose at least one channel']);
    expect(readinessIssues({ startAt: base.endAt, endAt: base.startAt, channels: ['social'] })).toEqual(['The end date must be after the start date']);
    expect(readinessIssues(base)).toEqual([]);
  });
});

describe('UTM', () => {
  it('slugifies to UTM-safe ASCII', () => {
    expect(slugifyUtm('Onam Sale 2026!')).toBe('onam-sale-2026');
    expect(slugifyUtm('Café  Crème — Promo')).toBe('cafe-creme-promo');
    expect(slugifyUtm('ഓണം')).toBe('campaign');
    expect(slugifyUtm('x'.repeat(80))).toHaveLength(60);
  });
  it('merges UTM parameters and keeps query and fragment', () => {
    const u = buildTrackedUrl('https://shop.example.in/offer?ref=abc&utm_source=old#form', { source: 'facebook', medium: 'paid_social', campaign: 'onam-sale', content: null });
    const p = new URL(u);
    expect(p.searchParams.get('ref')).toBe('abc');
    expect(p.searchParams.get('utm_source')).toBe('facebook');
    expect(p.searchParams.get('utm_campaign')).toBe('onam-sale');
    expect(p.searchParams.has('utm_content')).toBe(false);
    expect(p.hash).toBe('#form');
  });
  it('parses UTM from a landing URL', () => {
    expect(parseUtm('https://a.in/?utm_source=google&utm_campaign=onam-sale&x=1')).toEqual({ source: 'google', campaign: 'onam-sale' });
    expect(parseUtm('not a url')).toEqual({});
  });
});

describe('splitBudget', () => {
  it('splits exactly with the remainder on the largest share', () => {
    const parts = splitBudget('1000.00', [
      { channel: 'meta_ads', percent: 33.33 },
      { channel: 'google_ads', percent: 33.33 },
      { channel: 'social', percent: 33.34 },
    ]);
    const total = parts.reduce((n, p) => n + Math.round(Number(p.amount) * 100), 0);
    expect(total).toBe(100_000);
    expect(parts.find((p) => p.channel === 'social')!.amount).toBe('333.40');
  });
  it('normalises shares that do not add up to 100 and drops zeros', () => {
    expect(splitBudget('300', [{ channel: 'meta_ads', percent: 1 }, { channel: 'google_ads', percent: 2 }, { channel: 'email', percent: 0 }])).toEqual([
      { channel: 'meta_ads', amount: '100.00' },
      { channel: 'google_ads', amount: '200.00' },
    ]);
    expect(splitBudget('300', [])).toEqual([]);
  });
});

describe('schemas', () => {
  const ws = '0190a8d2-6d3c-7a00-8000-000000000001';
  it('creates with defaults and checks the date order', () => {
    const c = createMarketingCampaignSchema.parse({ workspaceId: ws, name: 'Onam sale', type: 'FESTIVAL' });
    expect(c.objective).toBe('AWARENESS');
    expect(c.timezone).toBe('Asia/Kolkata');
    expect(createMarketingCampaignSchema.safeParse({ workspaceId: ws, name: 'X1', type: 'FESTIVAL', startAt: '2026-11-10T00:00:00Z', endAt: '2026-11-01T00:00:00Z' }).success).toBe(false);
    expect(createMarketingCampaignSchema.safeParse({ workspaceId: ws, name: 'X1', type: 'FESTIVAL', channelPlans: [{ channel: 'social' }, { channel: 'social' }] }).success).toBe(false);
  });
  it('PATCH leaves omitted fields untouched (no defaults)', () => {
    expect(updateMarketingCampaignSchema.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' });
  });
  it('validates audience, links and assets', () => {
    expect(campaignAudienceSchema.safeParse({ ageMin: 40, ageMax: 20 }).success).toBe(false);
    expect(campaignAudienceSchema.parse({ segment: { kind: 'leads', statuses: ['NEW'] } }).segment?.sources).toEqual([]);
    expect(trackedLinkSchema.safeParse({ destinationUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(trackedLinkSchema.safeParse({ destinationUrl: 'https://a.in', utmSource: 'Facebook Ads' }).success).toBe(false);
    expect(trackedLinkSchema.parse({ destinationUrl: 'https://a.in' }).channel).toBe('other');
    expect(campaignAssetSchema.safeParse({ fileId: ws, designId: ws }).success).toBe(false);
    expect(campaignAssetSchema.safeParse({ designId: ws }).success).toBe(true);
  });
  it('AI output is constrained to known enums', () => {
    expect(aiCampaignPlanOutputSchema.safeParse({ name: 'Onam', type: 'FESTIVAL', objective: 'SALES', channels: ['tiktok'], audience: {} }).success).toBe(false);
    expect(aiCampaignPlanOutputSchema.parse({ name: 'Onam', type: 'FESTIVAL', objective: 'SALES', channels: ['social'], audience: {} }).contentPlan).toEqual([]);
  });
});
