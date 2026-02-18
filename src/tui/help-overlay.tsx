import { Box, Text, useStdout } from 'ink';
import type { JSX } from 'react';
import { palette, semantic } from './theme.js';

// ─── Keybinding Data ──────────────────────────────────────────────

interface KeyGroup {
  title: string;
  color: string;
  binds: Array<{ key: string; desc: string }>;
}

const HELP_GROUPS: KeyGroup[] = [
  {
    title: 'Navigation',
    color: palette.neonCyan,
    binds: [
      { key: '↑ / ↓', desc: 'Move up / down' },
      { key: '← / →', desc: 'Move left / right (cards)' },
      { key: 'Tab', desc: 'Next PR' },
      { key: 'Shift+Tab', desc: 'Previous PR' },
      { key: 'Enter', desc: 'Open detail view' },
      { key: 'Esc', desc: 'Go back' },
      { key: 'g / G', desc: 'Jump to top / bottom' },
    ],
  },
  {
    title: 'Search & Filter',
    color: palette.electricPurple,
    binds: [
      { key: '/', desc: 'Start search (fuzzy)' },
      { key: 'Esc', desc: 'Cancel search' },
      { key: 'Backspace', desc: 'Delete character' },
    ],
  },
  {
    title: 'Views & Modes',
    color: palette.electricYellow,
    binds: [
      { key: 'v', desc: 'Toggle cards / list' },
      { key: 'y', desc: 'Toggle HITL / YOLO mode' },
      { key: 'r', desc: 'Force poll refresh' },
    ],
  },
  {
    title: 'Detail View',
    color: palette.coral,
    binds: [
      { key: '↑ / ↓', desc: 'Scroll content' },
      { key: 'Tab', desc: 'Page down' },
      { key: 'Shift+Tab', desc: 'Page up' },
      { key: 'g / G', desc: 'Top / bottom' },
      { key: 'a', desc: 'Open action panel' },
    ],
  },
  {
    title: 'Actions',
    color: palette.successGreen,
    binds: [
      { key: '1-9', desc: 'Approve specific action' },
      { key: 'a', desc: 'Approve all' },
      { key: 'n', desc: 'Skip action' },
    ],
  },
  {
    title: 'Vim Motions',
    color: semantic.dim,
    binds: [{ key: 'h j k l', desc: 'Navigate (same as arrows)' }],
  },
];

// ─── Component ────────────────────────────────────────────────────

export function HelpOverlay(): JSX.Element {
  const { stdout } = useStdout();
  const width = stdout.columns ?? 80;
  const contentWidth = Math.min(width - 4, 72);
  const keyColWidth = 14;

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {/* Header */}
      <Box justifyContent="center" paddingY={1}>
        <Text color={palette.electricPurple} bold>
          {'━━━ VIGIL KEYBINDINGS ━━━'}
        </Text>
      </Box>

      {/* Groups */}
      {HELP_GROUPS.map(group => (
        <Box key={group.title} flexDirection="column" paddingBottom={1}>
          <Box paddingX={1}>
            <Text color={group.color} bold>
              {'▸ '}
              {group.title}
            </Text>
          </Box>
          {group.binds.map(bind => (
            <Box key={bind.key} paddingX={3} width={contentWidth}>
              <Box width={keyColWidth}>
                <Text color={palette.neonCyan} bold>
                  {bind.key}
                </Text>
              </Box>
              <Text color={semantic.muted}>{bind.desc}</Text>
            </Box>
          ))}
        </Box>
      ))}

      <Box flexGrow={1} />

      {/* Footer */}
      <Box justifyContent="center" paddingY={1}>
        <Text color={semantic.dim}>
          Press <Text color={palette.neonCyan}>?</Text> or <Text color={palette.neonCyan}>Esc</Text>{' '}
          to close
        </Text>
      </Box>
    </Box>
  );
}
