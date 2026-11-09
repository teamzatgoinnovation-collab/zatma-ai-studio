import { describe, expect, it } from 'vitest';
import { describeActivity, timeAgo, unreadCount } from './activity';

describe('activity helpers', () => {
  it('describes known and unknown actions', () => {
    expect(describeActivity({ action: 'member.invited', actorName: 'Zain' })).toBe('Zain invited a teammate');
    expect(describeActivity({ action: 'crm.lead_created', actorName: null })).toBe('System crm lead created');
  });

  it('formats relative times', () => {
    const now = Date.parse('2026-11-09T12:00:00Z');
    expect(timeAgo('2026-11-09T11:59:30Z', now)).toBe('just now');
    expect(timeAgo('2026-11-09T11:55:00Z', now)).toBe('5m ago');
    expect(timeAgo('2026-11-09T09:00:00Z', now)).toBe('3h ago');
    expect(timeAgo('2026-11-07T12:00:00Z', now)).toBe('2d ago');
  });

  it('counts entries newer than the last seen marker', () => {
    const entries = [{ createdAt: '2026-11-09T10:00:00Z' }, { createdAt: '2026-11-09T09:00:00Z' }, { createdAt: '2026-11-09T08:00:00Z' }];
    expect(unreadCount(entries, null)).toBe(3);
    expect(unreadCount(entries, '2026-11-09T09:00:00Z')).toBe(1);
    expect(unreadCount(entries, '2026-11-09T10:00:00Z')).toBe(0);
  });
});
