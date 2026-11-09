import { describe, expect, it } from 'vitest';
import { backgroundImagePrompt, BriefParseError, briefSystemPrompt, briefUserPrompt, parseBrief } from './brief.js';

describe('design brief', () => {
  it('parses JSON wrapped in fences and prose, normalising hashtags', () => {
    const b = parseBrief('Here you go:\n```json\n{"headline":"ഓണം ഓഫർ","cta":"ഇപ്പോൾ വാങ്ങൂ","hashtags":["Onam","#Kerala Sale"],"layout":"hero-center"}\n```');
    expect(b).toMatchObject({ headline: 'ഓണം ഓഫർ', cta: 'ഇപ്പോൾ വാങ്ങൂ', hashtags: ['#Onam', '#KeralaSale'], layout: 'hero-center', body: '' });
  });

  it('ignores invalid optional fields instead of failing', () => {
    const b = parseBrief('{"headline":"Sale","layout":"diagonal","palette":{"primary":"blue"}}');
    expect(b.layout).toBeUndefined();
    expect(b.palette?.primary).toBeUndefined();
  });

  it('rejects missing headline or non-JSON output', () => {
    expect(() => parseBrief('{"cta":"Buy"}')).toThrow(BriefParseError);
    expect(() => parseBrief('Sorry, I cannot help')).toThrow(/no JSON object/);
    expect(() => parseBrief('{"headline": "x",}')).toThrow(/malformed/);
  });

  it('asks for native-script copy, no invented facts and text-free backgrounds', () => {
    expect(briefSystemPrompt()).toMatch(/NO text/);
    expect(briefSystemPrompt()).toMatch(/Never invent prices/);
    const u = briefUserPrompt({ prompt: 'Onam sale', language: 'ml', platform: 'Instagram Post', width: 1080, height: 1080, brand: { name: 'ZatGo', tagline: null, guidelines: 'Blue tones', website: 'zatgo.in' } });
    expect(u).toContain('Malayalam (native script)');
    expect(u).toContain('Brand guidelines: Blue tones');
    expect(backgroundImagePrompt({ backgroundPrompt: 'a supermarket aisle' } as never, 'x')).toMatch(/^a supermarket aisle[\s\S]*no text/);
  });
});
