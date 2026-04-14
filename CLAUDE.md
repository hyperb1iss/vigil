# Vigil

AI-powered PR lifecycle management for the terminal.

## Stack

- **Runtime:** Bun (>=1.1.0)
- **TUI:** Ink 6 + React 19
- **AI:** Claude Agent SDK (in-process streaming)
- **State:** Zustand (vanilla store, agents write directly)
- **GitHub:** gh CLI (no direct API calls)
- **Git:** simple-git
- **Linting:** Biome 2
- **Types:** TypeScript 5.9 (strict, all flags maxed)

## Commands

```bash
bun run dev              # Watch mode
bun run build            # Bundle to dist/
bun run build:compile    # Standalone binary
bun run check            # Typecheck + lint + test (full gate)
bun run lint             # Biome lint only
bun run lint:fix         # Auto-fix lint issues
bun run lint:all         # Biome check (lint + format)
bun run lint:all:fix     # Biome check with --unsafe fixes
bun run format           # Biome format with --write
bun run format:check     # Biome format check only
bun test                 # Run tests
bun run test:watch       # Watch mode tests
bun run test:coverage    # Tests with LCOV coverage
bun run typecheck        # TypeScript only
bun run typecheck:watch  # TypeScript watch mode
bun run clean            # Remove dist/
```

## Architecture

See `docs/plans/2026-02-18-vigil-architecture-design.md` for full design.
See `docs/plans/2026-02-18-vigil-implementation.md` for implementation plan.
See `docs/plans/2026-02-26-review-radar-spec.md` for Review Radar feature spec.

### Key Patterns

- **XDG paths** — Config at `$XDG_CONFIG_HOME/vigil/`, data at `$XDG_DATA_HOME/vigil/`, cache at `$XDG_CACHE_HOME/vigil/`
- **Zustand vanilla store** — Agents call `store.getState()` / `store.setState()` directly. TUI components use `useStore(store, selector)`.
- **In-process agents** — All Claude Agent SDK agents run in the main Bun process via streaming. No subprocesses.
- **SilkCircuit Neon theme** — All colors from the palette in `src/tui/theme.ts`
- **Two-pass GitHub fetch** — `gh search prs` for discovery, `gh pr view` for rich detail
- **Worktree-scoped execution** — Fix and Rebase agents operate in git worktrees, never the main checkout

### Agent System

6 agents: Triage (haiku), Fix (sonnet), Respond (sonnet), Rebase (sonnet), Evidence (haiku), Learning (haiku).
Orchestrator routes events from poller → triage → action agent.
HITL mode queues actions for approval. YOLO mode auto-executes confident actions.

### Review Radar

Monitors incoming PRs where the user is requested, team-tagged, or domain-matched.
Three relevance tiers: direct (explicit review request), domain (file path match), watch (team/watchAll).
Separate poller and store slice. TUI shows radar PRs via feed mode toggle (`t` key cycles mine/incoming/both).

## Module Layout

```
src/
  cli.ts                    # Entry point (yargs CLI, polling, notifications)
  app.tsx                   # Root Ink/React component
  agents/                   # LLM-backed agents + orchestrator
    tools/                  # Agent MCP tools (fs, git, github)
  config/                   # XDG config, schema, loader, init wizard
  core/                     # Polling, state machine, differ, radar, worktrees
  learning/                 # Knowledge persistence + pattern extraction
  notifications/            # Desktop notifications (macOS/Linux)
  store/                    # Zustand store root
    slices/                 # prs, agents, ui, radar
  tui/                      # Ink/React components + theme
  types/                    # All TypeScript type definitions
```

## Conventions

- Strict TypeScript — no `any`, no non-null assertions
- Single quotes, 2-space indent, 100 char line width (Biome)
- All types in `src/types/` — import with `type` keyword
- Test files: `*.test.ts` next to source files
- Commits: conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`)
- File extensions in imports: always `.js` (Bun ESM resolution)
- Section dividers in source: `// ─── Section Name ────────────`
- Per-repo config: `.vigilrc.json` (JSON), `.vigilrc.ts` support exists but is disabled

## Important Files

- `src/tui/theme.ts` — SilkCircuit Neon palette, semantic colors, icons, utilities
- `src/agents/orchestrator.ts` — Event routing, deduplication, mode policy
- `src/agents/executor.ts` — Action execution lifecycle
- `src/agents/prompt-safety.ts` — Untrusted content sanitization
- `src/core/state-machine.ts` — 5-state PR classifier (hot/waiting/ready/dormant/blocked)
- `src/config/schema.ts` — Zod schema for all configuration
- `src/store/index.ts` — Zustand store composition
- `biome.json` — Lint + format rules (Biome 2, stricter than defaults)

## Testing

Tests live alongside source as `*.test.ts`. Run with `bun test`. Coverage via `bun run test:coverage`.
24 test files covering agents, config, core, store, and TUI feed logic.
No separate test directory — co-located by convention.
