import React, { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import type { Row } from '@shared/types';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import { Badge, Button, Card, CopyButton, EmptyState, Icon, toast } from '../components/ui';

interface Entry {
  id: number;
  script: string;
  at: number;
  rows?: Row[];
  raw?: string;
  ms?: number;
  error?: string;
  hint?: string;
}

const EXAMPLES: Array<{ label: string; script: string; group: string }> = [
  { group: 'System', label: 'RouterOS version', script: ':put [/system/resource/get version]' },
  { group: 'System', label: 'Identity', script: ':put [/system/identity/get name]' },
  { group: 'System', label: 'CPU load', script: ':put [/system/resource/get cpu-load]' },
  { group: 'System', label: 'Reboot', script: '/system reboot' },
  { group: 'Interfaces', label: 'Interface list', script: '/interface print' },
  { group: 'Interfaces', label: 'Monitor ether1', script: '/interface ethernet monitor ether1 once' },
  { group: 'Interfaces', label: 'Disable wifi2', script: '/interface wifi disable wifi2' },
  { group: 'IP', label: 'Active addresses', script: '/ip address print where interface=bridge1' },
  { group: 'IP', label: 'Default route', script: '/ip route print where dst-address=0.0.0.0/0' },
  { group: 'IP', label: 'Ping 1.1.1.1', script: '/ping 1.1.1.1 count=3' },
  { group: 'Firewall', label: 'Filter rules', script: '/ip firewall filter print stats' },
  { group: 'Firewall', label: 'Block a host', script: '/ip firewall address-list add list=BlockedNets address=203.0.113.99 timeout=1d' },
  { group: 'DHCP', label: 'Leases', script: '/ip dhcp-server lease print' },
  { group: 'DHCP', label: 'Make lease static', script: '/ip dhcp-server lease make-static [find address="192.168.88.11"]' },
  { group: 'Diagnostics', label: 'Torch ether1', script: '/tool torch interface=ether1 duration=3' },
  { group: 'Diagnostics', label: 'Sniffer quick', script: '/tool sniffer quick interface=ether1 duration=3' },
  { group: 'Backups', label: 'Export config', script: '/export compact file=dashboard-export' },
  { group: 'Backups', label: 'Create backup', script: '/system backup save name=dashboard-backup' },
  { group: 'Logs', label: 'Recent logs', script: '/log print where topics~"error"' },
];

const Console: React.FC = () => {
  const { refreshMs, mode, capabilities } = useApp();
  const [script, setScript] = useState(':put [/system/resource/get version]');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('rcd.consoleHistory') ?? '[]'); } catch { return []; }
  });
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { localStorage.setItem('rcd.consoleHistory', JSON.stringify(history.slice(0, 25))); }, [history]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { void run(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (override?: string) => {
    const cmd = (override ?? script).trim();
    if (!cmd) return;
    setRunning(true);
    const id = Date.now();
    try {
      const res = await api.console(cmd);
      setEntries((e) => [{ id, script: cmd, at: id, rows: res.rows, raw: res.raw, ms: res.ms }, ...e].slice(0, 40));
      setHistory((h) => [cmd, ...h.filter((x) => x !== cmd)].slice(0, 25));
    } catch (err: any) {
      setEntries((e) => [{ id, script: cmd, at: id, error: err?.message ?? 'Command failed', hint: err?.hint }, ...e].slice(0, 40));
      toast.error('Command failed', err?.message, err?.hint);
    } finally {
      setRunning(false);
    }
  };

  const grouped = EXAMPLES.reduce<Record<string, typeof EXAMPLES>>((acc, e) => { (acc[e.group] ||= []).push(e); return acc; }, {});

  return (
    <div className="mx-auto max-w-[1500px] p-3 sm:p-4">
      <header className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight">Console</h1>
          <p className="mt-0.5 max-w-3xl text-[12.5px] text-dim">
            Execute any RouterOS console command through <span className="mono">POST /rest/execute</span>. The response is returned as JSON — handy for
            one-off tasks, quick audits and scripting.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={mode === 'demo' ? 'info' : 'good'}>{mode === 'demo' ? 'demo device — output is simulated' : 'live device'}</Badge>
          {capabilities?.device?.version && <Badge tone="neutral">RouterOS {String(capabilities.device.version).split(' ')[0]}</Badge>}
        </div>
      </header>

      <div className="grid gap-3 xl:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-3">
          <Card title="Run a command" icon="Terminal" subtitle="⌘/Ctrl + Enter to execute" bodyClassName="p-3">
            <div className="relative">
              <textarea
                ref={inputRef}
                value={script}
                onChange={(e) => setScript(e.target.value)}
                spellCheck={false}
                rows={3}
                placeholder=":put [/system/resource/get version]"
                className="mono w-full resize-y rounded-lg border border-line bg-base2/60 p-3 pr-24 text-[12.5px] text-ink placeholder-faint focus:border-brand/60 focus:outline-none"
              />
              <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
                <CopyButton value={script} />
                <Button size="sm" variant="primary" icon="Play" loading={running} onClick={() => run()}>Run</Button>
              </div>
            </div>
            {history.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="label">History</span>
                {history.slice(0, 6).map((h) => (
                  <button key={h} className="chip chip-neutral mono max-w-[240px] truncate hover:border-line2" onClick={() => setScript(h)} title={h}>{h}</button>
                ))}
                <button className="btn btn-sm btn-ghost ml-auto" onClick={() => setHistory([])}>Clear</button>
              </div>
            )}
          </Card>

          {entries.length === 0 && (
            <Card>
              <EmptyState
                icon="SquareTerminal"
                title="Nothing executed yet"
                hint="Pick an example from the right, or type any RouterOS command. Everything the RouterOS console accepts works here — scripts, print commands, and monitoring calls."
              />
            </Card>
          )}

          {entries.map((e) => (
            <Card
              key={e.id}
              title={<span className="mono text-[12.5px]">{e.script}</span>}
              icon={e.error ? 'AlertTriangle' : 'TerminalSquare'}
              tone={e.error ? 'bad' : 'accent'}
              subtitle={`${new Date(e.at).toLocaleTimeString()} · ${e.error ? 'failed' : `${e.rows?.length ?? 0} rows in ${e.ms ?? 0} ms`}`}
              actions={<Button size="sm" variant="ghost" icon="RotateCw" onClick={() => run(e.script)} />}
            >
              {e.error ? (
                <div className="text-[12.5px] text-bad">{e.error}{e.hint && <div className="mt-1 text-[11.5px] text-faint">{e.hint}</div>}</div>
              ) : e.raw ? (
                <pre className="mono max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-base2/60 p-3 text-[11.5px] text-dim">{e.raw}</pre>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-line">
                  <table className="w-full text-left text-[12px]">
                    <thead className="bg-panel2 text-[11px] uppercase tracking-wide text-faint">
                      <tr>{Object.keys(e.rows?.[0] ?? {}).filter((k) => k !== '.id').map((k) => <th key={k} className="px-2.5 py-1.5">{k}</th>)}</tr>
                    </thead>
                    <tbody>
                      {(e.rows ?? []).map((r, i) => (
                        <tr key={i} className="border-t border-line/50">
                          {Object.keys(e.rows?.[0] ?? {}).filter((k) => k !== '.id').map((k) => (
                            <td key={k} className="mono px-2.5 py-1 text-dim">{typeof r[k] === 'boolean' ? String(r[k]) : String(r[k] ?? '')}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          <Card title="Example commands" icon="Sparkles" subtitle="Click to load into the editor">
            <div className="space-y-3">
              {Object.entries(grouped).map(([group, items]) => (
                <div key={group}>
                  <div className="label mb-1.5">{group}</div>
                  <div className="space-y-1">
                    {items.map((ex) => (
                      <button
                        key={ex.script}
                        onClick={() => { setScript(ex.script); inputRef.current?.focus(); }}
                        className={clsx('group flex w-full items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left hover:border-line hover:bg-panel2')}
                      >
                        <Icon name="ChevronRight" size={12} className="shrink-0 text-faint" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12px] text-ink">{ex.label}</span>
                          <span className="mono block truncate text-[10.5px] text-faint">{ex.script}</span>
                        </span>
                        <Icon name="CornerDownLeft" size={12} className="shrink-0 text-faint opacity-0 group-hover:opacity-100" />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Safety notes" icon="ShieldAlert" tone="warn">
            <ul className="space-y-1.5 text-[11.5px] leading-snug text-faint">
              <li className="flex gap-2"><Icon name="AlertTriangle" size={13} className="mt-0.5 shrink-0 text-warn" />Commands run with the policies of the configured API user. Prefer a dedicated <span className="mono">rest-api</span> user.</li>
              <li className="flex gap-2"><Icon name="Save" size={13} className="mt-0.5 shrink-0" />Back up before bulk changes: <span className="mono">/system backup save name=pre-change</span>.</li>
              <li className="flex gap-2"><Icon name="History" size={13} className="mt-0.5 shrink-0" />Every command here is also visible in the router log, so actions are auditable.</li>
            </ul>
          </Card>

          <Card title="Scheduled output" icon="Timer" subtitle="Auto-refresh preference from settings">
            <div className="text-[12px] text-dim">{refreshMs ? `Dashboard screens refresh every ${refreshMs / 1000}s.` : 'Auto-refresh is currently off.'}</div>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Console;
