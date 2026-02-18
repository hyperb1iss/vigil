import { Box, useApp, useInput, useStdout } from 'ink';
import type { JSX } from 'react';
import { useCallback } from 'react';
import { useStore } from 'zustand';
import { poll } from './core/poller.js';
import { vigilStore } from './store/index.js';
import { ActionPanel } from './tui/action-panel.js';
import { Dashboard } from './tui/dashboard.js';
import { PrDetail, useDetailLineCount } from './tui/pr-detail.js';
import type { MouseEvent } from './tui/use-mouse.js';
import { useMouse } from './tui/use-mouse.js';

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
  const detailLineCount = useDetailLineCount();

  /** Get PR keys sorted by state priority + updatedAt. */
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
        const sa = prStates.get(a.key) ?? 'dormant';
        const sb = prStates.get(b.key) ?? 'dormant';
        const pri = (STATE_ORDER[sa] ?? 4) - (STATE_ORDER[sb] ?? 4);
        if (pri !== 0) return pri;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      })
      .map(pr => pr.key);
  }, [prs, prStates]);

  /** Move focus by delta within the sorted PR list. */
  const moveFocus = useCallback(
    (delta: number): void => {
      const sorted = getSortedKeys();
      if (sorted.length === 0) return;

      const currentIdx = focusedPr ? sorted.indexOf(focusedPr) : -1;
      const nextIdx = Math.max(0, Math.min(sorted.length - 1, currentIdx + delta));
      const nextKey = sorted[nextIdx];
      if (nextKey !== undefined) {
        setFocusedPr(nextKey);
      }
    },
    [getSortedKeys, focusedPr, setFocusedPr]
  );

  // ─── Keyboard ─────────────────────────────────────────────────────

  useInput((input, key) => {
    if (input === 'q') {
      exit();
      return;
    }

    if (input === 'k' || key.upArrow) {
      if (view === 'dashboard') {
        scrollView('dashboard', -1, getSortedKeys().length);
        moveFocus(-1);
      } else if (view === 'detail') {
        scrollView('detail', -1, detailLineCount);
      }
      // Action panel handles its own j/k
      return;
    }

    if (input === 'j' || key.downArrow) {
      if (view === 'dashboard') {
        const sorted = getSortedKeys();
        scrollView('dashboard', 1, sorted.length);
        moveFocus(1);
      } else if (view === 'detail') {
        scrollView('detail', 1, detailLineCount);
      }
      // Action panel handles its own j/k
      return;
    }

    if (key.return) {
      if (focusedPr && view === 'dashboard') {
        setView('detail');
      }
      return;
    }

    if (key.escape) {
      if (view !== 'dashboard') {
        setView('dashboard');
      }
      return;
    }

    if (input === 'y') {
      setMode(mode === 'hitl' ? 'yolo' : 'hitl');
      return;
    }

    if (input === 'v' && view === 'dashboard') {
      setViewMode(viewMode === 'cards' ? 'list' : 'cards');
      return;
    }

    if (input === 'a' && view === 'detail') {
      setView('action');
      return;
    }

    if (input === 'r') {
      void poll();
    }
  });

  // ─── Mouse ────────────────────────────────────────────────────────

  const handleMouse = useCallback(
    (event: MouseEvent) => {
      if (view !== 'dashboard') return;

      // Scroll wheel
      if (event.button === 64) {
        scrollView('dashboard', -1, getSortedKeys().length);
        moveFocus(-1);
        return;
      }
      if (event.button === 65) {
        const sorted = getSortedKeys();
        scrollView('dashboard', 1, sorted.length);
        moveFocus(1);
        return;
      }

      // Left click — calculate which PR was clicked
      if (event.button === 0 && !event.isRelease) {
        const sorted = getSortedKeys();
        if (sorted.length === 0) return;

        const termWidth = stdout.columns ?? 120;
        const numCols = viewMode === 'cards' ? (termWidth >= 140 ? 2 : 1) : 1;
        const itemHeight = viewMode === 'cards' ? CARD_HEIGHT : LIST_ROW_HEIGHT;

        const contentY = event.y - HEADER_LINES;
        if (contentY < 1) return;

        const row = Math.floor((contentY - 1) / itemHeight);
        const col = viewMode === 'cards' ? Math.floor(((event.x - 1) / termWidth) * numCols) : 0;

        const scrollOffset = vigilStore.getState().scrollOffsets.dashboard;
        const idx = (scrollOffset + row) * numCols + col;

        if (idx >= 0 && idx < sorted.length) {
          const key = sorted[idx];
          if (key !== undefined) {
            setFocusedPr(key);

            // Double-click detection: if clicking already-focused PR, open detail
            if (key === focusedPr) {
              setView('detail');
            }
          }
        }
      }
    },
    [
      view,
      viewMode,
      scrollView,
      moveFocus,
      getSortedKeys,
      setFocusedPr,
      focusedPr,
      setView,
      stdout,
    ]
  );

  useMouse(handleMouse);

  // ─── Render ───────────────────────────────────────────────────────

  const termRows = stdout.rows ?? 24;

  return (
    <Box flexDirection="column" height={termRows}>
      {view === 'dashboard' && <Dashboard />}
      {view === 'detail' && <PrDetail />}
      {view === 'action' && <ActionPanel />}
    </Box>
  );
}
