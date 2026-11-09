import { describe, expect, it } from 'vitest';
import { safeRedirect } from './redirect';

describe('safeRedirect', () => {
  it('allows same-site relative paths', () => {
    expect(safeRedirect('/accept-invitation/abc')).toBe('/accept-invitation/abc');
  });
  it('rejects absolute, protocol-relative and backslash URLs', () => {
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '', null, undefined]) {
      expect(safeRedirect(bad)).toBe('/dashboard');
    }
    expect(safeRedirect('//x', '/onboarding/organization')).toBe('/onboarding/organization');
  });
});
