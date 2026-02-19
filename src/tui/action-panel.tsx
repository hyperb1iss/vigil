import { Box, Text, useInput, useStdout } from 'ink';
import type { JSX } from 'react';
import { useStore } from 'zustand';

import { vigilStore } from '../store/index.js';
import type { CompletedAction, ProposedAction } from '../types/index.js';
import { KeybindBar } from './keybind-bar.js';
import { ScrollIndicator } from './scroll-indicator.js';
import { icons, palette, semantic, truncate } from './theme.js';

// ─── Constants ───────────────────────────────────────────────────────

/** Lines reserved for chrome: card border (2) + header (1) + keybind bar (2) + scroll indicator (1) */
const CHROME_LINES = 6;
/** Each action row is 2 lines (main + description) + 1 blank */
const ACTION_ROW_HEIGHT = 3;

// ─── Action Row ──────────────────────────────────────────────────────

function ActionRow({
  action,
  index,
  isSelected,
}: {
  action: ProposedAction;
  index: number;
  isSelected: boolean;
}): JSX.Element {
  const statusSymbol =
    action.status === 'approved'
      ? icons.check
      : action.status === 'rejected'
        ? icons.cross
        : action.status === 'executed'
          ? icons.dot
          : '\u25CB';

  const statusColor =
    action.status === 'approved'
      ? semantic.success
      : action.status === 'rejected'
        ? semantic.error
        : action.status === 'executed'
          ? semantic.muted
          : semantic.warning;

  return (
    <Box
      flexDirection="column"
      paddingLeft={isSelected ? 0 : 1}
      {...(isSelected
        ? {
            borderStyle: 'single' as const,
            borderColor: palette.electricPurple,
            borderLeft: true,
            borderRight: false,
            borderTop: false,
            borderBottom: false,
          }
        : {})}
    >
      <Box gap={1}>
        <Text color={palette.neonCyan} bold>
          {index + 1}
        </Text>
        <Text color={statusColor}>{statusSymbol}</Text>
        <Text color={palette.coral} bold>
          {action.type}
        </Text>
        <Text color={semantic.branch}>{action.prKey}</Text>
      </Box>
      <Text color={semantic.dim} wrap="truncate-end">
        {'    "'}
        {truncate(action.description, 60)}
        {'"'}
      </Text>
    </Box>
  );
}

// ─── YOLO Log Row ────────────────────────────────────────────────────

function YoloRow({ action }: { action: CompletedAction }): JSX.Element {
  const isSuccess = action.status === 'executed';
  return (
    <Box gap={1} paddingLeft={1}>
      <Text color={semantic.timestamp} dimColor>
        {new Date(action.executedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </Text>
      <Text color={isSuccess ? semantic.success : semantic.error}>
        {isSuccess ? icons.check : icons.cross}
      </Text>
      <Text color={palette.coral}>{action.type}</Text>
      <Text color={semantic.branch}>{action.prKey}</Text>
      {!isSuccess && action.output && (
        <Text color={semantic.error} dimColor>
          ({truncate(action.output, 30)})
        </Text>
      )}
    </Box>
  );
}

// ─── HITL Action Panel ───────────────────────────────────────────────

function HitlPanel(): JSX.Element {
  const actionQueue = useStore(vigilStore, s => s.actionQueue);
  const selectedAction = useStore(vigilStore, s => s.selectedAction);
  const approveAction = useStore(vigilStore, s => s.approveAction);
  const rejectAction = useStore(vigilStore, s => s.rejectAction);
  const scrollOffset = useStore(vigilStore, s => s.scrollOffsets.action);
  const scrollView = useStore(vigilStore, s => s.scrollView);

  const { stdout } = useStdout();
  const termRows = stdout.rows ?? 24;

  const pending = actionQueue.filter(a => a.status === 'pending');

  useInput((input, key) => {
    // Number keys: approve specific action
    const num = Number.parseInt(input, 10);
    if (num >= 1 && num <= 9) {
      const action = pending[num - 1];
      if (action) {
        approveAction(action.id);
      }
      return;
    }

    // Approve all
    if (input === 'a') {
      for (const action of pending) {
        approveAction(action.id);
      }
      return;
    }

    // Skip (reject) selected
    if (input === 'n') {
      const action = pending[selectedAction];
      if (action) {
        rejectAction(action.id);
      }
      return;
    }

    // j/k navigation
    if (input === 'j' || key.downArrow) {
      const next = Math.min(selectedAction + 1, Math.max(0, pending.length - 1));
      vigilStore.setState({ selectedAction: next });

      // Auto-scroll if selected goes below visible
      const availableHeight = Math.max(1, termRows - CHROME_LINES);
      const visibleActions = Math.floor(availableHeight / ACTION_ROW_HEIGHT);
      if (next >= scrollOffset + visibleActions) {
        scrollView('action', 1, pending.length);
      }
      return;
    }

    if (input === 'k' || key.upArrow) {
      const next = Math.max(0, selectedAction - 1);
      vigilStore.setState({ selectedAction: next });

      // Auto-scroll if selected goes above visible
      if (next < scrollOffset) {
        scrollView('action', -1, pending.length);
      }
    }
  });

  // Windowed rendering
  const availableHeight = Math.max(1, termRows - CHROME_LINES);
  const visibleActions = Math.floor(availableHeight / ACTION_ROW_HEIGHT);
  const visible = pending.slice(scrollOffset, scrollOffset + visibleActions);

  return (
    <Box flexDirection="column" flexGrow={1}>
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
            {icons.bolt} Proposed Actions
          </Text>
          <Text color={semantic.muted}>({pending.length} pending)</Text>
        </Box>

        {pending.length === 0 ? (
          <Box flexGrow={1} alignItems="center" justifyContent="center">
            <Text color={semantic.muted} italic>
              No pending actions
            </Text>
          </Box>
        ) : (
          <Box flexDirection="column" paddingY={1}>
            {visible.map((action, i) => {
              const globalIdx = scrollOffset + i;
              return (
                <ActionRow
                  key={action.id}
                  action={action}
                  index={globalIdx}
                  isSelected={globalIdx === selectedAction}
                />
              );
            })}
          </Box>
        )}
      </Box>

      {/* Scroll indicator */}
      <ScrollIndicator current={scrollOffset} total={pending.length} visible={visibleActions} />

      <KeybindBar />
    </Box>
  );
}

// ─── YOLO Activity Log ───────────────────────────────────────────────

function YoloLog(): JSX.Element {
  const actionHistory = useStore(vigilStore, s => s.actionHistory);
  const scrollOffset = useStore(vigilStore, s => s.scrollOffsets.action);
  const scrollView = useStore(vigilStore, s => s.scrollView);

  const { stdout } = useStdout();
  const termRows = stdout.rows ?? 24;

  // Reverse chronological
  const sorted = [...actionHistory].reverse();

  useInput((input, key) => {
    if (input === 'j' || key.downArrow) {
      scrollView('action', 1, sorted.length);
      return;
    }
    if (input === 'k' || key.upArrow) {
      scrollView('action', -1, sorted.length);
    }
  });

  const availableHeight = Math.max(1, termRows - CHROME_LINES);
  const visible = sorted.slice(scrollOffset, scrollOffset + availableHeight);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={palette.neonCyan}
        paddingX={1}
        marginX={1}
        flexGrow={1}
      >
        <Box gap={1}>
          <Text color={palette.neonCyan} bold>
            {icons.bolt} Activity Log
          </Text>
          <Text color={semantic.muted}>
            (YOLO {icons.middleDot} {actionHistory.length} total)
          </Text>
        </Box>

        {sorted.length === 0 ? (
          <Box flexGrow={1} alignItems="center" justifyContent="center">
            <Text color={semantic.muted} italic>
              No actions yet
            </Text>
          </Box>
        ) : (
          <Box flexDirection="column" paddingY={1}>
            {visible.map(action => (
              <YoloRow key={action.id} action={action} />
            ))}
          </Box>
        )}
      </Box>

      {/* Scroll indicator */}
      <ScrollIndicator current={scrollOffset} total={sorted.length} visible={availableHeight} />

      <KeybindBar />
    </Box>
  );
}

// ─── Main Component ──────────────────────────────────────────────────

export function ActionPanel(): JSX.Element {
  const mode = useStore(vigilStore, s => s.mode);
  return mode === 'hitl' ? <HitlPanel /> : <YoloLog />;
}
