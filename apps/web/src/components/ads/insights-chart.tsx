'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { AdInsightPoint } from '@zatma/validation';
import { money } from './shared';

const H = 220;
const PAD = { top: 12, right: 12, bottom: 28, left: 56 };

/** Nice round axis maximum and 4 ticks. */
function ticks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  return Array.from({ length: 5 }, (_, i) => i * step);
}

/**
 * Daily spend as columns (one series: no legend, the title names it). Each column is a hover/focus target with a
 * tooltip; marks follow the shared spec: ≤ 24 px wide, 4 px rounded top, square at the baseline, 2 px gaps, hairline grid.
 */
export function SpendChart({ days, currency }: { days: AdInsightPoint[]; currency: string }) {
  const [hover, setHover] = useState<number | null>(null);
  // Render at the real pixel width so marks and text keep their specified sizes (no viewBox scaling).
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const values = days.map((d) => Number(d.spend));
  const axis = useMemo(() => ticks(Math.max(0, ...values)), [values]);
  const top = axis.at(-1)!;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const band = innerW / Math.max(1, days.length);
  const barW = Math.max(2, Math.min(24, band - 2));
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH;
  const fmtAxis = (v: number) => new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
  const label = (d: AdInsightPoint) => new Date(`${d.date}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const h = hover !== null ? days[hover] : null;
  // Date labels at least ~64 px apart; the last day is labelled only when it doesn't crowd the previous label.
  const every = Math.max(1, Math.ceil(64 / band));
  const showLabel = (i: number) => (i % every === 0 && days.length - 1 - i >= every / 2) || i === days.length - 1;

  return (
    <div className="relative" ref={box}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block max-w-full" role="group" aria-label={`Daily spend, ${days.length} days. Each column can be focused for its values.`}>
        {axis.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px]">
              {fmtAxis(t)}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const v = Number(d.spend);
          const x = PAD.left + i * band + (band - barW) / 2;
          const yy = y(v);
          const bh = Math.max(0, PAD.top + innerH - yy);
          const r = Math.min(4, barW / 2, bh);
          const path = bh > 0 ? `M${x},${PAD.top + innerH} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + barW - r} Q${x + barW},${yy} ${x + barW},${yy + r} V${PAD.top + innerH} Z` : '';
          return (
            <g key={d.date}>
              {path && <path d={path} className={hover === i ? 'fill-primary/80' : 'fill-primary'} />}
              {/* Hit target: the whole column band, larger than the mark */}
              <rect
                x={PAD.left + i * band}
                y={PAD.top}
                width={band}
                height={innerH}
                fill="transparent"
                tabIndex={0}
                role="button"
                aria-label={`${label(d)}: ${money(d.spend, currency)} spent, ${d.clicks} clicks`}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                className="cursor-default outline-none focus-visible:stroke-ring focus-visible:stroke-2"
              />
            </g>
          );
        })}
        <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + innerH} y2={PAD.top + innerH} className="stroke-border" strokeWidth={1} />
        {days.map((d, i) =>
          showLabel(i) ? (
            <text key={d.date} x={PAD.left + i * band + band / 2} y={H - 8} textAnchor="middle" className="fill-muted-foreground text-[11px]">
              {label(d)}
            </text>
          ) : null,
        )}
      </svg>
      {h && hover !== null && (
        <div
          role="status"
          className="pointer-events-none absolute top-0 z-10 rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md"
          style={{ left: `${Math.min(80, Math.max(0, ((PAD.left + hover * band) / W) * 100))}%` }}
        >
          <p className="font-medium">{label(h)}</p>
          <p>Spend {money(h.spend, currency)}</p>
          <p className="text-muted-foreground">
            {h.impressions.toLocaleString('en-IN')} impressions · {h.clicks.toLocaleString('en-IN')} clicks{h.leads ? ` · ${h.leads} leads` : ''}
          </p>
        </div>
      )}
    </div>
  );
}
