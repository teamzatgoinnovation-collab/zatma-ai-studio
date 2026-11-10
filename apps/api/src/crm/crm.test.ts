import { describe, expect, it } from 'vitest';
import { permissionsForRole, type OrgRole } from '@zatma/types';
import { TenantContext } from '../common/tenant-context.js';
import { startOfDayInZone } from './activities.service.js';
import { ownerScope, positionBetween, seesAllRecords } from './crm-common.js';
import { mapSource, rowToRecord } from './import.service.js';

const as = <T>(role: OrgRole, fn: () => T) => TenantContext.run({ organizationId: 'org', userId: 'u1', role, permissions: permissionsForRole(role) }, fn);

describe('CRM record visibility', () => {
  it('limits Sales Agents to their own records and lets managers and read-only roles see all', () => {
    expect(as('SALES_AGENT', () => [seesAllRecords(), ownerScope()])).toEqual([false, { ownerId: 'u1' }]);
    for (const role of ['ORGANIZATION_OWNER', 'ADMIN', 'CRM_MANAGER', 'VIEWER', 'ANALYST', 'MARKETING_MANAGER'] as const) {
      expect(as(role, () => ownerScope()), role).toEqual({});
    }
  });
});

describe('Kanban positions', () => {
  it('places cards between neighbours and signals when renumbering is needed', () => {
    expect(positionBetween(null, null)).toBe(1000);
    expect(positionBetween(null, 1000)).toBe(0);
    expect(positionBetween(3000, null)).toBe(4000);
    expect(positionBetween(1000, 2000)).toBe(1500);
    expect(positionBetween(1, 1 + 1e-7)).toBeNull();
  });
});

describe('import helpers', () => {
  it('maps CSV cells to fields, ignoring blanks and unmapped columns', () => {
    expect(rowToRecord(['Name', 'Mobile', 'Junk', 'Email'], ['Rahul', ' 98765 43210 ', 'x', ''], { Name: 'firstName', Mobile: 'phone', Junk: null, Email: 'email' })).toEqual({ firstName: 'Rahul', phone: '98765 43210' });
  });

  it('maps source labels to known sources', () => {
    expect(mapSource('Google Ads', 'import')).toEqual({ source: 'google_ads' });
    expect(mapSource('Walk-in', 'import')).toEqual({ source: 'walk_in' });
    expect(mapSource('Trade fair Dubai', 'import')).toEqual({ source: 'other', sourceDetail: 'Trade fair Dubai' });
    expect(mapSource(undefined, 'import')).toEqual({ source: 'import' });
  });
});

describe('time zones', () => {
  it('finds local midnight in a time zone', () => {
    const t = new Date('2026-11-09T20:00:00Z'); // 01:30 on 10 Nov in Kolkata, 00:00 on 10 Nov in Dubai
    expect(startOfDayInZone(t, 'Asia/Kolkata').toISOString()).toBe('2026-11-09T18:30:00.000Z');
    expect(startOfDayInZone(t, 'Asia/Dubai').toISOString()).toBe('2026-11-09T20:00:00.000Z');
    expect(startOfDayInZone(t, 'UTC').toISOString()).toBe('2026-11-09T00:00:00.000Z');
  });
});
