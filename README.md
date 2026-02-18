<div align="center">

# Vigil

**AI-powered PR lifecycle management for the terminal**

[![License](https://img.shields.io/badge/License-Apache%202.0-e135ff?style=for-the-badge&logo=apache&logoColor=white)](https://opensource.org/licenses/Apache-2.0)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-80ffea?style=for-the-badge&logo=typescript&logoColor=black)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-Runtime-f1fa8c?style=for-the-badge&logo=bun&logoColor=black)](https://bun.sh)
[![Claude](https://img.shields.io/badge/Claude-Agent_SDK-e135ff?style=for-the-badge&logo=anthropic&logoColor=white)](https://docs.anthropic.com/en/docs/agents-and-tools/claude-agent-sdk)
[![Ink](https://img.shields.io/badge/Ink_6-React_19-80ffea?style=for-the-badge&logo=react&logoColor=black)](https://github.com/vadimdemedes/ink)
[![ko-fi](https://img.shields.io/badge/Ko--fi-Support-ff6ac1?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/hyperb1iss)

`>` _Push code. Vigil handles the rest._ `<`

[Overview](#-overview) · [Agents](#-agents) · [Installation](#-installation) · [Quick Start](#-quick-start) · [Modes](#-modes) · [Configuration](#-configuration) · [Contributing](#-contributing)

</div>

---

## Overview

The PR lifecycle is one of the most interrupt-driven parts of software engineering. Push code, wait for CI, read reviews, fix nits, push again, update descriptions, fill in verification evidence, respond to comments, request re-review. Repeat.

**Vigil watches your pull requests so you don't have to.** It monitors all your open PRs across every repo, classifies their state in real-time, and dispatches AI agents to handle the mechanical work — fixing review feedback, rebasing branches, responding to comments, and filling in evidence templates. You stay focused on building. Vigil handles the grind.

### How It Works

```
Push code
  → Vigil detects new/updated PR
  → Triage reads ALL signals (CI, reviews, conflicts, templates)
  → Agents dispatch IN PARALLEL
    ├── Fix Agent patches code
    ├── Respond Agent replies to reviewers
    ├── Evidence Agent fills verification sections
  → Fix pushes commit → triggers new CI
  → Loop continues until PR reaches READY state
  → You merge. Learning Agent captures patterns.
  → Next PR. Smarter this time.
```

## PR State Machine

Every PR is classified into one of five states based on real-time GitHub signals:

| State | Indicator | Meaning | Signals |
|-------|-----------|---------|---------|
| **Hot** | :red_circle: | Needs attention now | Failing CI, blocking reviews, merge conflicts |
| **Waiting** | :yellow_circle: | Ball is elsewhere | Reviews pending, CI running, awaiting dependencies |
| **Ready** | :green_circle: | Green light to merge | All checks pass, approved, no conflicts |
| **Dormant** | :white_circle: | Stale | No activity 48h+, stale reviews |
| **Blocked** | :purple_circle: | Can't proceed | Draft, depends on another PR, policy block |

State transitions happen automatically as signals change. The dashboard re-renders in real-time.

## Agents

Six specialized AI agents, each tuned for a specific part of the PR lifecycle:

| Agent | Model | Purpose |
|-------|-------|---------|
| **Triage** | Haiku | First responder — classifies events, routes to action agents |
| **Fix** | Sonnet | Applies code changes for review feedback and CI failures |
| **Respond** | Sonnet | Drafts contextual replies, pushes back on scope creep |
| **Rebase** | Sonnet | Rebases branches, resolves merge conflicts intelligently |
| **Evidence** | Haiku | Fills verification and regression evidence in PR templates |
| **Learning** | Haiku | Captures patterns post-merge to improve future decisions |

Agents run **in-process** via the Claude Agent SDK — no subprocesses, no external services. All git operations are scoped to worktrees for safety.

## Modes

### HITL (Human-in-the-Loop)

The default. Every agent action is proposed first, displayed in the action panel, and executed only when you approve with a keypress. Safe, controlled, fully transparent.

### YOLO

For the bold. Confident actions auto-execute. Uncertain actions still pause for approval. Destructive operations (`force push`, `merge`, `close`, `delete branch`) **always** require human confirmation, even in YOLO mode.

Toggle between modes with `y` at any time.

## Installation

### Prerequisites

- [Bun](https://bun.sh) >= 1.1.0
- [GitHub CLI](https://cli.github.com/) (`gh`) authenticated
- `ANTHROPIC_API_KEY` environment variable set

### From Source

```bash
git clone https://github.com/hyperb1iss/vigil.git
cd vigil
bun install
bun run build
bun run link  # Symlinks to ~/.local/bin/vigil
```

## Quick Start

```bash
# Watch all your open PRs across every repo
vigil

# Focus on specific repos
vigil --repo owner/repo
vigil --repo owner/repo --repo hyperb1iss/sibyl

# Start in YOLO mode
vigil --mode yolo

# Dashboard only, no agent actions
vigil --no-agents
```

## The Dashboard

Vigil's terminal interface is built with [Ink](https://github.com/vadimdemedes/ink) and the **SilkCircuit Neon** design language.

### Navigation

| Key | Action |
|-----|--------|
| `↑` `↓` `←` `→` | Navigate PRs |
| `Tab` / `Shift+Tab` | Next / previous PR |
| `Enter` | Open detail view |
| `Esc` | Go back |
| `/` | Fuzzy search |
| `g` / `G` | Jump to top / bottom |

### Views & Modes

| Key | Action |
|-----|--------|
| `v` | Toggle cards / list view |
| `s` | Toggle sort: activity / state |
| `y` | Toggle HITL / YOLO mode |
| `r` | Force poll refresh |
| `?` | Full keybinding reference |
| `q` | Quit |

### Detail View

| Key | Action |
|-----|--------|
| `↑` `↓` | Scroll content |
| `Tab` / `Shift+Tab` | Page down / up |
| `a` | Open action panel |

### Action Panel

| Key | Action |
|-----|--------|
| `1`-`9` | Approve specific action |
| `a` | Approve all |
| `n` | Skip action |

Vim motions (`h` `j` `k` `l`) work everywhere for power users.

## Configuration

### XDG Paths

| Purpose | Path |
|---------|------|
| Config | `$XDG_CONFIG_HOME/vigil/config.ts` |
| Knowledge | `$XDG_DATA_HOME/vigil/knowledge.md` |
| Cache | `$XDG_CACHE_HOME/vigil/` |
| Per-repo | `.vigilrc.ts` in project root |

### Learning System

Vigil gets smarter over time. The Learning agent captures patterns from every merged PR — reviewer tendencies, common CI failure fixes, response templates — and stores them in a human-readable markdown knowledge file. Edit it, seed it, or let it grow organically.

## Architecture

| Layer | Technology |
|-------|-----------|
| Runtime | Bun |
| TUI | Ink 6 + React 19 |
| AI | Claude Agent SDK |
| State | Zustand |
| GitHub | `gh` CLI |
| Git | simple-git |
| Linting | Biome 2 |
| Types | TypeScript 5.9 (strict) |

### Data Flow

```
gh search prs --author=@me --state=open
  → Poller (30s interval)
    → Differ (snapshot comparison → events)
      → State Machine (classify each PR)
        → Zustand Store → Ink re-renders
        → Orchestrator → Agent dispatch
```

Two-pass GitHub fetch: `gh search prs` for discovery, `gh pr view` per-repo for rich detail (reviews, checks, comments).

## Development

```bash
bun run dev          # Watch mode
bun run build        # Bundle to dist/
bun run check        # Typecheck + lint + test
bun run lint:fix     # Auto-fix lint issues
bun test             # Run tests
bun run typecheck    # TypeScript only
```

## Contributing

Contributions are welcome! Please ensure your changes pass `bun run check` before submitting.

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/amazing-thing`)
3. Commit using [conventional commits](https://www.conventionalcommits.org/)
4. Open a pull request

## License

[Apache 2.0](LICENSE) — use it, extend it, build on it.

---

<div align="center">

Created by [Stefanie Jane](https://github.com/hyperb1iss)

If Vigil is keeping watch over your PRs, [buy me a coffee](https://ko-fi.com/hyperb1iss)! :coffee:

</div>
