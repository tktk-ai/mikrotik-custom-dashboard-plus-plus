/**
 * Alert rules, delivery log and the scheduled report.
 *
 * The insight engine decides what is wrong; these rules decide who hears about it.
 * Evaluation happens on every analysis read (and on demand), delivery is a webhook
 * so it drops straight into Slack/Discord/ntfy/Teams, and every fire is logged here
 * with what it said and whether the webhook accepted it.
 */
import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { SEVERITY_ORDER, type AlertEvent, type AlertRule, type AlertRuleType, type Severity } from '@shared/analytics';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import { fmtNumber, relativeTime } from '../lib/format';
import { EmptyState, Field, Icon, Modal, Spinner, Stat, Toggle, toast } from './ui';
import { SeverityChip } from './network';

const TYPE_LABEL: Record<AlertRuleType, string> = {
  'score-below': 'Health score below',
  'severity-count': 'Findings at severity',
  'new-findings': 'New findings since last check',
};

const describe = (rule: AlertRule): string => {
  if (rule.type === 'score-below') return `Score drops under ${rule.threshold}`;
  if (rule.type === 'severity-count') return `${rule.threshold}+ finding(s) at ${rule.severity ?? 'high'} or worse`;
  return `${rule.threshold}+ new finding(s) since the previous analysis`;
};

const DELIVERY_TONE: Record<AlertEvent['delivery'], string> = {
  logged: 'chip-neutral',
  'webhook-ok': 'chip-good',
  'webhook-failed': 'chip-bad',
};

export const AlertsPanel: React.FC = () => {
  const { connection: _connection } = useApp();
  const qc = useQueryClient();
  const [newOpen, setNewOpen] = useState(false);
  const [draft, setDraft] = useState<Partial<AlertRule>>({
    name: 'High findings', type: 'severity-count', severity: 'high', threshold: 3, channel: 'log', cooldownMinutes: 120,
  });
  const [scheduleUrl, setScheduleUrl] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['alerts'],
    queryFn: () => api.alerts(),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['alerts'] });
  };

  const create = useMutation({
    mutationFn: () => api.createAlert(draft),
    onSuccess: () => { toast.success('Rule created', 'It will be evaluated on the next analysis'); setNewOpen(false); refresh(); },
    onError: (err) => toast.error('Could not create rule', (err as Error).message),
  });

  const toggleRule = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api.updateAlert(id, { enabled }),
    onSuccess: refresh,
    onError: (err) => toast.error('Could not update rule', (err as Error).message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteAlert(id),
    onSuccess: () => { toast.info('Rule deleted'); refresh(); },
  });

  const check = useMutation({
    mutationFn: () => api.checkAlerts(),
    onSuccess: (result) => {
      if (result.fired.length) toast.success(`${result.fired.length} rule(s) fired`, result.fired[0]?.message);
      else toast.info('No rules fired', 'The current analysis trips none of your thresholds');
      refresh();
    },
    onError: (err) => toast.error('Check failed', (err as Error).message),
  });

  const clear = useMutation({
    mutationFn: () => api.clearAlertEvents(),
    onSuccess: () => { toast.info('Delivery log cleared'); refresh(); },
  });

  const saveSchedule = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.schedule(body as never),
    onSuccess: () => { toast.success('Schedule saved'); refresh(); },
    onError: (err) => toast.error('Could not save schedule', (err as Error).message),
  });

  const runReport = useMutation({
    mutationFn: () => api.runReport(),
    onSuccess: (result) => toast.success('Report generated', `${(result.bytes / 1024).toFixed(1)} kB · ${result.delivered}`),
    onError: (err) => toast.error('Report failed', (err as Error).message),
  });

  const testHook = useMutation({
    mutationFn: (url: string) => api.testWebhook(url),
    onSuccess: (result) => result.delivery === 'webhook-ok'
      ? toast.success('Webhook accepted the test')
      : toast.error('Webhook failed', 'The endpoint did not return 2xx'),
    onError: (err) => toast.error('Webhook failed', (err as Error).message),
  });

  const rules = query.data?.rules ?? [];
  const events = query.data?.events ?? [];
  const schedule = query.data?.schedule;
  const url = scheduleUrl ?? schedule?.webhookUrl ?? '';

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-[1fr_360px]">
        <section className="card p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Icon name="BellRing" size={15} className="text-brand" />
            <span className="text-[13px] font-semibold text-ink">Alert rules</span>
            <span className="chip chip-neutral">{rules.filter((rule) => rule.enabled).length} active</span>
            <div className="ml-auto flex items-center gap-2">
              <button className="btn btn-sm" onClick={() => check.mutate()} disabled={check.isPending}>
                {check.isPending ? <Spinner className="size-3.5" /> : <Icon name="Play" size={12} />}
                Check now
              </button>
              <button className="btn btn-sm btn-primary" onClick={() => setNewOpen(true)}>
                <Icon name="Plus" size={12} />
                New rule
              </button>
            </div>
          </div>

          {query.isLoading && <div className="py-6 text-center"><Spinner /></div>}
          {!query.isLoading && !rules.length && (
            <EmptyState
              icon="BellRing"
              title="No alert rules yet"
              hint="Rules run against every analysis: score thresholds, severity counts, or new findings appearing between checks."
            />
          )}

          {rules.length > 0 && (
            <div className="space-y-2">
              {rules.map((rule) => (
                <div key={rule.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-base2/50 p-2.5">
                  <Toggle checked={rule.enabled} onChange={(value) => toggleRule.mutate({ id: rule.id, enabled: value })} />
                  <div className="min-w-0">
                    <div className="truncate text-[12.5px] font-medium text-ink">{rule.name}</div>
                    <div className="text-[11px] text-faint">
                      {TYPE_LABEL[rule.type]} · {describe(rule)}
                      {rule.lastTriggeredAt ? ` · last fired ${relativeTime(rule.lastTriggeredAt)}` : ' · never fired'}
                    </div>
                  </div>
                  <span className={clsx('chip', rule.channel === 'webhook' ? 'chip-info' : 'chip-neutral')}>
                    <Icon name={rule.channel === 'webhook' ? 'Webhook' : 'ScrollText'} size={10} />
                    {rule.channel === 'webhook' ? 'webhook' : 'log only'}
                  </span>
                  <span className="chip chip-neutral" title={`cooldown ${rule.cooldownMinutes} minutes`}>{rule.cooldownMinutes}m cooldown</span>
                  <button className="btn btn-sm btn-ghost ml-auto" onClick={() => remove.mutate(rule.id)} title="Delete rule">
                    <Icon name="Trash2" size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card p-4">
          <div className="mb-3 flex items-center gap-2">
            <Icon name="CalendarClock" size={15} className="text-brand" />
            <span className="text-[13px] font-semibold text-ink">Scheduled report</span>
          </div>
          {schedule ? (
            <div className="space-y-3">
              <Toggle
                checked={schedule.enabled}
                onChange={(value) => saveSchedule.mutate({ enabled: value })}
                label="Generate the Markdown report on a schedule"
              />
              <div className="grid grid-cols-2 gap-2">
                <Field label="Every (hours)">
                  <input
                    type="number"
                    min={1}
                    max={720}
                    className="input"
                    value={schedule.everyHours}
                    onChange={(event) => saveSchedule.mutate({ everyHours: Number(event.target.value) })}
                  />
                </Field>
                <Field label="Last run">
                  <input className="input" readOnly value={schedule.lastRunAt ? relativeTime(schedule.lastRunAt) : 'never'} />
                </Field>
              </div>
              <Field label="Webhook URL" hint="Slack, Discord, ntfy, Teams or your own endpoint. Leave empty to only record runs in the log.">
                <div className="flex gap-2">
                  <input
                    className="input"
                    placeholder="https://hooks.slack.com/services/…"
                    value={url}
                    onChange={(event) => setScheduleUrl(event.target.value)}
                  />
                  <button className="btn btn-sm" onClick={() => saveSchedule.mutate({ webhookUrl: url })}>Save</button>
                </div>
              </Field>
              {url && (
                <button className="btn btn-sm btn-ghost" onClick={() => testHook.mutate(url)} disabled={testHook.isPending}>
                  {testHook.isPending ? <Spinner className="size-3.5" /> : <Icon name="Send" size={12} />}
                  Send test event
                </button>
              )}
              <Toggle
                checked={schedule.includeTraffic}
                onChange={(value) => saveSchedule.mutate({ includeTraffic: value })}
                label="Include the traffic / DPI summary"
              />
              <div className="flex items-center gap-2 border-t border-line/60 pt-3">
                <button className="btn btn-sm btn-primary" onClick={() => runReport.mutate()} disabled={runReport.isPending}>
                  {runReport.isPending ? <Spinner className="size-3.5" /> : <Icon name="FileDown" size={12} />}
                  Run now
                </button>
                <a className="btn btn-sm" href={api.reportUrl(false)} target="_blank" rel="noreferrer">
                  <Icon name="Eye" size={12} />
                  Preview
                </a>
              </div>
            </div>
          ) : (
            <div className="py-4 text-center"><Spinner /></div>
          )}
        </section>
      </div>

      <section className="card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Icon name="History" size={15} className="text-brand" />
          <span className="text-[13px] font-semibold text-ink">Delivery log</span>
          <span className="chip chip-neutral">{fmtNumber(events.length)}</span>
          {events.length > 0 && (
            <button className="btn btn-sm btn-ghost ml-auto" onClick={() => clear.mutate()}>
              <Icon name="Eraser" size={12} />
              Clear
            </button>
          )}
        </div>

        {!events.length ? (
          <EmptyState
            icon="BellOff"
            title="Nothing has fired yet"
            hint="Alerts and scheduled reports are recorded here with the message they sent and whether the webhook accepted it."
          />
        ) : (
          <div className="space-y-1.5">
            {events.map((event) => (
              <div key={event.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-base2/50 px-2.5 py-2">
                <span className="mono w-24 shrink-0 text-[11px] text-faint">{relativeTime(event.at)}</span>
                <SeverityChip severity={event.severity} />
                <span className="min-w-0 flex-1 truncate text-[12px] text-dim" title={event.message}>{event.message}</span>
                <span className="chip chip-neutral">{event.ruleName}</span>
                <span className={clsx('chip', DELIVERY_TONE[event.delivery])}>{event.delivery.replace('webhook-', 'hook ')}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <Modal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="New alert rule"
        subtitle="Evaluated against every analysis — the same data the Insights page shows"
        footer={
          <>
            <button className="btn" onClick={() => setNewOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={() => create.mutate()} disabled={!draft.name?.trim() || create.isPending}>
              {create.isPending ? <Spinner className="size-3.5" /> : <Icon name="Plus" size={13} />}
              Create rule
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Name" required>
            <input className="input" value={draft.name ?? ''} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </Field>
          <Field label="Condition">
            <select className="input" value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as AlertRuleType })}>
              {(Object.keys(TYPE_LABEL) as AlertRuleType[]).map((type) => (
                <option key={type} value={type}>{TYPE_LABEL[type]}</option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            {draft.type === 'severity-count' && (
              <Field label="Severity">
                <select
                  className="input"
                  value={draft.severity}
                  onChange={(event) => setDraft({ ...draft, severity: event.target.value as Severity })}
                >
                  {SEVERITY_ORDER.map((severity) => (
                    <option key={severity} value={severity}>{severity}</option>
                  ))}
                </select>
              </Field>
            )}
            <Field label={draft.type === 'score-below' ? 'Score threshold' : 'Count threshold'}>
              <input
                type="number"
                className="input"
                value={draft.threshold ?? 1}
                onChange={(event) => setDraft({ ...draft, threshold: Number(event.target.value) })}
              />
            </Field>
            <Field label="Cooldown (minutes)" hint="Minimum gap between deliveries for this rule.">
              <input
                type="number"
                min={5}
                max={1440}
                className="input"
                value={draft.cooldownMinutes ?? 60}
                onChange={(event) => setDraft({ ...draft, cooldownMinutes: Number(event.target.value) })}
              />
            </Field>
          </div>
          <Field label="Delivery">
            <select
              className="input"
              value={draft.channel}
              onChange={(event) => setDraft({ ...draft, channel: event.target.value as AlertRule['channel'] })}
            >
              <option value="log">Log only (visible in the delivery log)</option>
              <option value="webhook">Webhook</option>
            </select>
          </Field>
          {draft.channel === 'webhook' && (
            <Field label="Webhook URL" required hint="Receives a JSON payload with the message, score and current findings.">
              <input
                className="input"
                placeholder="https://…"
                value={draft.url ?? ''}
                onChange={(event) => setDraft({ ...draft, url: event.target.value })}
              />
            </Field>
          )}
          <Stat
            label="Rule preview"
            value={draft.type ? TYPE_LABEL[draft.type as AlertRuleType] : '—'}
            hint={draft.type ? describe({ ...(draft as AlertRule), threshold: draft.threshold ?? 1 }) : undefined}
            icon="BellRing"
          />
        </div>
      </Modal>
    </div>
  );
};
