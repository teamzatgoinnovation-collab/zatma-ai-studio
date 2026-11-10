import { describe, expect, it } from 'vitest';
import { activityLines, insightsSystemPrompt, insightsUserPrompt } from './crm-ai.service.js';

describe('CRM AI prompts', () => {
  it('summarises activity history factually, flagging overdue items', () => {
    const now = new Date('2026-11-10T12:00:00Z');
    const lines = activityLines(
      [
        { type: 'FOLLOW_UP', subject: 'Send quote', body: null, createdAt: new Date('2026-11-01'), dueAt: new Date('2026-11-05'), completedAt: null },
        { type: 'WHATSAPP', subject: 'Sent brochure', body: 'Asked about 3 vans', createdAt: new Date('2026-11-09'), dueAt: null, completedAt: new Date('2026-11-09') },
      ],
      now,
    );
    expect(lines).toBe('- due 2026-11-05 (overdue) · FOLLOW_UP · Send quote\n- 2026-11-09 · WHATSAPP · Sent brochure: Asked about 3 vans');
    expect(activityLines([])).toBe('No activity yet.');
  });

  it('builds a grounded prompt in the requested language', () => {
    const p = insightsUserPrompt(
      { name: 'Rahul Nair', jobTitle: 'MD', company: 'Nair Traders', industry: null, city: 'Kochi', country: null, source: 'referral', status: 'QUALIFIED', notes: null, hasWhatsapp: true, hasEmail: false, score: 57, grade: 'WARM', signals: [{ key: 'source', label: 'Source quality', points: 12, detail: 'Source: referral' }] },
      'No activity yet.',
      'ar',
      { name: 'ZatGo', tagline: null, website: 'zatgo.com', phone: null, whatsapp: '+91 98765 43210', email: null, address: null, guidelines: 'No slang' },
    );
    expect(p).toContain('Lead: Rahul Nair, MD at Nair Traders');
    expect(p).toContain('Reachable on: WhatsApp');
    expect(p).toContain('Score: 57 (WARM). Signals: Source quality +12 (Source: referral)');
    expect(p).toContain('Arabic');
    expect(p).toContain('ZatGo · zatgo.com · WhatsApp +91 98765 43210');
    expect(p).toContain('Brand guidelines: No slang');
    expect(insightsSystemPrompt()).toContain('Never invent prices');
  });
});
