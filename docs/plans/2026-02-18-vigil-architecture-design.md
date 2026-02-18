# Vigil Architecture Design

**Date:** 2026-02-18
**Status:** Approved

AI-powered PR lifecycle management for the terminal. Full agent suite shipping in one shot.

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Agent execution | In-process streaming | All agents run in main Bun process via Agent SDK. Non-blocking, Ink gets streaming updates natively. |
| State management | Zustand | External store agents write to directly. TUI subscribes to slices. Lightweight, proven with Ink. |
| CLI scope | All PRs, all repos | Default: `gh search prs --author=@me --state=open`. Optional `--repo` filter to focus. |
| Learning backend | Markdown file | Structured markdown at XDG data path. Human-readable, git-trackable, zero infrastructure. |
| Config paths | XDG | Config, data, cache in proper XDG locations. Per-repo config via `.vigilrc.ts`. |
| Phase 1 scope | Full agent suite | Dashboard + all 6 agents + HITL/YOLO modes. Agent teams parallelize the build. |

---

## Project Structure

```
vigil/
├── src/
│   ├── cli.ts                  # Entry point — yargs, launches Ink app
│   ├── app.tsx                 # Root Ink component, layout shell
│   ├── core/
│   │   ├── github.ts           # gh CLI wrapper — PR fetch, comments, checks
│   │   ├── poller.ts           # Polling loop with configurable interval
│   │   ├── differ.ts           # Event differ — compares snapshots, emits events
│   │   ├── state-machine.ts    # PR state classifier (hot/waiting/ready/dormant/blocked)
│   │   ├── events.ts           # Event type definitions
│   │   └── worktrees.ts        # git worktree discovery + path resolution
│   ├── store/
│   │   ├── index.ts            # Zustand store — single source of truth
│   │   └── slices/
│   │       ├── prs.ts          # PR data + states
│   │       ├── agents.ts       # Agent activity + streaming output
│   │       └── ui.ts           # Mode, focus, navigation, notifications
│   ├── agents/
│   │   ├── orchestrator.ts     # Event router → agent dispatch
│   │   ├── triage.ts           # Classify events, route to action agents
│   │   ├── fix.ts              # Code changes for review feedback / CI failures
│   │   ├── respond.ts          # Draft replies to reviewers
│   │   ├── rebase.ts           # Rebase + conflict resolution
│   │   ├── evidence.ts         # Fill verification/regression evidence
│   │   ├── learning.ts         # Post-merge pattern capture
│   │   └── tools/              # Shared tool definitions for agents
│   │       ├── git.ts          # git operations (via simple-git)
│   │       ├── github.ts       # gh CLI operations
│   │       └── fs.ts           # File read/write scoped to worktrees
│   ├── tui/
│   │   ├── dashboard.tsx       # Main view — PR list sorted by state
│   │   ├── pr-row.tsx          # Single PR row with status indicators
│   │   ├── pr-detail.tsx       # Drill-down — reviews, checks, agent actions
│   │   ├── action-panel.tsx    # HITL confirmation / YOLO activity log
│   │   ├── agent-status.tsx    # Live agent activity indicator
│   │   ├── notification.tsx    # Toast component
│   │   └── theme.ts            # SilkCircuit palette + semantic tokens
│   ├── learning/
│   │   ├── knowledge.ts        # Read/write/search the markdown knowledge file
│   │   └── patterns.ts         # Pattern extraction from PR lifecycle events
│   ├── config/
│   │   ├── loader.ts           # XDG config loading + .vigilrc.ts merge
│   │   ├── schema.ts           # Config type definitions + defaults
│   │   └── xdg.ts              # XDG path resolution
│   └── notifications/
│       └── notify.ts           # macOS/Linux desktop notifications
├── docs/
│   ├── vigil-genesis.md
│   └── plans/
├── package.json
├── tsconfig.json
├── biome.json
└── CLAUDE.md
```

---

## XDG Paths

| Purpose | Path | Contents |
|---------|------|----------|
| Config | `$XDG_CONFIG_HOME/vigil/config.ts` | Global settings (poll interval, mode, agent config) |
| Data | `$XDG_DATA_HOME/vigil/knowledge.md` | Learned patterns — workflow behaviors, reviewer tendencies |
| Cache | `$XDG_CACHE_HOME/vigil/` | PR snapshots for diffing between polls |
| Per-repo | `.vigilrc.ts` in repo root | Bot config, review patterns, worktree paths, monorepo config |

---

## CLI Interface

```
vigil                                        # All my PRs, all repos
vigil --repo gradial/v2                      # Focus on one repo
vigil --repo gradial/v2 --repo hyperb1iss/sibyl  # Multiple repos
vigil --mode yolo                            # Start in YOLO mode
vigil --no-agents                            # Dashboard only, no agent actions
```

---

## Core Data Flow

```
gh search prs --author=@me --state=open --json (all fields)
       │
       ▼
  Poller (30s default, configurable)
       │
       ▼
  Differ — compares current snapshot to previous
       │  Events: pr_opened, pr_closed, pr_merged, review_submitted,
       │  comment_added, checks_changed, conflict_detected,
       │  branch_behind, labels_changed, assignees_changed
       │
       ▼
  State Machine — classifies each PR
       │  hot:     failing CI OR blocking review OR merge conflict
       │  waiting: CI running OR reviews pending OR no activity <48h
       │  ready:   all checks pass + approved + no conflicts
       │  dormant: no activity 48h+ OR stale reviews
       │  blocked: draft OR depends on another PR OR policy block
       │
       ├──▶ Zustand Store ──▶ Ink re-renders
       │
       └──▶ Agent Orchestrator ──▶ routes events to agents
```

---

## Zustand Store

```typescript
interface VigilStore {
  // PR data — keyed by "owner/repo#number"
  prs: Map<string, PullRequest>;
  prStates: Map<string, PrState>;

  // Agent activity
  activeAgents: Map<string, AgentRun>;
  actionQueue: ProposedAction[];
  actionHistory: CompletedAction[];

  // UI state
  mode: 'hitl' | 'yolo';
  view: 'dashboard' | 'detail' | 'action';
  focusedPr: string | null;
  selectedAction: number;

  // Notifications
  unreadNotifications: Notification[];

  // Config
  config: ResolvedConfig;
}
```

Agents write to the store via actions. TUI is a pure subscriber — never mutates state directly except UI navigation.

---

## Agent System

### Agent Registry

| Agent | Model | Tools | Trigger Events |
|-------|-------|-------|----------------|
| Triage | haiku (fast) | gh read, knowledge read | Any new event — first responder |
| Fix | sonnet | git, fs, gh, build commands | Blocking review, CI failure |
| Respond | sonnet | gh comment | Scope creep, acknowledged, deferred |
| Rebase | sonnet | git, fs, build commands | conflict_detected, branch_behind |
| Evidence | haiku | gh comment edit, test runner | checks_passed + bot template exists |
| Learning | haiku | knowledge write | pr_merged, pr_closed |

### Orchestrator Flow

```
Event arrives
  │
  ├── Always → Triage Agent (classify + route)
  │
  Triage returns: { classification, routing, priority }
  │
  ├── routing: "fix"      → Fix Agent (in worktree dir)
  ├── routing: "respond"  → Respond Agent
  ├── routing: "rebase"   → Rebase Agent
  ├── routing: "evidence" → Evidence Agent
  ├── routing: "dismiss"  → Log to store, no action
  │
  └── HITL mode?
       ├── Yes → ProposedAction → TUI action panel
       └── No  → Execute (unless in alwaysConfirm list)
```

### Parallel Agent Execution

When Triage classifies multiple issues on the same PR (CI failure + blocking review + missing evidence), the orchestrator dispatches Fix, Respond, and Evidence agents simultaneously. They operate on different concerns — no conflicts.

### Agent Chaining

Fix Agent pushes commit → next poll detects new CI run → if it fails, Triage re-routes to Fix with new context. Self-corrects up to `maxAutoFixesPerPr` (default 5) before escalating.

### Safety Boundaries (Even in YOLO)

- `git push --force` → always HITL
- `merge` → always HITL
- `close PR` → always HITL
- `delete branch` → always HITL
- File ops outside worktree → blocked

### Worktree-Aware Execution

Fix and Rebase agents resolve the PR's branch to a local worktree via `git worktree list`. All file operations and git commands run scoped to that directory. No worktree = agent proposes creating one (always HITL).

---

## The Agentic Loop

```
Push code
  → Vigil detects new/updated PR (poll)
  → Triage reads ALL signals (CI, reviews, conflicts, templates)
  → Orchestrator dispatches agents IN PARALLEL
    ├── Fix Agent patches code
    ├── Respond Agent replies to reviewers
    ├── Evidence Agent fills verification sections
  → Fix pushes commit → triggers new CI
  → Next poll → loop continues until READY state
  → Notification: "PR ready to merge"
  → You hit [m] (or auto-merge in YOLO if configured)
  → Learning Agent captures lifecycle patterns → knowledge.md
  → Next PR. Smarter this time.
```

### Escalation Model

| Situation | YOLO Mode | HITL Mode |
|-----------|-----------|-----------|
| Agent confident | Auto-execute | Propose, one-keypress approval |
| Agent uncertain | Propose, never auto | Propose, never auto |
| Agent fails 3x | Escalate to human | Escalate to human |
| alwaysConfirm action | Always HITL | Always HITL |

### Multi-PR Orchestration

Vigil runs the loop for ALL open PRs simultaneously. Hot PRs get agent attention first. Dormant PRs get periodic nudge checks.

---

## Learning System

Structured markdown file at `$XDG_DATA_HOME/vigil/knowledge.md`.

### Structure

```markdown
# Vigil Knowledge

## Review Patterns
### {owner/repo} — {reviewer}
- **{trigger}** — {resolution}. Seen {N}x. [confidence: {0.0-1.0}]

## CI Patterns
### {owner/repo}
- **{failure pattern}** — {fix}. [confidence: {0.0-1.0}]

## Response Templates
### {template-name}
> {template text with {placeholders}}

## Workflow Patterns
- **{pattern}** — {insight}.
```

### Mechanics

- **Read:** Loaded as context for Triage/Respond agents each cycle.
- **Write:** Learning agent appends on pr_merged/pr_closed. Finds correct section, appends.
- **Confidence:** Counter in brackets. Bumped on success, decremented on rejection.
- **Human-editable:** Open it, edit patterns, delete stale ones, seed manually.

---

## Notification System

| Situation | TUI Focused | TUI Background |
|-----------|------------|----------------|
| Agent auto-fixed + pushed | Activity log | Silent |
| PR reached READY | Row highlight green | Desktop notification |
| Agent needs human decision | Action panel popup | Desktop notification + sound |
| Agent failed after retries | Error banner | Urgent notification |
| PR merged | Row removed | Desktop notification |

Desktop notifications via `osascript` (macOS) / `notify-send` (Linux). Clicking deep-links to the PR detail view.

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Bun | >=1.1.0 |
| TUI | Ink 6 + React 19 | latest |
| AI | Claude Agent SDK | latest |
| State | Zustand | latest |
| GitHub | gh CLI | system |
| Git | simple-git | latest |
| Notifications | osascript / notify-send | system |
| Linting | Biome 2 | latest |
| Types | TypeScript 5.9 | strict |

---

## SilkCircuit Theme

All TUI colors follow the SilkCircuit Neon palette:

| Semantic | Color | Hex |
|----------|-------|-----|
| Hot PR / Error | Error Red | `#ff6363` |
| Waiting PR / Attention | Electric Yellow | `#f1fa8c` |
| Ready PR / Success | Success Green | `#50fa7b` |
| Dormant PR | Dim (50% opacity) | — |
| Blocked PR / Markers | Electric Purple | `#e135ff` |
| Branches / Paths | Neon Cyan | `#80ffea` |
| Hashes / Numbers | Coral | `#ff6ac1` |
