import { spawn } from 'node:child_process';

import { Box, useApp, useInput, useStdout } from 'ink';
import type { JSX } from 'react';
import { useCallback, useState } from 'react';
import { useStore } from 'zustand';

import { fetchPrDetail } from './core/github.js';
import { poll } from './core/poller.js';
import { vigilStore } from './store/index.js';
import { ActionPanel } from './tui/action-panel.js';
import { Dashboard } from './tui/dashboard.js';
import { HelpOverlay } from './tui/help-overlay.js';
import { PrDetail, useDetailLineCount } from './tui/pr-detail.js';
import type { MouseEvent } from './tui/use-mouse.js';
import { useMouse } from './tui/use-mouse.js';

/** Fetch full PR detail on demand if the store only has search-stub data. */
async function fetchDetailIfNeeded(key: string): Promise<void> {
  const pr = vigilStore.getState().prs.get(key);
  if (!pr || pr.headRefName) return; // already enriched

  const hashIdx = key.indexOf('#');
  if (hashIdx === -1) return;
  const nameWithOwner = key.slice(0, hashIdx);
  const number = Number(key.slice(hashIdx + 1));
  const slashIdx = nameWithOwner.indexOf('/');
  if (slashIdx === -1 || Number.isNaN(number)) return;

  const owner = nameWithOwner.slice(0, slashIdx);
  const repo = nameWithOwner.slice(slashIdx + 1);

  try {
    const detail = await fetchPrDetail(owner, repo, number);
    vigilStore.getState().updatePr(key, detail);
  } catch {
    // Poller will retry on next cycle
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
  const focusedPr = useStore(vigilStore, s => s.focusedPr);
  const setFocusedPr = useStore(vigilStore, s => s.setFocusedPr);
  const prs = useStore(vigilStore, s => s.prs);
  const prStates = useStore(vigilStore, s => s.prStates);
  const sortMode = useStore(vigilStore, s => s.sortMode);
  const setSortMode = useStore(vigilStore, s => s.setSortMode);
  const searchQuery = useStore(vigilStore, s => s.searchQuery);
  const setSearchQuery = useStore(vigilStore, s => s.setSearchQuery);
  const detailLineCount = useDetailLineCount();
  const [showHelp, setShowHelp] = useState(false);

  /** Get PR keys sorted to match dashboard order. */
  const getSortedKeys = useCallback((): string[] => {
    const STATE_ORDER: Record<string, number> = {
      hot: 0,
      waiting: 1,
      ready: 2,
      blocked: 3,
      dormant: 4,
    };

    return Array.from(prs.values())
      .sort((a, b) => {
        if (sortMode === 'state') {
          const sa = prStates.get(a.key) ?? 'dormant';
          const sb = prStates.get(b.key) ?? 'dormant';
          const pri = (STATE_ORDER[sa] ?? 4) - (STATE_ORDER[sb] ?? 4);
          if (pri !== 0) return pri;
        }
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      })
      .map(pr => pr.key);
  }, [prs, prStates, sortMode]);

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

  /** Handle keys that work globally regardless of view. Returns true if handled. */
  function onGlobalKey(input: string, key: { tab: boolean; escape: boolean }): boolean {
    if (input === '?') {
      setShowHelp(true);
      return true;
    }
    if (input === 'q') {
      exit();
      return true;
    }
    if (input === 'y') {
      setMode(mode === 'hitl' ? 'yolo' : 'hitl');
      return true;
    }
    if (input === 'r') {
      void poll();
      return true;
    }
    if (input === 'o') {
      const prUrl = focusedPr ? prs.get(focusedPr)?.url : undefined;
      if (prUrl) openInBrowser(prUrl);
      return true;
    }
    if (key.escape && view !== 'dashboard') {
      setSearchQuery(null);
      setView('dashboard');
      return true;
    }
    return false;
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
    }
  }

  /** Handle keys in detail view. */
  function onDetailKey(
    input: string,
    key: { tab: boolean; shift: boolean; upArrow: boolean; downArrow: boolean }
  ): void {
    if (key.tab) {
      scrollView('detail', key.shift ? -5 : 5, detailLineCount);
      return;
    }
    if (input === 'k' || key.upArrow) {
      scrollView('detail', -1, detailLineCount);
      return;
    }
    if (input === 'j' || key.downArrow) {
      scrollView('detail', 1, detailLineCount);
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
    if (input === 'a') {
      setView('action');
    }
  }

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
          if (key === focusedPr) setView('detail');
        }
      }
    },
    [getSortedKeys, viewMode, stdout.columns, numCols, setFocusedPr, focusedPr, setView]
  );

  /** Handle mouse scroll wheel. */
  const onMouseScroll = useCallback(
    (button: number): void => {
      const delta = button === 64 ? -1 : 1;
      if (view === 'dashboard') moveFocus(delta * numCols);
      else if (view === 'detail') scrollView('detail', delta, detailLineCount);
    },
    [view, moveFocus, numCols, scrollView, detailLineCount]
  );

  const handleMouse = useCallback(
    (event: MouseEvent) => {
      if (event.button === 64 || event.button === 65) {
        onMouseScroll(event.button);
        return;
      }

      if (event.button !== 0 || event.isRelease) return;

      if (view === 'detail') {
        const prUrl = focusedPr ? prs.get(focusedPr)?.url : undefined;
        if (prUrl) openInBrowser(prUrl);
        return;
      }

      if (view === 'dashboard') onDashboardClick(event);
    },
    [view, focusedPr, prs, onMouseScroll, onDashboardClick]
  );

  useMouse(handleMouse);

  // ─── Render ───────────────────────────────────────────────────────

  const termRows = stdout.rows ?? 24;

  return (
    <Box flexDirection="column" height={termRows}>
      {showHelp ? (
        <HelpOverlay />
      ) : (
        <>
          {view === 'dashboard' && <Dashboard />}
          {view === 'detail' && <PrDetail />}
          {view === 'action' && <ActionPanel />}
        </>
      )}
    </Box>
  );
}
