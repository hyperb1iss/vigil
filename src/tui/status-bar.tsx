import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { JSX } from 'react';
import { useStore } from 'zustand';
import { vigilStore } from '../store/index.js';
import type { PrState } from '../types/index.js';
import { icons, palette, prStateColors, semantic, stateIndicators, timeAgo } from './theme.js';

const ALL_STATES: PrState[] = ['hot', 'waiting', 'ready', 'blocked', 'dormant'];

export function StatusBar(): JSX.Element {
  const prs = useStore(vigilStore, s => s.prs);
  const prStates = useStore(vigilStore, s => s.prStates);
  const mode = useStore(vigilStore, s => s.mode);
  const viewMode = useStore(vigilStore, s => s.viewMode);
  const isPolling = useStore(vigilStore, s => s.isPolling);
  const lastPollAt = useStore(vigilStore, s => s.lastPollAt);

  // Tally state counts
  const counts: Record<PrState, number> = { hot: 0, waiting: 0, ready: 0, blocked: 0, dormant: 0 };
  for (const pr of prs.values()) {
    const state = prStates.get(pr.key) ?? 'dormant';
    counts[state]++;
  }

  const totalPrs = prs.size;

  return (
    <Box paddingX={1}>
      <Text wrap="truncate-end">
        {/* Logo */}
        <Text color={palette.electricPurple} bold>
          {icons.bolt} VIGIL
        </Text>

        <Text color={semantic.dim}>{' │ '}</Text>

        {/* Mode */}
        <Text color={mode === 'yolo' ? palette.coral : palette.neonCyan} bold>
          {mode === 'yolo' ? 'YOLO' : 'HITL'}
        </Text>

        <Text color={semantic.dim}>{' │ '}</Text>

        {/* View mode */}
        <Text color={semantic.muted}>{viewMode === 'cards' ? '▦ Cards' : '☰ List'}</Text>

        <Text color={semantic.dim}>{' │ '}</Text>

        {/* PR state counts */}
        {totalPrs > 0 ? (
          ALL_STATES.map(state =>
            counts[state] > 0 ? (
              <Text key={state}>
                <Text color={prStateColors[state]}>
                  {stateIndicators[state]}
                  {counts[state]}
                </Text>
                {'  '}
              </Text>
            ) : null
          )
        ) : (
          <Text color={semantic.muted} italic>
            No PRs
          </Text>
        )}
      </Text>

      <Box flexGrow={1} />

      {/* Polling indicator */}
      {isPolling ? (
        <Box gap={1}>
          <Text color={palette.neonCyan}>
            <Spinner type="dots" />
          </Text>
          <Text color={semantic.muted}>polling</Text>
        </Box>
      ) : lastPollAt ? (
        <Text color={semantic.muted}>
          {icons.refresh} {timeAgo(lastPollAt)}
        </Text>
      ) : (
        <Text color={semantic.muted}>{icons.refresh} idle</Text>
      )}
    </Box>
  );
}
