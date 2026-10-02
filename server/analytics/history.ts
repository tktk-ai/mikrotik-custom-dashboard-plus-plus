/**
 * Score history.
 *
 * A single score is a snapshot; the interesting strategic question is whether the
 * device is getting better or worse. Every insights read appends a sample (deduped:
 * a new sample is only written when the score changed or the last one is older than
 * the sample interval), and the series is persisted to `data/` so it survives a
 * restart.
 *
 * In demo mode the series is seeded with a month of simulated readings so the trend
 * UI has something to show without waiting — samples carry `source: 'demo'` and the
 * UI labels them as simulated.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { CapacityRow, InsightBundle, LinkHistory, ScoreSample, ScoreTrend } from '../../shared/analytics';

export type { ScoreSample, ScoreTrend };

export interface LinkSample {
  at: number;
  /** interface name → cumulative byte counters at that instant. */
  counters: Record<string, { rx: number; tx: number }>;
}

interface Store {
  connectionId: string;
  samples: ScoreSample[];
  /** Interface throughput series, recorded on every analytics read. */
  links?: LinkSample[];
}

const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'analytics-history.json');
/** Minimum gap between samples when nothing changed. */
const SAMPLE_INTERVAL_MS = 5 * 60 * 1000;
/** Cap the series so the file stays small: ~2000 samples ≈ 7 days at 5 min. */
const MAX_SAMPLES = 2000;
/** How many samples the API returns. */
const PAYLOAD_SAMPLES = 240;
/** Link samples: 5 min apart → 720 points is ~2.5 days of throughput history. */
const MAX_LINK_SAMPLES = 720;
/** Interfaces worth keeping in the series (the rest are noise). */
const LINK_SERIES_LIMIT = 24;

let store: Store | null = null;

function load(): Store | null {
  if (store) return store;
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const parsed = JSON.parse(raw) as Store;
    if (parsed && Array.isArray(parsed.samples)) store = parsed;
  } catch {
    /* no history yet */
  }
  return store;
}

/**
 * Turns cumulative interface counters into rates, appends them to the series and
 * writes the rates back onto the bundle so the caller can show real bps on the
 * first read instead of waiting for a second one.
 */
export function recordLinkSamples(bundle: InsightBundle, connectionId = 'active'): Record<string, { rx: number; tx: number }> {
  const counters: Record<string, { rx: number; tx: number }> = {};
  const names: string[] = [];
  for (const row of bundle.capacity.interfaces) {
    counters[row.interface] = { rx: row.rxBytes, tx: row.txBytes };
    names.push(row.interface);
  }
  const rates = appendLinkSample(counters, bundle.mode, connectionId, names);

  // Apply: a device's own counters stay authoritative, rates come from the delta.
  let totalRx = 0;
  let totalTx = 0;
  for (const row of bundle.capacity.interfaces) {
    const rate = rates[row.interface];
    const rx = rate?.rx ?? 0;
    const tx = rate?.tx ?? 0;
    row.rxRate = rx;
    row.txRate = tx;
    row.utilisation = row.speedBps ? Math.min(100, Math.round((Math.max(rx, tx) * 8 / row.speedBps) * 100)) : row.utilisation;
    row.status = !row.status || row.status === 'down' ? row.status : row.utilisation > 85 ? 'hot' : row.status;
    totalRx += rx;
    totalTx += tx;
  }
  bundle.capacity.totalRx = totalRx;
  bundle.capacity.totalTx = totalTx;
  if (bundle.capacity.wan) {
    const speed = bundle.capacity.wan.speedBps;
    bundle.capacity.headroom = speed ? Math.max(0, 100 - Math.round((Math.max(bundle.capacity.wan.rxRate, bundle.capacity.wan.txRate) * 8 / speed) * 100)) : bundle.capacity.headroom;
  }
  return rates;
}

/** Shared append path: seed demo history, compute rates, cap the series, persist. */
function appendLinkSample(
  counters: Record<string, { rx: number; tx: number }>,
  mode: string,
  connectionId: string,
  names: string[],
): Record<string, { rx: number; tx: number }> {
  const now = Date.now();
  const existing = load();
  let samples: LinkSample[] = existing?.connectionId === connectionId ? (existing.links ?? []) : [];
  const seeded = !samples.length && mode === 'demo';
  if (seeded) samples = seedLinkSamplesFrom(counters);

  const previous = samples.at(-1);
  const seconds = previous ? (now - previous.at) / 1000 : 0;
  const rates: Record<string, { rx: number; tx: number }> = {};
  const busiest = [...names].sort((a, b) => (counters[b].rx + counters[b].tx) - (counters[a].rx + counters[a].tx)).slice(0, LINK_SERIES_LIMIT);
  for (const name of busiest) {
    const before = previous?.counters[name];
    if (before && seconds > 0) {
      rates[name] = {
        rx: Math.max(0, counters[name].rx - before.rx) / seconds,
        tx: Math.max(0, counters[name].tx - before.tx) / seconds,
      };
    }
  }

  const nextSamples = seeded || !previous || now - previous.at >= 60_000
    ? [...samples.slice(-(MAX_LINK_SAMPLES - 1)), { at: now, counters }]
    : [...samples.slice(0, -1), { at: now, counters }];
  persist({
    connectionId,
    samples: existing?.connectionId === connectionId ? existing!.samples : existing?.samples ?? [],
    links: nextSamples,
  });
  return rates;
}

/** Throughput series for one interface, newest last. */
export function readLinkHistory(connectionId: string, iface: string, hours = 6): LinkHistory {
  const existing = load();
  const samples = existing?.connectionId === connectionId ? (existing.links ?? []) : [];
  const since = Date.now() - hours * 60 * 60 * 1000;
  const points: Array<{ at: number; rx: number; tx: number }> = [];
  for (let i = 1; i < samples.length; i++) {
    const before = samples[i - 1];
    const current = samples[i];
    const seconds = (current.at - before.at) / 1000;
    const from = before.counters[iface];
    const to = current.counters[iface];
    if (!from || !to || seconds <= 0 || current.at < since) continue;
    points.push({
      at: current.at,
      rx: Math.max(0, to.rx - from.rx) / seconds,
      tx: Math.max(0, to.tx - from.tx) / seconds,
    });
  }
  const peak = points.reduce((max, point) => Math.max(max, point.rx, point.tx), 0);
  const average = points.length ? points.reduce((sum, point) => sum + point.rx + point.tx, 0) / points.length : 0;
  return {
    interface: iface,
    hours,
    points,
    peak,
    average,
    source: samples.at(-1) ? (sampleSource(samples) ?? 'live') : 'live',
  };
}

/**
 * Records a throughput sample from raw interface counters (no insights bundle needed),
 * so the map's link drill-down has history even when nobody opened the Insights page.
 */
export function recordInterfaceCounters(
  rows: Array<{ name: string; rxBytes: number; txBytes: number }>,
  mode: string,
  connectionId = 'active',
): Record<string, { rx: number; tx: number }> {
  const counters: Record<string, { rx: number; tx: number }> = {};
  for (const row of rows) counters[row.name] = { rx: row.rxBytes, tx: row.txBytes };
  return appendLinkSample(counters, mode, connectionId, rows.map((row) => row.name));
}

/** Most recent rates without recording anything (used by the topology route). */
export function latestLinkRates(connectionId = 'active'): Record<string, { rx: number; tx: number }> {
  const samples = load()?.connectionId === connectionId ? (load()?.links ?? []) : [];
  const current = samples.at(-1);
  const before = samples.at(-2);
  if (!current || !before) return {};
  const seconds = (current.at - before.at) / 1000;
  if (seconds <= 0) return {};
  const rates: Record<string, { rx: number; tx: number }> = {};
  for (const [iface, counter] of Object.entries(current.counters)) {
    const previous = before.counters[iface] ?? counter;
    rates[iface] = { rx: Math.max(0, counter.rx - previous.rx) / seconds, tx: Math.max(0, counter.tx - previous.tx) / seconds };
  }
  return rates;
}

const sampleSource = (samples: LinkSample[]): 'demo' | 'live' | undefined => {
  const store = load();
  if (!store) return undefined;
  // Link samples inherit the mode of the score series they were recorded with.
  return store.samples.at(-1)?.source;
};

/**
 * Demo seed: ~2.5 days of five-minute samples with a day/night shape, so the link
 * drill-down has a history to draw before the dashboard has been open for hours.
 */
function seedLinkSamplesFrom(seed: Record<string, { rx: number; tx: number }>): LinkSample[] {
  const now = Date.now();
  const step = 5 * 60 * 1000;
  const count = 720;
  const carriers = Object.keys(seed)
    .slice(0, 10)
    .map((name, index) => ({ name, base: Math.max(4, 600 / (index + 2)) }));
  const samples: LinkSample[] = [];
  const counters: Record<string, { rx: number; tx: number }> = {};
  for (const carrier of carriers) counters[carrier.name] = { rx: 0, tx: 0 };
  for (let i = count; i >= 0; i--) {
    const at = now - i * step;
    const hour = new Date(at).getHours();
    const daylight = 0.35 + 0.65 * Math.max(0, Math.sin(((hour - 5) / 24) * Math.PI * 2));
    for (const carrier of carriers) {
      // Bytes over the interval = rate (kB/s) × 300 s.
      const wobble = 0.7 + 0.6 * Math.abs(Math.sin((i + carrier.base) / 7));
      const rx = carrier.base * 1000 * daylight * wobble;
      const tx = carrier.base * 420 * daylight * (1.4 - wobble / 2);
      counters[carrier.name].rx += rx * 300;
      counters[carrier.name].tx += tx * 300;
    }
    samples.push({ at, counters: JSON.parse(JSON.stringify(counters)) });
  }
  return samples;
}

function persist(next: Store) {
  store = next;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
  } catch {
    /* history is a nice-to-have — never fail a request over it */
  }
}

const severityCounts = (bundle: InsightBundle): ScoreSample['findings'] => ({
  critical: bundle.counts.critical ?? 0,
  high: bundle.counts.high ?? 0,
  medium: bundle.counts.medium ?? 0,
  low: bundle.counts.low ?? 0,
  info: bundle.counts.info ?? 0,
});

const deviceCount = (bundle: InsightBundle) =>
  bundle.ipam.subnets.reduce((sum, subnet) => sum + subnet.used, 0);

const sameShape = (a: ScoreSample, b: ScoreSample) =>
  a.overall === b.overall &&
  a.grade === b.grade &&
  JSON.stringify(a.components) === JSON.stringify(b.components) &&
  JSON.stringify(a.findings) === JSON.stringify(b.findings);

/**
 * Demo seed: a month of daily readings that tells a plausible story (the operator
 * fixed the obvious things over time) and ends exactly where the device scores today.
 */
function seedDemo(connectionId: string, bundle: InsightBundle): ScoreSample[] {
  const target = bundle.score.overall;
  const components = Object.fromEntries(bundle.score.components.map((c) => [c.id, c.score]));
  const counts = severityCounts(bundle);
  const now = Date.now();
  const days = 30;
  const samples: ScoreSample[] = [];
  for (let i = days; i >= 0; i--) {
    // Ease-out improvement curve from ~78% of today's score to today's score, with a
    // small deterministic wobble so the trend does not read as a straight line.
    const progress = (days - i) / days;
    const eased = 1 - Math.pow(1 - progress, 2);
    const wobble = Math.sin(i * 1.7) * 1.6;
    const overall = Math.max(5, Math.min(100, Math.round(target * (0.78 + 0.22 * eased) + wobble)));
    const aged = i / days;
    samples.push({
      at: now - i * 24 * 60 * 60 * 1000,
      overall,
      grade: overall >= 90 ? 'A' : overall >= 80 ? 'B' : overall >= 70 ? 'C' : overall >= 55 ? 'D' : 'E',
      components: Object.fromEntries(
        Object.entries(components).map(([id, score]) => [id, Math.max(5, Math.min(100, Math.round(score * (0.8 + 0.2 * eased) + wobble / 2)))]),
      ),
      findings: {
        critical: Math.round(counts.critical + (1 - eased) * 1),
        high: Math.round(counts.high + (1 - eased) * 2),
        medium: Math.round(counts.medium + (1 - eased) * 3),
        low: Math.round(counts.low + (1 - eased) * 2),
        info: counts.info,
      },
      devices: Math.round(deviceCount(bundle) * (0.96 + 0.04 * eased)),
      // Simulated: the demo device has no real past, and the UI says so.
      source: 'demo' as const,
    });
    void aged;
  }
  return samples;
}

/** Appends a sample for this read (deduped) and returns the whole series. */
export function recordScoreSample(bundle: InsightBundle, connectionId = 'active'): ScoreTrend {
  const existing = load();
  const current = existing?.connectionId === connectionId ? existing.samples : [];
  const sample: ScoreSample = {
    at: Date.now(),
    overall: bundle.score.overall,
    grade: bundle.score.grade,
    components: Object.fromEntries(bundle.score.components.map((c) => [c.id, c.score])),
    findings: severityCounts(bundle),
    devices: deviceCount(bundle),
    source: bundle.mode === 'demo' ? 'demo' : 'live',
  };

  let samples: ScoreSample[];
  if (!current.length) {
    samples = bundle.mode === 'demo' ? seedDemo(connectionId, bundle) : [sample];
  } else {
    const last = current[current.length - 1];
    const stale = sample.at - last.at >= SAMPLE_INTERVAL_MS;
    samples = sameShape(last, sample) && !stale ? [...current] : [...current, sample];
    if (sameShape(last, sample) && stale) samples[samples.length - 1] = sample;
  }
  if (samples.length > MAX_SAMPLES) samples = samples.slice(-MAX_SAMPLES);

  persist({ connectionId, samples, links: existing?.connectionId === connectionId ? existing.links : undefined });
  return summarise(connectionId, samples);
}

/** Reads the series without recording a new point. */
export function readScoreTrend(connectionId = 'active'): ScoreTrend {
  const existing = load();
  const samples = existing?.connectionId === connectionId ? existing.samples : [];
  return summarise(connectionId, samples);
}

/** Wipes stored history (used by the demo reset). */
export function resetScoreHistory() {
  store = null;
  try {
    fs.rmSync(FILE, { force: true });
  } catch {
    /* nothing to remove */
  }
}

function summarise(connectionId: string, samples: ScoreSample[]): ScoreTrend {
  const last = samples.at(-1) ?? null;
  const first = samples[0] ?? null;
  const dayAgo = last ? samples.filter((s) => last.at - s.at >= 24 * 60 * 60 * 1000) : [];
  const before = dayAgo.at(-1) ?? first;

  // Component deltas read against the start of the series, so they line up with the
  // headline "score moved this much since we started recording" statement.
  const components = last
    ? Object.entries(last.components).map(([id, now]) => ({
        id,
        label: id.charAt(0).toUpperCase() + id.slice(1),
        now,
        before: first?.components[id] ?? now,
        delta: now - (first?.components[id] ?? now),
      }))
    : [];

  const delta = last && first ? last.overall - first.overall : null;
  return {
    connectionId,
    samples: samples.slice(-PAYLOAD_SAMPLES),
    source: last?.source ?? 'live',
    total: samples.length,
    first,
    last,
    delta,
    deltaDays: last && first ? Math.round((last.at - first.at) / (24 * 60 * 60 * 1000)) : null,
    delta24h: last && before && before !== last ? last.overall - before.overall : null,
    direction: delta === null || delta === 0 ? 'flat' : delta > 0 ? 'up' : 'down',
    components,
    newFindings: last && samples.length > 1
      ? Math.max(0, Object.entries(last.findings).reduce((sum, [severity, count]) => {
          const previous = samples[samples.length - 2].findings[severity as keyof ScoreSample['findings']] ?? 0;
          return sum + Math.max(0, count - previous);
        }, 0))
      : 0,
  };
}
