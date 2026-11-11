'use client';

import { useEffect, useRef, useState } from 'react';
import type { DesignDetail } from '@zatma/validation';
import { DesignCanvas, type DesignCanvasHandle } from '@/components/editor/design-canvas';
import { dataUrlToBlob } from '@/components/editor/export';
import { loadFonts } from '@/components/editor/fonts';

const noop = () => undefined;

function preload(url: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = url;
  });
}

/**
 * Renders a saved design off-screen at its native size and returns it as a JPEG (Instagram accepts JPEG only).
 * Fonts and images are loaded first so the export matches the editor. Loaded with `next/dynamic` (Konva needs `window`).
 */
export default function DesignRenderer({ design, onDone, onError }: { design: DesignDetail; onDone: (blob: Blob) => void; onError: (e: Error) => void }) {
  const ref = useRef<DesignCanvasHandle>(null);
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    let alive = true;
    const specs = [...new Map(design.document.layers.flatMap((l) => (l.type === 'text' ? [[`${l.fontFamily}|${l.fontWeight}`, { family: l.fontFamily, weight: l.fontWeight }] as const] : []))).values()];
    void Promise.all([loadFonts(specs), ...Object.values(design.assets).map(preload)]).then(() => alive && setEpoch(1));
    return () => {
      alive = false;
    };
  }, [design]);

  useEffect(() => {
    if (!epoch) return;
    // Images inside the canvas load from the browser cache after mount; give them a moment to draw.
    const t = window.setTimeout(() => {
      try {
        onDone(dataUrlToBlob(ref.current!.toDataURL({ mimeType: 'image/jpeg', quality: 0.92 })));
      } catch (e) {
        onError(e as Error);
      }
    }, 700);
    return () => window.clearTimeout(t);
  }, [epoch, onDone, onError]);

  return (
    <div aria-hidden="true" style={{ position: 'fixed', left: -100_000, top: 0, pointerEvents: 'none' }}>
      <DesignCanvas ref={ref} doc={design.document} assets={design.assets} scale={0.1} selectedId={null} showGrid={false} readOnly fontEpoch={epoch} onSelect={noop} onChange={noop} onEditText={noop} />
    </div>
  );
}
