import { Box, Text, useInput } from 'ink';
import type { JSX } from 'react';
import { useStore } from 'zustand';
import { vigilStore } from '../store/index.js';
import type { ProposedAction } from '../types/index.js';
import { KeybindBar } from './keybind-bar.js';
import { icons, palette, semantic, truncate } from './theme.js';

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
      ? icons.check
      : action.status === 'rejected'
        ? icons.cross
        : action.status === 'executed'
          ? icons.dot
          : '\u25CB';

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
        {truncate(action.description, 50)}
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
    const num = Number.parseInt(input, 10);
    if (num >= 1 && num <= 9) {
      const action = pending[num - 1];
      if (action) {
        approveAction(action.id);
      }
      return;
    }

    if (input === 'a') {
      for (const action of pending) {
        approveAction(action.id);
      }
      return;
    }

    if (input === 'n') {
      const action = pending[selectedAction];
      if (action) {
        rejectAction(action.id);
      }
    }
  });

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={palette.electricPurple}
        paddingX={1}
        marginX={1}
      >
        <Box gap={1}>
          <Text color={palette.electricPurple} bold>
            {icons.bolt} Proposed Actions
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
      </Box>

      <Box flexGrow={1} />
      <KeybindBar />
    </Box>
  );
}

// ─── YOLO Activity Log ────────────────────────────────────────────────

function YoloLog(): JSX.Element {
  const actionHistory = useStore(vigilStore, s => s.actionHistory);
  const recent = actionHistory.slice(-10);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={palette.neonCyan}
        paddingX={1}
        marginX={1}
      >
        <Box gap={1}>
          <Text color={palette.neonCyan} bold>
            {icons.bolt} Activity Log
          </Text>
          <Text color={semantic.muted}>
            (YOLO {icons.middleDot} {actionHistory.length} total)
          </Text>
        </Box>

        {recent.length === 0 ? (
          <Text color={semantic.muted} italic>
            No actions yet
          </Text>
        ) : (
          <Box flexDirection="column">
            {recent.map(action => (
              <Box key={action.id} gap={1} paddingLeft={1}>
                <Text color={semantic.timestamp} dimColor>
                  {new Date(action.executedAt).toLocaleTimeString()}
                </Text>
                <Text color={action.status === 'executed' ? semantic.success : semantic.error}>
                  {action.status === 'executed' ? icons.check : icons.cross}
                </Text>
                <Text color={palette.coral}>{action.type}</Text>
                <Text color={semantic.branch}>{action.prKey}</Text>
              </Box>
            ))}
          </Box>
        )}
      </Box>

      <Box flexGrow={1} />
      <KeybindBar />
    </Box>
  );
}

// ─── Main Component ───────────────────────────────────────────────────

export function ActionPanel(): JSX.Element {
  const mode = useStore(vigilStore, s => s.mode);
  return mode === 'hitl' ? <HitlPanel /> : <YoloLog />;
}
