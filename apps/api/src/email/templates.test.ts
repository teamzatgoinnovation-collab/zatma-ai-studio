import { describe, expect, it } from 'vitest';
import { emailTemplates, escapeHtml } from './templates.js';

describe('email templates', () => {
  it('escapes user-controlled values in HTML', () => {
    const t = emailTemplates.invitation({ inviterName: '<script>alert(1)</script>', organizationName: 'A & B "Co"', roleLabel: 'Viewer', url: 'https://x.test/accept?a=1&b=2' });
    expect(t.html).not.toContain('<script>');
    expect(t.html).toContain('&lt;script&gt;');
    expect(t.html).toContain('A &amp; B &quot;Co&quot;');
    expect(t.html).toContain('https://x.test/accept?a=1&amp;b=2');
    expect(t.text).toContain('https://x.test/accept?a=1&b=2');
  });

  it('produces subject, html, text and tag for every template', () => {
    const all = [
      emailTemplates.verifyEmail({ name: 'Z', url: 'https://x' }),
      emailTemplates.resetPassword({ name: 'Z', url: 'https://x' }),
      emailTemplates.deleteAccount({ name: 'Z', url: 'https://x' }),
      emailTemplates.trialEnding({ organizationName: 'O', planName: 'Pro', daysLeft: 1, url: 'https://x' }),
      emailTemplates.paymentFailed({ organizationName: 'O', planName: 'Pro', url: 'https://x' }),
    ];
    for (const t of all) {
      expect(t.subject.length).toBeGreaterThan(5);
      expect(t.html).toContain('<!doctype html>');
      expect(t.text).toContain('https://x');
      expect(t.tag).toMatch(/^[a-z-]+$/);
    }
    expect(all[3]!.subject).toBe('Your Pro trial ends in 1 day');
  });

  it('escapes all special characters', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});
