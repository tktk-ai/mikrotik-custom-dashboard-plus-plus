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
import type { InsightBundle, ScoreSample, ScoreTrend } from '../../shared/analytics';

export type { ScoreSample, ScoreTrend };

interface Store {
  connectionId: string;
  samples: ScoreSample[];
}

const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'analytics-history.json');
/** Minimum gap between samples when nothing changed. */
const SAMPLE_INTERVAL_MS = 5 * 60 * 1000;
/** Cap the series so the file stays small: ~2000 samples ≈ 7 days at 5 min. */
const MAX_SAMPLES = 2000;
/** How many samples the API returns. */
const PAYLOAD_SAMPLES = 240;

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

  persist({ connectionId, samples });
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
