import { Box, Text } from 'ink';
import type { JSX } from 'react';
import { useStore } from 'zustand';

import { vigilStore } from '../store/index.js';
import { icons, palette, semantic, truncate } from './theme.js';

function lastLine(output: string): string {
  const trimmed = output.trimEnd();
  if (!trimmed) return '';
  const lines = trimmed.split('\n');
  const last = lines[lines.length - 1];
  if (!last) return '';
  return last.length > 50 ? `${last.slice(0, 49)}\u2026` : last;
}

export function AgentStatus(): JSX.Element {
  const activeAgents = useStore(vigilStore, s => s.activeAgents);
  const mode = useStore(vigilStore, s => s.mode);

  const running = Array.from(activeAgents.values()).filter(a => a.status === 'running');

  if (running.length === 0) {
    return (
      <Box paddingX={1}>
        <Text color={semantic.dim}>
          {icons.bolt} agents {mode === 'yolo' ? 'auto' : 'standby'}
        </Text>
      </Box>
    );
  }

  const primary = running[0];
  if (!primary) {
    return (
      <Box paddingX={1}>
        <Text color={semantic.dim}>
          {icons.bolt} agents {mode === 'yolo' ? 'auto' : 'standby'}
        </Text>
      </Box>
    );
  }

  const extraCount = running.length - 1;

  return (
    <Box paddingX={1}>
      <Text wrap="truncate-end">
        <Text color={palette.electricPurple} bold>
          {icons.bolt} Agents
        </Text>
        <Text color={semantic.muted}> ({running.length} active)</Text>
        <Text color={semantic.dim}>{' · '}</Text>
        <Text color={palette.electricPurple} bold>
          {primary.agent}
        </Text>
        <Text color={semantic.dim}>{` ${icons.arrow} `}</Text>
        <Text color={semantic.branch}>{truncate(primary.prKey, 30)}</Text>
        {lastLine(primary.streamingOutput) && (
          <>
            <Text color={semantic.dim}>{' · '}</Text>
            <Text color={semantic.muted} dimColor>
              {lastLine(primary.streamingOutput)}
            </Text>
          </>
        )}
        {extraCount > 0 && (
          <>
            <Text color={semantic.dim}>{' · '}</Text>
            <Text color={semantic.dim}>+{extraCount} more</Text>
          </>
        )}
      </Text>
    </Box>
  );
}
