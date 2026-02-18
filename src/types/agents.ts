export type AgentName = 'triage' | 'fix' | 'respond' | 'rebase' | 'evidence' | 'learning';
export type AgentStatus = 'idle' | 'running' | 'completed' | 'failed';

export type TriageClassification =
  | 'blocking'
  | 'suggestion'
  | 'nice-to-have'
  | 'scope-creep'
  | 'noise';

export type TriageRouting = 'fix' | 'respond' | 'rebase' | 'evidence' | 'dismiss';
export type TriagePriority = 'immediate' | 'can-wait' | 'informational';

export interface TriageResult {
  classification: TriageClassification;
  routing: TriageRouting;
  priority: TriagePriority;
  reasoning: string;
}

export interface AgentRun {
  id: string;
  agent: AgentName;
  prKey: string;
  status: AgentStatus;
  startedAt: string;
  completedAt?: string | undefined;
  streamingOutput: string;
  result?: AgentResult | undefined;
  error?: string | undefined;
}

export interface AgentResult {
  success: boolean;
  summary: string;
  actions: ProposedAction[];
}

export type ActionType =
  | 'apply_fix'
  | 'push_commit'
  | 'post_comment'
  | 'edit_comment'
  | 'rebase'
  | 'create_worktree'
  | 'merge'
  | 'close'
  | 'dismiss';

export interface ProposedAction {
  id: string;
  type: ActionType;
  prKey: string;
  agent: AgentName;
  description: string;
  detail?: string | undefined;
  diff?: string | undefined;
  requiresConfirmation: boolean;
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';
}

export interface CompletedAction extends ProposedAction {
  executedAt: string;
  output?: string | undefined;
}
