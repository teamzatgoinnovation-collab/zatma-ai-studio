import { describe, expect, it } from 'vitest';
import { newSlug } from './campaign-tracking.service.js';
import { sumByCurrency } from './campaigns.service.js';
import { mapMetaLead } from './campaigns.worker.js';

describe('campaign helpers', () => {
  it('maps Meta lead-form answers onto CRM fields', () => {
    expect(mapMetaLead({ full_name: 'Deepa  Nair Menon', email: ' Deepa@Example.IN ', phone_number: '+91 98470 00099', city: 'Kochi' })).toEqual({ firstName: 'Deepa', lastName: 'Nair Menon', email: 'deepa@example.in', phone: '+91 98470 00099', city: 'Kochi', company: null, jobTitle: null });
    expect(mapMetaLead({ first_name: 'Anu', last_name: 'K', company_name: 'ZatGo' })).toMatchObject({ firstName: 'Anu', lastName: 'K', company: 'ZatGo' });
    expect(mapMetaLead({})).toMatchObject({ firstName: 'Meta lead', lastName: null, email: null, phone: null });
  });

  it('sums money per currency without mixing currencies', () => {
    expect(sumByCurrency([
      { currency: 'INR', cents: 10_050n },
      { currency: 'AED', cents: 1_000n },
      { currency: 'INR', cents: 99_950n },
    ])).toEqual([
      { currency: 'AED', amount: '10.00' },
      { currency: 'INR', amount: '1100.00' },
    ]);
    expect(sumByCurrency([])).toEqual([]);
  });

  it('makes unambiguous random slugs', () => {
    const slugs = new Set(Array.from({ length: 500 }, () => newSlug()));
    expect(slugs.size).toBe(500);
    for (const s of slugs) expect(s).toMatch(/^[a-km-zA-HJ-NP-Z2-9]{8}$/);
  });
});
