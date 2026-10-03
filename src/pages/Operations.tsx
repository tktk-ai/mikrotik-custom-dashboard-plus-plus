import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { EmptyState, Icon, Spinner, toast } from '../components/ui';
const PageHeader: React.FC<{ eyebrow: string; title: string; subtitle: string }> = ({ eyebrow, title, subtitle }) => <div><div className="label">{eyebrow}</div><h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">{title}</h1><p className="mt-1 text-sm text-dim">{subtitle}</p></div>;

const statusTone = (status: string) => status === 'approved' ? 'chip-good' : status === 'applied' ? 'chip-info' : status === 'rejected' || status === 'failed' ? 'chip-bad' : 'chip-neutral';

export default function Operations() {
  const client = useQueryClient();
  const plans = useQuery({ queryKey: ['ai-plans'], queryFn: api.aiPlans });
  const transition = useMutation({ mutationFn: ({ id, status }: { id: string; status: string }) => api.transitionPlan(id, status), onSuccess: () => { client.invalidateQueries({ queryKey: ['ai-plans'] }); toast.success('Plan updated'); }, onError: (e: Error) => toast.error('Plan update failed', e.message) });
  const apply = useMutation({ mutationFn: (id: string) => api.applyPlan(id), onSuccess: () => { client.invalidateQueries({ queryKey: ['ai-plans'] }); toast.success('Change applied and verified'); }, onError: (e: Error) => toast.error('Change failed', e.message) });
  return <div className="space-y-5 animate-in">
    <PageHeader eyebrow="AI OPERATIONS" title="Change plans" subtitle="Review, approve, and verify controlled network changes. Agents never apply unapproved plans." />
    {plans.isLoading ? <div className="grid min-h-[30vh] place-items-center"><Spinner className="size-5" /></div> : plans.error ? <EmptyState icon="AlertTriangle" title="Unable to load plans" hint={(plans.error as Error).message} /> : !plans.data?.plans.length ? <EmptyState icon="ClipboardCheck" title="No change plans" hint="AI investigations and hotspot bypass requests will appear here for review." /> : <div className="space-y-3">{plans.data.plans.map((plan: any) => <article key={plan.id} className="card p-4">
      <div className="flex flex-wrap items-start gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-medium text-ink">{plan.intent}</h2><span className={`chip ${statusTone(plan.status)}`}>{plan.status}</span><span className="chip chip-warn">{plan.risk} risk</span></div><div className="mt-1 text-xs text-faint">{plan.id} · device {plan.deviceIds?.join(', ')}</div></div><div className="flex gap-2">{plan.status === 'draft' && <button className="btn btn-sm" disabled={transition.isPending} onClick={() => transition.mutate({ id: plan.id, status: 'validated' })}><Icon name="ShieldCheck" size={13} />Validate</button>}{plan.status === 'validated' && <button className="btn btn-sm" onClick={() => transition.mutate({ id: plan.id, status: 'waiting_approval' })}>Request approval</button>}{plan.status === 'waiting_approval' && <button className="btn btn-sm btn-primary" onClick={() => transition.mutate({ id: plan.id, status: 'approved' })}>Approve</button>}{plan.status === 'approved' && <button className="btn btn-sm btn-primary" disabled={apply.isPending} onClick={() => apply.mutate(plan.id)}>{apply.isPending ? <Spinner className="size-3" /> : <Icon name="Play" size={13} />}Apply and verify</button>}</div></div>
      <div className="mt-4 grid gap-3 md:grid-cols-3"><div><div className="label">Actions</div><p className="mt-1 text-sm text-dim">{plan.actions?.length ?? 0} typed action(s)</p></div><div><div className="label">Verification</div><ul className="mt-1 space-y-1 text-xs text-dim">{(plan.verification ?? []).slice(0, 3).map((v: string) => <li key={v}>• {v}</li>)}</ul></div><div><div className="label">Rollback</div><ul className="mt-1 space-y-1 text-xs text-dim">{(plan.rollback ?? []).slice(0, 3).map((v: string) => <li key={v}>• {v}</li>)}</ul></div></div>
    </article>)}</div>}
  </div>;
}
