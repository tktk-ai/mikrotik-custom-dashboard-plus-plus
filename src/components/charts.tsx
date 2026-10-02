import React, { useMemo, useState } from 'react';
import clsx from 'clsx';
import { fmtBitrate, fmtBytes, fmtNumber } from '../lib/format';

/** Lightweight SVG charts — no chart library, fully themable. */

const path = (points: Array<[number, number]>) =>
  points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');

export const Sparkline: React.FC<{ data: number[]; tone?: string; height?: number; className?: string; fill?: boolean }> = ({ data, tone = 'brand', height = 34, className, fill = true }) => {
  if (!data?.length) return <div className={clsx('h-[34px]', className)} />;
  const w = 100;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts: Array<[number, number]> = data.map((v, i) => [(i / Math.max(1, data.length - 1)) * w, height - ((v - min) / span) * (height - 4) - 2]);
  const d = path(pts);
  const color = `var(--color-${tone === 'brand' ? 'brand' : tone})`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className={clsx('w-full', className)} style={{ height }}>
      {fill && <path d={`${d} L${w},${height} L0,${height} Z`} fill={color} opacity={0.13} />}
      <path d={d} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
};

export interface SeriesPoint { t: number; [key: string]: number }

export const AreaChart: React.FC<{
  data: SeriesPoint[];
  series: Array<{ key: string; label: string; color: string; format?: (v: number) => string }>;
  height?: number;
  className?: string;
  yTicks?: number;
}> = ({ data, series, height = 180, className, yTicks = 3 }) => {
  const [hover, setHover] = useState<{ x: number; index: number } | null>(null);
  const W = 600;
  const H = height;
  const padL = 46;
  const padR = 8;
  const padT = 10;
  const padB = 18;

  const { max, points } = useMemo(() => {
    const all = data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0));
    const m = Math.max(1, ...all);
    const niceMax = m * 1.15;
    const inner = { w: W - padL - padR, h: H - padT - padB };
    const pts = series.map((s) => data.map((d, i) => {
      const x = padL + (i / Math.max(1, data.length - 1)) * inner.w;
      const y = padT + inner.h - ((Number(d[s.key]) || 0) / niceMax) * inner.h;
      return [x, y] as [number, number];
    }));
    return { max: niceMax, points: pts, inner };
  }, [data, series, H]);

  const inner = { w: W - padL - padR, h: H - padT - padB };
  const gridLines = Array.from({ length: yTicks + 1 }).map((_, i) => padT + (i / yTicks) * inner.h);
  const labelEvery = Math.max(1, Math.floor(data.length / 6));

  return (
    <div className={clsx('relative', className)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height }}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * W;
          const idx = Math.round(((x - padL) / inner.w) * (data.length - 1));
          if (idx >= 0 && idx < data.length) setHover({ x: padL + (idx / Math.max(1, data.length - 1)) * inner.w, index: idx });
        }}
        onMouseLeave={() => setHover(null)}
      >
        {gridLines.map((y, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y} y2={y} stroke="var(--t-line)" strokeDasharray="3 5" strokeWidth={1} />
            <text x={padL - 7} y={y + 3.5} textAnchor="end" fontSize={9.5} fill="var(--t-faint)">
              {series[0].format ? series[0].format((1 - i / yTicks) * max) : fmtNumber((1 - i / yTicks) * max)}
            </text>
          </g>
        ))}
        {series.map((s, si) => {
          const d = path(points[si]);
          return (
            <g key={s.key}>
              <path d={`${d} L${W - padR},${padT + inner.h} L${padL},${padT + inner.h} Z`} fill={s.color} opacity={0.12} />
              <path d={d} fill="none" stroke={s.color} strokeWidth={1.9} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </g>
          );
        })}
        {data.map((d, i) => (i % labelEvery === 0 ? (
          <text key={i} x={padL + (i / Math.max(1, data.length - 1)) * inner.w} y={H - 5} textAnchor="middle" fontSize={9} fill="var(--t-faint)">
            {new Date(d.t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </text>
        ) : null))}
        {hover && (
          <g>
            <line x1={hover.x} x2={hover.x} y1={padT} y2={padT + inner.h} stroke="var(--t-line2)" strokeWidth={1} />
            {series.map((s, si) => (
              <circle key={s.key} cx={points[si][hover.index][0]} cy={points[si][hover.index][1]} r={3} fill={s.color} stroke="var(--t-panel)" strokeWidth={1.5} />
            ))}
          </g>
        )}
      </svg>
      {hover && data[hover.index] && (
        <div className="pointer-events-none absolute left-1/2 top-1 -translate-x-1/2 rounded-lg border border-line bg-panel/95 px-2.5 py-1.5 text-[11px] shadow-xl">
          <div className="mb-0.5 font-medium text-dim">{new Date(data[hover.index].t * 1000).toLocaleTimeString()}</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center gap-2 whitespace-nowrap">
              <span className="size-2 rounded-full" style={{ background: s.color }} />
              <span className="text-faint">{s.label}</span>
              <span className="mono ml-auto text-ink">{s.format ? s.format(Number(data[hover.index][s.key]) || 0) : fmtNumber(data[hover.index][s.key])}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const Donut: React.FC<{ segments: Array<{ label: string; value: number; color: string }>; size?: number; thickness?: number; center?: React.ReactNode; className?: string }> = ({ segments, size = 132, thickness = 13, center, className }) => {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className={clsx('relative inline-flex items-center justify-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--t-panel3)" strokeWidth={thickness} />
        {segments.map((s) => {
          const len = (s.value / total) * c;
          const el = (
            <circle key={s.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={thickness}
              strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} strokeLinecap="butt" />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{center}</div>
    </div>
  );
};

export const Gauge: React.FC<{ value: number; max?: number; label?: string; sub?: string; size?: number; tone?: string }> = ({ value, max = 100, label, sub, size = 108, tone = 'brand' }) => {
  const pct = Math.max(0, Math.min(1, value / (max || 1)));
  const r = size / 2 - 9;
  const circ = Math.PI * r; // half circle
  const color = `var(--color-${tone})`;
  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size * 0.62} viewBox={`0 0 ${size} ${size * 0.62}`}>
        <path d={`M9,${size * 0.55} A${r},${r} 0 0 1 ${size - 9},${size * 0.55}`} fill="none" stroke="var(--t-panel3)" strokeWidth={9} strokeLinecap="round" />
        <path d={`M9,${size * 0.55} A${r},${r} 0 0 1 ${size - 9},${size * 0.55}`} fill="none" stroke={color} strokeWidth={9} strokeLinecap="round"
          strokeDasharray={`${circ * pct} ${circ}`} />
        <text x={size / 2} y={size * 0.5} textAnchor="middle" fontSize={size * 0.19} fontWeight={600} fill="var(--t-ink)">{Math.round(value)}%</text>
      </svg>
      {label && <div className="text-[11.5px] font-medium text-dim">{label}</div>}
      {sub && <div className="text-[11px] text-faint">{sub}</div>}
    </div>
  );
};

export const BarList: React.FC<{ items: Array<{ label: string; value: number; secondary?: string; color?: string }>; format?: (v: number) => string; className?: string }> = ({ items, format = fmtBytes, className }) => {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className={clsx('space-y-2.5', className)}>
      {items.map((i) => (
        <div key={i.label}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-[11.5px]">
            <span className="mono truncate text-dim">{i.label}</span>
            <span className="shrink-0 text-faint">{format(i.value)}{i.secondary ? ` · ${i.secondary}` : ''}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-panel3">
            <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${(i.value / max) * 100}%`, background: i.color ?? 'linear-gradient(90deg,#22d3ee,#6366f1)' }} />
          </div>
        </div>
      ))}
    </div>
  );
};

export const MiniBars: React.FC<{ data: number[]; height?: number; tone?: string; className?: string }> = ({ data, height = 28, tone = 'brand', className }) => {
  const max = Math.max(1, ...data);
  return (
    <div className={clsx('flex items-end gap-[2px]', className)} style={{ height }}>
      {data.map((v, i) => (
        <div key={i} className="flex-1 rounded-sm" style={{ height: `${Math.max(6, (v / max) * 100)}%`, background: `var(--color-${tone})`, opacity: 0.35 + 0.65 * (v / max) }} />
      ))}
    </div>
  );
};

export const throughputSeries = (points: Array<{ t: number; rx: number; tx: number }>) =>
  points.map((p) => ({ t: p.t, rx: p.rx, tx: p.tx }));

export const bitrateFormatter = fmtBitrate;
