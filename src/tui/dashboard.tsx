import { Box, Text, useStdout } from 'ink';
import type { JSX } from 'react';
import { useStore } from 'zustand';
import { vigilStore } from '../store/index.js';
import type { PrState, PullRequest } from '../types/index.js';
import { AgentStatus } from './agent-status.js';
import { PrRow, statePriority } from './pr-row.js';
import { palette, prStateColors, semantic, stateIndicators, stateLabels } from './theme.js';

// ─── Constants ────────────────────────────────────────────────────────

/** Lines reserved for header, footer, agent status, etc. */
const CHROME_LINES = 6;

const ALL_STATES: PrState[] = ['hot', 'waiting', 'ready', 'blocked', 'dormant'];

// ─── Header ───────────────────────────────────────────────────────────

function Header({
  counts,
  mode,
}: {
  counts: Record<PrState, number>;
  mode: 'hitl' | 'yolo';
}): JSX.Element {
  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text color={palette.electricPurple} bold>
          VIGIL
        </Text>
        <Text color={semantic.muted}>
          {icons.dot} {mode === 'hitl' ? 'HITL' : 'YOLO'} mode
        </Text>
        <Box flexGrow={1} />
        {ALL_STATES.map(state => (
          <Text key={state} color={prStateColors[state]}>
            {stateIndicators[state]} {stateLabels[state]}:{counts[state]}
          </Text>
        ))}
      </Box>
      <Text color={semantic.muted}>{'\u2500'.repeat(72)}</Text>
    </Box>
  );
}

// Need icons for the header
const icons = { dot: '\u2022' } as const;

// ─── Footer ───────────────────────────────────────────────────────────

function Footer(): JSX.Element {
  return (
    <Box gap={2} paddingTop={1}>
      <Text color={semantic.muted}>
        <Text color={palette.neonCyan} bold>
          j/k
        </Text>{' '}
        navigate{' '}
        <Text color={palette.neonCyan} bold>
          Enter
        </Text>{' '}
        detail{' '}
        <Text color={palette.neonCyan} bold>
          y
        </Text>{' '}
        toggle mode{' '}
        <Text color={palette.neonCyan} bold>
          r
        </Text>{' '}
        refresh{' '}
        <Text color={palette.neonCyan} bold>
          q
        </Text>{' '}
        quit
      </Text>
    </Box>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────

export function Dashboard(): JSX.Element {
  const prs = useStore(vigilStore, s => s.prs);
  const prStates = useStore(vigilStore, s => s.prStates);
  const scrollOffset = useStore(vigilStore, s => s.scrollOffset);
  const focusedPr = useStore(vigilStore, s => s.focusedPr);
  const mode = useStore(vigilStore, s => s.mode);

  const { stdout } = useStdout();
  const terminalRows = stdout.rows ?? 24;
  const visibleRows = Math.max(1, terminalRows - CHROME_LINES);

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

  // Tally counts per state
  const counts: Record<PrState, number> = { hot: 0, waiting: 0, ready: 0, blocked: 0, dormant: 0 };
  for (const { state } of sorted) {
    counts[state]++;
  }

  // Windowed slice
  const visible = sorted.slice(scrollOffset, scrollOffset + visibleRows);

  // Resolve focused key — default to first visible if none set
  const effectiveFocus = focusedPr ?? visible[0]?.pr.key ?? null;

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Header counts={counts} mode={mode} />

      {visible.length === 0 ? (
        <Box paddingY={1} justifyContent="center">
          <Text color={semantic.muted}>No PRs to display. Waiting for poll\u2026</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {visible.map(({ pr, state }) => (
            <PrRow key={pr.key} pr={pr} state={state} isFocused={pr.key === effectiveFocus} />
          ))}
        </Box>
      )}

      <Box flexGrow={1} />
      <AgentStatus />
      <Footer />
    </Box>
  );
}
