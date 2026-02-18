import { Box, Text } from 'ink';
import type { JSX } from 'react';
import { useStore } from 'zustand';
import { vigilStore } from '../store/index.js';
import { palette, semantic } from './theme.js';

interface Keybind {
  key: string;
  label: string;
}

const DASHBOARD_BINDS: Keybind[] = [
  { key: 'j/k', label: 'navigate' },
  { key: '\u21B5', label: 'detail' },
  { key: 'v', label: 'view' },
  { key: 'y', label: 'mode' },
  { key: 'r', label: 'refresh' },
  { key: 'q', label: 'quit' },
];

const DETAIL_BINDS: Keybind[] = [
  { key: 'Esc', label: 'back' },
  { key: 'a', label: 'actions' },
  { key: 'j/k', label: 'scroll' },
  { key: 'q', label: 'quit' },
];

const ACTION_BINDS: Keybind[] = [
  { key: '1-9', label: 'approve' },
  { key: 'a', label: 'approve all' },
  { key: 'n', label: 'skip' },
  { key: 'Esc', label: 'back' },
];

function KeybindGroup({ binds }: { binds: Keybind[] }): JSX.Element {
  return (
    <Box gap={2} paddingX={1}>
      {binds.map(bind => (
        <Box key={bind.key} gap={1}>
          <Text color={palette.neonCyan} bold>
            {bind.key}
          </Text>
          <Text color={semantic.muted}>{bind.label}</Text>
        </Box>
      ))}
    </Box>
  );
}

export function KeybindBar(): JSX.Element {
  const view = useStore(vigilStore, s => s.view);

  const binds =
    view === 'action' ? ACTION_BINDS : view === 'detail' ? DETAIL_BINDS : DASHBOARD_BINDS;

  return <KeybindGroup binds={binds} />;
}
