import { Box, Text, useStdout } from 'ink';
import Spinner from 'ink-spinner';
import type { JSX } from 'react';
import { useEffect, useMemo } from 'react';
import { useStore } from 'zustand';

import { vigilStore } from '../store/index.js';
import { AgentStatus } from './agent-status.js';
import type { DashboardItem } from './dashboard-feed.js';
import { buildDashboardItems, matchesPr } from './dashboard-feed.js';
import { KeybindBar } from './keybind-bar.js';
import { PrCard } from './pr-card.js';
import { PrRow } from './pr-row.js';
import { ScrollIndicator } from './scroll-indicator.js';
import { SearchBar } from './search-bar.js';
import { StatusBar } from './status-bar.js';
import { icons, palette, semantic, truncate } from './theme.js';

// ─── Constants ────────────────────────────────────────────────────────

/** Lines reserved for chrome: status bar (1) + divider (1) + scroll indicator (1) + agent status (1) + keybind separator (1) + keybind text (1) */
const CHROME_LINES_CARD = 6;
const CHROME_LINES_LIST = 6;

/** Approximate height of a single card (border + 4-5 content rows) */
const CARD_HEIGHT = 7;

// ─── Empty State ──────────────────────────────────────────────────────

function EmptyState(): JSX.Element {
  const isPolling = useStore(vigilStore, s => s.isPolling);
  const radarIsPolling = useStore(vigilStore, s => s.radarIsPolling);
  const lastPollAt = useStore(vigilStore, s => s.lastPollAt);
  const radarLastPollAt = useStore(vigilStore, s => s.radarLastPollAt);
  const pollError = useStore(vigilStore, s => s.pollError);
  const radarPollError = useStore(vigilStore, s => s.radarPollError);
  const dashboardFeedMode = useStore(vigilStore, s => s.dashboardFeedMode);
  const usingIncoming = dashboardFeedMode === 'incoming' || dashboardFeedMode === 'both';
  const effectivePolling = isPolling || (usingIncoming && radarIsPolling);
  const effectiveError = pollError ?? (usingIncoming ? radarPollError : null);
  const effectiveLastPoll =
    usingIncoming && radarLastPollAt
      ? lastPollAt && new Date(lastPollAt) > new Date(radarLastPollAt)
        ? lastPollAt
        : radarLastPollAt
      : lastPollAt;

  const subtitle = effectiveError
    ? `Polling failed: ${truncate(effectiveError, 80)}`
    : effectiveLastPoll
      ? 'No open pull requests found'
      : 'Waiting for first poll...';
  const actionVerb = effectiveError ? 'retry' : 'poll';

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

      <Text color={semantic.muted}>
        {pollError ? 'GitHub polling needs attention' : 'Watching your pull requests'}
      </Text>

      <Text> </Text>

      <Box gap={1}>
        {effectivePolling ? (
          <Text color={palette.neonCyan}>
            <Spinner type="dots" />
          </Text>
        ) : (
          <Text color={effectiveError ? semantic.error : semantic.muted}>
            {effectiveError ? icons.cross : ' '}
          </Text>
        )}
        <Text color={effectiveError ? semantic.error : semantic.muted}>{subtitle}</Text>
      </Box>

      <Text> </Text>

      <Text color={semantic.dim}>
        Press <Text color={palette.neonCyan}>r</Text> to {actionVerb} now
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
  items: DashboardItem[];
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
  const rows: DashboardItem[][] = [];
  for (let i = 0; i < visible.length; i += numCols) {
    rows.push(visible.slice(i, i + numCols));
  }

  return (
    <Box flexDirection="column">
      {rows.map((row, rowIdx) => (
        <Box key={row[0]?.pr.key ?? rowIdx} gap={1}>
          {row.map(item => (
            <PrCard
              key={item.key}
              pr={item.pr}
              state={item.state}
              isFocused={item.key === focusedPr}
              width={cardWidth}
              source={item.source}
              radar={item.radar}
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
  items: DashboardItem[];
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
      {visible.map(item => (
        <PrRow
          key={item.key}
          pr={item.pr}
          state={item.state}
          isFocused={item.key === focusedPr}
          source={item.source}
          radar={item.radar}
        />
      ))}
    </Box>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────

export function Dashboard(): JSX.Element {
  const focusedPr = useStore(vigilStore, s => s.focusedPr);
  const setFocusedPr = useStore(vigilStore, s => s.setFocusedPr);
  const viewMode = useStore(vigilStore, s => s.viewMode);
  const prs = useStore(vigilStore, s => s.prs);
  const prStates = useStore(vigilStore, s => s.prStates);
  const radarPrs = useStore(vigilStore, s => s.radarPrs);
  const mergedRadarPrs = useStore(vigilStore, s => s.mergedRadarPrs);
  const dashboardFeedMode = useStore(vigilStore, s => s.dashboardFeedMode);
  const radarFilter = useStore(vigilStore, s => s.radarFilter);
  const sortMode = useStore(vigilStore, s => s.sortMode);
  const searchQuery = useStore(vigilStore, s => s.searchQuery);

  const { stdout } = useStdout();
  const termWidth = stdout.columns ?? 80;
  const termRows = stdout.rows ?? 24;

  const allSorted = useMemo(
    () =>
      buildDashboardItems({
        prs,
        prStates,
        radarPrs,
        mergedRadarPrs,
        dashboardFeedMode,
        radarFilter,
        sortMode,
      }),
    [prs, prStates, radarPrs, mergedRadarPrs, dashboardFeedMode, radarFilter, sortMode]
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
      setFocusedPr(sorted[0].key);
    }
  }, [focusedPr, sorted, setFocusedPr]);

  // When search filters, snap focus to first match
  useEffect(() => {
    if (searchQuery && sorted.length > 0 && sorted[0]) {
      const currentInResults = sorted.some(s => s.pr.key === focusedPr);
      if (!currentInResults) {
        setFocusedPr(sorted[0].key);
      }
    }
  }, [searchQuery, sorted, focusedPr, setFocusedPr]);

  const effectiveFocus = focusedPr ?? sorted[0]?.key ?? null;

  // Layout math
  const numCols = viewMode === 'cards' ? (termWidth >= 140 ? 2 : 1) : 1;
  const itemHeight = viewMode === 'cards' ? CARD_HEIGHT : 1;
  const chrome = viewMode === 'cards' ? CHROME_LINES_CARD : CHROME_LINES_LIST;
  const visibleRows = Math.max(1, Math.floor((termRows - chrome) / itemHeight));
  const visibleCount = visibleRows * numCols;

  // Compute scroll offset from focused item to keep it visible
  const focusedIdx = effectiveFocus ? sorted.findIndex(s => s.key === effectiveFocus) : 0;
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
