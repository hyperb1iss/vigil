# Vigil

**AI-powered PR lifecycle management for the terminal.**

Vigil is a real-time terminal dashboard that monitors your pull requests, triages review feedback, auto-fixes what it can, and learns from every PR cycle. It turns the tedious loop of "push, wait, read review, fix, push again" into an intelligent, semi-autonomous workflow.

Generic by design. Team-specific by configuration.

---

## Why Vigil Exists

The PR lifecycle is one of the most interrupt-driven parts of software engineering. You push code. You wait. CI runs. A bot leaves a review. A human leaves a review. CI fails on something unrelated. You context-switch back, re-read the feedback, figure out what's worth fixing vs what's scope creep, make changes, push again, update the PR description, fill in verification evidence, respond to comments, request re-review. Repeat.

Most of this is mechanical. The judgment calls are small and pattern-based. An agent that has seen your last 50 PRs knows that the bot always flags `SECURITY DEFINER` without `SET search_path`, knows your team's commit message style, knows which reviewer cares about test coverage and which cares about rollback docs.

Vigil is that agent, living in your terminal, watching your PRs, and either handling things automatically or surfacing them for a quick human decision.

---

## Core Concepts

### PR State Machine

Every PR is classified into one of five states based on real-time signals:

| State | Meaning | Signals |
|-------|---------|---------|
| **Hot** | Needs your attention now | Unresolved blocking reviews, failing CI, merge conflicts |
| **Waiting** | Ball is in someone else's court | Reviews requested, CI running, waiting on dependencies |
| **Ready** | Green light to merge | All checks passing, approved, no conflicts |
| **Dormant** | Stale, needs a nudge or close | No activity for 48h+, stale reviews |
| **Blocked** | Can't proceed yet | Draft, depends on another PR, blocked by policy |

State transitions happen automatically as GitHub signals change. The dashboard re-renders in real-time.

### Agent-Driven Actions

Vigil doesn't just show you status — it proposes and executes actions through specialized AI agents:

- **Triage Agent** — Reads new review comments, classifies them (blocking, suggestion, nice-to-have, scope creep), and decides what to do
- **Fix Agent** — Applies code changes to address review feedback, lint errors, type failures
- **Rebase Agent** — Handles rebasing on the target branch, resolving conflicts intelligently
- **Respond Agent** — Drafts contextual replies to reviewers, pushes back on scope creep with reasoned arguments
- **Evidence Agent** — Fills in verification and regression test evidence on PR comments

### Two Modes

**HITL (Human-in-the-Loop)** — The agent proposes every action. You approve or dismiss with a keypress. Safe, controlled, you stay in the loop.

**YOLO** — The agent auto-executes anything it's confident about. Only pauses for irreversible actions (push, merge, delete branch). For when you trust the system and want to focus on other work.

### Learning System

This is the killer feature. After every PR cycle, Vigil captures patterns:

- What review feedback came up? What was the fix?
- What did the bot reviewer flag that was actually scope creep?
- What CI failures are common and how were they resolved?
- What reviewer preferences exist? (Alice cares about tests, Bob cares about rollback docs)
- What auto-fixes worked? What got rejected?

Over time, Vigil stops making the same mistakes. It learns your team's review culture, your codebase's patterns, your CI's failure modes. The knowledge compounds — every PR makes the next one smoother.

---

## Architecture

```
vigil
├── core/           # PR state machine, polling, event system
├── tui/            # Ink components — dashboard, detail, action views
├── agents/         # Claude Agent SDK agent definitions
├── learning/       # Pattern capture, knowledge persistence
├── config/         # Pluggable repo-specific instructions
└── notifications/  # macOS/Linux desktop notifications
```

### Data Flow

```
GitHub API (polling)
       │
       ▼
  Event Differ ── detects changes since last poll
       │
       ▼
  State Machine ── updates PR states (hot/waiting/ready/...)
       │
       ├──▶ TUI Renderer ── re-renders dashboard
       │
       └──▶ Agent Orchestrator ── decides if action needed
                │
                ├──▶ Auto-execute (YOLO mode)
                │         │
                │         ▼
                │    gh CLI / git operations
                │
                └──▶ Propose to user (HITL mode)
                          │
                          ▼
                     TUI Action Panel
```

### GitHub Data Layer

Vigil polls the GitHub API via `gh` CLI at a configurable interval (default: 30 seconds). It tracks:

- **PR metadata** — title, description, state, draft status, labels, assignees
- **Reviews** — requested, pending, approved, changes requested, dismissed
- **Comments** — issue comments, review comments, inline comments
- **Check runs** — CI status per check, logs for failures
- **Merge state** — conflicts, mergeable status, required checks
- **Branch state** — behind target by N commits, diverged

The differ compares each poll against the previous state and emits granular events: `new_comment`, `ci_failed`, `review_submitted`, `conflict_detected`, `checks_passed`, etc.

### Agent Orchestrator

The orchestrator receives events and routes them to the appropriate agent. Each agent is a Claude Agent SDK agent with a focused system prompt and tool set.

```
Event: new_comment (from: claude-bot, type: blocking_review)
  │
  ▼
Triage Agent
  ├── "This is a real issue (search_path hardening)" → route to Fix Agent
  ├── "This is scope creep (add UPDATE trigger)" → route to Respond Agent
  └── "This is a nice-to-have" → note for learning, dismiss
```

Agents have access to:
- `gh` CLI for GitHub operations
- `git` for repository operations
- The learning knowledge base for pattern matching
- The repo-specific configuration for team conventions

### Learning Persistence

Patterns are stored in a local knowledge graph (Sibyl integration or standalone SQLite). Each pattern has:

- **Trigger** — What review signal or CI failure activated it
- **Resolution** — What fix or response resolved it
- **Confidence** — How many times this pattern has been seen and confirmed
- **Repo scope** — Whether it's repo-specific or universal

High-confidence patterns are promoted to auto-fix rules. Low-confidence patterns are surfaced as suggestions.

---

## Terminal Interface

### Dashboard View

The primary view. Shows all your open PRs sorted by state priority (hot first, dormant last).

```
╭─ vigil ──────────────────────────────── 3 hot · 2 waiting · 5 dormant ─╮
│                                                                          │
│  🔴 #3058  feat(keys): add shortcut sync          feature/auto-keys     │
│     CI ✅  │  Reviews: 1 blocking  │  Last activity: 2m ago            │
│     → Claude flagged search_path. Auto-fixable.           [enter: view] │
│                                                                          │
│  🔴 #3044  chore(ui): normalize pattern list      feature/patterns      │
│     CI ❌ typecheck failing  │  Conflicts with main                     │
│     → Needs rebase + type fix                             [enter: view] │
│                                                                          │
│  🟡 #3055  fix: persist cache artifact changes     feature/cf-meta      │
│     CI 🔄 running  │  Awaiting review from @jordan                     │
│                                                                          │
│  🟢 #2898  feat: per-entity workflow config       feature/workflow      │
│     CI ✅  │  Approved  │  Ready to merge                               │
│     → [m] merge  [s] squash                                              │
│                                                                          │
│  ⚫ #2679  fix: fallback for empty output         feature/fallback       │
│     No activity 5d  │  1 stale review                                   │
│                                                                          │
╰─ [r] refresh  [a] auto-fix all  [y] yolo mode  [q] quit ────────────────╯
```

Each PR row is a reactive component that updates as events arrive. State colors follow the SilkCircuit palette (coral for hot, electric yellow for waiting, success green for ready, dim for dormant, electric purple for blocked).

### PR Detail View

Drill into a specific PR to see the full context and agent-proposed actions.

```
╭─ #3058 feat(keys): add shortcut sync ───────────────────────────────────╮
│                                                                           │
│  Branch: feature/auto-keys → main                                        │
│  State: 🔴 Hot  │  CI: ✅ passing  │  Mergeable: yes                    │
│  Linear: ENG-1018 Dashboard polish                                       │
│                                                                           │
├─ Reviews ─────────────────────────────────────────────────────────────────┤
│                                                                           │
│  🤖 claude-code-review[bot]  ·  4m ago                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │ 🚫 Blocking: Missing SET search_path on SECURITY DEFINER          │  │
│  │    → Agent assessment: Real issue. Auto-fixable.                   │  │
│  │    → Learned pattern: 3 prior PRs had this exact feedback          │  │
│  │                                                                     │  │
│  │ ⚠️ Suggestion: INSERT vs UPDATE on key rotation trigger            │  │
│  │    → Agent assessment: Scope creep. Single-key-per-instance.       │  │
│  │    → Recommend: Respond with justification, dismiss.               │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                                                           │
├─ Proposed Actions ────────────────────────────────────────────────────────┤
│                                                                           │
│  1. [f] Fix search_path (auto)     Add SET search_path = public          │
│  2. [r] Respond to scope creep     Draft pushback on UPDATE trigger      │
│  3. [e] Update evidence            Fill truthsayer verification comment  │
│  4. [p] Push changes               Push fixup commit to remote           │
│                                                                           │
│  [a] Execute all  │  [esc] back to dashboard                             │
│                                                                           │
╰───────────────────────────────────────────────────────────────────────────╯
```

### Action Confirmation

In HITL mode, every action gets a confirmation panel before execution:

```
╭─ Confirm Action ─────────────────────────────────────────────────────────╮
│                                                                           │
│  Fix: Add SET search_path = public to SECURITY DEFINER function          │
│                                                                           │
│  File: apps/supabase/migrations/20260217140000_fix_eval_scheduler...sql  │
│  Line 35:                                                                │
│  - $$ LANGUAGE plpgsql SECURITY DEFINER;                                 │
│  + $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;        │
│                                                                           │
│  [y] Apply  [n] Skip  [e] Edit  [d] Show full diff                      │
│                                                                           │
╰───────────────────────────────────────────────────────────────────────────╯
```

### Notification Toasts

When the TUI is running but not focused, high-priority events appear as macOS/Linux notifications:

- **CI failed on #3058** — "typecheck: Property 'status' does not exist"
- **Blocking review on #3044** — "Missing error handling for null case"
- **PR #2898 ready to merge** — "All checks passing, 2 approvals"

Clicking a notification focuses the TUI on that PR.

---

## Configuration

### Global Config (`$XDG_CONFIG_HOME/vigil/config.json`)

```json
{
  "pollIntervalMs": 30000,
  "defaultMode": "hitl",
  "notifications": {
    "enabled": true,
    "onCiFailure": true,
    "onBlockingReview": true,
    "onReadyToMerge": true,
    "onNewComment": false
  },
  "agent": {
    "model": "claude-sonnet-4-6",
    "maxAutoFixesPerPr": 5,
    "autoRespondToScopeCreep": true
  },
  "learning": {
    "enabled": true,
    "backend": "markdown",
    "captureAfterMerge": true
  },
  "display": {
    "dormantThresholdHours": 48,
    "maxPrsOnDashboard": 20,
    "colorScheme": "silkcircuit",
    "dashboardFeedMode": "mine"
  },
  "radar": {
    "enabled": true,
    "repos": [
      {
        "repo": "owner/repo",
        "domainRules": [],
        "watchAll": true
      }
    ],
    "teams": [],
    "pollIntervalMs": 60000,
    "merged": {
      "limit": 10,
      "maxAgeHours": 48,
      "domainOnly": true
    },
    "notifications": {
      "onDirectReviewRequest": true,
      "onNewDomainPr": true,
      "onMergedDomainPr": false
    },
    "excludeBotDrafts": true,
    "excludeOwnPrs": true,
    "staleCutoffDays": 30
  }
}
```

### Repo Config (`.vigilrc.json` in repo root)

This is where team-specific behavior lives. The generic core never hardcodes repo-specific logic.

```json
{
  "owner": "acme",
  "repo": "webapp",
  "baseBranch": "main",
  "titleFormat": "<type>(<scope>): [ENG|FDE-XXXX] <description>",
  "bots": {
    "claude-code-review[bot]": {
      "role": "code-reviewer",
      "trustLevel": "advisory",
      "parseBlocking": true,
      "parseSuggestions": true
    },
    "acme-truthsayer[bot]": {
      "role": "pr-template",
      "templates": {
        "verification": "## Verification Evidence",
        "regression": "## Regression Test Evidence"
      }
    },
    "linear[bot]": {
      "role": "issue-tracker"
    }
  },
  "monorepo": {
    "tool": "turbo",
    "packageDirs": ["apps/*", "packages/*"],
    "buildCommand": "turbo build",
    "typecheckCommand": "turbo typecheck",
    "lintCommand": "turbo lint:fix"
  },
  "reviewPatterns": [
    {
      "trigger": "SECURITY DEFINER without SET search_path",
      "action": "auto-fix",
      "fix": "Add SET search_path = public after SECURITY DEFINER",
      "confidence": 1.0
    },
    {
      "trigger": "PR description test count mismatch",
      "action": "auto-fix",
      "fix": "Count tests in file and update PR body",
      "confidence": 0.9
    },
    {
      "trigger": "scope creep suggestion on single-use trigger",
      "action": "respond",
      "template": "This is a {description} scenario. The trigger handles the production case. Adding {suggestion} is overengineering for a {context} model.",
      "confidence": 0.7
    }
  ],
  "alwaysConfirm": [
    "git push --force",
    "merge",
    "close",
    "delete branch"
  ]
}
```

---

## Agent System

### Agent Architecture

Each agent is a Claude Agent SDK agent with a focused role, specific tools, and access to the shared knowledge base.

```
                    ┌──────────────────┐
                    │   Orchestrator   │
                    │   (event router) │
                    └────────┬─────────┘
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                   │
    ┌─────▼─────┐    ┌──────▼──────┐    ┌──────▼──────┐
    │  Triage   │    │    Fix      │    │   Respond   │
    │  Agent    │    │    Agent    │    │   Agent     │
    └───────────┘    └────────────┘    └─────────────┘
          │                  │                   │
    ┌─────▼─────┐    ┌──────▼──────┐    ┌──────▼──────┐
    │  Rebase   │    │  Evidence   │    │  Learning   │
    │  Agent    │    │  Agent      │    │  Agent      │
    └───────────┘    └────────────┘    └─────────────┘
```

### Triage Agent

**Role:** First responder. Reads new events and decides what to do.

**Inputs:**
- New PR event (comment, review, CI status change, conflict)
- PR context (description, files changed, previous reviews)
- Knowledge base (learned patterns for this repo)

**Outputs:**
- Classification: blocking / suggestion / nice-to-have / scope creep / noise
- Routing: which agent should handle this
- Priority: immediate / can-wait / informational

**Key behaviors:**
- Distinguishes between bot reviews and human reviews (different handling)
- Recognizes patterns from the knowledge base ("we've seen this exact feedback 3 times before")
- Detects scope creep by comparing review suggestions against the PR's stated intent
- Assigns urgency based on CI status + review state + time since last activity

### Fix Agent

**Role:** Code surgeon. Applies targeted fixes to address review feedback or CI failures.

**Inputs:**
- Review comment or CI failure log
- Relevant source files
- Known fix patterns from knowledge base

**Tools:**
- File read/write
- Git operations (stage, commit)
- Build/typecheck/lint commands (from monorepo config)

**Key behaviors:**
- Reads CI logs to identify exact failure (not just "typecheck failed" but which file/line)
- Applies learned patterns first (high-confidence fixes don't need the LLM)
- For novel issues, uses Claude to analyze and propose a fix
- Always runs the relevant check after fixing (typecheck after type fix, lint after lint fix)
- Creates atomic commits with clear messages

### Respond Agent

**Role:** Diplomat. Drafts contextual replies to review feedback.

**Inputs:**
- Review comment to respond to
- Triage classification (scope creep, acknowledged, deferred)
- PR context and intent
- Knowledge base (how this team communicates)

**Tools:**
- GitHub comment API
- Knowledge base search (past responses to similar feedback)

**Key behaviors:**
- For scope creep: reasoned pushback citing the PR's intent and practical constraints
- For acknowledged issues: clear statement of what will be fixed and how
- For deferred items: acknowledgment with follow-up tracking
- Matches the team's communication style (learned from past interactions)
- Never defensive, always constructive

### Rebase Agent

**Role:** Merge conflict resolver. Handles the mechanical pain of staying up to date.

**Inputs:**
- Target branch state
- Conflict file list
- PR's changed files and intent

**Tools:**
- Git rebase/merge operations
- File read/write for conflict resolution
- Build verification commands

**Key behaviors:**
- Previews conflicts before executing (shows what will conflict and proposed resolution)
- Resolves lock file conflicts by regeneration (pnpm-lock.yaml, etc.)
- For code conflicts, uses Claude to understand both sides and merge intelligently
- Always verifies the build passes after rebase
- Never force-pushes without explicit approval

### Evidence Agent

**Role:** Documentation automator. Fills in verification and regression evidence.

**Inputs:**
- PR's changed files and test results
- Template comments from bots (e.g., truthsayer's evidence sections)
- Test output from CI or local runs

**Tools:**
- GitHub comment API (edit existing comments)
- Test runner commands
- Build/CI log reader

**Key behaviors:**
- Parses bot comment templates to find evidence sections
- Runs relevant tests and captures output
- Synthesizes test results into human-readable evidence
- Updates both verification and regression sections
- Includes test names, pass/fail counts, and relevant output snippets

### Learning Agent

**Role:** Librarian. Captures patterns from completed PR cycles.

**Inputs:**
- Full PR lifecycle (comments, reviews, fixes, responses, merge)
- Agent actions taken and their outcomes

**Tools:**
- Knowledge base write (Sibyl or local storage)
- Pattern extraction prompts

**Key behaviors:**
- Runs after PR merge (or close)
- Extracts: what feedback came up, what was the fix, was it scope creep
- Identifies new patterns (first time seeing this feedback type)
- Strengthens existing patterns (seen this before, same resolution)
- Weakens patterns that led to rejected fixes
- Periodic synthesis: "In the last 20 PRs, the most common feedback is X"

---

## Learning System

### How Patterns Evolve

```
First occurrence:
  "Bot flagged missing SET search_path"
  → Captured as pattern, confidence: 0.3

Second occurrence (same fix worked):
  → Confidence bumped to 0.6

Third occurrence:
  → Confidence: 0.85
  → Promoted to auto-fix candidate

Fourth occurrence:
  → Confidence: 0.95
  → Auto-applied in YOLO mode, shown as suggestion in HITL mode
```

### Pattern Categories

| Category | Examples | Storage |
|----------|----------|---------|
| **Review patterns** | "Bot always flags X", "Reviewer Y cares about Z" | Per-repo |
| **CI patterns** | "Typecheck fails when touching migrations", "Lint flaky on generated files" | Per-repo |
| **Fix patterns** | "search_path fix is always the same one-liner" | Universal |
| **Response patterns** | "Scope creep pushback template for single-use triggers" | Per-repo |
| **Reviewer profiles** | "claude-bot: thorough but scope-creepy", "@alice: focuses on perf" | Per-repo |

### Knowledge Backends

- **Sibyl** — Full graph-RAG with semantic search. Best for teams that already use Sibyl.
- **SQLite** — Local, zero-dependency, good enough for most teams.
- **JSON** — Flat file, simplest possible. Good for getting started.

The learning API is backend-agnostic — patterns are just data objects with a consistent shape.

---

## Notification System

### Priority Levels

| Priority | Events | Notification Type |
|----------|--------|-------------------|
| **Critical** | CI failure, blocking review, merge conflict | macOS banner + sound |
| **High** | New review, checks passed, ready to merge | macOS banner |
| **Medium** | New comment, status change | Badge update only |
| **Low** | Bot comment, label change | Silent (visible in TUI) |

### Implementation

```
Event arrives via polling
       │
       ▼
  Is TUI focused?
  ├── Yes → Update TUI, highlight the PR
  └── No  → Check priority level
              ├── Critical/High → macOS notification (osascript)
              └── Medium/Low → Queue for next TUI focus
```

Clicking a macOS notification deep-links to the PR detail view in the TUI.

---

## Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Runtime** | Bun | Fast startup, native TypeScript, excellent DX |
| **TUI Framework** | Ink (React for terminals) | Component model, reactive updates, familiar API |
| **AI** | Claude Agent SDK | Multi-agent orchestration, tool use, streaming |
| **GitHub** | `gh` CLI | Already authenticated, handles pagination, rate limiting |
| **Git** | `simple-git` | Programmatic git operations without shell escaping pain |
| **Notifications** | `node-notifier` / `osascript` | Cross-platform desktop notifications |
| **Knowledge** | Sibyl / SQLite / JSON | Pluggable persistence for learned patterns |

### Why Bun + Ink

- Bun's startup time matters — Vigil should feel instant when you launch it
- Ink's React model makes the TUI trivially composable and reactive
- Both are TypeScript-native with zero build step
- The Bun + Ink ecosystem already proves these patterns out in production-quality CLIs

### Why Claude Agent SDK

- First-class multi-agent support with tool use
- Agents can be specialized (triage vs fix vs respond) without complex routing
- Streaming support for real-time feedback in the TUI
- Model selection per agent (fast model for triage, capable model for fixes)

---

## Development Roadmap

### Phase 1: Foundation

Polling loop, PR state machine, basic dashboard rendering. No agents yet — just a live PR status board.

**Milestone:** Launch `vigil` and see all your open PRs with accurate states, auto-refreshing.

### Phase 2: Agent Core

Triage agent + fix agent. Read review comments, classify them, apply known fixes.

**Milestone:** Vigil auto-fixes a lint error from CI and proposes the fix in HITL mode.

### Phase 3: Full Agent Suite

Respond agent, rebase agent, evidence agent. Complete the PR lifecycle loop.

**Milestone:** Vigil handles a full review cycle: reads feedback, fixes what it can, responds to scope creep, updates evidence, and is ready for re-review.

### Phase 4: Learning

Pattern capture after merge, confidence scoring, auto-fix promotion.

**Milestone:** Vigil auto-applies a fix it learned from a previous PR without being told.

### Phase 5: YOLO Mode

Autonomous operation for confident actions. Notification system for when it needs you.

**Milestone:** Push code, walk away. Come back to a merged PR with all reviews addressed.

---

## Worktree Awareness

Vigil is built for developers who use git worktrees — multiple branches checked out simultaneously in different directories. This is the default workflow for teams where feature branches live in dedicated worktree directories.

### How Vigil Discovers Worktrees

On startup, Vigil scans for worktrees associated with the repo:

```
~/src/webapp/                            ← main worktree (main branch)
~/worktrees/webapp/feature/auto-keys    ← feature worktree (feature/auto-keys)
~/worktrees/webapp/feature/patterns     ← feature worktree (feature/patterns)
~/worktrees/webapp/feature/cf-meta      ← feature worktree (feature/cf-meta)
```

Each PR in the dashboard shows its local worktree path (if one exists). When the fix agent needs to apply changes, it operates in the correct worktree directory — not the main checkout.

### Worktree-Aware Actions

| Action | Behavior |
|--------|----------|
| **Fix code** | Agent operates in the PR's worktree directory |
| **Run tests** | Executed from the worktree root |
| **Rebase** | Performed in the worktree, not the main checkout |
| **Open in editor** | Opens the worktree path, not the main repo |
| **Status check** | Shows uncommitted changes per-worktree |

### Dashboard Integration

The dashboard shows worktree status alongside PR status:

```
  🔴 #3058  feat(keys): add shortcut sync               feature/auto-keys
     CI ✅  │  Reviews: 1 blocking  │  Last activity: 2m ago
     📂 ~/worktrees/webapp/feature/auto-keys  │  clean
```

```
  🔴 #3044  chore(ui): normalize pattern list            feature/patterns
     CI ❌ typecheck  │  Conflicts with main
     📂 ~/worktrees/webapp/feature/patterns  │  2 uncommitted changes
```

PRs without a local worktree show a "no local checkout" indicator with an option to create one.

### Multi-Repo Support

Vigil can monitor multiple repos simultaneously. Each repo has its own worktree discovery:

```
╭─ vigil ──────────────────────────────────────────────────────────────────╮
│                                                                          │
│  acme/webapp                                         3 hot · 2 waiting  │
│  ──────────────────────────────────────────────────────────────────────  │
│  🔴 #3058  fix(supabase): eval scheduler ...                            │
│  🔴 #3044  chore: pattern JSON view ...                                 │
│                                                                          │
│  personal/notesync                                   1 waiting          │
│  ──────────────────────────────────────────────────────────────────────  │
│  🟡 #42   feat: MCP resource subscriptions ...                          │
│                                                                          │
╰──────────────────────────────────────────────────────────────────────────╯
```

### Configuration

Worktree discovery is configured per-repo in `.vigilrc.json`:

```json
{
  "worktrees": {
    "autoDiscover": true,
    "searchPaths": [
      "~/worktrees/webapp",
      "~/.vigil-worktrees"
    ],
    "displayFormat": "branch"
  }
}
```

---

## Design Principles

**Generic core, specific config.** The PR state machine, agent orchestration, and TUI are universal. Team-specific behavior (bot parsing, CI conventions, review culture) lives in `.vigilrc.json`. You should be able to use Vigil on any GitHub repo by writing a config file.

**Learn, don't hardcode.** Instead of building rules for every possible review pattern, Vigil observes what works and promotes it. The config file seeds initial patterns, but the system gets smarter on its own.

**Human authority, machine velocity.** Even in YOLO mode, destructive actions require human approval. The agent handles the mechanical work. You make the judgment calls.

**Terminal-native.** No browser tab, no Electron app, no web dashboard. Vigil lives where you already work. Fast to launch, fast to dismiss, always one keystroke away.

**Composable agents.** Each agent does one thing well. The orchestrator composes them. Adding a new capability means adding a new agent, not modifying existing ones.
