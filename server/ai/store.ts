import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { atomicWriteJson } from '../persistence';
import type { ChangePlan, Investigation, PlannedAction, RiskLevel } from '../../shared/ai';

const dir = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
const file = path.join(dir, 'ai-workflows.json');
interface State { plans: ChangePlan[]; investigations: Investigation[] }
let state: State | null = null;

function load(): State {
  if (state) return state;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<State>;
    state = { plans: Array.isArray(parsed.plans) ? parsed.plans : [], investigations: Array.isArray(parsed.investigations) ? parsed.investigations : [] };
  } catch { state = { plans: [], investigations: [] }; }
  return state;
}
function save() {
  const current = load();
  atomicWriteJson(file, current);
}
const id = (prefix: string) => `${prefix}-${crypto.randomBytes(8).toString('hex')}`;

export function listPlans(): ChangePlan[] { return [...load().plans].sort((a, b) => b.updatedAt - a.updatedAt); }
export function getPlan(planId: string): ChangePlan | undefined { return load().plans.find((p) => p.id === planId); }
export function createPlan(input: { intent: string; deviceIds: string[]; risk: RiskLevel; actions?: PlannedAction[]; preconditions?: string[]; expectedEffects?: string[]; verification?: string[]; rollback?: string[]; createdBy?: string }): ChangePlan {
  const now = Date.now();
  const plan: ChangePlan = { id: id('plan'), intent: input.intent.trim().slice(0, 1000), deviceIds: input.deviceIds.slice(0, 50), risk: input.risk, status: 'draft', actions: (input.actions ?? []).slice(0, 100), preconditions: (input.preconditions ?? []).slice(0, 50), expectedEffects: (input.expectedEffects ?? []).slice(0, 50), verification: (input.verification ?? []).slice(0, 50), rollback: (input.rollback ?? []).slice(0, 50), evidence: [], createdBy: input.createdBy || 'api', createdAt: now, updatedAt: now, expiresAt: now + 24 * 60 * 60 * 1000 };
  load().plans.push(plan); save(); return plan;
}
export function transitionPlan(planId: string, status: ChangePlan['status'], actor: string): ChangePlan | undefined {
  const plan = getPlan(planId); if (!plan) return undefined;
  const allowed: Record<ChangePlan['status'], ChangePlan['status'][]> = { draft: ['validated', 'cancelled'], validated: ['waiting_approval', 'cancelled'], waiting_approval: ['approved', 'rejected', 'cancelled'], approved: ['applied', 'failed', 'cancelled'], applied: [], rejected: [], cancelled: [], failed: [] };
  if (!allowed[plan.status].includes(status)) throw new Error(`Cannot transition plan from ${plan.status} to ${status}.`);
  plan.status = status; plan.updatedAt = Date.now();
  if (status === 'approved') { plan.approvedBy = actor; plan.approvedAt = Date.now(); }
  save(); return plan;
}
export function listInvestigations(): Investigation[] { return [...load().investigations].sort((a, b) => b.updatedAt - a.updatedAt); }
export function createInvestigation(input: { title: string; goal: string; deviceIds: string[]; createdBy?: string }): Investigation {
  const now = Date.now();
  const item: Investigation = { id: id('investigation'), title: input.title.trim().slice(0, 200), goal: input.goal.trim().slice(0, 2000), deviceIds: input.deviceIds.slice(0, 50), status: 'queued', evidence: [], findings: [], createdBy: input.createdBy || 'api', createdAt: now, updatedAt: now };
  load().investigations.push(item); save(); return item;
}
