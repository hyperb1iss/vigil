import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { JSX } from 'react';
import { useStore } from 'zustand';
import { vigilStore } from '../store/index.js';
import type { AgentRun } from '../types/index.js';
import { icons, palette, semantic, truncate } from './theme.js';

function lastLine(output: string): string {
  const trimmed = output.trimEnd();
  if (!trimmed) return '';
  const lines = trimmed.split('\n');
  const last = lines[lines.length - 1];
  if (!last) return '';
  return last.length > 50 ? `${last.slice(0, 49)}\u2026` : last;
}

function AgentRow({ run }: { run: AgentRun }): JSX.Element {
  const line = lastLine(run.streamingOutput);
  return (
    <Box gap={1} paddingLeft={1}>
      <Text color={palette.neonCyan}>
        <Spinner type="dots" />
      </Text>
      <Text color={palette.electricPurple} bold>
        {run.agent}
      </Text>
      <Text color={semantic.dim}>{icons.arrow}</Text>
      <Text color={semantic.branch}>{truncate(run.prKey, 30)}</Text>
      {line && (
        <Text color={semantic.muted} dimColor>
          {line}
        </Text>
      )}
    </Box>
  );
}

export function AgentStatus(): JSX.Element | null {
  const activeAgents = useStore(vigilStore, s => s.activeAgents);

  const running = Array.from(activeAgents.values()).filter(a => a.status === 'running');

  if (running.length === 0) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={palette.electricPurple}
      paddingX={1}
      marginX={1}
    >
      <Box gap={1}>
        <Text color={palette.electricPurple} bold>
          {icons.bolt} Agents
        </Text>
        <Text color={semantic.muted}>({running.length} active)</Text>
      </Box>
      {running.map(run => (
        <AgentRow key={run.id} run={run} />
      ))}
    </Box>
  );
}
