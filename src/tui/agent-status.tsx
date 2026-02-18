import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { JSX } from 'react';
import { useStore } from 'zustand';
import { vigilStore } from '../store/index.js';
import type { AgentRun } from '../types/index.js';
import { icons, palette, semantic } from './theme.js';

/** Truncate to last line of streaming output. */
function lastLine(output: string): string {
  const trimmed = output.trimEnd();
  if (!trimmed) return '';
  const lines = trimmed.split('\n');
  const last = lines[lines.length - 1];
  if (!last) return '';
  return last.length > 60 ? `${last.slice(0, 59)}\u2026` : last;
}

function AgentRow({ run }: { run: AgentRun }): JSX.Element {
  const line = lastLine(run.streamingOutput);
  return (
    <Box gap={1}>
      <Text color={palette.electricPurple} bold>
        {run.agent}
      </Text>
      <Text color={semantic.muted}>{icons.arrow}</Text>
      <Text color={semantic.branch}>{run.prKey}</Text>
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
      borderStyle="single"
      borderColor={palette.electricPurple}
      paddingX={1}
    >
      <Box gap={1}>
        <Text color={palette.electricPurple}>
          <Spinner type="dots" />
        </Text>
        <Text color={palette.electricPurple} bold>
          {running.length} agent{running.length === 1 ? '' : 's'} running
        </Text>
      </Box>
      {running.map(run => (
        <AgentRow key={run.id} run={run} />
      ))}
    </Box>
  );
}
