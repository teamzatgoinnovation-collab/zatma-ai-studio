import { describe, expect, it } from 'vitest';
import type { BoardColumn, DealDto } from '@zatma/validation';
import { formatMoney, initials, moveOnBoard, queryString, relativeTime, toQuery } from './crm';

const deal = (id: string, stageId: string, value: number) => ({ id, stageId, stageName: stageId, value }) as DealDto;
const col = (id: string, deals: DealDto[]): BoardColumn => ({ stage: { id, name: id.toUpperCase(), order: 0, probability: 0, kind: 'OPEN' }, deals, count: deals.length, total: deals.reduce((s, d) => s + d.value, 0) });

describe('CRM helpers', () => {
  it('formats money with Indian grouping and other currencies', () => {
    expect(formatMoney(150000, 'INR')).toBe('₹1,50,000');
    expect(formatMoney(2500.5, 'AED')).toMatch(/AED\s?2,500\.50/);
    expect(formatMoney(1250000, 'INR', { compact: true })).toMatch(/₹12\.5L|₹1\.3M/);
  });

  it('builds clean query strings from filters', () => {
    expect(toQuery({ q: '', status: 'NEW', page: 2, favorite: true, none: undefined, off: false })).toEqual({ status: 'NEW', page: 2, favorite: 'true' });
    expect(queryString({ q: 'rahul nair', status: undefined })).toBe('?q=rahul+nair');
    expect(queryString({})).toBe('');
  });

  it('moves a deal between columns and keeps totals in sync', () => {
    const board = [col('a', [deal('1', 'a', 100), deal('2', 'a', 50)]), col('b', [deal('3', 'b', 10)])];
    const next = moveOnBoard(board, '1', 'b', '3');
    expect(next[0]).toMatchObject({ count: 1, total: 50 });
    expect(next[1]!.deals.map((d) => d.id)).toEqual(['1', '3']);
    expect(next[1]).toMatchObject({ count: 2, total: 110 });
    expect(next[1]!.deals[0]).toMatchObject({ stageId: 'b', stageName: 'B' });
    expect(moveOnBoard(board, '2', 'a', null)[0]!.deals.map((d) => d.id)).toEqual(['1', '2']);
    expect(moveOnBoard(board, 'missing', 'b', null)).toBe(board);
  });

  it('formats relative times and initials', () => {
    const now = Date.parse('2026-11-09T12:00:00Z');
    expect(relativeTime('2026-11-11T12:00:00Z', now)).toBe('in 2 days');
    expect(relativeTime('2026-11-09T09:00:00Z', now)).toBe('3 hours ago');
    expect(initials('Rahul Nair')).toBe('RN');
    expect(initials('')).toBe('?');
  });
});

describe('scoring helpers', () => {
  it('converts settings lists and labels weights', async () => {
    const { listToText, textToList, weightLabel } = await import('./crm');
    expect(textToList(' Retail, retail ,\nBakery,, ')).toEqual(['Retail', 'Bakery']);
    expect(listToText(['Kochi', 'Dubai'])).toBe('Kochi, Dubai');
    expect([weightLabel(0), weightLabel(1), weightLabel(2), weightLabel(1.5)]).toEqual(['Off', 'Normal', '2×', '1.5×']);
  });
});
