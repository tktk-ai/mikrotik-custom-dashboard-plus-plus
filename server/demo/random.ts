/** Deterministic helpers used to synthesise a believable RouterOS device. */

export type Rnd = () => number;

/** Mulberry32 — small, fast, seedable PRNG so demo data is stable across reloads. */
export function rng(seed: number): Rnd {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable string hash → seed. */
export function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const pick = <T>(arr: readonly T[], r: Rnd): T => arr[Math.floor(r() * arr.length) % arr.length];
export const int = (min: number, max: number, r: Rnd): number => Math.floor(r() * (max - min + 1)) + min;
export const chance = (p: number, r: Rnd): boolean => r() < p;

export function hex(r: Rnd, len: number): string {
  let out = '';
  for (let i = 0; i < len; i++) out += '0123456789abcdef'[int(0, 15, r)];
  return out;
}

export function mac(r: Rnd): string {
  const oui = ['74:4D:28', 'DC:2C:6E', '48:8F:5A', 'E4:8D:8C', '2C:C8:1B', '18:FD:74', '64:D1:54', 'CC:2D:E0'];
  return `${pick(oui, r)}:${hex(r, 2).toUpperCase()}:${hex(r, 2).toUpperCase()}:${hex(r, 2).toUpperCase()}`;
}

export function ip4(r: Rnd, subnet = '192.168.88'): string {
  return `${subnet}.${int(2, 254, r)}`;
}

export function cidr(r: Rnd, base = '192.168.88'): string {
  return `${base}.${int(0, 8, r) * 8}/${pick([24, 24, 24, 25, 26, 16], r)}`;
}

export function duration(r: Rnd): string {
  const units = [
    () => `${int(5, 59, r)}s`,
    () => `${int(1, 59, r)}m`,
    () => `${int(1, 23, r)}h${int(1, 59, r)}m`,
    () => `${int(1, 40, r)}d${int(1, 23, r)}h`,
    () => `${int(1, 30, r)}w${int(1, 6, r)}d`,
  ];
  return pick(units, r)();
}

export function bytes(r: Rnd): number {
  return Math.floor(Math.pow(10, 3 + r() * 6));
}

export function rate(r: Rnd): string {
  const units = ['k', 'M', 'G'];
  return `${(r() * 90 + 1).toFixed(1)}${pick(units, r)}bps`;
}

export function address6(r: Rnd): string {
  return `2a02:${hex(r, 4)}:${hex(r, 2)}${hex(r, 2)}::${hex(r, 2)}${hex(r, 2)}/${pick([64, 64, 56], r)}`;
}

const NOW = () => Date.now();
export function uptimeSec(startedOffsetSec: number): string {
  const s = Math.floor(NOW() / 1000) - startedOffsetSec;
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d) return `${d}d${h}h${m}m`;
  if (h) return `${h}h${m}m${sec}s`;
  if (m) return `${m}m${sec}s`;
  return `${sec}s`;
}

export function timeString(offsetSec = 0): string {
  const d = new Date(Date.now() - offsetSec * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function dateTimeString(offsetSec = 0): string {
  const d = new Date(Date.now() - offsetSec * 1000);
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const p = (n: number) => String(n).padStart(2, '0');
  return `${months[d.getMonth()]}/${p(d.getDate())}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function routerosDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  return `${months[d.getMonth()]}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}
