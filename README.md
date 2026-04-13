<div align="center">

# ⚡ Vigil

<strong>Your PRs Never Sleep. Neither Does Vigil.</strong>

<sub>AI-powered PR lifecycle management for the terminal</sub>

[![License](https://img.shields.io/badge/License-Apache%202.0-e135ff?style=for-the-badge&logo=apache&logoColor=white)](https://opensource.org/licenses/Apache-2.0)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-80ffea?style=for-the-badge&logo=typescript&logoColor=black)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-Runtime-f1fa8c?style=for-the-badge&logo=bun&logoColor=black)](https://bun.sh)
[![Claude](https://img.shields.io/badge/Claude-Agent_SDK-e135ff?style=for-the-badge&logo=anthropic&logoColor=white)](https://docs.anthropic.com/en/docs/agents-and-tools/claude-agent-sdk)
[![Ink](https://img.shields.io/badge/Ink_6-React_19-80ffea?style=for-the-badge&logo=react&logoColor=black)](https://github.com/vadimdemedes/ink)
[![ko-fi](https://img.shields.io/badge/Ko--fi-Support-ff6ac1?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/hyperb1iss)

[Why Vigil?](#-the-problem) · [Features](#%EF%B8%8F-what-you-get) · [Agents](#-agents) · [Quick Start](#-quick-start) · [Dashboard](#%EF%B8%8F-the-dashboard) · [Configuration](#%EF%B8%8F-configuration) · [Contributing](#-contributing)

</div>

---

## 👁️ The Problem

The PR lifecycle is death by a thousand interrupts. Push code, wait for CI, read reviews, fix nits, push again, update descriptions, fill in verification evidence, respond to comments, request re-review. _Repeat until merge or madness._

**Vigil watches your pull requests so you don't have to.**

It monitors your authored PRs plus incoming review PRs where you are requested, tagged, or matched by repo radar rules, classifies them in real-time, and dispatches AI agents to handle the mechanical work — fixing review feedback, rebasing branches, responding to comments, filling in evidence templates. You stay in flow. Vigil keeps the watch.

## 🗡️ What You Get

| | Capability | Description |
|---|---|---|
| 🔴 | **Real-Time State Machine** | 5 states — hot, waiting, ready, dormant, blocked — updated live as GitHub signals change |
| 🤖 | **6 Specialized Agents** | Triage, Fix, Respond, Rebase, Evidence, Learning — in-process via Claude SDK, no external services |
| 🎯 | **HITL + YOLO Modes** | Approve every action, or let confident ones auto-execute. Toggle with `y` anytime |
| 🖥️ | **SilkCircuit TUI** | Card-based dashboard, scrollable detail view, action panel — Ink 6 + React 19 |
| 🔔 | **Desktop Alerts** | CI failures, blocking reviews, conflicts — click to open the PR. Non-intrusive by default |
| 🧠 | **Post-Merge Learning** | Captures reviewer patterns, common fixes, response templates — gets smarter every merge |
| 🔍 | **Fuzzy Search** | `/` to filter PRs instantly across titles, repos, branches, authors |
| 🌊 | **Smart Polling** | Two-pass fetch with `updatedAt` short-circuit — skips repos where nothing changed |

## 🚦 How It Works

```
Push code
  → Vigil detects new/updated PR
  → Triage agent reads ALL signals (CI, reviews, conflicts, templates)
  → Action agents dispatch IN PARALLEL
    ├── 🔧 Fix patches code from review feedback
    ├── 💬 Respond replies to reviewers, pushes back on scope creep
    ├── 📋 Evidence fills verification sections
    └── 🔀 Rebase resolves conflicts with main
  → Fix pushes commit → triggers new CI → loop continues
  → PR reaches READY → you merge
  → Learning agent captures patterns for next time
```

Every PR is classified into one of five states:

| State | Meaning | What Triggers It |
|-------|---------|------------------|
| 🔴 **Hot** | Needs attention now | Failing CI, blocking reviews, merge conflicts |
| 🟡 **Waiting** | Ball is elsewhere | Reviews pending, CI running |
| 🟢 **Ready** | Ship it | All checks pass, approved, no conflicts |
| ⚪ **Dormant** | Gone quiet | No activity in 48h+ |
| 🟣 **Blocked** | Can't proceed | Draft, policy block, dependency |

## 🤖 Agents

Six agents. Each does one thing well.

| Agent | Model | What It Does |
|-------|-------|--------------|
| 🔍 **Triage** | Haiku | First responder — classifies events, decides which agents to wake up |
| 🔧 **Fix** | Sonnet | Reads review feedback + CI logs, applies code fixes, pushes commits |
| 💬 **Respond** | Sonnet | Drafts contextual replies, defends scope, requests re-review |
| 🔀 **Rebase** | Sonnet | Rebases onto latest base, resolves conflicts intelligently |
| 📋 **Evidence** | Haiku | Fills verification/regression evidence in PR templates |
| 🧠 **Learning** | Haiku | Extracts patterns post-merge — feeds forward into future triage |

All agents run **in-process** via the Claude Agent SDK. No subprocesses, no external services, no containers. Git operations are scoped to worktrees for safety.

## 📦 Installation

### Prerequisites

- [Bun](https://bun.sh) >= 1.1.0
- [GitHub CLI](https://cli.github.com/) (`gh`) — authenticated
- `ANTHROPIC_API_KEY` environment variable
- _(Optional)_ [`terminal-notifier`](https://github.com/julienXX/terminal-notifier) for click-to-open notifications on macOS

### From Source

```bash
git clone https://github.com/hyperb1iss/vigil.git
cd vigil
bun install
bun run build
bun run link  # Symlinks to ~/.local/bin/vigil
```

## 🚀 Quick Start

```bash
vigil                                    # All your PRs, all repos
vigil --repo owner/repo                  # Focus on one repo
vigil --repo owner/repo --repo org/lib   # Multiple repos
vigil --mode yolo                        # Auto-execute confident actions
vigil --no-agents                        # Dashboard only, no AI
vigil --demo                             # Mock data for visual testing
```

## 🖥️ The Dashboard

Built with [Ink](https://github.com/vadimdemedes/ink) and the **SilkCircuit Neon** design language. Cards, colors, vim motions, mouse support.

### ⌨️ Keybindings

**Navigation**

| Key | Action |
|-----|--------|
| `↑↓←→` / `hjkl` | Navigate PRs |
| `Tab` / `Shift+Tab` | Next / previous |
| `Enter` | Open detail view |
| `Esc` | Back |
| `/` | Search |
| `g` / `G` | Top / bottom |
| `o` | Open in browser |

**Controls**

| Key | Action |
|-----|--------|
| `v` | Cards ↔ list |
| `s` | Sort: activity ↔ state |
| `y` | HITL ↔ YOLO |
| `r` | Force refresh |
| `?` | Help overlay |
| `q` | Quit |

**Detail View** — `j`/`k` scroll, `Tab` pages, `a` opens actions, `o` or click opens PR in browser.

**Action Panel** — `1`-`9` approve, `a` approve all, `n` skip.

## 🎭 Modes

**🛡️ HITL** — The default. Every agent action shows up in the action panel first. You approve with a keypress. Nothing happens without your say-so.

**🚀 YOLO** — Confident actions auto-execute. Uncertain ones still pause. Destructive operations (`force push`, `merge`, `close`, `delete branch`) **always** require confirmation — even in YOLO.

Toggle anytime with `y`.

## 🔔 Notifications

Lightweight desktop alerts for the things that actually matter:

| Event | Desktop Alert |
|-------|---------------|
| 🔴 CI failure | ✅ |
| 🔴 Changes requested | ✅ |
| 🔴 Merge conflict | ✅ |
| 🟡 Ready to merge | — |
| ⚪ New comment | — |

Click a notification → opens the PR in your browser. First-poll alerts are suppressed so you don't get blasted on startup.

```json
{
  "notifications": {
    "enabled": true,
    "onCiFailure": true,
    "onBlockingReview": true,
    "onReadyToMerge": true,
    "onNewComment": false
  }
}
```

## ⚙️ Configuration

| Path | Purpose |
|------|---------|
| `$XDG_CONFIG_HOME/vigil/config.json` | Global config |
| `$XDG_DATA_HOME/vigil/knowledge.md` | Learning knowledge base |
| `$XDG_CACHE_HOME/vigil/` | Poll cache + snapshots |
| `.vigilrc.json` | Per-repo overrides |

Per-repo overrides live in `.vigilrc.json`. TypeScript repo config execution is currently disabled, so stick to JSON for local overrides.

If you want slower personal projects to surface every incoming PR, set `radar.repos[].watchAll: true` in your global `config.json`. Those PRs stay visible at watch tier even without an explicit review request.

```json
{
  "radar": {
    "repos": [
      {
        "repo": "owner/repo",
        "domainRules": [],
        "watchAll": true
      }
    ]
  }
}
```

### 🧠 Learning

The Learning agent captures patterns from every merged PR — reviewer tendencies, common CI failure fixes, response templates. Stored as human-readable markdown. Edit it, seed it, or let it grow.

## 🏗️ Architecture

```
GraphQL authored-PR discovery
  → Repo-paged detail hydration + incoming radar paging
    → Poller (30s, snapshot diffing)
      → State Machine (5 states)
        → Zustand Store → Ink TUI
        → Orchestrator → Agents (parallel)
          → Desktop notifications
```

| Layer | Stack |
|-------|-------|
| Runtime | Bun |
| TUI | Ink 6 + React 19 |
| AI | Claude Agent SDK |
| State | Zustand vanilla |
| GitHub | `gh` CLI |
| Git | simple-git |
| Lint | Biome 2 |
| Types | TypeScript 5.9 strict |

## 🛠️ Development

```bash
bun run dev          # Watch mode
bun run build        # Bundle to dist/
bun run check        # Typecheck + lint + test
bun run lint:fix     # Auto-fix
bun test             # Run the full test suite
bun run test:coverage
bun run typecheck    # Types only
```

## 🤝 Contributing

Contributions welcome! Run `bun run check` before submitting.

1. Fork it
2. Branch it (`git checkout -b feat/amazing-thing`)
3. [Conventional commit](https://www.conventionalcommits.org/) it
4. PR it

## ⚖️ License

[Apache 2.0](LICENSE) — use it, extend it, build on it.

---

<p align="center">
  <a href="https://github.com/hyperb1iss/vigil">
    <img src="https://img.shields.io/github/stars/hyperb1iss/vigil?style=social" alt="Star on GitHub">
  </a>
  &nbsp;&nbsp;
  <a href="https://ko-fi.com/hyperb1iss">
    <img src="https://img.shields.io/badge/Ko--fi-Support%20Development-ff5e5b?logo=ko-fi&logoColor=white" alt="Ko-fi">
  </a>
</p>

<p align="center">
  <sub>
    If Vigil is keeping watch, give it a ⭐ or <a href="https://ko-fi.com/hyperb1iss">buy me a Monster Ultra Violet</a> ⚡️
    <br><br>
    ✦ Built with obsession by <a href="https://hyperbliss.tech"><strong>Hyperbliss Technologies</strong></a> ✦
  </sub>
</p>
