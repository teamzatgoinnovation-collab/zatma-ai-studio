import { describe, expect, it } from 'vitest';
import { addSocialAccountsSchema, connectSocialSchema } from './social.js';

describe('social schemas', () => {
  it('only accepts same-site return paths', () => {
    expect(connectSocialSchema.safeParse({ returnTo: '/marketing/accounts' }).success).toBe(true);
    expect(connectSocialSchema.safeParse({ returnTo: '/marketing/accounts?x=1' }).success).toBe(true);
    expect(connectSocialSchema.safeParse({ returnTo: '//evil.example' }).success).toBe(false);
    expect(connectSocialSchema.safeParse({ returnTo: 'https://evil.example' }).success).toBe(false);
    expect(connectSocialSchema.safeParse({ returnTo: '/a b' }).success).toBe(false);
  });

  it('validates account selection', () => {
    expect(addSocialAccountsSchema.parse({ connectionId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', externalIds: ['123'] }).workspaceIds).toEqual([]);
    expect(addSocialAccountsSchema.safeParse({ connectionId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', externalIds: [] }).success).toBe(false);
  });
});
