/**
 * Alert rules and scheduled reports.
 *
 * The insight engine already decides what is wrong with the network; this module
 * decides what to do about it without a human watching the screen: evaluate rules
 * against each analysis, respect a cooldown so a persistent problem does not spam,
 * deliver to a webhook, and keep an auditable log of what fired when.
 *
 * There is no SMTP client here on purpose — a webhook is what Slack, Discord, ntfy,
 * Teams and every incident tool accepts, and it needs no credentials in the
 * dashboard's config file.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { AlertEvent, AlertRule, InsightBundle, ReportSchedule, Severity } from '../../shared/analytics';

const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'alerts.json');
const MAX_EVENTS = 200;
const WEBHOOK_TIMEOUT_MS = 6000;

interface Store {
  rules: AlertRule[];
  events: AlertEvent[];
  schedule: ReportSchedule;
}

const DEFAULT_SCHEDULE: ReportSchedule = { enabled: false, everyHours: 24, includeTraffic: true };

let store: Store | null = null;
let counter = 0;

const load = (): Store => {
  if (store) return store;
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Partial<Store>;
    store = {
      rules: Array.isArray(parsed.rules) ? parsed.rules : [],
      events: Array.isArray(parsed.events) ? parsed.events : [],
      schedule: { ...DEFAULT_SCHEDULE, ...(parsed.schedule ?? {}) },
    };
  } catch {
    store = { rules: [], events: [], schedule: { ...DEFAULT_SCHEDULE } };
  }
  return store;
};

const persist = () => {
  const current = load();
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify({ ...current, events: current.events.slice(0, MAX_EVENTS) }, null, 2), { mode: 0o600 });
  } catch {
    /* alerts are best-effort plumbing */
  }
};

const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(++counter).toString(36)}`;

/* ------------------------------------------------------------------ *
 * Demo starter set
 * ------------------------------------------------------------------ */

const HOUR = 60 * 60 * 1000;

/**
 * A brand-new install on the demo device opens the alerts tab with something to
 * look at: three rules that mirror the demo findings, a delivery log with real
 * history, and a schedule that has already run once. Only used when no store file
 * exists — a live install's rules are never touched.
 */
const demoSeed = (): Store => {
  const now = Date.now();
  const rules: AlertRule[] = [
    {
      id: 'rule-demo-critical', name: 'Critical findings', enabled: true, type: 'severity-count',
      severity: 'critical', threshold: 1, channel: 'log', cooldownMinutes: 5,
      createdAt: now - 6 * 24 * HOUR, lastTriggeredAt: now - 9 * HOUR,
    },
    {
      id: 'rule-demo-score', name: 'Health score under 90', enabled: true, type: 'score-below',
      severity: 'medium', threshold: 90, channel: 'log', cooldownMinutes: 720,
      createdAt: now - 6 * 24 * HOUR, lastTriggeredAt: now - 26 * HOUR,
    },
    {
      id: 'rule-demo-newfindings', name: 'New findings digest', enabled: false, type: 'new-findings',
      severity: 'high', threshold: 1, channel: 'webhook', url: 'https://hooks.example.net/routeros',
      cooldownMinutes: 240, createdAt: now - 2 * 24 * HOUR,
    },
  ];
  const events: AlertEvent[] = [
    {
      id: 'evt-demo-1', at: now - 2 * HOUR, ruleId: 'rule-demo-critical', ruleName: 'Critical findings',
      severity: 'critical', value: 1, delivery: 'logged',
      message: '1 finding at critical or worse (threshold 1) — "Rogue DHCP server on bridge1"',
    },
    {
      id: 'evt-demo-2', at: now - 9 * HOUR, ruleId: 'rule-demo-critical', ruleName: 'Critical findings',
      severity: 'critical', value: 1, delivery: 'logged',
      message: '1 finding at critical or worse (threshold 1) — "Rogue DHCP server on bridge1"',
    },
    {
      id: 'evt-demo-3', at: now - 26 * HOUR, ruleId: 'rule-demo-score', ruleName: 'Health score under 90',
      severity: 'medium', value: 88, delivery: 'logged',
      message: 'Health score 88 (B) is below the threshold of 90',
    },
    {
      id: 'evt-demo-4', at: now - 26 * HOUR, ruleId: 'scheduled-report', ruleName: 'Scheduled report',
      severity: 'info', value: 7594, delivery: 'logged',
      message: 'Network health report generated (7.4 kB).',
    },
  ];
  return {
    rules,
    events,
    schedule: { enabled: false, everyHours: 24, includeTraffic: true, lastRunAt: now - 26 * HOUR },
  };
};

/** Seeds the starter set once, on a device that has no alerts store yet. */
export const seedDemoAlerts = (): void => {
  if (store || fs.existsSync(FILE)) return;
  store = demoSeed();
  persist();
};

/* ------------------------------------------------------------------ *
 * Rules
 * ------------------------------------------------------------------ */

export const listRules = (): AlertRule[] => load().rules;
export const listEvents = (): AlertEvent[] => load().events;
export const getSchedule = (): ReportSchedule => load().schedule;

const VALID_TYPES: AlertRule['type'][] = ['score-below', 'severity-count', 'new-findings'];

export function createRule(input: Partial<AlertRule>): AlertRule {
  const type = (input.type ?? 'score-below') as AlertRule['type'];
  if (!VALID_TYPES.includes(type)) throw new Error(`Unknown rule type "${type}".`);
  const rule: AlertRule = {
    id: nextId('rule'),
    name: String(input.name ?? 'Untitled rule').slice(0, 80),
    enabled: input.enabled !== false,
    type,
    severity: (input.severity as Severity) ?? 'high',
    threshold: Number.isFinite(Number(input.threshold)) ? Number(input.threshold) : type === 'score-below' ? 80 : 1,
    channel: input.channel === 'webhook' ? 'webhook' : 'log',
    url: input.url ? String(input.url).slice(0, 500) : undefined,
    cooldownMinutes: Math.max(5, Math.min(1440, Number(input.cooldownMinutes ?? 60))),
    createdAt: Date.now(),
  };
  if (rule.channel === 'webhook' && !/^https?:\/\//.test(rule.url ?? '')) throw new Error('A webhook rule needs an http(s) URL.');
  load().rules.push(rule);
  persist();
  return rule;
}

export function updateRule(id: string, patch: Partial<AlertRule>): AlertRule | null {
  const rule = load().rules.find((entry) => entry.id === id);
  if (!rule) return null;
  Object.assign(rule, {
    ...(patch.name !== undefined ? { name: String(patch.name).slice(0, 80) } : {}),
    ...(patch.enabled !== undefined ? { enabled: patch.enabled === true } : {}),
    ...(patch.threshold !== undefined ? { threshold: Number(patch.threshold) } : {}),
    ...(patch.severity !== undefined ? { severity: patch.severity } : {}),
    ...(patch.channel !== undefined ? { channel: patch.channel === 'webhook' ? 'webhook' : 'log' } : {}),
    ...(patch.url !== undefined ? { url: String(patch.url).slice(0, 500) } : {}),
    ...(patch.cooldownMinutes !== undefined ? { cooldownMinutes: Math.max(5, Math.min(1440, Number(patch.cooldownMinutes))) } : {}),
  });
  persist();
  return rule;
}

export function deleteRule(id: string): boolean {
  const current = load();
  const before = current.rules.length;
  current.rules = current.rules.filter((rule) => rule.id !== id);
  persist();
  return current.rules.length !== before;
}

export function clearEvents(): void {
  load().events = [];
  persist();
}

/* ------------------------------------------------------------------ *
 * Evaluation
 * ------------------------------------------------------------------ */

const severityAtLeast = (counts: Record<Severity, number>, severity: Severity): number => {
  const order: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
  return order.slice(0, order.indexOf(severity) + 1).reduce((sum, key) => sum + (counts[key] ?? 0), 0);
};

interface Trigger {
  rule: AlertRule;
  message: string;
  value: number | string;
  severity: Severity;
}

function evaluate(bundle: InsightBundle, rule: AlertRule): Trigger | null {
  if (rule.type === 'score-below') {
    if (bundle.score.overall >= rule.threshold) return null;
    return {
      rule,
      severity: bundle.score.overall < 60 ? 'critical' : 'high',
      value: bundle.score.overall,
      message: `Health score ${bundle.score.overall}/100 is below the ${rule.threshold} threshold (grade ${bundle.score.grade}).`,
    };
  }
  if (rule.type === 'severity-count') {
    const severity = rule.severity ?? 'high';
    const count = severityAtLeast(bundle.counts as unknown as Record<Severity, number>, severity);
    if (count < rule.threshold) return null;
    const worst = bundle.findings.find((finding) => finding.severity === severity);
    return {
      rule,
      severity,
      value: count,
      message: `${count} finding(s) at ${severity} or worse (threshold ${rule.threshold})${worst ? ` — e.g. "${worst.title}"` : ''}.`,
    };
  }
  // new-findings: compared against the previous sample in the score series.
  const trend = bundle.history;
  if (!trend || trend.total < 2) return null;
  if (trend.newFindings < Math.max(1, rule.threshold)) return null;
  return {
    rule,
    severity: 'high',
    value: trend.newFindings,
    message: `${trend.newFindings} new finding(s) appeared since the previous analysis.`,
  };
}

async function deliver(event: AlertEvent, rule: AlertRule, payload: unknown): Promise<AlertEvent['delivery']> {
  if (rule.channel !== 'webhook' || !rule.url) return 'logged';
  try {
    const response = await fetch(rule.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    return response.ok ? 'webhook-ok' : 'webhook-failed';
  } catch {
    return 'webhook-failed';
  }
}

export interface EvaluateOptions {
  device?: string;
  /** Skip delivery (used by the "test rules" action). */
  dryRun?: boolean;
}

/** Evaluates every enabled rule against a fresh bundle, delivering what fires. */
export async function evaluateAlerts(bundle: InsightBundle, options: EvaluateOptions = {}): Promise<AlertEvent[]> {
  const current = load();
  const fired: AlertEvent[] = [];
  const now = Date.now();

  for (const rule of current.rules) {
    if (!rule.enabled) continue;
    const trigger = evaluate(bundle, rule);
    if (!trigger) continue;
    if (!options.dryRun && rule.lastTriggeredAt && now - rule.lastTriggeredAt < rule.cooldownMinutes * 60_000) continue;

    const event: AlertEvent = {
      id: nextId('evt'),
      at: now,
      ruleId: rule.id,
      ruleName: rule.name,
      severity: trigger.severity,
      message: trigger.message,
      value: trigger.value,
      delivery: 'logged',
    };
    if (!options.dryRun) {
      event.delivery = await deliver(event, rule, {
        event: 'routeros-dashboard.alert',
        device: options.device ?? bundle.mode,
        rule: { id: rule.id, name: rule.name, type: rule.type, threshold: rule.threshold, severity: rule.severity },
        value: trigger.value,
        message: trigger.message,
        score: bundle.score.overall,
        grade: bundle.score.grade,
        findings: bundle.findings.slice(0, 10).map((finding) => ({ severity: finding.severity, title: finding.title })),
        at: new Date(now).toISOString(),
      });
      rule.lastTriggeredAt = now;
    }
    fired.push(event);
  }

  if (fired.length && !options.dryRun) {
    current.events = [...fired, ...current.events].slice(0, MAX_EVENTS);
    persist();
  }
  return fired;
}

/* ------------------------------------------------------------------ *
 * Scheduled reports
 * ------------------------------------------------------------------ */

export function setSchedule(patch: Partial<ReportSchedule>): ReportSchedule {
  const schedule = load().schedule;
  Object.assign(schedule, {
    ...(patch.enabled !== undefined ? { enabled: patch.enabled === true } : {}),
    ...(patch.everyHours !== undefined ? { everyHours: Math.max(1, Math.min(720, Number(patch.everyHours))) } : {}),
    ...(patch.webhookUrl !== undefined ? { webhookUrl: String(patch.webhookUrl).slice(0, 500) } : {}),
    ...(patch.includeTraffic !== undefined ? { includeTraffic: patch.includeTraffic === true } : {}),
  });
  persist();
  return schedule;
}

/** True when the schedule is enabled and the interval has elapsed. */
export function reportDue(now = Date.now()): boolean {
  const schedule = load().schedule;
  if (!schedule.enabled) return false;
  const last = schedule.lastRunAt ?? 0;
  return now - last >= schedule.everyHours * 60 * 60 * 1000;
}

/** Delivers a rendered report, records it in the event log and stamps lastRunAt. */
export async function deliverReport(markdown: string, meta: { device?: string; trigger: 'schedule' | 'manual' }): Promise<AlertEvent> {
  const schedule = load().schedule;
  const now = Date.now();
  const event: AlertEvent = {
    id: nextId('rpt'),
    at: now,
    ruleId: 'scheduled-report',
    ruleName: meta.trigger === 'schedule' ? 'Scheduled report' : 'Report (run now)',
    severity: 'info',
    message: `Network health report generated (${(markdown.length / 1024).toFixed(1)} kB).`,
    value: markdown.length,
    delivery: 'logged',
  };

  if (schedule.webhookUrl) {
    event.delivery = await deliver(event, { ...({} as AlertRule), channel: 'webhook', url: schedule.webhookUrl }, {
      event: 'routeros-dashboard.report',
      device: meta.device,
      trigger: meta.trigger,
      generatedAt: new Date(now).toISOString(),
      text: markdown,
    });
  }

  const current = load();
  current.events = [event, ...current.events].slice(0, MAX_EVENTS);
  if (meta.trigger === 'schedule') current.schedule.lastRunAt = now;
  persist();
  return event;
}

export function markReportRun(at = Date.now()): void {
  load().schedule.lastRunAt = at;
  persist();
}

/** Test delivery for one rule (or the schedule webhook) without waiting for a trigger. */
export async function testWebhook(url: string): Promise<'webhook-ok' | 'webhook-failed'> {
  const result = await deliver({} as AlertEvent, { ...({} as AlertRule), channel: 'webhook', url }, {
    event: 'routeros-dashboard.test',
    message: 'Test delivery from RouterOS Control Plane — alerts are wired up correctly.',
    at: new Date().toISOString(),
  });
  return result === 'webhook-ok' ? 'webhook-ok' : 'webhook-failed';
}
