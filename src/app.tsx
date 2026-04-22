import { spawn } from 'node:child_process';

import { Box, Text, useApp, useInput, useStdout } from 'ink';
import type { JSX } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';

import { fetchPrDetail } from './core/github.js';
import { resetGitHubRateLimitBackoff } from './core/github-client.js';
import { poll } from './core/poller.js';
import { pollRadar } from './core/radar-poller.js';
import { vigilStore } from './store/index.js';
import { ActionPanel } from './tui/action-panel.js';
import { ActivityPanel } from './tui/activity-panel.js';
import { Dashboard } from './tui/dashboard.js';
import { buildDashboardItems } from './tui/dashboard-feed.js';
import { HelpOverlay } from './tui/help-overlay.js';
import {
  buildDetailItems,
  detailNavigatorItemIndexAtRow,
  findRelativeReviewItemIndex,
  measureDetailViewport,
  PrDetail,
  useDetailLineCount,
} from './tui/pr-detail.js';
import { icons, palette, semantic } from './tui/theme.js';
import type { MouseEvent } from './tui/use-mouse.js';
import { useMouse } from './tui/use-mouse.js';
import type { PullRequest } from './types/pr.js';

const MIN_COLS = 80;
const MIN_ROWS = 24;

const detailFetchInFlight = new Set<string>();
const DETAIL_PREFETCH_DEBOUNCE_MS = 150;

function parsePrKey(key: string): { owner: string; repo: string; number: number } | null {
  const hashIdx = key.indexOf('#');
  if (hashIdx === -1) return null;
  const nameWithOwner = key.slice(0, hashIdx);
  const number = Number(key.slice(hashIdx + 1));
  const slashIdx = nameWithOwner.indexOf('/');
  if (slashIdx === -1 || Number.isNaN(number)) return null;
  return {
    owner: nameWithOwner.slice(0, slashIdx),
    repo: nameWithOwner.slice(slashIdx + 1),
    number,
  };
}

function getFocusedPr(key: string | null): PullRequest | undefined {
  if (!key) return;
  const state = vigilStore.getState();
  return state.prs.get(key) ?? state.radarPrs.get(key)?.pr ?? state.mergedRadarPrs.get(key)?.pr;
}

interface DetailMouseTarget {
  zone: 'breadcrumb' | 'navigator' | 'inspector' | 'gap' | 'outside';
  items: ReturnType<typeof buildDetailItems>;
  layout: ReturnType<typeof measureDetailViewport>['layout'];
  navigatorBodyRow: number | null;
}

function isDetailAgentRunning(
  activeAgents: Map<string, { prKey: string; status: string }>,
  prKey: string | null
): boolean {
  if (!prKey) return false;
  return Array.from(activeAgents.values()).some(
    run => run.prKey === prKey && run.status === 'running'
  );
}

function detailNavigatorBodyRow(panelRow: number, navigatorHeight: number): number | null {
  return panelRow >= 2 && panelRow < navigatorHeight ? panelRow - 2 : null;
}

function detailTarget(
  zone: DetailMouseTarget['zone'],
  items: DetailMouseTarget['items'],
  layout: DetailMouseTarget['layout'],
  navigatorBodyRow: number | null = null
): DetailMouseTarget {
  return { zone, items, layout, navigatorBodyRow };
}

function resolveWideDetailMouseTarget(
  contentX: number,
  panelRow: number,
  items: DetailMouseTarget['items'],
  layout: DetailMouseTarget['layout']
): DetailMouseTarget {
  if (contentX <= layout.navigatorWidth) {
    return detailTarget(
      'navigator',
      items,
      layout,
      detailNavigatorBodyRow(panelRow, layout.navigatorHeight)
    );
  }
  if (contentX > layout.navigatorWidth + layout.panelGap) {
    return detailTarget('inspector', items, layout);
  }
  return detailTarget('gap', items, layout);
}

function resolveStackedDetailMouseTarget(
  panelRow: number,
  items: DetailMouseTarget['items'],
  layout: DetailMouseTarget['layout']
): DetailMouseTarget {
  if (panelRow <= layout.navigatorHeight) {
    return detailTarget(
      'navigator',
      items,
      layout,
      detailNavigatorBodyRow(panelRow, layout.navigatorHeight)
    );
  }
  if (panelRow === layout.navigatorHeight + 1) {
    return detailTarget('gap', items, layout);
  }
  return detailTarget('inspector', items, layout);
}

function resolveDetailMouseTargetFromLayout(
  event: MouseEvent,
  pr: PullRequest,
  focusedPr: string | null,
  activeAgents: Map<string, { prKey: string; status: string }>,
  termCols: number,
  termRows: number
): DetailMouseTarget {
  const contentWidth = Math.max(1, termCols - 2);
  const contentLeft = 2;
  const contentRight = contentLeft + contentWidth - 1;
  const viewport = measureDetailViewport(
    pr,
    contentWidth,
    termRows,
    isDetailAgentRunning(activeAgents, focusedPr)
  );
  const items = buildDetailItems(pr);

  if (event.x < contentLeft || event.x > contentRight) {
    return detailTarget('outside', items, viewport.layout);
  }
  if (event.y === 1) {
    return detailTarget('breadcrumb', items, viewport.layout);
  }

  const panelRow = event.y - 1 - viewport.headerLineCount;
  if (panelRow < 1 || panelRow > viewport.availableHeight) {
    return detailTarget('outside', items, viewport.layout);
  }

  const contentX = event.x - contentLeft + 1;
  return viewport.layout.isWide
    ? resolveWideDetailMouseTarget(contentX, panelRow, items, viewport.layout)
    : resolveStackedDetailMouseTarget(panelRow, items, viewport.layout);
}

function isMouseScrollEvent(event: MouseEvent): boolean {
  return event.button === 64 || event.button === 65;
}

/** Fetch full PR detail on demand if the store only has search-stub data. */
async function fetchDetailIfNeeded(key: string): Promise<void> {
  if (detailFetchInFlight.has(key)) return;

  const state = vigilStore.getState();
  const minePr = state.prs.get(key);
  const radarPr = state.radarPrs.get(key);
  const mergedRadarPr = state.mergedRadarPrs.get(key);
  const pr = minePr ?? radarPr?.pr ?? mergedRadarPr?.pr;
  if (!pr || pr.headRefName) return; // already enriched

  const parsed = parsePrKey(key);
  if (!parsed) return;
  const { owner, repo, number } = parsed;

  detailFetchInFlight.add(key);
  try {
    const detail = await fetchPrDetail(owner, repo, number, { updatedAt: pr.updatedAt });
    const next = vigilStore.getState();
    if (next.prs.has(key)) {
      next.updatePr(key, detail);
    } else if (next.radarPrs.has(key)) {
      next.updateRadarPr(key, detail);
    } else if (next.mergedRadarPrs.has(key)) {
      next.updateMergedRadarPr(key, detail);
    }
  } catch {
    // Poller will retry on next cycle
  } finally {
    detailFetchInFlight.delete(key);
  }
}

/** Open a URL in the system default browser. */
function openInBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref();
}

/** Lines reserved for status bar + divider at top */
const HEADER_LINES = 2;
/** Card height including border */
const CARD_HEIGHT = 7;
/** List row height (unfocused) */
const LIST_ROW_HEIGHT = 1;

function TooSmall({ cols, rows }: { cols: number; rows: number }): JSX.Element {
  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" height={rows}>
      <Text color={palette.electricPurple} bold>
        {icons.conflict} Terminal Too Small
      </Text>
      <Text> </Text>
      <Text color={semantic.muted}>
        Current:{' '}
        <Text color={semantic.error}>
          {cols}x{rows}
        </Text>
      </Text>
      <Text color={semantic.muted}>
        Required:{' '}
        <Text color={palette.neonCyan}>
          {MIN_COLS}x{MIN_ROWS}
        </Text>
      </Text>
      <Text> </Text>
      <Text color={semantic.dim}>Resize your terminal to continue</Text>
    </Box>
  );
}

export function App(): JSX.Element {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const view = useStore(vigilStore, s => s.view);
  const setView = useStore(vigilStore, s => s.setView);
  const setMode = useStore(vigilStore, s => s.setMode);
  const mode = useStore(vigilStore, s => s.mode);
  const viewMode = useStore(vigilStore, s => s.viewMode);
  const setViewMode = useStore(vigilStore, s => s.setViewMode);
  const scrollView = useStore(vigilStore, s => s.scrollView);
  const resetScroll = useStore(vigilStore, s => s.resetScroll);
  const focusedPr = useStore(vigilStore, s => s.focusedPr);
  const setFocusedPr = useStore(vigilStore, s => s.setFocusedPr);
  const detailFocus = useStore(vigilStore, s => s.detailFocus);
  const cycleDetailFocus = useStore(vigilStore, s => s.cycleDetailFocus);
  const detailSelection = useStore(vigilStore, s => s.detailSelection);
  const setDetailFocus = useStore(vigilStore, s => s.setDetailFocus);
  const setDetailSelection = useStore(vigilStore, s => s.setDetailSelection);
  const moveDetailSelection = useStore(vigilStore, s => s.moveDetailSelection);
  const cycleDashboardFeedMode = useStore(vigilStore, s => s.cycleDashboardFeedMode);
  const sortMode = useStore(vigilStore, s => s.sortMode);
  const setSortMode = useStore(vigilStore, s => s.setSortMode);
  const searchQuery = useStore(vigilStore, s => s.searchQuery);
  const setSearchQuery = useStore(vigilStore, s => s.setSearchQuery);
  const detailLineCount = useDetailLineCount();
  const [showHelp, setShowHelp] = useState(false);
  const detailPrefetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visiblePrefetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Get PR keys sorted to match dashboard order. */
  const getSortedKeys = useCallback((): string[] => {
    return buildDashboardItems(vigilStore.getState()).map(item => item.key);
  }, []);

  /** Number of card columns based on terminal width. */
  const numCols = viewMode === 'cards' ? ((stdout.columns ?? 120) >= 140 ? 2 : 1) : 1;

  /** Move focus by delta within the sorted PR list. */
  const moveFocus = useCallback(
    (delta: number): void => {
      const sorted = getSortedKeys();
      if (sorted.length === 0) return;

      // Default to first item when no focus set
      const currentIdx = focusedPr ? sorted.indexOf(focusedPr) : 0;
      const nextIdx = Math.max(0, Math.min(sorted.length - 1, currentIdx + delta));
      const nextKey = sorted[nextIdx];
      if (nextKey !== undefined) {
        setFocusedPr(nextKey);
      }
    },
    [getSortedKeys, focusedPr, setFocusedPr]
  );

  /** Prefetch details for cards currently visible in the dashboard viewport. */
  const onVisiblePrKeysChange = useCallback((keys: string[]): void => {
    if (visiblePrefetchTimer.current) {
      clearTimeout(visiblePrefetchTimer.current);
      visiblePrefetchTimer.current = null;
    }
    if (keys.length === 0) return;

    const uniqueKeys = [...new Set(keys)];
    visiblePrefetchTimer.current = setTimeout(() => {
      for (const key of uniqueKeys) {
        void fetchDetailIfNeeded(key);
      }
      visiblePrefetchTimer.current = null;
    }, DETAIL_PREFETCH_DEBOUNCE_MS);
  }, []);

  // ─── Extracted Input Handlers ──────────────────────────────────────

  /** Handle keyboard input while in search mode. */
  function onSearchInput(
    input: string,
    key: {
      escape: boolean;
      return: boolean;
      backspace: boolean;
      delete: boolean;
      ctrl: boolean;
      meta: boolean;
    },
    query: string
  ): void {
    if (key.escape) {
      setSearchQuery(null);
      return;
    }
    if (key.return) {
      if (query.length === 0) setSearchQuery(null);
      return;
    }
    if (key.backspace || key.delete) {
      setSearchQuery(query.length === 0 ? null : query.slice(0, -1));
      return;
    }
    if (input && !key.ctrl && !key.meta) setSearchQuery(query + input);
  }

  /** Handle Enter key — opens detail from dashboard. */
  function onEnter(): void {
    if (view !== 'dashboard') return;
    let prKey = focusedPr;
    if (!prKey) {
      const sorted = getSortedKeys();
      prKey = sorted[0] ?? null;
      if (prKey) setFocusedPr(prKey);
    }
    if (prKey) {
      setView('detail');
      void fetchDetailIfNeeded(prKey);
    }
  }

  /** Handle g/G jump to top/bottom. */
  function onJump(toBottom: boolean): void {
    if (view === 'dashboard') {
      const sorted = getSortedKeys();
      const target = toBottom ? sorted[sorted.length - 1] : sorted[0];
      if (target) setFocusedPr(target);
    } else if (view === 'detail') {
      const delta = toBottom ? detailLineCount : -detailLineCount;
      scrollView('detail', delta, detailLineCount);
    }
  }

  const onGlobalCommand = useCallback(
    (input: string): boolean => {
      switch (input) {
        case '?':
          setShowHelp(true);
          return true;
        case 'q':
          exit();
          return true;
        case 'y':
          setMode(mode === 'hitl' ? 'yolo' : 'hitl');
          return true;
        case 'r': {
          resetGitHubRateLimitBackoff();
          void poll();
          const state = vigilStore.getState();
          if (state.config.radar.enabled) {
            void pollRadar(state.config.radar);
          }
          return true;
        }
        case 'o': {
          const prUrl = getFocusedPr(focusedPr)?.url;
          if (prUrl) openInBrowser(prUrl);
          return true;
        }
        case 'x':
          setSearchQuery(null);
          setView(view === 'activity' ? 'dashboard' : 'activity');
          return true;
        case 'a':
          // The action panel owns `a` for approve-all while it's focused.
          if (view === 'action') return false;
          setSearchQuery(null);
          setView('action');
          return true;
        default:
          return false;
      }
    },
    [exit, focusedPr, mode, setMode, setSearchQuery, setView, view]
  );

  /** Handle keys that work globally regardless of view. Returns true if handled. */
  function onGlobalKey(input: string, key: { tab: boolean; escape: boolean }): boolean {
    if (onGlobalCommand(input)) return true;
    if (!key.escape || view === 'dashboard') return false;
    setSearchQuery(null);
    setView('dashboard');
    return true;
  }

  /** Resolve directional input to a focus delta. Returns 0 if not a nav key. */
  function dashboardNavDelta(
    input: string,
    key: {
      tab: boolean;
      shift: boolean;
      upArrow: boolean;
      downArrow: boolean;
      leftArrow: boolean;
      rightArrow: boolean;
    }
  ): number {
    if (key.tab) return key.shift ? -1 : 1;
    if (input === 'k' || key.upArrow) return -numCols;
    if (input === 'j' || key.downArrow) return numCols;
    if ((input === 'h' || key.leftArrow) && numCols > 1) return -1;
    if ((input === 'l' || key.rightArrow) && numCols > 1) return 1;
    return 0;
  }

  /** Handle keys in dashboard view. */
  function onDashboardKey(
    input: string,
    key: {
      tab: boolean;
      shift: boolean;
      upArrow: boolean;
      downArrow: boolean;
      leftArrow: boolean;
      rightArrow: boolean;
      return: boolean;
    }
  ): void {
    const delta = dashboardNavDelta(input, key);
    if (delta !== 0) {
      moveFocus(delta);
      return;
    }
    if (key.return) {
      onEnter();
      return;
    }
    if (input === 'g') {
      onJump(false);
      return;
    }
    if (input === 'G') {
      onJump(true);
      return;
    }
    if (input === '/') {
      setSearchQuery('');
      return;
    }
    if (input === 'v') {
      setViewMode(viewMode === 'cards' ? 'list' : 'cards');
      return;
    }
    if (input === 's') {
      setSortMode(sortMode === 'activity' ? 'state' : 'activity');
      return;
    }
    if (input === 'm') {
      cycleDashboardFeedMode();
    }
  }

  /** Handle keys in detail view. */
  function onDetailReviewJump(
    input: string,
    key: { leftArrow: boolean; rightArrow: boolean }
  ): boolean {
    const detailPr = getFocusedPr(focusedPr);
    const detailItems = detailPr ? buildDetailItems(detailPr) : [];
    if (detailItems.length === 0) return false;

    if (input === 'h' || key.leftArrow) {
      setDetailSelection(findRelativeReviewItemIndex(detailItems, detailSelection, -1));
      return true;
    }
    if (input === 'l' || key.rightArrow) {
      setDetailSelection(findRelativeReviewItemIndex(detailItems, detailSelection, 1));
      return true;
    }

    return false;
  }

  function onDetailNavigatorKey(
    input: string,
    key: { upArrow: boolean; downArrow: boolean; return: boolean }
  ): boolean {
    const detailPr = getFocusedPr(focusedPr);
    const detailItems = detailPr ? buildDetailItems(detailPr) : [];

    if (input === 'k' || key.upArrow) {
      moveDetailSelection(-1, detailItems.length);
      return true;
    }
    if (input === 'j' || key.downArrow) {
      moveDetailSelection(1, detailItems.length);
      return true;
    }
    if (input === 'g') {
      setDetailSelection(0);
      return true;
    }
    if (input === 'G') {
      setDetailSelection(Math.max(0, detailItems.length - 1));
      return true;
    }
    if (key.return) {
      setDetailFocus('inspector');
      resetScroll('detail');
      return true;
    }

    return false;
  }

  function onDetailInspectorKey(
    input: string,
    key: { upArrow: boolean; downArrow: boolean }
  ): boolean {
    if (input === 'k' || key.upArrow) {
      scrollView('detail', -1, detailLineCount);
      return true;
    }
    if (input === 'j' || key.downArrow) {
      scrollView('detail', 1, detailLineCount);
      return true;
    }
    if (input === 'g') {
      onJump(false);
      return true;
    }
    if (input === 'G') {
      onJump(true);
      return true;
    }

    return false;
  }

  function onDetailKey(
    input: string,
    key: {
      tab: boolean;
      shift: boolean;
      upArrow: boolean;
      downArrow: boolean;
      leftArrow: boolean;
      rightArrow: boolean;
      return: boolean;
    }
  ): void {
    if (key.tab) {
      cycleDetailFocus(key.shift);
      return;
    }

    if (onDetailReviewJump(input, key)) {
      return;
    }

    if (detailFocus === 'navigator') {
      onDetailNavigatorKey(input, key);
    } else {
      onDetailInspectorKey(input, key);
    }
  }

  const resolveDetailMouseTarget = useCallback(
    (event: MouseEvent): DetailMouseTarget | null => {
      const pr = getFocusedPr(focusedPr);
      if (!pr) return null;
      return resolveDetailMouseTargetFromLayout(
        event,
        pr,
        focusedPr,
        vigilStore.getState().activeAgents,
        stdout.columns ?? 80,
        stdout.rows ?? 24
      );
    },
    [focusedPr, stdout.columns, stdout.rows]
  );

  // ─── Keyboard ─────────────────────────────────────────────────────

  useInput((input, key) => {
    if (searchQuery !== null) {
      onSearchInput(input, key, searchQuery);
      return;
    }
    if (showHelp) {
      if (input === '?' || key.escape) setShowHelp(false);
      return;
    }
    if (onGlobalKey(input, key)) return;
    if (view === 'dashboard') onDashboardKey(input, key);
    else if (view === 'detail') onDetailKey(input, key);
  });

  // ─── Mouse ────────────────────────────────────────────────────────

  /** Handle mouse click on dashboard to select/open a PR. */
  const onDashboardClick = useCallback(
    (event: MouseEvent): void => {
      const sorted = getSortedKeys();
      if (sorted.length === 0) return;

      const itemHeight = viewMode === 'cards' ? CARD_HEIGHT : LIST_ROW_HEIGHT;
      const contentY = event.y - HEADER_LINES;
      if (contentY < 1) return;

      const row = Math.floor((contentY - 1) / itemHeight);
      const tw = stdout.columns ?? 120;
      const col = viewMode === 'cards' ? Math.floor(((event.x - 1) / tw) * numCols) : 0;
      const scrollOffset = vigilStore.getState().scrollOffsets.dashboard;
      const idx = (scrollOffset + row) * numCols + col;

      if (idx >= 0 && idx < sorted.length) {
        const key = sorted[idx];
        if (key !== undefined) {
          setFocusedPr(key);
          void fetchDetailIfNeeded(key);
          if (key === focusedPr) {
            setView('detail');
          }
        }
      }
    },
    [getSortedKeys, viewMode, stdout.columns, numCols, setFocusedPr, focusedPr, setView]
  );

  /** Handle mouse scroll wheel. */
  const onMouseScroll = useCallback(
    (event: MouseEvent): void => {
      const delta = event.button === 64 ? -1 : 1;
      if (view === 'dashboard') {
        moveFocus(delta * numCols);
        return;
      }
      if (view !== 'detail') return;

      const target = resolveDetailMouseTarget(event);
      if (!target) return;

      if (target.zone === 'navigator') {
        setDetailFocus('navigator');
        moveDetailSelection(delta, target.items.length);
        return;
      }

      if (target.zone === 'inspector') {
        setDetailFocus('inspector');
        scrollView('detail', delta, detailLineCount);
      }
    },
    [
      view,
      moveFocus,
      numCols,
      resolveDetailMouseTarget,
      setDetailFocus,
      moveDetailSelection,
      scrollView,
      detailLineCount,
    ]
  );

  const onDetailClick = useCallback(
    (event: MouseEvent): void => {
      const target = resolveDetailMouseTarget(event);
      if (!target) return;

      switch (target.zone) {
        case 'breadcrumb':
          setView('dashboard');
          return;
        case 'navigator': {
          setDetailFocus('navigator');
          if (target.navigatorBodyRow === null) return;
          const hitIndex = detailNavigatorItemIndexAtRow(
            target.items,
            target.layout.navigatorHeight,
            detailSelection,
            target.navigatorBodyRow
          );
          if (hitIndex !== null) {
            setDetailSelection(hitIndex);
          }
          return;
        }
        case 'inspector':
          setDetailFocus('inspector');
          return;
        default:
          return;
      }
    },
    [resolveDetailMouseTarget, setView, setDetailFocus, detailSelection, setDetailSelection]
  );

  const handleMouse = useCallback(
    (event: MouseEvent) => {
      if (isMouseScrollEvent(event)) {
        onMouseScroll(event);
        return;
      }

      if (event.button !== 0 || event.isRelease) return;

      if (view === 'detail') {
        onDetailClick(event);
        return;
      }

      if (view === 'dashboard') onDashboardClick(event);
    },
    [view, onMouseScroll, onDetailClick, onDashboardClick]
  );

  useMouse(handleMouse);

  useEffect(() => {
    if (!focusedPr || (view !== 'dashboard' && view !== 'detail')) {
      if (detailPrefetchTimer.current) {
        clearTimeout(detailPrefetchTimer.current);
        detailPrefetchTimer.current = null;
      }
      return;
    }

    if (detailPrefetchTimer.current) {
      clearTimeout(detailPrefetchTimer.current);
      detailPrefetchTimer.current = null;
    }

    if (view === 'detail') {
      void fetchDetailIfNeeded(focusedPr);
      return;
    }

    detailPrefetchTimer.current = setTimeout(() => {
      void fetchDetailIfNeeded(focusedPr);
    }, DETAIL_PREFETCH_DEBOUNCE_MS);

    return () => {
      if (detailPrefetchTimer.current) {
        clearTimeout(detailPrefetchTimer.current);
        detailPrefetchTimer.current = null;
      }
    };
  }, [focusedPr, view]);

  useEffect(() => {
    return () => {
      if (visiblePrefetchTimer.current) {
        clearTimeout(visiblePrefetchTimer.current);
        visiblePrefetchTimer.current = null;
      }
    };
  }, []);

  // ─── Render ───────────────────────────────────────────────────────

  const termRows = stdout.rows ?? 24;
  const termCols = stdout.columns ?? 80;

  if (termCols < MIN_COLS || termRows < MIN_ROWS) {
    return <TooSmall cols={termCols} rows={termRows} />;
  }

  return (
    <Box flexDirection="column" height={termRows}>
      {showHelp ? (
        <Box flexGrow={1}>
          <HelpOverlay />
        </Box>
      ) : (
        <Box flexGrow={1}>
          {view === 'dashboard' && <Dashboard onVisiblePrKeysChange={onVisiblePrKeysChange} />}
          {view === 'detail' && <PrDetail />}
          {view === 'action' && <ActionPanel />}
          {view === 'activity' && <ActivityPanel />}
        </Box>
      )}
    </Box>
  );
}
