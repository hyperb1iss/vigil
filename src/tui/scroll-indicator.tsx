import { Box, Text } from 'ink';
import type { JSX } from 'react';

import { palette, semantic } from './theme.js';

export function ScrollIndicator({
  current,
  total,
  visible,
}: {
  current: number;
  total: number;
  visible: number;
}): JSX.Element | null {
  if (total <= 0) return null;

  const effectiveVisible = Math.max(1, Math.min(visible, total));
  const isScrollable = total > effectiveVisible;

  const canUp = current > 0;
  const canDown = current + effectiveVisible < total;

  const trackWidth = 12;
  const thumbSize = isScrollable
    ? Math.max(1, Math.round((effectiveVisible / total) * trackWidth))
    : trackWidth;
  const thumbPos = isScrollable ? Math.round((current / total) * (trackWidth - thumbSize)) : 0;

  const track: string[] = [];
  for (let i = 0; i < trackWidth; i++) {
    if (i >= thumbPos && i < thumbPos + thumbSize) {
      track.push('\u2588'); // █ thumb
    } else {
      track.push('\u2591'); // ░ track
    }
  }

  return (
    <Box justifyContent="center" gap={2}>
      {canUp ? <Text color={semantic.dim}>{'\u25B2'}</Text> : <Text color={semantic.dim}> </Text>}
      <Text>
        <Text color={isScrollable ? palette.electricPurple : semantic.dim}>{track.join('')}</Text>
      </Text>
      <Text color={semantic.muted}>
        {`${Math.min(current + 1, total)}\u2013${Math.min(current + effectiveVisible, total)}`}{' '}
        <Text color={semantic.dim}>of</Text> {total}
      </Text>
      {canDown ? <Text color={semantic.dim}>{'\u25BC'}</Text> : <Text color={semantic.dim}> </Text>}
    </Box>
  );
}
