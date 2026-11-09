import { describe, expect, it } from 'vitest';
import { containBox, coverCrop, exportPixelRatio, fitScale, nextZoom, snapAxis, ZOOM_STEPS } from './geometry';

describe('editor geometry', () => {
  it('fits a canvas into the viewport with padding', () => {
    expect(fitScale(1080, 1080, 600, 600, 50)).toBeCloseTo(500 / 1080);
    expect(fitScale(1080, 1920, 1000, 700, 50)).toBeCloseTo(600 / 1920);
    expect(fitScale(1080, 1080, 0, 0)).toBeGreaterThan(0);
  });

  it('steps zoom through the presets and clamps at the ends', () => {
    expect(nextZoom(0.5, 1)).toBe(0.67);
    expect(nextZoom(0.5, -1)).toBe(0.33);
    expect(nextZoom(0.42, 1)).toBe(0.5);
    expect(nextZoom(ZOOM_STEPS.at(-1)!, 1)).toBe(ZOOM_STEPS.at(-1));
    expect(nextZoom(ZOOM_STEPS[0]!, -1)).toBe(ZOOM_STEPS[0]);
  });

  it('snaps leading edge, centre and trailing edge to targets', () => {
    const targets = [0, 500, 1000];
    expect(snapAxis(4, 100, targets, 8)).toEqual({ value: 0, guide: 0 });
    expect(snapAxis(447, 100, targets, 8)).toEqual({ value: 450, guide: 500 }); // centre 497 → 500
    expect(snapAxis(895, 100, targets, 8)).toEqual({ value: 900, guide: 1000 }); // right edge 995 → 1000
    expect(snapAxis(200, 100, targets, 8)).toEqual({ value: 200, guide: null });
  });

  it('exports at native resolution regardless of zoom', () => {
    expect(exportPixelRatio(0.5)).toBe(2);
    expect(exportPixelRatio(0.25) * 1080 * 0.25).toBe(1080);
    expect(exportPixelRatio(0.5, 480, 1080) * 1080 * 0.5).toBeCloseTo(480);
  });

  it('computes cover crops and contain boxes', () => {
    expect(coverCrop(2000, 1000, 500, 500)).toEqual({ x: 500, y: 0, width: 1000, height: 1000 });
    expect(containBox(2000, 1000, 500, 500)).toEqual({ x: 0, y: 125, width: 500, height: 250 });
  });
});
