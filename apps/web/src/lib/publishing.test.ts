import { describe, expect, it } from 'vitest';
import { addDays, fromLocalInput, groupByDay, monthGrid, moveToDay, shiftAnchor, toLocalInput, todayKey, viewRange, weekStart } from './publishing';

describe('calendar math', () => {
  it('builds Monday-first month grids', () => {
    const grid = monthGrid('2026-12-15');
    expect(grid[0]![0]).toEqual({ key: '2026-11-30', inMonth: false });
    expect(grid[0]![1]).toEqual({ key: '2026-12-01', inMonth: true });
    expect(grid.at(-1)!.at(-1)!.key).toBe('2027-01-03');
    expect(grid).toHaveLength(5);
    expect(monthGrid('2026-02-01')[0]![0]!.key).toBe('2026-01-26');
  });

  it('computes fetch ranges as whole days in the org time zone', () => {
    expect(viewRange('day', '2026-12-01', 'Asia/Kolkata')).toMatchObject({ from: '2026-11-30T18:30:00.000Z', to: '2026-12-01T18:30:00.000Z', days: ['2026-12-01'] });
    const week = viewRange('week', '2026-12-03', 'Asia/Dubai');
    expect(week.days[0]).toBe('2026-11-30');
    expect([week.from, week.to]).toEqual(['2026-11-29T20:00:00.000Z', '2026-12-06T20:00:00.000Z']);
    expect(weekStart('2026-12-06')).toBe('2026-11-30');
    expect(shiftAnchor('month', '2026-12-15', 1)).toBe('2027-01-01');
    expect(shiftAnchor('week', '2026-12-15', -1)).toBe('2026-12-08');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('keeps the wall-clock time when moving a post to another day', () => {
    // 10:30 IST on 1 Dec → 10:30 IST on 3 Dec
    expect(moveToDay('2026-12-01T05:00:00.000Z', 'Asia/Kolkata', '2026-12-03')).toBe('2026-12-03T05:00:00.000Z');
  });

  it('round-trips datetime-local values in a time zone', () => {
    expect(toLocalInput('2026-12-01T05:00:00.000Z', 'Asia/Kolkata')).toBe('2026-12-01T10:30');
    expect(fromLocalInput('2026-12-01T10:30', 'Asia/Kolkata')).toBe('2026-12-01T05:00:00.000Z');
    expect(fromLocalInput('2026-12-01T10:30', 'Asia/Dubai')).toBe('2026-12-01T06:30:00.000Z');
  });

  it('groups entries by day in the org time zone', () => {
    const g = groupByDay([{ at: '2026-11-30T20:00:00Z' }, { at: '2026-11-30T10:00:00Z' }], 'Asia/Kolkata');
    expect(Object.keys(g)).toEqual(['2026-11-30', '2026-12-01']);
    expect(todayKey('Asia/Kolkata', new Date('2026-11-30T19:00:00Z'))).toBe('2026-12-01');
  });
});
