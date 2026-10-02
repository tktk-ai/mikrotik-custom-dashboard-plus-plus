/** Formatting helpers shared across the dashboard. */

export const fmtBytes = (bytes: number | string | undefined | null, digits = 1): string => {
  const n = typeof bytes === 'string' ? Number(bytes) : bytes;
  if (n === undefined || n === null || Number.isNaN(n)) return '—';
  if (Math.abs(n) < 1000) return `${Math.round(n)} B`;
  const units = ['kB', 'MB', 'GB', 'TB', 'PB'];
  let v = n;
  let i = -1;
  while (Math.abs(v) >= 1000 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(Math.abs(v) >= 100 ? 0 : digits)} ${units[i]}`;
};

export const fmtBitrate = (bytesPerSec: number, digits = 1): string => {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '0 bps';
  const bits = bytesPerSec * 8;
  const units = ['bps', 'Kbps', 'Mbps', 'Gbps', 'Tbps'];
  let v = bits;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i++; }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : digits)} ${units[i]}`;
};

export const fmtNumber = (n: number | string | undefined | null, digits = 0): string => {
  const v = typeof n === 'string' ? Number(n) : n;
  if (v === undefined || v === null || Number.isNaN(v)) return '—';
  return v.toLocaleString('en-US', { maximumFractionDigits: digits });
};

export const fmtPercent = (value: number, digits = 0) => `${value.toFixed(digits)}%`;

export const fmtUptime = (raw: string | undefined): string => {
  if (!raw) return '—';
  const m = String(raw).match(/^(?:(\d+)w)?(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m) return raw;
  const [, w, d, h, min] = m;
  const parts = [];
  if (w) parts.push(`${w}w`);
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (min && parts.length < 3) parts.push(`${min}m`);
  return parts.join(' ') || raw;
};

export const relativeTime = (ts: number): string => {
  const diff = Math.round((Date.now() - ts) / 1000);
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
};

export const titleCase = (s: string) =>
  s.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export type Tone = 'good' | 'bad' | 'warn' | 'info' | 'neutral' | 'accent';

/** Maps a RouterOS-ish value to a semantic tone. */
export const toneForValue = (key: string, value: unknown): Tone => {
  const v = String(value).toLowerCase();
  if (['true', 'yes', 'enabled', 'running', 'up', 'connected', 'bound', 'established', 'reachable', 'ok', 'active', 'authorized', 'trusted', 'complete', 'Full'.toLowerCase()].includes(v)) return 'good';
  if (['false', 'no'].includes(v)) return 'neutral';
  if (['disabled', 'stopped', 'down', 'closed', 'error', 'failed', 'invalid', 'expired', 'deny', 'blocked', 'incomplete', 'notrack'].includes(v)) return 'bad';
  if (['waiting', 'offered', 'searching', 'warning', 'dying', 'stale', 'unknown', 'none'].includes(v)) return 'warn';
  if (['running-ap', 'running-bridge', 'bound', 'bound', 'assured', 'in-progress'].includes(v)) return 'good';
  if (key === 'action' && ['drop', 'reject', 'tarpit', 'blocked'].includes(v)) return 'bad';
  return 'neutral';
};

export const csvEscape = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const downloadCsv = (filename: string, columns: string[], rows: Record<string, unknown>[]) => {
  const head = columns.map(csvEscape).join(',');
  const body = rows.map((r) => columns.map((c) => csvEscape(r[c])).join(',')).join('\n');
  const blob = new Blob([`${head}\n${body}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

export const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};
