import { describe, expect, it } from 'vitest';
import { HttpStatus } from '@nestjs/common';
import { AppException } from '../common/errors.js';
import { MissingTenantError } from '../common/tenant-context.js';
import { isTransient } from './automation-actions.js';
import { matchesTrigger, pickRoundRobin } from './triggers.js';

describe('matchesTrigger', () => {
  it('filters new leads by source (no filter matches all)', () => {
    expect(matchesTrigger('lead.created', {}, { source: 'website' })).toBe(true);
    expect(matchesTrigger('lead.created', { sources: ['meta_ads'] }, { source: 'meta_ads' })).toBe(true);
    expect(matchesTrigger('lead.created', { sources: ['meta_ads'] }, { source: 'website' })).toBe(false);
    expect(matchesTrigger('lead.created', { sources: ['meta_ads'] }, {})).toBe(false);
  });
  it('filters status changes by from and to', () => {
    expect(matchesTrigger('lead.status_changed', { to: ['QUALIFIED'] }, { from: 'NEW', to: 'QUALIFIED' })).toBe(true);
    expect(matchesTrigger('lead.status_changed', { to: ['QUALIFIED'] }, { from: 'NEW', to: 'LOST' })).toBe(false);
    expect(matchesTrigger('lead.status_changed', { from: ['NEW'], to: ['QUALIFIED'] }, { from: 'CONTACTED', to: 'QUALIFIED' })).toBe(false);
    expect(matchesTrigger('lead.status_changed', {}, { from: 'NEW', to: 'LOST' })).toBe(true);
  });
  it('filters by campaign and by deal value', () => {
    const cid = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
    expect(matchesTrigger('campaign.interaction', { campaignId: cid }, { campaignId: cid })).toBe(true);
    expect(matchesTrigger('campaign.interaction', { campaignId: cid }, { campaignId: 'other' })).toBe(false);
    expect(matchesTrigger('form.submitted', {}, {})).toBe(true);
    expect(matchesTrigger('deal.won', { minValue: 1000 }, { value: 999 })).toBe(false);
    expect(matchesTrigger('deal.won', { minValue: 1000 }, { value: 1000 })).toBe(true);
    expect(matchesTrigger('deal.lost', {}, {})).toBe(true);
  });
  it('an invalid trigger config never matches', () => {
    expect(matchesTrigger('contact.inactive', { days: 0 }, {})).toBe(false);
  });
});

describe('pickRoundRobin', () => {
  it('rotates through everyone in order and wraps', () => {
    const ids = ['a', 'b', 'c'];
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => pickRoundRobin(ids, i))).toEqual(['a', 'b', 'c', 'a', 'b', 'c', 'a']);
    expect(pickRoundRobin(['solo'], 41)).toBe('solo');
    expect(() => pickRoundRobin([], 0)).toThrow();
  });
});

describe('isTransient', () => {
  it('retries server errors, rate limits and unknown failures, but not our own validation or permission errors', () => {
    expect(isTransient(new Error('socket hang up'))).toBe(true);
    expect(isTransient(new AppException(HttpStatus.BAD_GATEWAY, 'AI_FAILED', 'Provider down'))).toBe(true);
    expect(isTransient(new AppException(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', 'Slow down'))).toBe(true);
    expect(isTransient(new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'MEMBER_NOT_FOUND', 'Gone'))).toBe(false);
    expect(isTransient(new AppException(HttpStatus.FORBIDDEN, 'CANNOT_ASSIGN', 'No'))).toBe(false);
    expect(isTransient(new AppException(HttpStatus.PAYMENT_REQUIRED, 'AI_CREDITS', 'No credits'))).toBe(false);
    expect(isTransient(new MissingTenantError())).toBe(false);
  });
});
