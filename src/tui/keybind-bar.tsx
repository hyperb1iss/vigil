import { Box, Text, useStdout } from 'ink';
import type { JSX } from 'react';
import { useStore } from 'zustand';

import { vigilStore } from '../store/index.js';
import { palette, semantic } from './theme.js';

interface Keybind {
  key: string;
  label: string;
  abbr?: string;
}

const DASHBOARD_BINDS: Keybind[] = [
  { key: '↑↓←→', label: 'navigate', abbr: 'nav' },
  { key: 'Tab', label: 'next' },
  { key: '↵', label: 'detail' },
  { key: '/', label: 'search' },
  { key: 'x', label: 'activity', abbr: 'act' },
  { key: 's', label: 'sort' },
  { key: 'm', label: 'feed' },
  { key: 'v', label: 'view' },
  { key: 'o', label: 'open' },
  { key: 'r', label: 'refresh', abbr: 'ref' },
  { key: '?', label: 'help' },
  { key: 'q', label: 'quit' },
];

const DETAIL_BINDS: Keybind[] = [
  { key: 'Esc', label: 'back' },
  { key: 'Tab', label: 'pane' },
  { key: '↑↓', label: 'move/scroll', abbr: 'move' },
  { key: 'h/l', label: 'review' },
  { key: '↵', label: 'inspect', abbr: 'insp' },
  { key: 'a', label: 'actions' },
  { key: 'x', label: 'activity', abbr: 'act' },
  { key: 'o', label: 'open' },
  { key: '?', label: 'help' },
  { key: 'q', label: 'quit' },
];

const ACTION_BINDS: Keybind[] = [
  { key: '1-9', label: 'approve' },
  { key: 'a', label: 'approve all' },
  { key: 'n', label: 'skip' },
  { key: 'x', label: 'activity', abbr: 'act' },
  { key: 'Esc', label: 'back' },
];

const ACTIVITY_BINDS: Keybind[] = [
  { key: 'Esc', label: 'back' },
  { key: '↑↓', label: 'scroll' },
  { key: 'Tab', label: 'page' },
  { key: 'g/G', label: 'top/bot' },
  { key: 'f', label: 'verbose' },
  { key: 'x', label: 'dashboard', abbr: 'dash' },
  { key: 'r', label: 'refresh', abbr: 'ref' },
  { key: '?', label: 'help' },
  { key: 'q', label: 'quit' },
];

// Purple → Cyan gradient across the SilkCircuit spectrum
const VIGIL_GRADIENT: Array<{ letter: string; color: string }> = [
  { letter: 'V', color: '#e135ff' },
  { letter: 'I', color: '#c666ff' },
  { letter: 'G', color: '#aa99ff' },
  { letter: 'I', color: '#80ccff' },
  { letter: 'L', color: '#80ffea' },
];
const BIND_DIVIDER = ' · ';
const BRAND_WIDTH = 17; // "V · I · G · I · L"
const BRAND_GAP = 2;
const MIN_BIND_WIDTH = 20;

interface RenderBind {
  key: string;
  label: string;
}

function renderLabel(bind: Keybind, compact: boolean): string {
  return compact && bind.abbr ? bind.abbr : bind.label;
}

function totalWidth(rendered: RenderBind[], hiddenCount: number): number {
  const parts = rendered.map(bind => `${bind.key} ${bind.label}`);
  if (hiddenCount > 0) {
    parts.push(`+${hiddenCount}`);
  }
  if (parts.length === 0) return 0;
  return (
    parts.reduce((sum, part) => sum + part.length, 0) +
    BIND_DIVIDER.length * Math.max(0, parts.length - 1)
  );
}

function chooseVisible(
  binds: Keybind[],
  maxWidth: number,
  compact: boolean
): { visible: RenderBind[]; hiddenCount: number } {
  const rendered = binds.map(bind => ({
    key: bind.key,
    label: renderLabel(bind, compact),
  }));

  for (let count = rendered.length; count >= 0; count--) {
    const visible = rendered.slice(0, count);
    const hiddenCount = rendered.length - count;
    if (totalWidth(visible, hiddenCount) <= maxWidth) {
      return { visible, hiddenCount };
    }
  }

  return { visible: [], hiddenCount: rendered.length };
}

function fitBinds(
  binds: Keybind[],
  maxWidth: number
): { visible: RenderBind[]; hiddenCount: number } {
  const expanded = chooseVisible(binds, maxWidth, false);
  if (expanded.hiddenCount === 0) return expanded;

  const compact = chooseVisible(binds, maxWidth, true);
  if (compact.visible.length > expanded.visible.length) return compact;
  if (compact.hiddenCount < expanded.hiddenCount) return compact;
  return expanded;
}

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
    view === 'action'
      ? ACTION_BINDS
      : view === 'detail'
        ? DETAIL_BINDS
        : view === 'activity'
          ? ACTIVITY_BINDS
          : DASHBOARD_BINDS;

  const contentWidth = Math.max(0, termWidth - 2);
  let showBrand = contentWidth >= MIN_BIND_WIDTH + BRAND_WIDTH + BRAND_GAP;
  let maxBindWidth = contentWidth - (showBrand ? BRAND_WIDTH + BRAND_GAP : 0);
  if (maxBindWidth < MIN_BIND_WIDTH) {
    showBrand = false;
    maxBindWidth = contentWidth;
  }

  const { visible, hiddenCount } = fitBinds(binds, Math.max(0, maxBindWidth));

  return (
    <Box flexDirection="column">
      <Box paddingX={1}>
        <Text color={semantic.dim}>{'\u2500'.repeat(Math.min(termWidth - 2, 120))}</Text>
      </Box>
      <Box paddingX={1}>
        <Text wrap="truncate-end">
          {visible.map((bind, i) => (
            <Text key={bind.key}>
              {i > 0 && <Text color={semantic.dim}>{' \u00B7 '}</Text>}
              <Text color={palette.neonCyan} bold>
                {bind.key}
              </Text>
              <Text color={semantic.muted}> {bind.label}</Text>
            </Text>
          ))}
          {hiddenCount > 0 && (
            <Text>
              {visible.length > 0 && <Text color={semantic.dim}>{' \u00B7 '}</Text>}
              <Text color={semantic.dim}>+{hiddenCount}</Text>
            </Text>
          )}
        </Text>
        <Box flexGrow={1} />
        {showBrand && <VigilBrand />}
      </Box>
    </Box>
  );
}
