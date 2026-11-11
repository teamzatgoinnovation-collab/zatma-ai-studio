import { describe, expect, it } from 'vitest';
import type { SocialAccountDto } from '@zatma/validation';
import { oauthErrorMessage, sortAccounts, workspaceSummary } from './helpers';

const acct = (name: string, status: SocialAccountDto['status']) => ({ name, status }) as SocialAccountDto;

describe('social helpers', () => {
  it('maps OAuth error codes to friendly messages', () => {
    expect(oauthErrorMessage(null)).toBeNull();
    expect(oauthErrorMessage('access_denied')).toContain('cancelled');
    expect(oauthErrorMessage('weird')).toContain('Something went wrong');
  });
  it('summarises workspaces', () => {
    const ws = [
      { id: 'a', name: 'Kochi' },
      { id: 'b', name: 'Dubai' },
    ];
    expect(workspaceSummary([], ws)).toBe('All workspaces');
    expect(workspaceSummary(['b', 'a'], ws)).toBe('Dubai, Kochi');
    expect(workspaceSummary(['gone'], ws)).toBe('All workspaces');
  });
  it('puts accounts that need attention first', () => {
    expect(sortAccounts([acct('B', 'ACTIVE'), acct('A', 'ACTIVE'), acct('Z', 'NEEDS_REAUTH'), acct('Y', 'ERROR')]).map((a) => a.name)).toEqual(['Z', 'Y', 'A', 'B']);
  });
});
