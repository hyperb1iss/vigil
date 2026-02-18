import { Box, useApp, useInput } from 'ink';
import type { JSX } from 'react';
import { useStore } from 'zustand';
import { poll } from './core/poller.js';
import { vigilStore } from './store/index.js';
import { ActionPanel } from './tui/action-panel.js';
import { Dashboard } from './tui/dashboard.js';
import { PrDetail } from './tui/pr-detail.js';

export function App(): JSX.Element {
  const { exit } = useApp();
  const view = useStore(vigilStore, s => s.view);
  const setView = useStore(vigilStore, s => s.setView);
  const setMode = useStore(vigilStore, s => s.setMode);
  const mode = useStore(vigilStore, s => s.mode);
  const scrollUp = useStore(vigilStore, s => s.scrollUp);
  const scrollDown = useStore(vigilStore, s => s.scrollDown);
  const focusedPr = useStore(vigilStore, s => s.focusedPr);
  const setFocusedPr = useStore(vigilStore, s => s.setFocusedPr);
  const prs = useStore(vigilStore, s => s.prs);
  const prStates = useStore(vigilStore, s => s.prStates);

  useInput((input, key) => {
    // Quit
    if (input === 'q') {
      exit();
      return;
    }

    // Navigate up
    if (input === 'k' || key.upArrow) {
      scrollUp();
      moveFocus(-1);
      return;
    }

    // Navigate down
    if (input === 'j' || key.downArrow) {
      scrollDown();
      moveFocus(1);
      return;
    }

    // Select / enter detail view
    if (key.return) {
      if (focusedPr && view === 'dashboard') {
        setView('detail');
      }
      return;
    }

    // Back
    if (key.escape) {
      if (view !== 'dashboard') {
        setView('dashboard');
      }
      return;
    }

    // Toggle mode
    if (input === 'y') {
      setMode(mode === 'hitl' ? 'yolo' : 'hitl');
      return;
    }

    // Action panel
    if (input === 'a' && view === 'detail') {
      setView('action');
      return;
    }

    // Manual refresh
    if (input === 'r') {
      void poll();
    }
  });

  /** Move focus by delta within the sorted PR list. */
  function moveFocus(delta: number): void {
    const sorted = getSortedKeys();
    if (sorted.length === 0) return;

    const currentIdx = focusedPr ? sorted.indexOf(focusedPr) : -1;
    const nextIdx = Math.max(0, Math.min(sorted.length - 1, currentIdx + delta));
    const nextKey = sorted[nextIdx];
    if (nextKey !== undefined) {
      setFocusedPr(nextKey);
    }
  }

  /** Get PR keys sorted by state priority + updatedAt. */
  function getSortedKeys(): string[] {
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
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      {view === 'dashboard' && <Dashboard />}
      {view === 'detail' && <PrDetail />}
      {view === 'action' && <ActionPanel />}
    </Box>
  );
}
