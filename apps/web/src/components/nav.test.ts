import { describe, expect, it } from 'vitest';
import { activeSectionId, allNavEntries, breadcrumbsFor, findNavEntry, NAV } from './nav';

describe('navigation config', () => {
  it('has unique, absolute hrefs', () => {
    const hrefs = allNavEntries().map((e) => e.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const h of hrefs) expect(h).toMatch(/^\/[a-z0-9/-]*$/);
  });

  it('covers every module from the product spec', () => {
    const labels = NAV.map((s) => s.label);
    expect(labels).toEqual(['Dashboard', 'AI Studio', 'CRM', 'Marketing', 'Advertising', 'Analytics', 'AI Assistant', 'Team', 'Billing', 'Settings']);
    const crm = NAV.find((s) => s.id === 'crm')!.children!.map((c) => c.label);
    expect(crm).toEqual(['Leads', 'Contacts', 'Companies', 'Customers', 'Deals', 'Sales Pipeline', 'Activities', 'Follow-ups']);
  });

  it('marks live modules without a phase and planned ones with one', () => {
    const live = ['/dashboard', '/studio', '/studio/design', '/studio/posters', '/studio/templates', '/studio/brand-kit', '/studio/copywriter', '/crm', '/crm/leads', '/crm/contacts', '/crm/companies', '/crm/customers', '/crm/deals', '/crm/pipeline', '/crm/activities', '/crm/follow-ups', '/marketing', '/marketing/campaigns', '/marketing/accounts', '/marketing/social', '/marketing/calendar', '/ads', '/ads/meta', '/ads/google', '/ads/campaigns', '/team', '/billing', '/settings'];
    for (const href of live) expect(findNavEntry(href), href).toBeTruthy();
    for (const e of allNavEntries().filter((e) => live.includes(e.href))) expect(e.phase, e.href).toBeUndefined();
    for (const e of allNavEntries().filter((e) => !live.includes(e.href))) {
      expect(e.phase, e.href).toBeGreaterThanOrEqual(3);
    }
  });

  it('builds breadcrumbs from the tree', () => {
    expect(breadcrumbsFor('/crm/leads')).toEqual([
      { label: 'CRM', href: '/crm' },
      { label: 'Leads', href: '/crm/leads' },
    ]);
    expect(breadcrumbsFor('/crm')).toEqual([{ label: 'CRM', href: '/crm' }]);
    expect(breadcrumbsFor('/settings')).toEqual([{ label: 'Settings', href: '/settings' }]);
    expect(breadcrumbsFor('/unknown')).toEqual([]);
  });

  it('does not treat a shared prefix as a match', () => {
    expect(activeSectionId('/crm-something')).toBeNull();
    expect(activeSectionId('/crm/deals')).toBe('crm');
    expect(activeSectionId('/ads/meta')).toBe('advertising');
  });

  it('resolves module pages by exact path only', () => {
    expect(findNavEntry('/studio/brand-kit')?.leaf?.label).toBe('Brand Kit');
    expect(findNavEntry('/studio')?.section.id).toBe('studio');
    expect(findNavEntry('/studio/brand-kit/extra')).toBeNull();
    expect(findNavEntry('/crm/nope')).toBeNull();
  });
});
