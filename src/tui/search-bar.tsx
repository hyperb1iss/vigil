import { Box, Text } from 'ink';
import type { JSX } from 'react';

import { icons, palette, semantic } from './theme.js';

interface SearchBarProps {
  query: string;
  matchCount: number;
  totalCount: number;
}

export function SearchBar({ query, matchCount, totalCount }: SearchBarProps): JSX.Element {
  return (
    <Box paddingX={1} gap={1}>
      <Text color={palette.electricPurple} bold>
        {icons.search}
      </Text>
      <Text color={palette.fg}>{query}</Text>
      <Text color={palette.neonCyan}>{'█'}</Text>
      <Box flexGrow={1} />
      <Text color={semantic.muted}>
        {matchCount}/{totalCount}
      </Text>
    </Box>
  );
}
