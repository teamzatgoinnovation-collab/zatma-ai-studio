import { describe, expect, it } from 'vitest';
import { dateOfEnd, dateOfStart, endFromDate, formatRange, moneyList, startFromDate } from './shared';

describe('campaign date helpers', () => {
  it('runs from the start of the first day to the end of the last day in the campaign time zone', () => {
    const start = startFromDate('2026-11-10', 'Asia/Kolkata');
    const end = endFromDate('2026-11-20', 'Asia/Kolkata');
    expect(start).toBe('2026-11-09T18:30:00.000Z');
    expect(end).toBe('2026-11-20T18:30:00.000Z');
    expect(dateOfStart(start, 'Asia/Kolkata')).toBe('2026-11-10');
    expect(dateOfEnd(end, 'Asia/Kolkata')).toBe('2026-11-20');
    expect(dateOfEnd(endFromDate('2026-12-31', 'Asia/Dubai'), 'Asia/Dubai')).toBe('2026-12-31');
  });
  it('formats ranges and money per currency', () => {
    expect(formatRange(null, null, 'Asia/Kolkata')).toBe('Dates not set');
    expect(formatRange(startFromDate('2026-11-10', 'Asia/Kolkata'), endFromDate('2026-11-20', 'Asia/Kolkata'), 'Asia/Kolkata')).toBe('10 Nov 2026 – 20 Nov 2026');
    expect(moneyList([])).toBe('–');
    expect(moneyList([{ currency: 'AED', amount: '10.00' }, { currency: 'INR', amount: '1500.00' }])).toMatch(/AED.*10.*\+.*₹1,500/);
  });
});
