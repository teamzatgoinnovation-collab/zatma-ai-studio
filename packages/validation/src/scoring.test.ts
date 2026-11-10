import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING_SETTINGS, dueFor, gradeFor, leadInsightsOutputSchema, resolveScoringSettings, scoreLead, scoringSettingsSchema, type ScoreInput } from './scoring.js';

const NOW = new Date('2026-11-10T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const base: ScoreInput = {
  email: null,
  phone: null,
  whatsapp: null,
  company: null,
  jobTitle: null,
  industry: null,
  city: null,
  source: 'import',
  status: 'NEW',
  lastContactedAt: null,
  createdAt: daysAgo(1),
  activities: [],
};

describe('lead scoring', () => {
  it('scores a bare lead low and a well-qualified, engaged lead hot', () => {
    const cold = scoreLead(base, DEFAULT_SCORING_SETTINGS, NOW);
    expect(cold).toMatchObject({ score: 3, grade: 'COLD' });

    const hot = scoreLead(
      {
        ...base,
        phone: '+919847012345',
        whatsapp: '+919847012345',
        email: 'md@nairtraders.in',
        company: 'Nair Traders',
        jobTitle: 'Managing Director',
        source: 'referral',
        status: 'QUALIFIED',
        lastContactedAt: daysAgo(1),
        activities: [
          { type: 'CALL', createdAt: daysAgo(1), dueAt: null, completedAt: daysAgo(1) },
          { type: 'WHATSAPP', createdAt: daysAgo(3), dueAt: null, completedAt: daysAgo(3) },
          { type: 'FOLLOW_UP', createdAt: daysAgo(1), dueAt: new Date(NOW.getTime() + 86_400_000).toISOString(), completedAt: null },
        ],
      },
      DEFAULT_SCORING_SETTINGS,
      NOW,
    );
    // 15 channels + 8 company + 10 decision maker + 12 referral + 15 recency + 6 engagement + 6 follow-up + 12 qualified = 84
    expect(hot).toMatchObject({ score: 84, grade: 'HOT' });
    expect(hot.signals.map((s) => s.key)).toEqual(['contactChannels', 'recency', 'source', 'status', 'decisionMaker', 'company', 'engagement', 'followUp']);
    expect(hot.reason).toBe('Reachable by phone, WhatsApp, email · Last contacted 1 day ago · Source: referral');
  });

  it('decays with time and penalises stale and overdue leads', () => {
    const at = (d: number) => scoreLead({ ...base, lastContactedAt: daysAgo(d) }, DEFAULT_SCORING_SETTINGS, NOW).signals.find((s) => s.key === 'recency')?.points ?? 0;
    expect([at(0), at(5), at(10), at(20), at(40)]).toEqual([15, 12, 8, 4, 0]);
    const stale = scoreLead({ ...base, phone: '+919847012345', source: 'website', lastContactedAt: daysAgo(45), activities: [{ type: 'TASK', createdAt: daysAgo(50), dueAt: daysAgo(40), completedAt: null }] }, DEFAULT_SCORING_SETTINGS, NOW);
    expect(stale.signals.filter((s) => s.points < 0).map((s) => [s.key, s.points])).toEqual([
      ['stale', -10],
      ['overdue', -8],
    ]);
    expect(stale.score).toBe(0); // 6 + 9 - 18, clamped
    expect(scoreLead({ ...base, createdAt: daysAgo(40) }, DEFAULT_SCORING_SETTINGS, NOW).signals.find((s) => s.key === 'stale')?.detail).toBe('Never contacted since it was added');
  });

  it('applies weights, targets and thresholds from settings', () => {
    const settings = scoringSettingsSchema.parse({ weights: { source: 0, company: 3 }, targetIndustries: ['Retail'], targetCities: ['Kochi', 'Dubai'], hotThreshold: 30, warmThreshold: 10 });
    const r = scoreLead({ ...base, company: 'Anil Stores', industry: 'retail', city: 'Kochi', source: 'referral' }, settings, NOW);
    expect(r.signals.map((s) => [s.key, s.points])).toEqual([
      ['company', 24],
      ['targetIndustry', 10],
      ['targetCity', 6],
    ]);
    expect(r).toMatchObject({ score: 40, grade: 'HOT' });
    // Keyword matching is whole-word: "management trainee" is not "md"
    expect(scoreLead({ ...base, jobTitle: 'MD' }, DEFAULT_SCORING_SETTINGS, NOW).signals.some((s) => s.key === 'decisionMaker')).toBe(true);
    expect(scoreLead({ ...base, jobTitle: 'Cmdr' }, DEFAULT_SCORING_SETTINGS, NOW).signals.some((s) => s.key === 'decisionMaker')).toBe(false);
  });

  it('does not score unqualified or lost leads and is deterministic', () => {
    const lost = scoreLead({ ...base, phone: '+919847012345', status: 'LOST' }, DEFAULT_SCORING_SETTINGS, NOW);
    expect(lost).toMatchObject({ score: 0, grade: 'COLD' });
    expect(lost.signals[0]!.detail).toBe('Marked lost: not scored');
    const input = { ...base, phone: '1', status: 'QUALIFIED' };
    expect(scoreLead(input, DEFAULT_SCORING_SETTINGS, NOW)).toEqual(scoreLead(input, DEFAULT_SCORING_SETTINGS, NOW));
  });

  it('grades by thresholds', () => {
    expect([gradeFor(70, DEFAULT_SCORING_SETTINGS), gradeFor(69, DEFAULT_SCORING_SETTINGS), gradeFor(40, DEFAULT_SCORING_SETTINGS), gradeFor(39, DEFAULT_SCORING_SETTINGS)]).toEqual(['HOT', 'WARM', 'WARM', 'COLD']);
  });
});

describe('scoring settings and insights schemas', () => {
  it('validates settings and falls back to defaults', () => {
    expect(scoringSettingsSchema.safeParse({ hotThreshold: 40, warmThreshold: 50 }).success).toBe(false);
    expect(scoringSettingsSchema.safeParse({ weights: { source: 4 } }).success).toBe(false);
    expect(scoringSettingsSchema.safeParse({ weights: { nope: 1 } }).success).toBe(false);
    expect(resolveScoringSettings(null)).toEqual(DEFAULT_SCORING_SETTINGS);
    expect(resolveScoringSettings({ hotThreshold: 'x' })).toEqual(DEFAULT_SCORING_SETTINGS);
  });

  it('accepts AI insights and tolerates an unknown timing', () => {
    const v = leadInsightsOutputSchema.parse({ summary: 'S', nextBestAction: { action: 'CALL', reason: 'R', when: 'soonish' }, followUpMessage: { text: 'Hi' } });
    expect(v).toMatchObject({ nextBestAction: { when: 'this_week' }, talkingPoints: [], followUpMessage: { channel: 'whatsapp' } });
    expect(leadInsightsOutputSchema.safeParse({ summary: 'S', nextBestAction: { action: 'SPAM', reason: 'R' }, followUpMessage: { text: 'x' } }).success).toBe(false);
  });

  it('suggests due dates for next actions', () => {
    const now = new Date(2026, 10, 10, 9, 15);
    expect(dueFor('tomorrow', now)).toEqual(new Date(2026, 10, 11, 10, 0));
    expect(dueFor('next_week', now)).toEqual(new Date(2026, 10, 17, 10, 0));
    expect(dueFor('today', now)).toEqual(new Date(2026, 10, 10, 11, 0));
  });
});
