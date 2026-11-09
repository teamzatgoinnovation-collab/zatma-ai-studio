import { describe, expect, it } from 'vitest';
import { brandKitSchema } from '@zatma/validation';
import { isDark } from '@/components/editor/editor';
import { EMPTY_KIT, toInput } from './brand-kit';
import { DESIGN_EXAMPLES, estimateCredits } from './generator';

describe('studio helpers', () => {
  it('turns empty brand kit fields into nulls that pass validation', () => {
    const input = toInput({ ...EMPTY_KIT, name: '  ZatGo  ', email: '', website: ' zatgo.com ' });
    expect(input).toMatchObject({ name: 'ZatGo', email: null, website: 'zatgo.com', phone: null });
    expect(brandKitSchema.safeParse(input).success).toBe(true);
  });

  it('includes the spec Malayalam example and estimates image credits', () => {
    expect(DESIGN_EXAMPLES[0]).toMatchObject({ language: 'ml' });
    expect(DESIGN_EXAMPLES[0]!.prompt).toContain('ZatGo Van Sales ERP');
    expect(estimateCredits(true)).toEqual({ min: 1, max: 6, image: 4 });
    expect(estimateCredits(false).image).toBe(0);
  });

  it('detects dark colours for readable default text', () => {
    expect(isDark('#0F172A')).toBe(true);
    expect(isDark('#FFFFFF')).toBe(false);
    expect(isDark('#1D4ED8')).toBe(true);
  });
});
