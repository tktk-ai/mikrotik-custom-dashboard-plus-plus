/** Shared contracts for evidence-backed network agents. No agent may bypass these
 * contracts to execute an arbitrary RouterOS script. */
export type EvidenceConfidence = 'confirmed' | 'inferred' | 'stale' | 'partial';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type PlanStatus = 'draft' | 'validated' | 'waiting_approval' | 'approved' | 'applied' | 'rejected' | 'cancelled' | 'failed';

export interface EvidenceRef {
  id: string;
  deviceId: string;
  sourcePath: string;
  sourceRowId?: string;
  observedAt: number;
  confidence: EvidenceConfidence;
  summary: string;
}

export interface PlannedAction {
  id: string;
  deviceId: string;
  operation: 'create' | 'update' | 'delete' | 'command';
  resource: string;
  description: string;
  parameters: Record<string, unknown>;
  reversible: boolean;
}

export interface ChangePlan {
  id: string;
  intent: string;
  deviceIds: string[];
  risk: RiskLevel;
  status: PlanStatus;
  actions: PlannedAction[];
  preconditions: string[];
  expectedEffects: string[];
  verification: string[];
  rollback: string[];
  evidence: EvidenceRef[];
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  approvedBy?: string;
  approvedAt?: number;
}

export interface Investigation {
  id: string;
  title: string;
  goal: string;
  deviceIds: string[];
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  evidence: EvidenceRef[];
  findings: string[];
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}
