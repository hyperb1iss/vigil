import type { AgentRun, CompletedAction, ProposedAction } from './agents.js';
import type { VigilConfig } from './config.js';
import type { PrEvent } from './events.js';
import type { PrState, PullRequest } from './pr.js';
import type { DashboardFeedMode, RadarFilter, RadarPr } from './radar.js';

export type ViewName = 'dashboard' | 'detail' | 'action' | 'activity';
export type ViewMode = 'cards' | 'list';
export type SortMode = 'activity' | 'state';
export type DetailFocus = 'navigator' | 'inspector';

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
  prEvents: Map<string, PrEvent[]>;
  prStates: Map<string, PrState>;
  lastPollAt: string | null;
  isPolling: boolean;
  pollError: string | null;
  radarPrs: Map<string, RadarPr>;
  mergedRadarPrs: Map<string, RadarPr>;
  radarLastPollAt: string | null;
  radarIsPolling: boolean;
  radarPollError: string | null;
  radarFilter: RadarFilter | null;

  // Agent activity
  activeAgents: Map<string, AgentRun>;
  actionQueue: ProposedAction[];
  actionHistory: CompletedAction[];

  // UI state
  mode: 'hitl' | 'yolo';
  view: ViewName;
  viewMode: ViewMode;
  sortMode: SortMode;
  dashboardFeedMode: DashboardFeedMode;
  focusedPr: string | null;
  detailFocus: DetailFocus;
  detailSelection: number;
  selectedAction: number;
  scrollOffsets: Record<ViewName, number>;
  searchQuery: string | null; // null = inactive, string = active filter
  showVerboseLogs: boolean;

  // Notifications
  notifications: Notification[];

  // Config
  config: VigilConfig;

  // PR actions
  setPrs: (prs: Map<string, PullRequest>) => void;
  recordPrEvents: (events: PrEvent[]) => void;
  setPrState: (key: string, state: PrState) => void;
  updatePr: (key: string, update: Partial<PullRequest>) => void;
  setRadarPrs: (prs: Map<string, RadarPr>) => void;
  setMergedRadarPrs: (prs: Map<string, RadarPr>) => void;
  updateRadarPr: (key: string, update: Partial<PullRequest>) => void;
  updateMergedRadarPr: (key: string, update: Partial<PullRequest>) => void;

  // Agent actions
  startAgentRun: (run: AgentRun) => void;
  updateAgentRun: (id: string, update: Partial<AgentRun>) => void;
  completeAgentRun: (id: string, result: AgentRun['result']) => void;
  enqueueAction: (action: ProposedAction) => void;
  approveAction: (id: string) => void;
  rejectAction: (id: string) => void;
  markActionExecuted: (id: string, output?: string) => void;
  markActionFailed: (id: string, output: string) => void;

  // UI actions
  setView: (view: ViewName) => void;
  setViewMode: (viewMode: ViewMode) => void;
  setSortMode: (sortMode: SortMode) => void;
  setDashboardFeedMode: (mode: DashboardFeedMode) => void;
  cycleDashboardFeedMode: () => void;
  setFocusedPr: (key: string | null) => void;
  setDetailFocus: (focus: DetailFocus) => void;
  cycleDetailFocus: (reverse?: boolean) => void;
  setDetailSelection: (index: number) => void;
  moveDetailSelection: (delta: number, max: number) => void;
  setMode: (mode: 'hitl' | 'yolo') => void;
  setConfig: (config: VigilConfig) => void;
  setSearchQuery: (query: string | null) => void;
  scrollView: (view: ViewName, delta: number, max: number, visible?: number) => void;
  resetScroll: (view: ViewName) => void;
  toggleVerboseLogs: () => void;

  // Notifications
  addNotification: (n: Notification) => void;
  markRead: (id: string) => void;

  // Polling
  setPolling: (isPolling: boolean) => void;
  setLastPollAt: (timestamp: string) => void;
  setPollError: (message: string | null) => void;
  setRadarPolling: (isPolling: boolean) => void;
  setRadarLastPollAt: (timestamp: string) => void;
  setRadarPollError: (message: string | null) => void;
  setRadarFilter: (filter: RadarFilter | null) => void;
}
