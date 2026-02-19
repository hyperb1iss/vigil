import { Box, Text, useStdout } from 'ink';
import Spinner from 'ink-spinner';
import type { JSX } from 'react';
import { useEffect, useMemo } from 'react';
import { useStore } from 'zustand';

import { vigilStore } from '../store/index.js';
import type { PrState, PullRequest } from '../types/index.js';
import { AgentStatus } from './agent-status.js';
import { KeybindBar } from './keybind-bar.js';
import { PrCard } from './pr-card.js';
import { PrRow, statePriority } from './pr-row.js';
import { ScrollIndicator } from './scroll-indicator.js';
import { SearchBar } from './search-bar.js';
import { StatusBar } from './status-bar.js';
import { icons, palette, semantic } from './theme.js';

// ─── Search Matching ─────────────────────────────────────────────

/** Case-insensitive fuzzy match: all query chars appear in order in the target. */
function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

/** Match a PR against a search query (title, number, repo, branch). */
function matchesPr(pr: PullRequest, query: string): boolean {
  if (query.length === 0) return true;
  return (
    fuzzyMatch(query, pr.title) ||
    fuzzyMatch(query, `#${pr.number}`) ||
    fuzzyMatch(query, pr.repository.nameWithOwner) ||
    fuzzyMatch(query, pr.headRefName)
  );
}

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
        {'██╗   ██╗'}
      </Text>
      <Text color={palette.electricPurple} bold>
        {'██║   ██║'}
      </Text>
      <Text color={palette.electricPurple} bold>
        {'╚██╗ ██╔╝'}
      </Text>
      <Text color={palette.electricPurple} bold>
        {' ╚████╔╝ '}
      </Text>
      <Text color={palette.electricPurple} bold>
        {'  ╚██╔╝  '}
      </Text>
      <Text color={palette.electricPurple} bold>
        {'   ╚═╝   '}
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
  const focusedPr = useStore(vigilStore, s => s.focusedPr);
  const setFocusedPr = useStore(vigilStore, s => s.setFocusedPr);
  const viewMode = useStore(vigilStore, s => s.viewMode);
  const sortMode = useStore(vigilStore, s => s.sortMode);
  const searchQuery = useStore(vigilStore, s => s.searchQuery);

  const { stdout } = useStdout();
  const termWidth = stdout.columns ?? 80;
  const termRows = stdout.rows ?? 24;

  // Sort PRs based on active sort mode
  const allSorted = useMemo(
    () =>
      Array.from(prs.values())
        .map(pr => ({
          pr,
          state: prStates.get(pr.key) ?? ('dormant' as PrState),
        }))
        .sort((a, b) => {
          if (sortMode === 'state') {
            const pri = statePriority(a.state) - statePriority(b.state);
            if (pri !== 0) return pri;
          }
          return new Date(b.pr.updatedAt).getTime() - new Date(a.pr.updatedAt).getTime();
        }),
    [prs, prStates, sortMode]
  );

  // Apply search filter
  const sorted = useMemo(
    () =>
      searchQuery !== null && searchQuery.length > 0
        ? allSorted.filter(item => matchesPr(item.pr, searchQuery))
        : allSorted,
    [allSorted, searchQuery]
  );

  // Auto-set focusedPr to first item when null and PRs exist
  useEffect(() => {
    if (!focusedPr && sorted.length > 0 && sorted[0]) {
      setFocusedPr(sorted[0].pr.key);
    }
  }, [focusedPr, sorted, setFocusedPr]);

  // When search filters, snap focus to first match
  useEffect(() => {
    if (searchQuery && sorted.length > 0 && sorted[0]) {
      const currentInResults = sorted.some(s => s.pr.key === focusedPr);
      if (!currentInResults) {
        setFocusedPr(sorted[0].pr.key);
      }
    }
  }, [searchQuery, sorted, focusedPr, setFocusedPr]);

  const effectiveFocus = focusedPr ?? sorted[0]?.pr.key ?? null;

  // Layout math
  const numCols = viewMode === 'cards' ? (termWidth >= 140 ? 2 : 1) : 1;
  const itemHeight = viewMode === 'cards' ? CARD_HEIGHT : 1;
  const chrome = viewMode === 'cards' ? CHROME_LINES_CARD : CHROME_LINES_LIST;
  const visibleRows = Math.max(1, Math.floor((termRows - chrome) / itemHeight));
  const visibleCount = visibleRows * numCols;

  // Compute scroll offset from focused item to keep it visible
  const focusedIdx = effectiveFocus ? sorted.findIndex(s => s.pr.key === effectiveFocus) : 0;
  const focusedRow =
    numCols > 1 ? Math.floor(Math.max(0, focusedIdx) / numCols) : Math.max(0, focusedIdx);
  const totalRows = numCols > 1 ? Math.ceil(sorted.length / numCols) : sorted.length;

  // Keep focused row within the visible window
  const prevOffset = vigilStore.getState().scrollOffsets.dashboard;
  let scrollOffset = prevOffset;
  if (focusedRow < scrollOffset) {
    scrollOffset = focusedRow;
  } else if (focusedRow >= scrollOffset + visibleRows) {
    scrollOffset = focusedRow - visibleRows + 1;
  }
  // Clamp
  scrollOffset = Math.max(0, Math.min(Math.max(0, totalRows - visibleRows), scrollOffset));

  // Sync back to store if changed
  useEffect(() => {
    const current = vigilStore.getState().scrollOffsets.dashboard;
    if (scrollOffset !== current) {
      vigilStore.setState(prev => ({
        scrollOffsets: { ...prev.scrollOffsets, dashboard: scrollOffset },
      }));
    }
  }, [scrollOffset]);

  const isSearchActive = searchQuery !== null;

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Status bar */}
      <StatusBar />
      {isSearchActive ? (
        <SearchBar query={searchQuery} matchCount={sorted.length} totalCount={allSorted.length} />
      ) : (
        <Box paddingX={1}>
          <Text color={semantic.dim}>{'\u2500'.repeat(Math.min(termWidth - 2, 120))}</Text>
        </Box>
      )}

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
          current={scrollOffset * numCols}
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
