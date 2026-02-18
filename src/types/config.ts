export type VigilMode = 'hitl' | 'yolo';
export type LearningBackend = 'markdown';
export type ColorScheme = 'silkcircuit' | 'monochrome';

export interface VigilConfig {
  pollIntervalMs: number;
  defaultMode: VigilMode;
  notifications: NotificationConfig;
  agent: AgentConfig;
  learning: LearningConfig;
  display: DisplayConfig;
}

export interface NotificationConfig {
  enabled: boolean;
  onCiFailure: boolean;
  onBlockingReview: boolean;
  onReadyToMerge: boolean;
  onNewComment: boolean;
}

export interface AgentConfig {
  model: string;
  maxAutoFixesPerPr: number;
  autoRespondToScopeCreep: boolean;
}

export interface LearningConfig {
  enabled: boolean;
  backend: LearningBackend;
  captureAfterMerge: boolean;
}

export interface DisplayConfig {
  dormantThresholdHours: number;
  maxPrsOnDashboard: number;
  colorScheme: ColorScheme;
}

export type BotRole = 'code-reviewer' | 'pr-template' | 'issue-tracker';
export type BotTrustLevel = 'advisory' | 'authoritative';

export interface BotConfig {
  role: BotRole;
  trustLevel?: BotTrustLevel | undefined;
  parseBlocking?: boolean | undefined;
  parseSuggestions?: boolean | undefined;
  templates?: Record<string, string> | undefined;
}

export interface WorktreeConfig {
  autoDiscover: boolean;
  searchPaths: string[];
  displayFormat: 'branch' | 'path' | 'both';
}

export interface RepoConfig {
  owner: string;
  repo: string;
  baseBranch: string;
  titleFormat?: string | undefined;
  bots?: Record<string, BotConfig> | undefined;
  monorepo?: MonorepoConfig | undefined;
  reviewPatterns?: ReviewPattern[] | undefined;
  alwaysConfirm?: string[] | undefined;
  worktrees?: WorktreeConfig | undefined;
}

export interface MonorepoConfig {
  tool: string;
  packageDirs: string[];
  buildCommand: string;
  typecheckCommand: string;
  lintCommand: string;
}

export interface ReviewPattern {
  trigger: string;
  action: 'auto-fix' | 'respond' | 'dismiss';
  fix?: string | undefined;
  template?: string | undefined;
  confidence: number;
}
