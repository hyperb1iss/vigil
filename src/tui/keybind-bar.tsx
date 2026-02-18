import { Box, Text, useStdout } from 'ink';
import type { JSX } from 'react';
import { useStore } from 'zustand';
import { vigilStore } from '../store/index.js';
import { palette, semantic } from './theme.js';

interface Keybind {
  key: string;
  label: string;
}

const DASHBOARD_BINDS: Keybind[] = [
  { key: 'hjkl', label: 'navigate' },
  { key: 'g/G', label: 'top/bottom' },
  { key: '/', label: 'search' },
  { key: '↵', label: 'detail' },
  { key: 'v', label: 'view' },
  { key: 'r', label: 'refresh' },
  { key: '?', label: 'help' },
  { key: 'q', label: 'quit' },
];

const DETAIL_BINDS: Keybind[] = [
  { key: 'Esc', label: 'back' },
  { key: 'j/k', label: 'scroll' },
  { key: 'g/G', label: 'top/bottom' },
  { key: 'a', label: 'actions' },
  { key: '?', label: 'help' },
  { key: 'q', label: 'quit' },
];

const ACTION_BINDS: Keybind[] = [
  { key: '1-9', label: 'approve' },
  { key: 'a', label: 'approve all' },
  { key: 'n', label: 'skip' },
  { key: 'Esc', label: 'back' },
];

// Purple → Cyan gradient across the SilkCircuit spectrum
const VIGIL_GRADIENT: Array<{ letter: string; color: string }> = [
  { letter: 'V', color: '#e135ff' },
  { letter: 'I', color: '#c666ff' },
  { letter: 'G', color: '#aa99ff' },
  { letter: 'I', color: '#80ccff' },
  { letter: 'L', color: '#80ffea' },
];

function VigilBrand(): JSX.Element {
  return (
    <Text>
      {VIGIL_GRADIENT.map((g, i) => (
        <Text key={i}>
          {i > 0 && <Text color={semantic.dim}>{' \u00B7 '}</Text>}
          <Text color={g.color} bold>
            {g.letter}
          </Text>
        </Text>
      ))}
    </Text>
  );
}

export function KeybindBar(): JSX.Element {
  const view = useStore(vigilStore, s => s.view);
  const { stdout } = useStdout();
  const termWidth = stdout.columns ?? 80;

  const binds =
    view === 'action' ? ACTION_BINDS : view === 'detail' ? DETAIL_BINDS : DASHBOARD_BINDS;

  return (
    <Box flexDirection="column">
      <Box paddingX={1}>
        <Text color={semantic.dim}>{'\u2500'.repeat(Math.min(termWidth - 2, 120))}</Text>
      </Box>
      <Box paddingX={1}>
        <Text wrap="truncate-end">
          {binds.map((bind, i) => (
            <Text key={bind.key}>
              {i > 0 && <Text color={semantic.dim}>{' \u00B7 '}</Text>}
              <Text color={palette.neonCyan} bold>
                {bind.key}
              </Text>
              <Text color={semantic.muted}> {bind.label}</Text>
            </Text>
          ))}
        </Text>
        <Box flexGrow={1} />
        <VigilBrand />
      </Box>
    </Box>
  );
}
