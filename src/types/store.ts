import type { AgentRun, CompletedAction, ProposedAction } from './agents.js';
import type { VigilConfig } from './config.js';
import type { PrState, PullRequest } from './pr.js';

export type ViewName = 'dashboard' | 'detail' | 'action';
export type ViewMode = 'cards' | 'list';

export interface Notification {
  id: string;
  prKey: string;
  message: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  timestamp: string;
  read: boolean;
}

export interface VigilStore {
  // PR data
  prs: Map<string, PullRequest>;
  prStates: Map<string, PrState>;
  lastPollAt: string | null;
  isPolling: boolean;

  // Agent activity
  activeAgents: Map<string, AgentRun>;
  actionQueue: ProposedAction[];
  actionHistory: CompletedAction[];

  // UI state
  mode: 'hitl' | 'yolo';
  view: ViewName;
  viewMode: ViewMode;
  focusedPr: string | null;
  selectedAction: number;
  scrollOffsets: Record<ViewName, number>;

  // Notifications
  notifications: Notification[];

  // Config
  config: VigilConfig;

  // PR actions
  setPrs: (prs: Map<string, PullRequest>) => void;
  setPrState: (key: string, state: PrState) => void;
  updatePr: (key: string, update: Partial<PullRequest>) => void;

  // Agent actions
  startAgentRun: (run: AgentRun) => void;
  updateAgentRun: (id: string, update: Partial<AgentRun>) => void;
  completeAgentRun: (id: string, result: AgentRun['result']) => void;
  enqueueAction: (action: ProposedAction) => void;
  approveAction: (id: string) => void;
  rejectAction: (id: string) => void;

  // UI actions
  setView: (view: ViewName) => void;
  setViewMode: (viewMode: ViewMode) => void;
  setFocusedPr: (key: string | null) => void;
  setMode: (mode: 'hitl' | 'yolo') => void;
  scrollView: (view: ViewName, delta: number, max: number, visible?: number) => void;
  resetScroll: (view: ViewName) => void;

  // Notifications
  addNotification: (n: Notification) => void;
  markRead: (id: string) => void;

  // Polling
  setPolling: (isPolling: boolean) => void;
  setLastPollAt: (timestamp: string) => void;
}
