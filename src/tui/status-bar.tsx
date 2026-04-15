import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { JSX } from 'react';
import { useStore } from 'zustand';

import { vigilStore } from '../store/index.js';
import type { PrState } from '../types/index.js';
import {
  icons,
  palette,
  prStateColors,
  semantic,
  stateIndicators,
  timeAgo,
  truncate,
} from './theme.js';

const ALL_STATES: PrState[] = ['hot', 'waiting', 'ready', 'blocked', 'dormant'];

export function StatusBar(): JSX.Element {
  const prs = useStore(vigilStore, s => s.prs);
  const prStates = useStore(vigilStore, s => s.prStates);
  const radarPrs = useStore(vigilStore, s => s.radarPrs);
  const mergedRadarPrs = useStore(vigilStore, s => s.mergedRadarPrs);
  const dashboardFeedMode = useStore(vigilStore, s => s.dashboardFeedMode);
  const mode = useStore(vigilStore, s => s.mode);
  const viewMode = useStore(vigilStore, s => s.viewMode);
  const sortMode = useStore(vigilStore, s => s.sortMode);
  const isPolling = useStore(vigilStore, s => s.isPolling);
  const radarIsPolling = useStore(vigilStore, s => s.radarIsPolling);
  const lastPollAt = useStore(vigilStore, s => s.lastPollAt);
  const radarLastPollAt = useStore(vigilStore, s => s.radarLastPollAt);
  const pollError = useStore(vigilStore, s => s.pollError);
  const radarPollError = useStore(vigilStore, s => s.radarPollError);

  // Tally state counts
  const counts: Record<PrState, number> = { hot: 0, waiting: 0, ready: 0, blocked: 0, dormant: 0 };
  for (const pr of prs.values()) {
    const state = prStates.get(pr.key) ?? 'dormant';
    counts[state]++;
  }

  const totalPrs = prs.size;
  const hasIncoming = dashboardFeedMode === 'incoming' || dashboardFeedMode === 'both';
  const incomingCount = radarPrs.size;
  const mergedCount = mergedRadarPrs.size;

  const effectiveError = pollError ?? (hasIncoming ? radarPollError : null);
  const effectiveLastPoll =
    hasIncoming && radarLastPollAt
      ? lastPollAt && new Date(lastPollAt) > new Date(radarLastPollAt)
        ? lastPollAt
        : radarLastPollAt
      : lastPollAt;

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

        <Text color={semantic.muted}>
          feed:{' '}
          <Text color={palette.neonCyan} bold>
            {dashboardFeedMode}
          </Text>
        </Text>

        <Text color={semantic.dim}>{' │ '}</Text>

        {/* View mode + sort */}
        <Text color={semantic.muted}>
          {viewMode === 'cards' ? `${icons.grid} cards` : `${icons.list} list`}
        </Text>
        <Text color={semantic.dim}>{' · '}</Text>
        <Text color={semantic.muted}>
          {sortMode === 'activity' ? `${icons.pulse} activity` : `${icons.sort} state`}
        </Text>

        <Text color={semantic.dim}>{' │ '}</Text>

        {/* PR state counts */}
        {dashboardFeedMode === 'mine' ? (
          totalPrs > 0 ? (
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
          )
        ) : (
          <Text color={semantic.muted}>
            mine <Text color={palette.neonCyan}>{totalPrs}</Text>
            <Text color={semantic.dim}>{' · '}</Text>
            incoming <Text color={palette.electricYellow}>{incomingCount}</Text>
            <Text color={semantic.dim}>{' · '}</Text>
            merged <Text color={semantic.success}>{mergedCount}</Text>
          </Text>
        )}
      </Text>

      <Box flexGrow={1} />

      {/* Polling indicator */}
      {isPolling || (hasIncoming && radarIsPolling) ? (
        <Box gap={1}>
          <Text color={palette.neonCyan}>
            <Spinner type="dots" />
          </Text>
          <Text color={semantic.muted}>polling</Text>
        </Box>
      ) : effectiveError ? (
        <Text color={semantic.error}>
          {icons.cross} {truncate(effectiveError, 36)}
        </Text>
      ) : effectiveLastPoll ? (
        <Text color={semantic.muted}>
          {icons.refresh} {timeAgo(effectiveLastPoll)}
        </Text>
      ) : (
        <Text color={semantic.muted}>{icons.refresh} idle</Text>
      )}
    </Box>
  );
}
