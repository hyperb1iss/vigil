import { spawn } from 'node:child_process';

import { Box, useApp, useInput, useStdout } from 'ink';
import type { JSX } from 'react';
import { useCallback, useState } from 'react';
import { useStore } from 'zustand';

import { poll } from './core/poller.js';
import { vigilStore } from './store/index.js';
import { ActionPanel } from './tui/action-panel.js';
import { Dashboard } from './tui/dashboard.js';
import { HelpOverlay } from './tui/help-overlay.js';
import { PrDetail, useDetailLineCount } from './tui/pr-detail.js';
import type { MouseEvent } from './tui/use-mouse.js';
import { useMouse } from './tui/use-mouse.js';

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

  // ─── Keyboard ─────────────────────────────────────────────────────

  useInput((input, key) => {
    // ─── Search Mode Input ──────────────────────────────────────────
    if (searchQuery !== null) {
      if (key.escape) {
        setSearchQuery(null);
        return;
      }
      if (key.return) {
        // Keep filter active, exit search input mode
        if (searchQuery.length === 0) {
          setSearchQuery(null); // Empty query = cancel
        }
        return;
      }
      if (key.backspace || key.delete) {
        if (searchQuery.length === 0) {
          setSearchQuery(null);
        } else {
          setSearchQuery(searchQuery.slice(0, -1));
        }
        return;
      }
      // Append printable characters to query
      if (input && !key.ctrl && !key.meta) {
        setSearchQuery(searchQuery + input);
      }
      return;
    }

    // ─── Help Overlay ────────────────────────────────────────────────
    if (showHelp) {
      if (input === '?' || key.escape) {
        setShowHelp(false);
      }
      return;
    }

    // ─── Normal Mode ────────────────────────────────────────────────
    if (input === '?') {
      setShowHelp(true);
      return;
    }

    if (input === 'q') {
      exit();
      return;
    }

    // Tab / Shift+Tab — sequential PR cycling (dashboard), scroll (detail)
    if (key.tab) {
      if (view === 'dashboard') {
        moveFocus(key.shift ? -1 : 1);
      } else if (view === 'detail') {
        scrollView('detail', key.shift ? -5 : 5, detailLineCount);
      }
      return;
    }

    if (input === 'k' || key.upArrow) {
      if (view === 'dashboard') {
        moveFocus(-numCols); // Move up one row
      } else if (view === 'detail') {
        scrollView('detail', -1, detailLineCount);
      }
      return;
    }

    if (input === 'j' || key.downArrow) {
      if (view === 'dashboard') {
        moveFocus(numCols); // Move down one row
      } else if (view === 'detail') {
        scrollView('detail', 1, detailLineCount);
      }
      return;
    }

    // Column navigation (dashboard only)
    if (input === 'h' || key.leftArrow) {
      if (view === 'dashboard' && numCols > 1) {
        moveFocus(-1);
      }
      return;
    }

    if (input === 'l' || key.rightArrow) {
      if (view === 'dashboard' && numCols > 1) {
        moveFocus(1);
      }
      return;
    }

    if (key.return) {
      if (view === 'dashboard') {
        // If no PR focused yet, default to first in list
        if (!focusedPr) {
          const sorted = getSortedKeys();
          if (sorted[0]) setFocusedPr(sorted[0]);
        }
        if (focusedPr || getSortedKeys().length > 0) {
          setView('detail');
        }
      }
      return;
    }

    if (key.escape) {
      if (view !== 'dashboard') {
        setSearchQuery(null);
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

    if (input === 's' && view === 'dashboard') {
      setSortMode(sortMode === 'activity' ? 'state' : 'activity');
      return;
    }

    if (input === 'a' && view === 'detail') {
      setView('action');
      return;
    }

    // Jump to top/bottom (vim g/G)
    if (input === 'g') {
      if (view === 'dashboard') {
        const sorted = getSortedKeys();
        if (sorted[0]) setFocusedPr(sorted[0]);
      } else if (view === 'detail') {
        scrollView('detail', -detailLineCount, detailLineCount);
      }
      return;
    }

    if (input === 'G') {
      if (view === 'dashboard') {
        const sorted = getSortedKeys();
        const last = sorted[sorted.length - 1];
        if (last) setFocusedPr(last);
      } else if (view === 'detail') {
        scrollView('detail', detailLineCount, detailLineCount);
      }
      return;
    }

    // Search (dashboard only)
    if (input === '/' && view === 'dashboard') {
      setSearchQuery('');
      return;
    }

    // Open focused PR in browser
    if (input === 'o') {
      const prUrl = focusedPr ? prs.get(focusedPr)?.url : undefined;
      if (prUrl) {
        openInBrowser(prUrl);
      }
      return;
    }

    if (input === 'r') {
      void poll();
    }
  });

  // ─── Mouse ────────────────────────────────────────────────────────

  const handleMouse = useCallback(
    (event: MouseEvent) => {
      // Scroll wheel — works on dashboard + detail views
      if (event.button === 64 || event.button === 65) {
        const delta = event.button === 64 ? -1 : 1;
        if (view === 'dashboard') {
          moveFocus(delta * numCols); // Scroll by row
        } else if (view === 'detail') {
          scrollView('detail', delta, detailLineCount);
        }
        return;
      }

      // Left click
      if (event.button !== 0 || event.isRelease) return;

      // Detail view: click opens PR in browser
      if (view === 'detail') {
        const prUrl = focusedPr ? prs.get(focusedPr)?.url : undefined;
        if (prUrl) openInBrowser(prUrl);
        return;
      }

      // Dashboard: click to select PR
      if (view === 'dashboard') {
        const sorted = getSortedKeys();
        if (sorted.length === 0) return;

        const cols = numCols;
        const itemHeight = viewMode === 'cards' ? CARD_HEIGHT : LIST_ROW_HEIGHT;

        const contentY = event.y - HEADER_LINES;
        if (contentY < 1) return;

        const row = Math.floor((contentY - 1) / itemHeight);
        const tw = stdout.columns ?? 120;
        const col = viewMode === 'cards' ? Math.floor(((event.x - 1) / tw) * cols) : 0;

        const scrollOffset = vigilStore.getState().scrollOffsets.dashboard;
        const idx = (scrollOffset + row) * cols + col;

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
      prs,
      setView,
      stdout,
      detailLineCount,
      numCols,
    ]
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
