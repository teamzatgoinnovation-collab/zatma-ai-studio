import { describe, expect, it } from 'vitest';
import { checkLimits, REWRITE_ACTIONS } from '@zatma/validation';
import { clipboardText, limitStatus, REWRITE_MENU, textDirection, titleCase } from './copy-helpers';

describe('copywriter helpers', () => {
  it('describes lengths against platform limits', () => {
    expect(limitStatus(checkLimits('ad_headline', 'meta_ads', 'Free trial'))).toEqual({ label: '10 / 40', tone: 'neutral', detail: null });
    expect(limitStatus(checkLimits('ad_headline', 'meta_ads', 'x'.repeat(45)))).toMatchObject({ tone: 'warning', detail: 'Longer than the recommended 40' });
    expect(limitStatus(checkLimits('ad_headline', 'google_ads', 'x'.repeat(31)))).toMatchObject({ label: '31 / 30', tone: 'danger', detail: 'Over the 30-character platform limit' });
    expect(limitStatus(checkLimits('hashtags', 'generic', '#a #b')).label).toBe('5 characters');
    expect(limitStatus(checkLimits('sms', 'sms', 'ഓണം ഓഫർ')).detail).toBe('1 SMS segment (UCS-2)');
    const tags = Array.from({ length: 31 }, (_, i) => `#t${i}`);
    expect(limitStatus(checkLimits('caption', 'instagram', 'Hi', tags)).detail).toContain('31 hashtags; the platform allows 30');
  });

  it('sets text direction by language', () => {
    expect(textDirection('ar')).toBe('rtl');
    expect(textDirection('ml')).toBe('ltr');
  });

  it('offers every rewrite action except custom in the menu', () => {
    expect(REWRITE_MENU.map((m) => m.action)).toEqual(REWRITE_ACTIONS.filter((a) => a !== 'custom'));
    expect(REWRITE_MENU[0]).toEqual({ action: 'shorter', label: 'Make shorter' });
  });

  it('formats labels and clipboard text', () => {
    expect(titleCase('ad_primary_text')).toBe('Ad primary text');
    expect(clipboardText('Hello', ['#a', '#b'])).toBe('Hello\n\n#a #b');
    expect(clipboardText('Hello', [])).toBe('Hello');
  });
});
