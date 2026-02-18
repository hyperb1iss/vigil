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

## Commands

```bash
bun run dev          # Watch mode
bun run build        # Bundle to dist/
bun run check        # Typecheck + lint + test
bun run lint:fix     # Auto-fix lint issues
bun test             # Run tests
bun run typecheck    # TypeScript only
```

## Architecture

See `docs/plans/2026-02-18-vigil-architecture-design.md` for full design.
See `docs/plans/2026-02-18-vigil-implementation.md` for implementation plan.

### Key Patterns

- **XDG paths** — Config at `$XDG_CONFIG_HOME/vigil/`, data at `$XDG_DATA_HOME/vigil/`, cache at `$XDG_CACHE_HOME/vigil/`
- **Zustand vanilla store** — Agents call `store.getState()` / `store.setState()` directly. TUI components use `useStore(store, selector)`.
- **In-process agents** — All Claude Agent SDK agents run in the main Bun process via streaming. No subprocesses.
- **SilkCircuit Neon theme** — All colors from the palette in `src/tui/theme.ts`
- **Two-pass GitHub fetch** — `gh search prs` for discovery, `gh pr view` for rich detail

### Agent System

6 agents: Triage (haiku), Fix (sonnet), Respond (sonnet), Rebase (sonnet), Evidence (haiku), Learning (haiku).
Orchestrator routes events from poller → triage → action agent.
HITL mode queues actions for approval. YOLO mode auto-executes confident actions.

### Conventions

- Strict TypeScript — no `any`, no non-null assertions
- Single quotes, 2-space indent, 100 char line width (Biome)
- All types in `src/types/` — import with `type` keyword
- Test files: `*.test.ts` next to source files
- Commits: conventional commits (`feat:`, `fix:`, `chore:`, `docs:`)
