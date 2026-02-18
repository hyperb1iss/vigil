# Vigil Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a full AI-powered PR lifecycle TUI — dashboard, 6 agents, HITL/YOLO modes, learning system.

**Architecture:** Bun + Ink 6 + React 19 TUI backed by Zustand store. Claude Agent SDK agents (in-process streaming) handle triage, fixes, responses, rebases, evidence, and learning. GitHub data via `gh` CLI. XDG-compliant config/data paths. SilkCircuit Neon theme.

**Tech Stack:** Bun, TypeScript 5.9 (strict), Ink 6, React 19, Zustand, Claude Agent SDK, simple-git, Biome 2, yargs

**Parallelization:** Tasks are grouped into phases. Tasks within the same phase can be built by parallel agents. Each task is self-contained with exact file paths, types, and code.

---

## Phase A: Foundation (Sequential)

### Task 1: Project Bootstrap

Bootstrap the Bun + Ink project with all dependencies, tooling, and config.

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `biome.json`
- Create: `CLAUDE.md`
- Create: `.gitignore`
- Create: `build.ts`
- Create: `src/cli.ts` (placeholder)

**Step 1: Create package.json**

```json
{
  "name": "@hyperb1iss/vigil",
  "version": "0.1.0",
  "description": "AI-powered PR lifecycle management for the terminal",
  "type": "module",
  "main": "dist/cli.js",
  "bin": {
    "vigil": "dist/cli.js"
  },
  "files": ["dist"],
  "scripts": {
    "dev": "bun run --watch src/cli.ts",
    "build": "bun run build.ts",
    "build:compile": "bun run build.ts --compile",
    "link": "bun run build && mkdir -p ~/.local/bin && ln -sf \"$(pwd)/dist/cli.js\" ~/.local/bin/vigil && echo 'Linked vigil -> ~/.local/bin/vigil'",
    "check": "bun run typecheck && bun run lint:all && bun test",
    "lint": "biome lint .",
    "lint:fix": "biome lint --write .",
    "lint:all": "biome check .",
    "lint:all:fix": "biome check --write --unsafe .",
    "format": "biome format --write .",
    "format:check": "biome format .",
    "test": "bun test",
    "test:watch": "bun test --watch",
    "test:coverage": "bun test --coverage --coverage-reporter=text --coverage-reporter=lcov",
    "typecheck": "tsc --noEmit",
    "typecheck:watch": "tsc --noEmit --watch",
    "clean": "rm -rf dist"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/hyperb1iss/vigil.git"
  },
  "author": "Stefanie Jane <stef@hyperbliss.tech>",
  "license": "Apache-2.0",
  "keywords": ["cli", "terminal", "tui", "github", "pr", "code-review", "ai", "agent"],
  "engines": {
    "bun": ">=1.1.0"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.1.76",
    "ink": "^6.6.0",
    "ink-spinner": "^5.0.0",
    "react": "^19.2.3",
    "simple-git": "^3.27.0",
    "yargs": "^18.0.0",
    "zod": "^3.24.0",
    "zustand": "^5.0.0"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.3.10",
    "@types/bun": "^1.3.5",
    "@types/react": "^19.2.7",
    "@types/yargs": "^17.0.35",
    "typescript": "^5.9.3"
  }
}
```

**Step 2: Create tsconfig.json**

Match `q` project config with strict mode, Bun target, JSX support.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "useUnknownInCatchVariables": true,
    "alwaysStrict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": false,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "types": ["bun-types"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "docs", "**/*.test.ts"]
}
```

**Step 3: Create biome.json**

Match `q` project Biome config — single quotes, 100 char lines, strict rules.

```json
{
  "$schema": "https://biomejs.dev/schemas/2.3.10/schema.json",
  "files": {
    "includes": ["src/**", "*.json", "*.ts"],
    "ignoreUnknown": true
  },
  "assist": {
    "actions": {
      "source": {
        "organizeImports": "on"
      }
    }
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "performance": {
        "noAccumulatingSpread": "error",
        "noBarrelFile": "off",
        "noReExportAll": "off"
      },
      "complexity": {
        "noBannedTypes": "error",
        "noUselessTypeConstraint": "error",
        "noExcessiveCognitiveComplexity": "off"
      },
      "correctness": {
        "noUnusedVariables": "error",
        "noUnusedImports": "error",
        "noUnusedFunctionParameters": "warn",
        "noUnusedPrivateClassMembers": "error",
        "useExhaustiveDependencies": "warn",
        "noUndeclaredDependencies": "error",
        "noUndeclaredVariables": "error"
      },
      "style": {
        "noNonNullAssertion": "error",
        "useConst": "error",
        "useImportType": "error",
        "useExportType": "error",
        "useEnumInitializers": "error",
        "noInferrableTypes": "error",
        "useShorthandFunctionType": "error",
        "useConsistentArrayType": {
          "level": "error",
          "options": { "syntax": "shorthand" }
        },
        "useNamingConvention": "off"
      },
      "suspicious": {
        "noExplicitAny": "error",
        "noConfusingVoidType": "error",
        "noArrayIndexKey": "off",
        "noAssignInExpressions": "error",
        "noAsyncPromiseExecutor": "error",
        "noDoubleEquals": "error",
        "noEmptyBlockStatements": "warn",
        "noMisleadingInstantiator": "error",
        "noUnsafeDeclarationMerging": "error",
        "useAwait": "off"
      },
      "security": {
        "noDangerouslySetInnerHtml": "error"
      },
      "nursery": {
        "noFloatingPromises": "error",
        "noMisusedPromises": "error",
        "noShadow": "off"
      }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "javascript": {
    "globals": ["Bun"],
    "formatter": {
      "quoteStyle": "single",
      "trailingCommas": "es5",
      "arrowParentheses": "asNeeded"
    }
  }
}
```

**Step 4: Create .gitignore**

```
node_modules/
dist/
*.tsbuildinfo
.DS_Store
coverage/
.env
.env.local
bun.lock
```

**Step 5: Create build.ts**

```typescript
import { $ } from 'bun';

const isCompile = process.argv.includes('--compile');

if (isCompile) {
  await $`bun build src/cli.ts --compile --outfile ./vigil --external @anthropic-ai/claude-agent-sdk --external react-devtools-core`;
} else {
  await $`bun build src/cli.ts --outdir dist --target bun --external @anthropic-ai/claude-agent-sdk --external react-devtools-core`;
}
```

**Step 6: Create placeholder src/cli.ts**

```typescript
#!/usr/bin/env bun
console.log('vigil');
```

**Step 7: Create CLAUDE.md**

```markdown
# Vigil

AI-powered PR lifecycle management for the terminal.

## Stack

- **Runtime:** Bun (>=1.1.0)
- **TUI:** Ink 6 + React 19
- **AI:** Claude Agent SDK (in-process streaming)
- **State:** Zustand
- **GitHub:** gh CLI
- **Git:** simple-git
- **Linting:** Biome 2

## Commands

- `bun run dev` — Watch mode
- `bun run build` — Bundle to dist/
- `bun run check` — Typecheck + lint + test
- `bun run lint:fix` — Auto-fix lint issues
- `bun test` — Run tests

## Architecture

See `docs/plans/2026-02-18-vigil-architecture-design.md` for full design.

## Conventions

- Strict TypeScript — no `any`, no non-null assertions
- Single quotes, 2-space indent, 100 char line width
- SilkCircuit Neon color palette for all terminal output
- XDG paths for config/data/cache (not ~/.vigil)
- All agents run in-process via Claude Agent SDK
- Zustand store is the single source of truth
```

**Step 8: Install dependencies**

```bash
bun install
```

**Step 9: Verify setup**

```bash
bun run typecheck && bun run lint:all
```

**Step 10: Commit**

```bash
git add package.json tsconfig.json biome.json .gitignore build.ts src/cli.ts CLAUDE.md bun.lock
git commit -m "feat: project bootstrap with Bun + Ink + Claude Agent SDK"
```

---

### Task 2: Domain Types

Define all TypeScript types for the domain model — PRs, events, agents, config, store.

**Files:**
- Create: `src/types/pr.ts`
- Create: `src/types/events.ts`
- Create: `src/types/agents.ts`
- Create: `src/types/config.ts`
- Create: `src/types/store.ts`
- Create: `src/types/index.ts`

**Step 1: Create PR types — `src/types/pr.ts`**

```typescript
export type PrState = 'hot' | 'waiting' | 'ready' | 'dormant' | 'blocked';

export type CheckStatus = 'COMPLETED' | 'IN_PROGRESS' | 'QUEUED' | 'PENDING';
export type CheckConclusion = 'SUCCESS' | 'FAILURE' | 'SKIPPED' | 'CANCELLED' | 'NEUTRAL' | null;
export type MergeableState = 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
export type ReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | '';
export type ReviewState = 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';

export interface PrAuthor {
  login: string;
  name?: string;
  isBbot: boolean;
}

export interface PrLabel {
  id: string;
  name: string;
  color: string;
}

export interface PrReview {
  id: string;
  author: PrAuthor;
  state: ReviewState;
  body: string;
  submittedAt: string;
}

export interface PrComment {
  id: string;
  author: PrAuthor;
  body: string;
  createdAt: string;
  url: string;
}

export interface PrCheck {
  name: string;
  status: CheckStatus;
  conclusion: CheckConclusion;
  workflowName?: string;
  detailsUrl?: string;
}

export interface PrWorktree {
  path: string;
  branch: string;
  isClean: boolean;
  uncommittedChanges: number;
}

export interface PullRequest {
  /** Unique key: "owner/repo#number" */
  key: string;
  number: number;
  title: string;
  body: string;
  url: string;
  repository: {
    name: string;
    nameWithOwner: string;
  };
  author: PrAuthor;
  headRefName: string;
  baseRefName: string;
  isDraft: boolean;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  mergeable: MergeableState;
  reviewDecision: ReviewDecision;
  reviews: PrReview[];
  comments: PrComment[];
  checks: PrCheck[];
  labels: PrLabel[];
  additions: number;
  deletions: number;
  changedFiles: number;
  createdAt: string;
  updatedAt: string;
  worktree?: PrWorktree;
}
```

**Step 2: Create event types — `src/types/events.ts`**

```typescript
import type { PrCheck, PrComment, PrReview, PullRequest } from './pr.js';

export type EventType =
  | 'pr_opened'
  | 'pr_closed'
  | 'pr_merged'
  | 'review_submitted'
  | 'comment_added'
  | 'checks_changed'
  | 'conflict_detected'
  | 'conflict_resolved'
  | 'branch_behind'
  | 'labels_changed'
  | 'ready_to_merge'
  | 'became_draft'
  | 'undrafted';

export interface PrEvent {
  type: EventType;
  prKey: string;
  pr: PullRequest;
  timestamp: string;
  data?: EventData;
}

export type EventData =
  | { type: 'review_submitted'; review: PrReview }
  | { type: 'comment_added'; comment: PrComment }
  | { type: 'checks_changed'; checks: PrCheck[]; previousChecks: PrCheck[] }
  | { type: 'branch_behind'; commitsBehind: number }
  | { type: 'labels_changed'; added: string[]; removed: string[] };
```

**Step 3: Create agent types — `src/types/agents.ts`**

```typescript
export type AgentName = 'triage' | 'fix' | 'respond' | 'rebase' | 'evidence' | 'learning';
export type AgentStatus = 'idle' | 'running' | 'completed' | 'failed';

export type TriageClassification = 'blocking' | 'suggestion' | 'nice-to-have' | 'scope-creep' | 'noise';
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
  completedAt?: string;
  streamingOutput: string;
  result?: AgentResult;
  error?: string;
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
  detail?: string;
  diff?: string;
  requiresConfirmation: boolean;
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';
}

export interface CompletedAction extends ProposedAction {
  executedAt: string;
  output?: string;
}
```

**Step 4: Create config types — `src/types/config.ts`**

```typescript
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
  trustLevel?: BotTrustLevel;
  parseBlocking?: boolean;
  parseSuggestions?: boolean;
  templates?: Record<string, string>;
  linkPattern?: RegExp;
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
  titleFormat?: string;
  bots?: Record<string, BotConfig>;
  monorepo?: MonorepoConfig;
  reviewPatterns?: ReviewPattern[];
  alwaysConfirm?: string[];
  worktrees?: WorktreeConfig;
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
  fix?: string;
  template?: string;
  confidence: number;
}
```

**Step 5: Create store types — `src/types/store.ts`**

```typescript
import type { AgentRun, CompletedAction, ProposedAction } from './agents.js';
import type { VigilConfig } from './config.js';
import type { PrState, PullRequest } from './pr.js';

export type ViewName = 'dashboard' | 'detail' | 'action';

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
  focusedPr: string | null;
  selectedAction: number;
  scrollOffset: number;

  // Notifications
  notifications: Notification[];

  // Config
  config: VigilConfig;

  // PR actions
  setPrs: (prs: Map<string, PullRequest>) => void;
  setPrState: (key: string, state: PrState) => void;
  updatePr: (key: string, pr: Partial<PullRequest>) => void;

  // Agent actions
  startAgentRun: (run: AgentRun) => void;
  updateAgentRun: (id: string, update: Partial<AgentRun>) => void;
  completeAgentRun: (id: string, result: AgentRun['result']) => void;
  enqueueAction: (action: ProposedAction) => void;
  approveAction: (id: string) => void;
  rejectAction: (id: string) => void;

  // UI actions
  setView: (view: ViewName) => void;
  setFocusedPr: (key: string | null) => void;
  setMode: (mode: 'hitl' | 'yolo') => void;
  scrollUp: () => void;
  scrollDown: () => void;

  // Notifications
  addNotification: (notification: Notification) => void;
  markRead: (id: string) => void;

  // Polling
  setPolling: (isPolling: boolean) => void;
  setLastPollAt: (timestamp: string) => void;
}
```

**Step 6: Create barrel export — `src/types/index.ts`**

```typescript
export type * from './pr.js';
export type * from './events.js';
export type * from './agents.js';
export type * from './config.js';
export type * from './store.js';
```

**Step 7: Typecheck**

```bash
bun run typecheck
```

**Step 8: Commit**

```bash
git add src/types/
git commit -m "feat: domain type definitions for PRs, events, agents, config, store"
```

---

## Phase B: Core Modules (Parallel — 4 agents)

These 4 tasks can be built simultaneously by different agents. They depend on Task 2 (types) but not on each other.

### Task 3: XDG Config System

**Files:**
- Create: `src/config/xdg.ts`
- Create: `src/config/defaults.ts`
- Create: `src/config/loader.ts`
- Create: `src/config/index.ts`
- Test: `src/config/xdg.test.ts`

**`src/config/xdg.ts`** — XDG path resolution with macOS fallbacks:

```typescript
import { homedir } from 'node:os';
import { join } from 'node:path';

function env(key: string): string | undefined {
  return process.env[key];
}

export function xdgConfig(): string {
  return env('XDG_CONFIG_HOME') ?? join(homedir(), '.config');
}

export function xdgData(): string {
  return env('XDG_DATA_HOME') ?? join(homedir(), '.local', 'share');
}

export function xdgCache(): string {
  return env('XDG_CACHE_HOME') ?? join(homedir(), '.cache');
}

export const paths = {
  config: () => join(xdgConfig(), 'vigil'),
  configFile: () => join(xdgConfig(), 'vigil', 'config.json'),
  data: () => join(xdgData(), 'vigil'),
  knowledgeFile: () => join(xdgData(), 'vigil', 'knowledge.md'),
  cache: () => join(xdgCache(), 'vigil'),
  snapshotDir: () => join(xdgCache(), 'vigil', 'snapshots'),
} as const;
```

**`src/config/defaults.ts`** — Default config values:

```typescript
import type { VigilConfig } from '../types/index.js';

export const defaultConfig: VigilConfig = {
  pollIntervalMs: 30_000,
  defaultMode: 'hitl',
  notifications: {
    enabled: true,
    onCiFailure: true,
    onBlockingReview: true,
    onReadyToMerge: true,
    onNewComment: false,
  },
  agent: {
    model: 'claude-sonnet-4-6',
    maxAutoFixesPerPr: 5,
    autoRespondToScopeCreep: true,
  },
  learning: {
    enabled: true,
    backend: 'markdown',
    captureAfterMerge: true,
  },
  display: {
    dormantThresholdHours: 48,
    maxPrsOnDashboard: 20,
    colorScheme: 'silkcircuit',
  },
};
```

**`src/config/loader.ts`** — Load global config + per-repo .vigilrc.ts:

```typescript
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import type { RepoConfig, VigilConfig } from '../types/index.js';
import { defaultConfig } from './defaults.js';
import { paths } from './xdg.js';

export function loadGlobalConfig(): VigilConfig {
  const configPath = paths.configFile();
  if (!existsSync(configPath)) {
    return { ...defaultConfig };
  }
  const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
  return { ...defaultConfig, ...raw };
}

export function ensureDirectories(): void {
  for (const dir of [paths.config(), paths.data(), paths.cache(), paths.snapshotDir()]) {
    mkdirSync(dir, { recursive: true });
  }
}

export async function loadRepoConfig(repoDir: string): Promise<RepoConfig | null> {
  const rcPath = `${repoDir}/.vigilrc.ts`;
  if (!existsSync(rcPath)) return null;
  const mod = await import(rcPath);
  return mod.default as RepoConfig;
}
```

**Test, typecheck, commit.**

---

### Task 4: GitHub Data Layer

**Files:**
- Create: `src/core/github.ts`
- Test: `src/core/github.test.ts`

Wraps `gh` CLI for PR data fetching. Two-pass approach: `gh search prs` for cross-repo discovery, `gh pr view` for rich detail per-PR.

Key functions:
- `fetchMyOpenPrs(repos?: string[])` — Returns lightweight PR list across all repos
- `fetchPrDetail(owner: string, repo: string, number: number)` — Returns full PR with reviews, checks, comments
- `postComment(owner: string, repo: string, number: number, body: string)`
- `editComment(commentUrl: string, body: string)`
- `mergePr(owner: string, repo: string, number: number, method: 'merge' | 'squash' | 'rebase')`

All functions shell out to `gh` via `Bun.spawn` and parse JSON output. Include proper error handling for rate limits, auth failures, network issues.

**Implementation notes:**
- `gh search prs --author=@me --state=open` lacks `headRefName`, `mergeable`, `reviews`, `statusCheckRollup` — must follow up with `gh pr view` per-repo
- `gh pr view --json` returns rich data — fields: `mergeable`, `mergeStateStatus`, `reviewDecision`, `statusCheckRollup`, `reviews`, `comments`, `additions`, `deletions`, `changedFiles`
- `statusCheckRollup` has two shapes: `CheckRun` (GitHub Actions) and `StatusContext` (external) — normalize both
- Use `--repo owner/repo` flag for cross-repo operations

---

### Task 5: Worktree Discovery

**Files:**
- Create: `src/core/worktrees.ts`
- Test: `src/core/worktrees.test.ts`

Uses `simple-git` to discover worktrees for each PR's branch.

Key functions:
- `discoverWorktrees(repoPaths: string[])` — Runs `git worktree list` across all repo paths, returns branch→path mapping
- `findWorktreeForBranch(branch: string, worktrees: Map<string, string>)` — Matches PR branch to local worktree
- `getWorktreeStatus(path: string)` — Returns clean/dirty status and uncommitted change count
- `createWorktree(repoDir: string, branch: string, targetDir: string)` — Creates new worktree for a branch

**Implementation notes:**
- Search paths from config: `worktrees.searchPaths` (e.g., `~/dev/worktrees/v2`)
- Also check `git worktree list --porcelain` for programmatic parsing
- Match on branch name (strip `refs/heads/` prefix)

---

### Task 6: SilkCircuit Theme

**Files:**
- Create: `src/tui/theme.ts`
- Test: `src/tui/theme.test.ts`

SilkCircuit Neon palette + semantic color mapping for Ink components.

```typescript
export const palette = {
  electricPurple: '#e135ff',
  neonCyan: '#80ffea',
  coral: '#ff6ac1',
  electricYellow: '#f1fa8c',
  successGreen: '#50fa7b',
  errorRed: '#ff6363',
  fg: '#f8f8f2',
  muted: '#8b85a0',
  bgHighlight: '#1a162a',
} as const;

/** Semantic colors for PR states */
export const prStateColors: Record<PrState, string> = {
  hot: palette.errorRed,
  waiting: palette.electricYellow,
  ready: palette.successGreen,
  dormant: palette.muted,
  blocked: palette.electricPurple,
};

/** Semantic colors for UI elements */
export const semantic = {
  branch: palette.neonCyan,
  hash: palette.coral,
  timestamp: palette.electricYellow,
  marker: palette.electricPurple,
  success: palette.successGreen,
  error: palette.errorRed,
  warning: palette.electricYellow,
  info: palette.neonCyan,
  muted: palette.muted,
  fg: palette.fg,
} as const;

/** PR state indicator characters */
export const stateIndicators: Record<PrState, string> = {
  hot: '\u{1F534}',      // red circle
  waiting: '\u{1F7E1}',  // yellow circle
  ready: '\u{1F7E2}',    // green circle
  dormant: '\u26AB',     // black circle
  blocked: '\u{1F7E3}',  // purple circle
};
```

---

## Phase C: Store + Events (After Phase B)

### Task 7: Zustand Store

**Files:**
- Create: `src/store/index.ts`
- Create: `src/store/slices/prs.ts`
- Create: `src/store/slices/agents.ts`
- Create: `src/store/slices/ui.ts`

Use `createStore` from `zustand/vanilla` so agents can access the store outside React. Components use `useStore` hook with selectors.

**`src/store/index.ts`:**

```typescript
import { createStore } from 'zustand/vanilla';
import type { VigilStore } from '../types/index.js';
import { createAgentSlice } from './slices/agents.js';
import { createPrSlice } from './slices/prs.js';
import { createUiSlice } from './slices/ui.js';

export const store = createStore<VigilStore>()((...a) => ({
  ...createPrSlice(...a),
  ...createAgentSlice(...a),
  ...createUiSlice(...a),
}));

/** For React/Ink components */
export { useStore } from 'zustand';
export { store as vigilStore };
```

Each slice uses the `StateCreator` pattern from Zustand. Agents call `store.getState()` and `store.setState()` directly.

---

### Task 8: Event Differ + State Machine

**Files:**
- Create: `src/core/events.ts`
- Create: `src/core/differ.ts`
- Create: `src/core/state-machine.ts`
- Create: `src/core/poller.ts`
- Test: `src/core/state-machine.test.ts`
- Test: `src/core/differ.test.ts`

**State machine (`src/core/state-machine.ts`):**

```typescript
import type { PrState, PullRequest } from '../types/index.js';

export function classifyPr(pr: PullRequest, dormantThresholdHours: number): PrState {
  // Blocked: draft or closed
  if (pr.isDraft || pr.state !== 'OPEN') return 'blocked';

  // Hot: failing CI, blocking review, or merge conflict
  const hasCiFailure = pr.checks.some(c => c.conclusion === 'FAILURE');
  const hasBlockingReview = pr.reviewDecision === 'CHANGES_REQUESTED';
  const hasConflict = pr.mergeable === 'CONFLICTING';
  if (hasCiFailure || hasBlockingReview || hasConflict) return 'hot';

  // Ready: all checks pass + approved + no conflicts
  const allChecksPassing = pr.checks.length > 0 &&
    pr.checks.every(c => c.conclusion === 'SUCCESS' || c.conclusion === 'SKIPPED' || c.conclusion === 'NEUTRAL');
  const isApproved = pr.reviewDecision === 'APPROVED';
  const isMergeable = pr.mergeable === 'MERGEABLE';
  if (allChecksPassing && isApproved && isMergeable) return 'ready';

  // Dormant: no activity beyond threshold
  const hoursSinceUpdate = (Date.now() - new Date(pr.updatedAt).getTime()) / (1000 * 60 * 60);
  if (hoursSinceUpdate > dormantThresholdHours) return 'dormant';

  // Waiting: everything else (CI running, reviews pending, etc.)
  return 'waiting';
}
```

**Differ (`src/core/differ.ts`):**

Compares previous PR snapshot to current and emits `PrEvent[]`. Detects: new comments, new reviews, check state transitions, mergeable changes, label changes, PR open/close/merge.

**Poller (`src/core/poller.ts`):**

Runs on interval. Calls GitHub data layer → differ → state machine → store update → agent orchestrator dispatch. Uses `setInterval` with configurable period.

---

## Phase D: TUI + Agent Infra (Parallel — 3 agents, after Phase C)

### Task 9: TUI Dashboard

**Files:**
- Create: `src/tui/dashboard.tsx`
- Create: `src/tui/pr-row.tsx`
- Create: `src/tui/agent-status.tsx`
- Create: `src/tui/notification.tsx`
- Create: `src/app.tsx`

**Dashboard** — Main view. Lists all PRs sorted by state priority (hot → waiting → ready → blocked → dormant). Each PR is a `PrRow` component that subscribes to its store slice.

**PrRow** — Shows: state indicator, number, title, branch, CI status, review status, last activity, worktree path. Color-coded by state using SilkCircuit palette.

**AgentStatus** — Shows currently running agents with streaming output. Positioned at bottom of dashboard.

**App** — Root component. Handles keyboard navigation (arrow keys, enter, escape, `r` refresh, `a` auto-fix, `y` toggle YOLO, `q` quit, `m` merge). Routes between dashboard/detail/action views.

**Keyboard map:**
- `j`/`k` or `↑`/`↓` — Navigate PR list
- `Enter` — Open PR detail view
- `Escape` — Back to dashboard
- `r` — Force refresh
- `y` — Toggle HITL/YOLO mode
- `m` — Merge focused PR (if ready)
- `q` — Quit
- `1-9` — Quick approve action by number (in action panel)

---

### Task 10: Agent Infrastructure

**Files:**
- Create: `src/agents/tools/git.ts`
- Create: `src/agents/tools/github.ts`
- Create: `src/agents/tools/fs.ts`
- Create: `src/agents/orchestrator.ts`

**Tool definitions** — Using Claude Agent SDK's `tool()` + `createSdkMcpServer()`:

- **git tools:** `git_status`, `git_diff`, `git_add`, `git_commit`, `git_push`, `git_rebase`, `git_worktree_list`
- **github tools:** `gh_pr_view`, `gh_pr_comment`, `gh_pr_edit_comment`, `gh_pr_merge`, `gh_pr_review`
- **fs tools:** `read_file`, `write_file`, `list_files` (scoped to worktree dir)

All tools validate that file operations stay within the PR's worktree directory (safety boundary).

**Orchestrator** — Receives events from poller, dispatches to agents:

```typescript
export async function handleEvents(events: PrEvent[]): Promise<void> {
  for (const event of events) {
    // Always triage first
    const triageResult = await runTriageAgent(event);

    // Route based on triage
    if (triageResult.routing === 'dismiss') continue;

    const mode = store.getState().mode;
    if (mode === 'hitl') {
      // Queue as proposed action
      store.getState().enqueueAction(buildAction(event, triageResult));
    } else {
      // Check alwaysConfirm list
      if (requiresConfirmation(triageResult)) {
        store.getState().enqueueAction(buildAction(event, triageResult));
      } else {
        await executeAgent(triageResult.routing, event);
      }
    }
  }
}
```

---

### Task 11: Learning System

**Files:**
- Create: `src/learning/knowledge.ts`
- Create: `src/learning/patterns.ts`
- Test: `src/learning/knowledge.test.ts`

**knowledge.ts** — Read/write/search the markdown knowledge file:

- `readKnowledge()` — Parse markdown into structured sections
- `writeKnowledge(sections)` — Serialize back to markdown
- `appendPattern(section, pattern)` — Add a new pattern to the right section
- `findPatterns(query)` — Simple string matching for relevant patterns
- `bumpConfidence(section, trigger)` — Increment confidence counter
- `getKnowledgeAsContext()` — Returns full file content as string for agent system prompts

**patterns.ts** — Extract patterns from completed PR lifecycle:

- `extractReviewPatterns(pr, events)` — What feedback came up, what was the resolution
- `extractCiPatterns(pr, events)` — What CI failed, how was it fixed
- `extractResponsePatterns(pr, events)` — What pushback worked, what didn't

---

## Phase E: All Agents (Parallel — 6 agents, after Phase D)

Each agent follows the same structure: system prompt + tool set + handler. All use Claude Agent SDK `query()` with streaming.

### Task 12: Triage Agent

**File:** `src/agents/triage.ts`

**Model:** haiku (fast)
**Tools:** gh read, knowledge read
**System prompt:** Classify incoming PR events. Read the event, the PR context, and the knowledge base. Return a structured classification: blocking/suggestion/nice-to-have/scope-creep/noise. Route to the appropriate action agent. Distinguish bot reviews from human reviews. Recognize learned patterns.

---

### Task 13: Fix Agent

**File:** `src/agents/fix.ts`

**Model:** sonnet
**Tools:** git, fs, gh, build commands
**System prompt:** You are a code surgeon. Apply targeted fixes for review feedback or CI failures. Read CI logs to identify exact failures. Apply known patterns first. For novel issues, analyze and fix. Always run relevant checks after fixing. Create atomic commits.

---

### Task 14: Respond Agent

**File:** `src/agents/respond.ts`

**Model:** sonnet
**Tools:** gh comment
**System prompt:** Draft contextual replies to review feedback. For scope creep: reasoned pushback citing PR intent. For acknowledged issues: clear statement of fix plan. For deferred: acknowledge + follow-up tracking. Match team communication style from knowledge base. Never defensive, always constructive.

---

### Task 15: Rebase Agent

**File:** `src/agents/rebase.ts`

**Model:** sonnet
**Tools:** git, fs, build commands
**System prompt:** Handle rebasing on target branch. Preview conflicts before executing. Resolve lock file conflicts by regeneration. For code conflicts, understand both sides and merge intelligently. Always verify build passes after rebase. Never force-push without explicit approval.

---

### Task 16: Evidence Agent

**File:** `src/agents/evidence.ts`

**Model:** haiku
**Tools:** gh comment edit, test runner
**System prompt:** Fill in verification and regression evidence sections in PR comments. Parse bot comment templates. Run relevant tests. Synthesize results into human-readable evidence. Update both verification and regression sections.

---

### Task 17: Learning Agent

**File:** `src/agents/learning.ts`

**Model:** haiku
**Tools:** knowledge write
**System prompt:** Run after PR merge/close. Extract patterns: what feedback came up, what was the fix, was it scope creep. Identify new patterns. Strengthen existing patterns that were confirmed. Weaken patterns that led to rejected fixes.

---

## Phase F: Integration (After Phase E)

### Task 18: PR Detail View + Action Panel

**Files:**
- Create: `src/tui/pr-detail.tsx`
- Create: `src/tui/action-panel.tsx`

**PR Detail** — Full context for one PR: reviews (parsed + classified), checks, agent-proposed actions, worktree status. Shows triage classification next to each review comment.

**Action Panel** — In HITL mode: numbered list of proposed actions with descriptions and diffs. Keyboard: `1-9` to approve individual, `a` to approve all, `n` to skip, `e` to edit, `d` to show full diff.

In YOLO mode: scrolling activity log of auto-executed actions.

---

### Task 19: Notification System

**Files:**
- Create: `src/notifications/notify.ts`

Desktop notifications via `osascript` (macOS). Include:
- `sendNotification(title, body, subtitle?)` — macOS notification
- Priority-based filtering (only Critical/High get desktop notifications)
- Sound for critical notifications
- Click handling to focus TUI on relevant PR (if possible via deep link)

---

### Task 20: CLI Entry Point

**Files:**
- Modify: `src/cli.ts`

Wire everything together with yargs:

```
vigil                           # All my PRs
vigil --repo owner/repo         # Focus on repo(s)
vigil --mode yolo               # Start in YOLO mode
vigil --no-agents               # Dashboard only
vigil --poll-interval 15000     # Custom poll interval
```

Flow: parse args → load config → ensure directories → start poller → render Ink app.

---

### Task 21: HITL/YOLO Mode Integration

Wire the mode toggle through the full system:
- `y` key toggles mode in store
- Orchestrator checks mode before dispatching
- Action panel shows/hides based on mode
- YOLO: auto-execute confident actions, log to history
- HITL: queue all actions for approval
- `alwaysConfirm` actions (merge, force-push, close, delete branch) always require approval regardless of mode

---

## Phase G: Polish (After Phase F)

### Task 22: End-to-End Verification

- Run `vigil` against real PRs
- Verify dashboard renders correctly with SilkCircuit colors
- Verify polling picks up changes
- Verify state machine classifies correctly
- Verify agents stream output to TUI
- Verify HITL action approval flow
- Verify notifications fire
- Fix any integration issues
- Run full quality gate: `bun run check`

**Commit and tag v0.1.0.**

---

## Agent Team Assignment

For maximum parallelism, assign tasks to agent teams:

| Phase | Tasks | Agents Needed | Dependencies |
|-------|-------|---------------|--------------|
| A | 1, 2 | 1 (sequential) | None |
| B | 3, 4, 5, 6 | 4 (parallel) | Phase A |
| C | 7, 8 | 2 (parallel) | Phase B |
| D | 9, 10, 11 | 3 (parallel) | Phase C |
| E | 12-17 | 6 (parallel) | Phase D |
| F | 18-21 | 4 (parallel) | Phase E |
| G | 22 | 1 | Phase F |

**Total: 22 tasks, ~7 sequential phases, up to 6-wide parallelism.**
