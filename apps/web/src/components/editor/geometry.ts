/** Scale that fits a `docW`×`docH` canvas inside a viewport with padding. */
export function fitScale(docW: number, docH: number, viewW: number, viewH: number, padding = 48): number {
  const s = Math.min((viewW - padding * 2) / docW, (viewH - padding * 2) / docH);
  return Math.max(0.05, Math.min(4, Number.isFinite(s) && s > 0 ? s : 0.1));
}

export const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3];

export function nextZoom(current: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((z) => z > current + 0.001) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]!;
  return [...ZOOM_STEPS].reverse().find((z) => z < current - 0.001) ?? ZOOM_STEPS[0]!;
}

export interface SnapResult {
  value: number;
  guide: number | null;
}

/**
 * Snaps a box edge/centre to the nearest target (canvas edges and centre) within `threshold`.
 * `start` is the box's leading edge, `size` its extent along the axis.
 */
export function snapAxis(start: number, size: number, targets: number[], threshold: number): SnapResult {
  let best: SnapResult = { value: start, guide: null };
  let bestDist = threshold + 1;
  for (const t of targets) {
    for (const [offset] of [[0], [size / 2], [size]] as const) {
      const d = Math.abs(start + offset - t);
      if (d <= threshold && d < bestDist) {
        bestDist = d;
        best = { value: Math.round(t - offset), guide: t };
      }
    }
  }
  return best;
}

/** Pixel ratio that renders a stage shown at `scale` back to the document's native size. */
export function exportPixelRatio(scale: number, targetWidth?: number, docWidth?: number): number {
  if (targetWidth && docWidth) return targetWidth / docWidth / scale;
  return 1 / scale;
}

/** Source crop that makes an image "cover" a box (like CSS object-fit: cover). */
export function coverCrop(imgW: number, imgH: number, boxW: number, boxH: number): { x: number; y: number; width: number; height: number } {
  const scale = Math.max(boxW / imgW, boxH / imgH);
  const width = boxW / scale;
  const height = boxH / scale;
  return { x: (imgW - width) / 2, y: (imgH - height) / 2, width, height };
}

/** Size and offset that make an image "contain" inside a box. */
export function containBox(imgW: number, imgH: number, boxW: number, boxH: number): { x: number; y: number; width: number; height: number } {
  const scale = Math.min(boxW / imgW, boxH / imgH);
  const width = imgW * scale;
  const height = imgH * scale;
  return { x: (boxW - width) / 2, y: (boxH - height) / 2, width, height };
}
