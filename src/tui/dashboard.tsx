import { Box, Text, useStdout } from 'ink';
import Spinner from 'ink-spinner';
import type { JSX } from 'react';
import { useStore } from 'zustand';
import { vigilStore } from '../store/index.js';
import type { PrState, PullRequest } from '../types/index.js';
import { AgentStatus } from './agent-status.js';
import { KeybindBar } from './keybind-bar.js';
import { PrCard } from './pr-card.js';
import { PrRow, statePriority } from './pr-row.js';
import { ScrollIndicator } from './scroll-indicator.js';
import { StatusBar } from './status-bar.js';
import { icons, palette, semantic } from './theme.js';

// ─── Constants ────────────────────────────────────────────────────────

/** Lines reserved for chrome: status bar (1) + divider (1) + scroll indicator (1) + keybind bar (1) */
const CHROME_LINES_CARD = 4;
const CHROME_LINES_LIST = 4;

/** Approximate height of a single card (border + 4-5 content rows) */
const CARD_HEIGHT = 7;

// ─── Empty State ──────────────────────────────────────────────────────

function EmptyState(): JSX.Element {
  return (
    <Box flexDirection="column" alignItems="center" paddingY={2}>
      {/* Branded ASCII mark */}
      <Text color={palette.electricPurple} bold>
        {'  \u2588\u2588\u2588\u2588\u2588\u2588\u2557'}
      </Text>
      <Text color={palette.electricPurple} bold>
        {'  \u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D'}
      </Text>
      <Text color={palette.electricPurple} bold>
        {'  \u2588\u2588\u2588\u2588\u2588\u2557 '}
      </Text>
      <Text color={palette.electricPurple} bold>
        {'  \u255A\u2550\u2550\u2550\u2588\u2588\u2551'}
      </Text>
      <Text color={palette.electricPurple} bold>
        {'  \u2588\u2588\u2588\u2588\u2588\u2588\u2551'}
      </Text>
      <Text color={palette.electricPurple} bold>
        {'  \u255A\u2550\u2550\u2550\u2550\u2550\u255D'}
      </Text>

      <Text> </Text>

      <Text color={palette.fg} bold>
        V {icons.middleDot} I {icons.middleDot} G {icons.middleDot} I {icons.middleDot} L
      </Text>

      <Text> </Text>

      <Text color={semantic.muted}>Watching your pull requests</Text>

      <Text> </Text>

      <Box gap={1}>
        <Text color={palette.neonCyan}>
          <Spinner type="dots" />
        </Text>
        <Text color={semantic.muted}>Waiting for first poll{'\u2026'}</Text>
      </Box>

      <Text> </Text>

      <Text color={semantic.dim}>
        Press <Text color={palette.neonCyan}>r</Text> to poll now
      </Text>
    </Box>
  );
}

// ─── Card Grid ────────────────────────────────────────────────────────

function CardGrid({
  items,
  focusedPr,
  termWidth,
  termRows,
  scrollOffset,
}: {
  items: Array<{ pr: PullRequest; state: PrState }>;
  focusedPr: string | null;
  termWidth: number;
  termRows: number;
  scrollOffset: number;
}): JSX.Element {
  // Calculate columns: 2 if wide enough, else 1
  const numCols = termWidth >= 140 ? 2 : 1;
  const cardWidth = numCols > 1 ? Math.floor((termWidth - 2) / numCols) : termWidth;

  // Calculate visible cards based on terminal height
  const visibleRows = Math.max(1, Math.floor((termRows - CHROME_LINES_CARD) / CARD_HEIGHT));
  const visibleCards = visibleRows * numCols;

  // Windowed slice
  const startIdx = scrollOffset * numCols;
  const visible = items.slice(startIdx, startIdx + visibleCards);

  if (visible.length === 0) {
    return <EmptyState />;
  }

  // Group into rows
  const rows: Array<Array<{ pr: PullRequest; state: PrState }>> = [];
  for (let i = 0; i < visible.length; i += numCols) {
    rows.push(visible.slice(i, i + numCols));
  }

  return (
    <Box flexDirection="column">
      {rows.map((row, rowIdx) => (
        <Box key={row[0]?.pr.key ?? rowIdx} gap={1}>
          {row.map(({ pr, state }) => (
            <PrCard
              key={pr.key}
              pr={pr}
              state={state}
              isFocused={pr.key === focusedPr}
              width={cardWidth}
            />
          ))}
        </Box>
      ))}
    </Box>
  );
}

// ─── List View ────────────────────────────────────────────────────────

function ListView({
  items,
  focusedPr,
  termRows,
  scrollOffset,
}: {
  items: Array<{ pr: PullRequest; state: PrState }>;
  focusedPr: string | null;
  termRows: number;
  scrollOffset: number;
}): JSX.Element {
  const visibleRows = Math.max(1, termRows - CHROME_LINES_LIST);
  const visible = items.slice(scrollOffset, scrollOffset + visibleRows);

  if (visible.length === 0) {
    return <EmptyState />;
  }

  return (
    <Box flexDirection="column">
      {visible.map(({ pr, state }) => (
        <PrRow key={pr.key} pr={pr} state={state} isFocused={pr.key === focusedPr} />
      ))}
    </Box>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────

export function Dashboard(): JSX.Element {
  const prs = useStore(vigilStore, s => s.prs);
  const prStates = useStore(vigilStore, s => s.prStates);
  const scrollOffset = useStore(vigilStore, s => s.scrollOffsets.dashboard);
  const focusedPr = useStore(vigilStore, s => s.focusedPr);
  const viewMode = useStore(vigilStore, s => s.viewMode);

  const { stdout } = useStdout();
  const termWidth = stdout.columns ?? 80;
  const termRows = stdout.rows ?? 24;

  // Sort PRs by state priority, then by updatedAt descending
  const sorted: Array<{ pr: PullRequest; state: PrState }> = Array.from(prs.values())
    .map(pr => ({
      pr,
      state: prStates.get(pr.key) ?? ('dormant' as PrState),
    }))
    .sort((a, b) => {
      const pri = statePriority(a.state) - statePriority(b.state);
      if (pri !== 0) return pri;
      return new Date(b.pr.updatedAt).getTime() - new Date(a.pr.updatedAt).getTime();
    });

  // Resolve focused key — default to first item if none set
  const effectiveFocus = focusedPr ?? sorted[0]?.pr.key ?? null;

  // Calculate visible count for scroll indicator
  const numCols = viewMode === 'cards' ? (termWidth >= 140 ? 2 : 1) : 1;
  const itemHeight = viewMode === 'cards' ? CARD_HEIGHT : 2;
  const chrome = viewMode === 'cards' ? CHROME_LINES_CARD : CHROME_LINES_LIST;
  const visibleCount =
    viewMode === 'cards'
      ? Math.max(1, Math.floor((termRows - chrome) / itemHeight)) * numCols
      : Math.max(1, termRows - chrome);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Status bar */}
      <StatusBar />
      <Box paddingX={1}>
        <Text color={semantic.dim}>{'\u2500'.repeat(Math.min(termWidth - 2, 120))}</Text>
      </Box>

      {/* Main content — fills available vertical space */}
      <Box flexDirection="column" flexGrow={1}>
        {viewMode === 'cards' ? (
          <CardGrid
            items={sorted}
            focusedPr={effectiveFocus}
            termWidth={termWidth}
            termRows={termRows}
            scrollOffset={scrollOffset}
          />
        ) : (
          <ListView
            items={sorted}
            focusedPr={effectiveFocus}
            termRows={termRows}
            scrollOffset={scrollOffset}
          />
        )}
        <Box flexGrow={1} />
        {/* Scroll indicator */}
        <ScrollIndicator
          current={scrollOffset * (viewMode === 'cards' ? numCols : 1)}
          total={sorted.length}
          visible={visibleCount}
        />
      </Box>

      {/* Agent activity */}
      <AgentStatus />

      {/* Keybind footer */}
      <KeybindBar />
    </Box>
  );
}
