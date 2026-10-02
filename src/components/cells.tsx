import React from 'react';
import type { FieldDef } from '@shared/types';
import { fmtBytes, fmtUptime } from '../lib/format';
import { Badge } from './ui';

/** Value rendering shared by tables, drawers and JSON views. */

export const looksLikeMac = (v: string) => /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/.test(v);
export const looksLikeIp = (v: string) => /^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(v);
export const looksLikeIp6 = (v: string) => /^[0-9a-f:]{4,}(\/\d{1,3})?$/i.test(v) && v.includes(':');
const looksLikeDuration = (v: string) => /^(\d+w)?(\d+d)?(\d+h)?(\d+m)?(\d+s)?$/.test(v) && v.length > 1;

export const toneForBoolean = (v: boolean, field?: FieldDef): string => {
  if (field?.name === 'disabled') return v ? 'neutral' : 'good';
  if (field?.name === 'dynamic' || field?.name === 'invalid') return v ? 'info' : 'neutral';
  return v ? 'good' : 'neutral';
};

export function renderValue(value: unknown, field?: FieldDef, opts: { compact?: boolean } = {}): React.ReactNode {
  if (value === undefined || value === null || value === '') return <span className="text-faint/60">—</span>;
  if (typeof value === 'boolean') {
    const labels = field?.boolLabels ?? ['yes', 'no'];
    return <Badge tone={toneForBoolean(value, field)}>{value ? labels[0] : labels[1]}</Badge>;
  }
  const s = String(value);
  if (field?.type === 'bytes' || field?.unit === 'B' || (field?.name ?? '').match(/bytes|size|memory|space/i)) {
    const n = Number(s.replace(/[^\d.]/g, ''));
    if (Number.isFinite(n) && s.match(/^\d+$/)) return <span className="mono">{fmtBytes(n)}</span>;
  }
  if (looksLikeMac(s)) return <span className="mono text-[12px]">{s}</span>;
  if (looksLikeIp(s) || looksLikeIp6(s)) return <span className="mono text-[12px]">{s}</span>;
  if (field?.type === 'password' || /^\*+$/.test(s)) return <span className="mono text-faint">••••••••</span>;
  if (['enabled', 'disabled', 'running', 'down', 'up', 'established', 'bound', 'connected', 'ok', 'active', 'expired', 'invalid', 'searching', 'waiting', 'stopped', 'error', 'rejected'].includes(s.toLowerCase())) {
    const tone = ['enabled', 'running', 'up', 'established', 'bound', 'connected', 'ok', 'active'].includes(s.toLowerCase()) ? 'good'
      : ['disabled'].includes(s.toLowerCase()) ? 'neutral'
        : ['searching', 'waiting', 'dying'].includes(s.toLowerCase()) ? 'warn' : 'bad';
    return <Badge tone={tone}>{s}</Badge>;
  }
  if (looksLikeDuration(s) && (field?.type === 'duration' || /uptime|timeout|interval|time|expires|since|age/i.test(field?.name ?? ''))) {
    return <span className="mono text-[12px]">{fmtUptime(s)}</span>;
  }
  if (!opts.compact && s.length > 90) return <span title={s}>{s.slice(0, 88)}…</span>;
  return field?.mono ? <span className="mono text-[12px]">{s}</span> : <span>{s}</span>;
}

export const Cell: React.FC<{ value: unknown; field?: FieldDef; compact?: boolean }> = ({ value, field, compact }) => (
  <>{renderValue(value, field, { compact })}</>
);

/** Key/value grid used inside the record drawer. */
export const PropertyList: React.FC<{ row: Record<string, unknown>; fields?: FieldDef[]; columns?: 1 | 2 }> = ({ row, fields }) => {
  const entries = Object.entries(row).filter(([k]) => k !== '.id');
  const known = new Map((fields ?? []).map((f) => [f.name, f]));
  const ordered = entries.sort((a, b) => {
    const fa = known.get(a[0]); const fb = known.get(b[0]);
    const score = (f?: FieldDef) => (f?.primary ? 0 : f?.key ? 1 : f?.advanced ? 3 : 2);
    return score(fa) - score(fb) || a[0].localeCompare(b[0]);
  });
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-0 sm:grid-cols-2">
      {ordered.map(([key, value]) => (
        <div key={key} className="flex items-start justify-between gap-3 border-b border-line/50 py-1.5 last:border-0">
          <dt className="shrink-0 text-[11.5px] text-faint">{known.get(key)?.label ?? key}</dt>
          <dd className="min-w-0 break-words text-right text-[12px] text-dim">{renderValue(value, known.get(key))}</dd>
        </div>
      ))}
    </dl>
  );
};
