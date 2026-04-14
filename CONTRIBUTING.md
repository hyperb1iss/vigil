# Contributing to Vigil

Contributions welcome. Here's how to make it smooth.

## Setup

```bash
git clone https://github.com/hyperb1iss/vigil.git
cd vigil
bun install
bun run check    # Typecheck + lint + test — must pass
```

## Development

```bash
bun run dev          # Watch mode
bun test             # Run tests
bun run lint:fix     # Auto-fix lint issues
bun run typecheck    # Types only
```

## Before You Submit

Run the full quality gate:

```bash
bun run check
```

This runs typecheck, Biome lint + format check, and the full test suite. PRs that don't pass CI won't be reviewed.

## Code Style

- **Strict TypeScript** — no `any`, no non-null assertions, all strict flags enabled
- **Biome 2** — single quotes, 2-space indent, 100 char line width, organized imports
- **Co-located tests** — `*.test.ts` next to the source file they test
- **Types** — all type definitions live in `src/types/`, imported with `type` keyword
- **SilkCircuit Neon** — all UI colors come from `src/tui/theme.ts`

## Commit Messages

[Conventional commits](https://www.conventionalcommits.org/):

```
feat(agents): add batch deduplication to orchestrator
fix(tui): restore scroll position on view switch
docs: update README keybindings table
chore(deps): bump biome to 2.4
```

## Pull Requests

1. Fork and branch from `main`
2. One logical change per PR
3. Include tests for new behavior
4. Update docs if you change user-facing behavior
5. Keep the diff focused — no drive-by refactors

## Architecture

See [CLAUDE.md](CLAUDE.md) for the module layout, key files, and architectural patterns. The design docs in `docs/plans/` have the full reasoning behind major decisions.

## License

By contributing, you agree that your contributions will be licensed under the [Apache 2.0 License](LICENSE).
