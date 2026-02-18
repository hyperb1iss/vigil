import { Box, Text, useInput } from 'ink';
import type { JSX } from 'react';
import { useStore } from 'zustand';
import { vigilStore } from '../store/index.js';
import type { ProposedAction } from '../types/index.js';
import { icons, palette, semantic } from './theme.js';

// ─── Action Row ───────────────────────────────────────────────────────

function ActionRow({
  action,
  index,
  isSelected,
}: {
  action: ProposedAction;
  index: number;
  isSelected: boolean;
}): JSX.Element {
  const statusColor =
    action.status === 'approved'
      ? semantic.success
      : action.status === 'rejected'
        ? semantic.error
        : action.status === 'executed'
          ? semantic.muted
          : semantic.warning;

  const statusSymbol =
    action.status === 'approved'
      ? '\u2713'
      : action.status === 'rejected'
        ? '\u2717'
        : action.status === 'executed'
          ? '\u2022'
          : '\u25cb';

  return (
    <Box
      gap={1}
      paddingLeft={1}
      {...(isSelected
        ? { borderStyle: 'single' as const, borderColor: palette.electricPurple }
        : {})}
    >
      <Text color={palette.neonCyan} bold>
        {index + 1}
      </Text>
      <Text color={statusColor}>{statusSymbol}</Text>
      <Text color={palette.coral} bold>
        {action.type}
      </Text>
      <Text color={semantic.branch}>{action.prKey}</Text>
      <Text color={semantic.muted} dimColor>
        {action.description.length > 50
          ? `${action.description.slice(0, 49)}\u2026`
          : action.description}
      </Text>
    </Box>
  );
}

// ─── HITL Action Panel ────────────────────────────────────────────────

function HitlPanel(): JSX.Element {
  const actionQueue = useStore(vigilStore, s => s.actionQueue);
  const selectedAction = useStore(vigilStore, s => s.selectedAction);
  const approveAction = useStore(vigilStore, s => s.approveAction);
  const rejectAction = useStore(vigilStore, s => s.rejectAction);

  const pending = actionQueue.filter(a => a.status === 'pending');

  useInput(input => {
    // Number keys 1-9 to quick-approve
    const num = Number.parseInt(input, 10);
    if (num >= 1 && num <= 9) {
      const action = pending[num - 1];
      if (action) {
        approveAction(action.id);
      }
      return;
    }

    // Approve all pending
    if (input === 'a') {
      for (const action of pending) {
        approveAction(action.id);
      }
      return;
    }

    // Reject selected
    if (input === 'n') {
      const action = pending[selectedAction];
      if (action) {
        rejectAction(action.id);
      }
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={palette.electricPurple}
      paddingX={1}
    >
      <Box gap={1}>
        <Text color={palette.electricPurple} bold>
          Proposed Actions
        </Text>
        <Text color={semantic.muted}>({pending.length} pending)</Text>
      </Box>

      {pending.length === 0 ? (
        <Text color={semantic.muted} italic>
          No pending actions
        </Text>
      ) : (
        <Box flexDirection="column">
          {pending.map((action, i) => (
            <ActionRow
              key={action.id}
              action={action}
              index={i}
              isSelected={i === selectedAction}
            />
          ))}
        </Box>
      )}

      <Box gap={2} paddingTop={1}>
        <Text color={semantic.muted}>
          <Text color={palette.neonCyan} bold>
            1-9
          </Text>{' '}
          approve{' '}
          <Text color={palette.neonCyan} bold>
            a
          </Text>{' '}
          approve all{' '}
          <Text color={palette.neonCyan} bold>
            n
          </Text>{' '}
          skip{' '}
          <Text color={palette.neonCyan} bold>
            Esc
          </Text>{' '}
          back
        </Text>
      </Box>
    </Box>
  );
}

// ─── YOLO Activity Log ────────────────────────────────────────────────

function YoloLog(): JSX.Element {
  const actionHistory = useStore(vigilStore, s => s.actionHistory);
  const recent = actionHistory.slice(-10);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={palette.neonCyan} paddingX={1}>
      <Box gap={1}>
        <Text color={palette.neonCyan} bold>
          Activity Log
        </Text>
        <Text color={semantic.muted}>
          (YOLO mode {icons.dot} {actionHistory.length} total)
        </Text>
      </Box>

      {recent.length === 0 ? (
        <Text color={semantic.muted} italic>
          No actions yet
        </Text>
      ) : (
        <Box flexDirection="column">
          {recent.map(action => (
            <Box key={action.id} gap={1}>
              <Text color={semantic.timestamp} dimColor>
                {new Date(action.executedAt).toLocaleTimeString()}
              </Text>
              <Text color={action.status === 'executed' ? semantic.success : semantic.error}>
                {action.status === 'executed' ? '\u2713' : '\u2717'}
              </Text>
              <Text color={palette.coral}>{action.type}</Text>
              <Text color={semantic.branch}>{action.prKey}</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

// ─── Main Component ───────────────────────────────────────────────────

export function ActionPanel(): JSX.Element {
  const mode = useStore(vigilStore, s => s.mode);
  return mode === 'hitl' ? <HitlPanel /> : <YoloLog />;
}
