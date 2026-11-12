import { describe, expect, it } from 'vitest';
import {
  activateCampaignSchema,
  campaignDraftSchema,
  fromMetaMinor,
  fromMicros,
  maxSpend,
  maxSpendThisMonth,
  toCents,
  toMetaMinor,
  toMicros,
  updateCampaignSchema,
  validateCampaign,
  type CampaignDraftInput,
} from './ads.js';

const uuid = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const metaCreative = { pageId: '1001', primaryText: 'Onam offers at ZatGo Kochi', headline: 'Onam Mega Sale', description: '', cta: 'LEARN_MORE' as const, link: 'https://zatgo.com/onam', imageFileId: uuid, imageWidth: 1080, imageHeight: 1080 };
const metaTargeting = { locations: [{ key: 'IN', name: 'India', type: 'country' as const }], ageMin: 18, ageMax: 65, genders: [], interests: [], locales: [] };
const meta = (over: Partial<CampaignDraftInput> = {}, creative: object = {}): CampaignDraftInput =>
  campaignDraftSchema.parse({ workspaceId: uuid, adAccountId: uuid, name: 'Onam', objective: 'TRAFFIC', budgetAmount: '500', adGroups: [{ name: 'Kerala', targeting: metaTargeting, ads: [{ name: 'Ad 1', creative: { ...metaCreative, ...creative } }] }], ...over });
const codes = (issues: Array<{ code: string; level: string }>, level = 'error') => issues.filter((i) => i.level === level).map((i) => i.code);

describe('money', () => {
  it('converts exactly between amounts, Meta minor units and Google micros', () => {
    expect(toCents('1499.5')).toBe(149950n);
    expect(() => toCents('1.234')).toThrow();
    expect(() => toCents('-5')).toThrow();
    expect(toMetaMinor('500', 'INR')).toBe('50000');
    expect(toMetaMinor('500', 'JPY')).toBe('500');
    expect(fromMetaMinor('50050', 'INR')).toBe('500.50');
    expect(fromMetaMinor(500, 'JPY')).toBe('500.00');
    expect(toMicros('0.1')).toBe('100000');
    expect(toMicros('1234.56')).toBe('1234560000');
    expect(fromMicros('1234560000')).toBe('1234.56');
    // 0.1 + 0.2 style float errors cannot happen
    expect(toCents('0.10') + toCents('0.20')).toBe(30n);
  });

  it('computes the maximum possible spend', () => {
    const now = new Date('2026-11-11T06:00:00Z');
    expect(maxSpend({ budgetType: 'LIFETIME', budgetAmount: '10000', endAt: '2026-12-01T00:00:00Z' }, now)).toEqual({ amount: '10000.00', days: 0, untilMonthEnd: false });
    // Daily with end date: 11 Nov 06:00 → 21 Nov 06:00 = 10 days
    expect(maxSpend({ budgetType: 'DAILY', budgetAmount: '500', endAt: '2026-11-21T06:00:00Z' }, now)).toEqual({ amount: '5000.00', days: 10, untilMonthEnd: false });
    // Open-ended: until month end (19 days 18 h → 20 days)
    expect(maxSpend({ budgetType: 'DAILY', budgetAmount: '500' }, now)).toEqual({ amount: '10000.00', days: 20, untilMonthEnd: true });
    // Future start counts from the start
    expect(maxSpend({ budgetType: 'DAILY', budgetAmount: '100.50', startAt: '2026-11-20T00:00:00Z', endAt: '2026-11-23T00:00:00Z' }, now).amount).toBe('301.50');
    // Only the part in this month counts toward the monthly cap
    expect(maxSpendThisMonth({ budgetType: 'DAILY', budgetAmount: '500', endAt: '2026-12-31T00:00:00Z' }, now)).toBe('10000.00');
    expect(maxSpendThisMonth({ budgetType: 'DAILY', budgetAmount: '500', startAt: '2026-12-05T00:00:00Z' }, now)).toBe('0.00');
  });
});

describe('campaign rules', () => {
  const now = new Date('2026-11-11T06:00:00Z');
  it('accepts a valid Meta traffic campaign', () => {
    expect(codes(validateCampaign(meta(), 'META', now))).toEqual([]);
  });
  it('enforces objective requirements', () => {
    expect(codes(validateCampaign(meta({}, { link: undefined }), 'META', now))).toContain('LINK_REQUIRED');
    expect(codes(validateCampaign(meta({ objective: 'MESSAGES' }), 'META', now))).toContain('MESSAGING_REQUIRED');
    expect(codes(validateCampaign(meta({ objective: 'MESSAGES' }, { messaging: { channel: 'WHATSAPP' } }), 'META', now))).toContain('WHATSAPP_NUMBER_REQUIRED');
    expect(codes(validateCampaign(meta({ objective: 'LEADS' }), 'META', now))).toContain('LEAD_FORM_REQUIRED');
    expect(codes(validateCampaign(meta({ objective: 'LEADS' }, { leadForm: { name: 'Onam', questions: ['FULL_NAME', 'PHONE'], privacyPolicyUrl: 'https://zatgo.com/privacy' } }), 'META', now))).toEqual([]);
    expect(codes(validateCampaign(meta({ objective: 'SEARCH' }), 'META', now))).toContain('OBJECTIVE_UNSUPPORTED');
  });
  it('checks budgets, dates and creative limits', () => {
    expect(codes(validateCampaign(meta({ budgetAmount: '0.50' }), 'META', now))).toContain('BUDGET_TOO_LOW');
    expect(codes(validateCampaign(meta({ budgetType: 'LIFETIME' }), 'META', now))).toContain('END_REQUIRED');
    expect(codes(validateCampaign(meta({ startAt: '2026-11-20T00:00:00Z', endAt: '2026-11-19T00:00:00Z' }), 'META', now))).toContain('END_BEFORE_START');
    expect(codes(validateCampaign(meta({}, { headline: 'x'.repeat(41) }), 'META', now))).toContain('HEADLINE_TOO_LONG');
    expect(codes(validateCampaign(meta({}, { imageWidth: 1080, imageHeight: 2400 }), 'META', now))).toContain('IMAGE_RATIO');
    expect(codes(validateCampaign(meta({}, { primaryText: 'x'.repeat(200) }), 'META', now), 'warning')).toContain('TEXT_TRUNCATED');
  });
  it('enforces Google responsive search ad rules', () => {
    const g = (rsa: object) =>
      campaignDraftSchema.parse({
        workspaceId: uuid,
        adAccountId: uuid,
        name: 'Search',
        objective: 'SEARCH',
        budgetAmount: '800',
        adGroups: [{ name: 'Van sales ERP', targeting: { locations: [{ id: '2356', name: 'India' }], languages: [], keywords: [{ text: 'van sales software', matchType: 'PHRASE' }] }, ads: [{ name: 'RSA', creative: { finalUrl: 'https://zatgo.com', headlines: ['A', 'B', 'C'], descriptions: ['One', 'Two'], ...rsa } }] }],
      });
    expect(codes(validateCampaign(g({}), 'GOOGLE', now))).toEqual([]);
    expect(codes(validateCampaign(g({ headlines: ['A', 'B'] }), 'GOOGLE', now))).toContain('HEADLINES_TOO_FEW');
    expect(codes(validateCampaign(g({ headlines: ['A', 'a', 'C'] }), 'GOOGLE', now))).toContain('HEADLINES_DUPLICATE');
    expect(codes(validateCampaign(g({ headlines: ['A', 'B', 'x'.repeat(31)] }), 'GOOGLE', now))).toContain('HEADLINE_TOO_LONG');
    expect(codes(validateCampaign(g({ descriptions: ['One'] }), 'GOOGLE', now))).toContain('DESCRIPTIONS_TOO_FEW');
    expect(codes(validateCampaign(g({}), 'GOOGLE', now), 'warning')).toContain('HEADLINES_FEW');
    expect(() => g({ finalUrl: 'http://zatgo.com' })).toThrow();
    expect(codes(validateCampaign({ ...g({}), budgetType: 'LIFETIME', endAt: '2026-12-01T00:00:00Z' }, 'GOOGLE', now))).toEqual(expect.arrayContaining(['BUDGET_TYPE_UNSUPPORTED', 'SCHEDULE_UNSUPPORTED']));
  });
});

describe('schemas', () => {
  it('requires explicit spend confirmation and keeps PATCH partial', () => {
    expect(activateCampaignSchema.safeParse({ maxSpend: '5000' }).success).toBe(false);
    expect(activateCampaignSchema.safeParse({ confirm: true, maxSpend: '5000.00' }).success).toBe(true);
    expect(updateCampaignSchema.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' });
  });
});
