import { Box, Text, useInput, useStdout } from 'ink';
import Spinner from 'ink-spinner';
import type { JSX } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';

import {
  type AgentLogEntry,
  getAgentLogPath,
  readAgentActivityTail,
} from '../agents/activity-log.js';
import { vigilStore } from '../store/index.js';
import { KeybindBar } from './keybind-bar.js';
import { ScrollIndicator } from './scroll-indicator.js';
import { StatusBar } from './status-bar.js';
import { icons, palette, semantic, truncate } from './theme.js';

const REFRESH_INTERVAL_MS = 900;
const LOG_TAIL_LIMIT = 400;
/** status bar + divider + keybind divider + keybind row + panel header/meta */
const CHROME_LINES = 6;

/** Events that are noise unless verbose mode is on */
const VERBOSE_EVENTS = new Set([
  'executor_tick',
  'orchestrator_dispatch',
  'orchestrator_dispatch_complete',
]);

function eventColor(event: string): string {
  if (event.includes('failed') || event.includes('error')) return semantic.error;
  if (event.includes('skipped')) return semantic.warning;
  if (event.includes('complete') || event.includes('success')) return semantic.success;
  if (event.includes('start') || event.includes('received')) return semantic.info;
  return semantic.muted;
}

function summarizeData(data: Record<string, unknown> | undefined): string {
  if (!data) return '';
  const keys: Array<'type' | 'routing' | 'fingerprint' | 'reason' | 'error'> = [
    'type',
    'routing',
    'fingerprint',
    'reason',
    'error',
  ];
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.length > 0) {
      return `${key}=${truncate(value, 36)}`;
    }
  }
  return truncate(JSON.stringify(data), 52);
}

function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--:--:--';
  return date.toLocaleTimeString([], { hour12: false });
}

function sameTail(a: AgentLogEntry[], b: AgentLogEntry[]): boolean {
  if (a.length !== b.length) return false;
  const lastA = a[a.length - 1];
  const lastB = b[b.length - 1];
  if (!lastA || !lastB) return a.length === 0 && b.length === 0;
  return (
    lastA.ts === lastB.ts &&
    lastA.event === lastB.event &&
    lastA.prKey === lastB.prKey &&
    lastA.runId === lastB.runId
  );
}

function ActiveRunRow({
  run,
  width,
}: {
  run: {
    agent: string;
    prKey: string;
    streamingOutput: string;
  };
  width: number;
}): JSX.Element {
  const lastStreamLine = run.streamingOutput.trimEnd().split('\n').pop() ?? '';
  const text = `${run.agent} ${run.prKey}${lastStreamLine.length > 0 ? ` ${lastStreamLine}` : ''}`;
  return (
    <Box gap={1} width={width}>
      <Text color={palette.neonCyan}>
        <Spinner type="dots" />
      </Text>
      <Text color={semantic.muted} wrap="truncate-end">
        <Text color={palette.electricPurple} bold>
          {truncate(text, 220)}
        </Text>
      </Text>
    </Box>
  );
}

function LogRow({ entry, width }: { entry: AgentLogEntry; width: number }): JSX.Element {
  const summary = summarizeData(entry.data);

  return (
    <Box width={width}>
      <Text color={semantic.muted} wrap="truncate-end">
        <Text color={semantic.timestamp}>{formatClock(entry.ts)}</Text>{' '}
        <Text color={eventColor(entry.event)}>{entry.event}</Text>
        {entry.agent ? (
          <>
            {' '}
            <Text color={palette.electricPurple}>{entry.agent}</Text>
          </>
        ) : null}
        {entry.prKey ? (
          <>
            {' '}
            <Text color={semantic.branch}>{entry.prKey}</Text>
          </>
        ) : null}
        {summary.length > 0 ? (
          <>
            {' '}
            <Text color={semantic.dim}>{summary}</Text>
          </>
        ) : null}
      </Text>
    </Box>
  );
}

export function ActivityPanel(): JSX.Element {
  const activeAgents = useStore(vigilStore, s => s.activeAgents);
  const actionQueue = useStore(vigilStore, s => s.actionQueue);
  const actionHistory = useStore(vigilStore, s => s.actionHistory);
  const scrollOffset = useStore(vigilStore, s => s.scrollOffsets.activity);
  const scrollView = useStore(vigilStore, s => s.scrollView);
  const showVerboseLogs = useStore(vigilStore, s => s.showVerboseLogs);
  const toggleVerboseLogs = useStore(vigilStore, s => s.toggleVerboseLogs);
  const { stdout } = useStdout();
  const termRows = stdout.rows ?? 24;
  const termWidth = stdout.columns ?? 80;

  const [entries, setEntries] = useState<AgentLogEntry[]>(() =>
    readAgentActivityTail(LOG_TAIL_LIMIT)
  );
  const previousLenRef = useRef(entries.length);
  const logPath = useMemo(() => getAgentLogPath(), []);

  useEffect(() => {
    function refresh(): void {
      const next = readAgentActivityTail(LOG_TAIL_LIMIT);
      setEntries(prev => (sameTail(prev, next) ? prev : next));
    }
    refresh();
    const timer = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  const filteredEntries = useMemo(
    () => (showVerboseLogs ? entries : entries.filter(e => !VERBOSE_EVENTS.has(e.event))),
    [entries, showVerboseLogs]
  );

  const running = useMemo(
    () => Array.from(activeAgents.values()).filter(run => run.status === 'running'),
    [activeAgents]
  );
  const runningRows = running.length > 0 ? Math.min(4, running.length) + 2 : 2;
  const visibleRows = Math.max(1, termRows - CHROME_LINES - runningRows);
  const panelContentWidth = Math.max(20, termWidth - 8);

  useEffect(() => {
    const prevLen = previousLenRef.current;
    const prevMaxOffset = Math.max(0, prevLen - visibleRows);
    const atTail = scrollOffset >= Math.max(0, prevMaxOffset - 1);
    const maxOffset = Math.max(0, filteredEntries.length - visibleRows);

    if (
      scrollOffset > maxOffset ||
      (filteredEntries.length > prevLen && atTail && scrollOffset !== maxOffset)
    ) {
      vigilStore.setState(prev => ({
        scrollOffsets: { ...prev.scrollOffsets, activity: maxOffset },
      }));
    }

    previousLenRef.current = filteredEntries.length;
  }, [filteredEntries.length, scrollOffset, visibleRows]);

  useInput((input, key) => {
    if (input === 'f') {
      toggleVerboseLogs();
      return;
    }
    if (input === 'j' || key.downArrow) {
      scrollView('activity', 1, filteredEntries.length, visibleRows);
      return;
    }
    if (input === 'k' || key.upArrow) {
      scrollView('activity', -1, filteredEntries.length, visibleRows);
      return;
    }
    if (key.tab) {
      scrollView('activity', key.shift ? -10 : 10, filteredEntries.length, visibleRows);
      return;
    }
    if (input === 'g') {
      scrollView('activity', -filteredEntries.length, filteredEntries.length, visibleRows);
      return;
    }
    if (input === 'G') {
      scrollView('activity', filteredEntries.length, filteredEntries.length, visibleRows);
    }
  });

  const visibleEntries = filteredEntries.slice(scrollOffset, scrollOffset + visibleRows);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <StatusBar />
      <Box paddingX={1}>
        <Text color={semantic.dim}>{'─'.repeat(Math.min((stdout.columns ?? 80) - 2, 120))}</Text>
      </Box>

      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={palette.electricPurple}
        paddingX={1}
        marginX={1}
        flexGrow={1}
      >
        <Box gap={1}>
          <Text color={palette.electricPurple} bold>
            {icons.bolt} Agent Activity
          </Text>
          <Text color={semantic.muted}>
            ({running.length} running · {filteredEntries.length}
            {filteredEntries.length !== entries.length ? ` of ${entries.length}` : ''} log lines
            {' · '}verbose: {showVerboseLogs ? 'on' : 'off'})
          </Text>
        </Box>
        <Text color={semantic.dim} wrap="truncate-end">
          {truncate(logPath, 120)}
        </Text>

        <Box marginTop={1} flexDirection="column">
          {running.length === 0 ? (
            <Text color={semantic.dim}>agents standby</Text>
          ) : (
            running.slice(0, 4).map(run => (
              <ActiveRunRow
                key={run.id}
                run={{
                  agent: run.agent,
                  prKey: run.prKey,
                  streamingOutput: run.streamingOutput,
                }}
                width={panelContentWidth}
              />
            ))
          )}
        </Box>

        <Box marginTop={1} marginBottom={1}>
          <Text color={semantic.dim}>
            queue {actionQueue.filter(a => a.status === 'pending').length} pending · executed{' '}
            {actionHistory.length}
          </Text>
        </Box>

        {visibleEntries.length === 0 ? (
          <Box flexGrow={1} justifyContent="center" alignItems="center">
            <Text color={semantic.muted} italic>
              Waiting for agent activity...
            </Text>
          </Box>
        ) : (
          <Box flexDirection="column">
            {visibleEntries.map((entry, i) => (
              <LogRow
                key={`${entry.ts}:${entry.event}:${entry.runId ?? '-'}:${i}`}
                entry={entry}
                width={panelContentWidth}
              />
            ))}
          </Box>
        )}
      </Box>

      <ScrollIndicator
        current={scrollOffset}
        total={filteredEntries.length}
        visible={visibleRows}
      />
      <KeybindBar />
    </Box>
  );
}
