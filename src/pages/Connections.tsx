import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api, type ConnectionInfo, type TestResult } from '../lib/api';
import { useApp } from '../lib/store';
import { relativeTime } from '../lib/format';
import { Badge, Button, Card, CopyButton, EmptyState, Field, Icon, Modal, Toggle, toast } from '../components/ui';

const ROUTER_SETUP = `/ip service set www-ssl disabled=no
/ip service set www disabled=no

# dedicated API user (read+write, no console access)
/user group add name=rest-api policy=read,write,api,rest-api,test
/user add name=dashboard group=rest-api password=CHANGE-ME

# reachable from the dashboard host only
/ip firewall filter add chain=input action=accept protocol=tcp dst-port=443 \\
  src-address=192.168.88.0/24 comment="dashboard REST"`;

const Connections: React.FC = () => {
  const qc = useQueryClient();
  const { connections, activeId, refreshCapabilities } = useApp();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ConnectionInfo | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult | undefined>>({});

  const testMutation = useMutation({
    mutationFn: (id: string) => api.testConnection(id),
    onSuccess: (result, id) => {
      setTestResults((t) => ({ ...t, [id]: result }));
      if (result.ok) toast.success('Connection OK', `${result.identity ?? ''} ${result.board ?? ''}`.trim() || `${result.latencyMs} ms`);
      else toast.error('Connection failed', result.error, result.hint);
    },
  });

  const activate = useMutation({
    mutationFn: (id: string) => api.activateConnection(id),
    onSuccess: async () => { await qc.invalidateQueries(); toast.success('Active device switched'); },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.removeConnection(id),
    onSuccess: async () => { await qc.invalidateQueries(); toast.success('Connection deleted'); },
  });

  return (
    <div className="mx-auto max-w-[1200px] p-3 sm:p-4">
      <header className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight">Device connections</h1>
          <p className="mt-0.5 max-w-3xl text-[12.5px] text-dim">
            The dashboard talks to RouterOS through the official REST API (<span className="mono">/rest/…</span>, RouterOS 7.1+). Credentials are stored
            server-side in <span className="mono">data/connections.json</span> and never sent to the browser.
          </p>
        </div>
        <Button variant="primary" icon="Plus" onClick={() => setAdding(true)}>Add device</Button>
      </header>

      <div className="grid gap-3 lg:grid-cols-[1.5fr_1fr]">
        <div className="flex flex-col gap-3">
          {connections.map((c) => {
            const active = c.id === activeId;
            const test = testResults[c.id];
            return (
              <Card key={c.id} className={clsx(active && 'ring-1 ring-brand/40')} bodyClassName="p-0">
                <div className="flex flex-wrap items-start gap-3 p-3.5">
                  <span className={clsx('grid size-10 shrink-0 place-items-center rounded-xl border', c.demo ? 'border-info/30 bg-info/10 text-info' : 'border-good/30 bg-good/10 text-good')}>
                    <Icon name={c.demo ? 'FlaskConical' : 'Router'} size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-[14px] font-semibold">{c.name}</h2>
                      {active && <Badge tone="accent">active</Badge>}
                      {c.demo && <Badge tone="info">simulated</Badge>}
                      {c.lastSeen && <span className="text-[11px] text-faint">last seen {relativeTime(c.lastSeen)}</span>}
                    </div>
                    <div className="mono mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-faint">
                      <span>{c.scheme}://{c.host}:{c.port}</span>
                      <span>·</span>
                      <span>user: {c.username}</span>
                      <span>·</span>
                      <span>{c.hasPassword ? 'password stored' : 'no password'}</span>
                      {!c.tlsVerify && !c.demo && <><span>·</span><span className="text-warn">TLS check off</span></>}
                    </div>
                    {c.note && <p className="mt-1 text-[11.5px] text-faint">{c.note}</p>}
                    {test && (
                      <div className={clsx('mt-2 flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-[11.5px]',
                        test.ok ? 'border-good/30 bg-good/5 text-good' : 'border-bad/30 bg-bad/5 text-bad')}>
                        <Icon name={test.ok ? 'CheckCircle2' : 'AlertTriangle'} size={13} className="mt-0.5" />
                        <div>
                          {test.ok
                            ? <span>{test.identity || 'RouterOS'} · {test.board} · {test.latencyMs} ms — REST API reachable.</span>
                            : <><div>{test.error}</div>{test.hint && <div className="text-faint">{test.hint}</div>}</>}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <Button size="sm" icon="Activity" loading={testMutation.isPending && testMutation.variables === c.id} onClick={() => testMutation.mutate(c.id)}>Test</Button>
                    {!active && <Button size="sm" variant="primary" icon="Plug" loading={activate.isPending} onClick={() => activate.mutate(c.id)}>Use</Button>}
                    {active && <Button size="sm" icon="RefreshCw" onClick={() => refreshCapabilities()}>Re-probe</Button>}
                    {!c.demo && <Button size="sm" variant="ghost" icon="Pencil" onClick={() => setEditing(c)} />}
                    {!c.demo && <Button size="sm" variant="ghost" icon="Trash2" className="text-bad" onClick={() => { if (confirm(`Delete connection “${c.name}”?`)) remove.mutate(c.id); }} />}
                  </div>
                </div>
              </Card>
            );
          })}
          {connections.length === 0 && <EmptyState icon="Router" title="No connections" hint="Add a RouterOS device to get started." action={<Button variant="primary" icon="Plus" onClick={() => setAdding(true)}>Add device</Button>} />}
        </div>

        <div className="flex flex-col gap-3">
          <Card title="Enable REST access on RouterOS" icon="Terminal" subtitle="Run this once in a RouterOS terminal" actions={<CopyButton value={ROUTER_SETUP} label="Copy" />}>
            <pre className="mono overflow-auto rounded-lg border border-line bg-base2/70 p-3 text-[11px] leading-relaxed text-dim">{ROUTER_SETUP}</pre>
            <ul className="mt-3 space-y-1.5 text-[11.5px] leading-snug text-faint">
              <li className="flex gap-2"><Icon name="KeyRound" size={13} className="mt-0.5 shrink-0" />Grant the user the <span className="mono">rest-api</span> policy — without it RouterOS answers 403 even with valid credentials.</li>
              <li className="flex gap-2"><Icon name="Shield" size={13} className="mt-0.5 shrink-0" />Self-signed certificates are the norm: leave “verify TLS certificate” off, or import your CA.</li>
              <li className="flex gap-2"><Icon name="Network" size={13} className="mt-0.5 shrink-0" />The dashboard server (not your browser) connects to the router — allow that host's address.</li>
            </ul>
          </Card>

          <Card title="How the connection works" icon="Info">
            <ol className="space-y-2 text-[12px] leading-relaxed text-dim">
              <li className="flex gap-2"><span className="mono text-brand">1</span>Every screen issues standard REST calls (<span className="mono">GET/POST/PATCH/DELETE /rest/&lt;menu&gt;</span>) through this server.</li>
              <li className="flex gap-2"><span className="mono text-brand">2</span>On activation the dashboard probes ~40 menus to learn which ones your RouterOS build supports.</li>
              <li className="flex gap-2"><span className="mono text-brand">3</span>Unsupported menus stay visible but are clearly badged, so nothing silently disappears.</li>
            </ol>
          </Card>
        </div>
      </div>

      <ConnectionModal
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={async () => { setAdding(false); await qc.invalidateQueries(); }}
      />
      {editing && (
        <ConnectionModal
          open
          connection={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await qc.invalidateQueries(); }}
        />
      )}
    </div>
  );
};

const ConnectionModal: React.FC<{ open: boolean; connection?: ConnectionInfo; onClose: () => void; onSaved: () => void }> = ({ open, connection, onClose, onSaved }) => {
  const [form, setForm] = useState({
    name: connection?.name ?? '',
    host: connection?.host ?? '192.168.88.1',
    port: connection?.port ?? 443,
    scheme: connection?.scheme ?? 'https',
    username: connection?.username ?? 'admin',
    password: '',
    tlsVerify: connection?.tlsVerify ?? false,
    test: true,
  });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setBusy(true);
    setResult(null);
    try {
      if (connection) {
        await api.updateConnection(connection.id, { ...form, password: form.password || '••••••••', test: undefined } as any);
        const test = await api.testConnection(connection.id);
        setResult(test);
        toast.success('Connection updated');
      } else {
        const res = await api.createConnection({ ...form, port: Number(form.port) } as any);
        setResult(res.test);
        toast.success('Device added', res.test?.ok ? `${res.test.identity ?? form.host} reachable` : 'Saved — check the test result');
      }
      onSaved();
    } catch (err: any) {
      toast.error('Could not save', err?.message, err?.hint);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={connection ? `Edit “${connection.name}”` : 'Add a RouterOS device'}
      subtitle="Credentials stay on the server and are used for REST calls only."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="Save" loading={busy} onClick={save}>{connection ? 'Save changes' : 'Add & test'}</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
        <Field label="Display name" className="sm:col-span-2">
          <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Head office CCR2004" />
        </Field>
        <Field label="Host / IP" required>
          <input className="input mono" value={form.host} onChange={(e) => set('host', e.target.value)} placeholder="192.168.88.1" />
        </Field>
        <Field label="Port" hint="www-ssl default 443, www (HTTP) default 80">
          <input className="input mono" type="number" value={form.port} onChange={(e) => set('port', Number(e.target.value))} />
        </Field>
        <Field label="Protocol">
          <select className="input" value={form.scheme} onChange={(e) => set('scheme', e.target.value)}>
            <option value="https">https (www-ssl)</option>
            <option value="http">http (www — plaintext, RouterOS 7.9+)</option>
          </select>
        </Field>
        <Field label="Username" required>
          <input className="input mono" value={form.username} onChange={(e) => set('username', e.target.value)} />
        </Field>
        <Field label="Password" hint={connection ? 'Leave blank to keep the stored password.' : undefined}>
          <input className="input" type="password" value={form.password} onChange={(e) => set('password', e.target.value)} placeholder={connection?.hasPassword ? '••••••••' : ''} />
        </Field>
        <div className="flex items-end pb-1">
          <Toggle checked={form.tlsVerify} onChange={(v) => set('tlsVerify', v)} label="Verify TLS certificate" />
        </div>
        {!connection && (
          <div className="flex items-end pb-1">
            <Toggle checked={form.test} onChange={(v) => set('test', v)} label="Test connection after saving" />
          </div>
        )}
      </div>

      {result && (
        <div className={clsx('mt-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-[12px]', result.ok ? 'border-good/30 bg-good/5 text-good' : 'border-bad/30 bg-bad/5 text-bad')}>
          <Icon name={result.ok ? 'CheckCircle2' : 'AlertTriangle'} size={14} className="mt-0.5" />
          <div>
            {result.ok ? <span>{result.identity} · {result.board} · {result.latencyMs} ms</span> : <><div>{result.error}</div>{result.hint && <div className="mt-0.5 text-faint">{result.hint}</div>}</>}
          </div>
        </div>
      )}

      <div className="mt-4 rounded-lg border border-line bg-panel2/50 p-3 text-[11.5px] leading-snug text-faint">
        <div className="mb-1 flex items-center gap-1.5 text-dim"><Icon name="Info" size={12} />Need the demo device back?</div>
        The simulated CCR2004 is always available in the list — activate it to explore every screen without hardware.
      </div>
    </Modal>
  );
};

export default Connections;
