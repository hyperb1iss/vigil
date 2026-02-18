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
  if (total <= visible) return null;

  const canUp = current > 0;
  const canDown = current + visible < total;

  // Build a mini scrollbar track
  const trackWidth = 12;
  const thumbSize = Math.max(1, Math.round((visible / total) * trackWidth));
  const thumbPos = Math.round((current / total) * (trackWidth - thumbSize));

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
      {canUp && <Text color={semantic.dim}>{'\u25B2'}</Text>}
      <Text>
        <Text color={palette.electricPurple}>{track.join('')}</Text>
      </Text>
      <Text color={semantic.muted}>
        {`${Math.min(current + 1, total)}\u2013${Math.min(current + visible, total)}`}{' '}
        <Text color={semantic.dim}>of</Text> {total}
      </Text>
      {canDown && <Text color={semantic.dim}>{'\u25BC'}</Text>}
    </Box>
  );
}
