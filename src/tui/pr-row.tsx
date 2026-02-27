import { Box, Text } from 'ink';
import type { JSX } from 'react';

import type {
  CheckConclusion,
  PrState,
  PullRequest,
  RadarPr,
  ReviewDecision,
} from '../types/index.js';
import {
  checkIndicators,
  palette,
  prStateColors,
  semantic,
  stateIndicators,
  timeAgo,
  truncate,
} from './theme.js';

interface PrRowProps {
  pr: PullRequest;
  state: PrState;
  isFocused: boolean;
  source?: 'mine' | 'incoming' | 'merged' | undefined;
  radar?: RadarPr | undefined;
}

// ─── Helpers ──────────────────────────────────────────────────────────

const STATE_PRIORITY: PrState[] = ['hot', 'waiting', 'ready', 'blocked', 'dormant'];

export function statePriority(state: PrState): number {
  const idx = STATE_PRIORITY.indexOf(state);
  return idx === -1 ? STATE_PRIORITY.length : idx;
}

function ciSummary(checks: PullRequest['checks']): {
  symbol: string;
  color: string;
  label: string;
} {
  if (checks.length === 0) {
    return {
      symbol: checkIndicators.skipped.symbol,
      color: checkIndicators.skipped.color,
      label: '',
    };
  }

  let pass = 0;
  let fail = 0;
  let pending = 0;

  for (const c of checks) {
    if (c.status !== 'COMPLETED') {
      pending++;
    } else {
      const conclusion: CheckConclusion = c.conclusion;
      if (conclusion === 'SUCCESS' || conclusion === 'NEUTRAL' || conclusion === 'SKIPPED') {
        pass++;
      } else {
        fail++;
      }
    }
  }

  if (fail > 0) {
    return {
      symbol: checkIndicators.failing.symbol,
      color: checkIndicators.failing.color,
      label: `${fail}/${checks.length}`,
    };
  }
  if (pending > 0) {
    return {
      symbol: checkIndicators.pending.symbol,
      color: checkIndicators.pending.color,
      label: `${pending}/${checks.length}`,
    };
  }
  return {
    symbol: checkIndicators.passing.symbol,
    color: checkIndicators.passing.color,
    label: `${pass}/${checks.length}`,
  };
}

function reviewIndicator(decision: ReviewDecision): { symbol: string; color: string } {
  switch (decision) {
    case 'APPROVED':
      return { symbol: checkIndicators.passing.symbol, color: semantic.success };
    case 'CHANGES_REQUESTED':
      return { symbol: checkIndicators.failing.symbol, color: semantic.error };
    case 'REVIEW_REQUIRED':
      return { symbol: checkIndicators.pending.symbol, color: semantic.warning };
    default:
      return { symbol: checkIndicators.skipped.symbol, color: semantic.muted };
  }
}

// ─── Compact CI Bar ──────────────────────────────────────────────────

function MiniCiBar({ checks }: { checks: PullRequest['checks'] }): JSX.Element {
  if (checks.length === 0) {
    return <Text color={semantic.dim}>{'\u2500'}</Text>;
  }

  const passed = checks.filter(
    c =>
      c.status === 'COMPLETED' &&
      (c.conclusion === 'SUCCESS' || c.conclusion === 'NEUTRAL' || c.conclusion === 'SKIPPED')
  ).length;
  const failed = checks.filter(
    c =>
      c.status === 'COMPLETED' &&
      c.conclusion !== 'SUCCESS' &&
      c.conclusion !== 'NEUTRAL' &&
      c.conclusion !== 'SKIPPED' &&
      c.conclusion !== null
  ).length;

  // Render as tiny block bar (max 10 blocks)
  const total = checks.length;
  const barLen = Math.min(total, 10);
  const scale = total > 10 ? barLen / total : 1;

  const passBlocks = Math.round(passed * scale);
  const failBlocks = Math.round(failed * scale);
  const pendBlocks = barLen - passBlocks - failBlocks;

  return (
    <Box>
      {passBlocks > 0 && <Text color={semantic.success}>{'\u2588'.repeat(passBlocks)}</Text>}
      {failBlocks > 0 && <Text color={semantic.error}>{'\u2588'.repeat(failBlocks)}</Text>}
      {pendBlocks > 0 && <Text color={semantic.warning}>{'\u2588'.repeat(pendBlocks)}</Text>}
    </Box>
  );
}

// ─── Component ────────────────────────────────────────────────────────

interface SourceBadge {
  text: string;
  color: string;
}

function getSourceBadge(
  source: PrRowProps['source'],
  radar: PrRowProps['radar']
): SourceBadge | null {
  if (source === 'mine') return { text: 'MINE', color: palette.neonCyan };
  if (source === 'merged') return { text: 'MERGED', color: semantic.success };
  if (source === 'incoming') {
    if (radar?.topTier === 'direct') return { text: 'DIRECT', color: semantic.error };
    if (radar?.topTier === 'domain') return { text: 'DOMAIN', color: semantic.warning };
    return { text: 'WATCH', color: palette.electricPurple };
  }
  return null;
}

function BranchMeta({ pr }: { pr: PullRequest }): JSX.Element | null {
  if (pr.headRefName.length === 0) return null;
  return (
    <Text>
      <Text color={palette.dimmed}> </Text>
      <Text color={palette.neonCyan} dimColor>
        {truncate(pr.headRefName, 20)}
      </Text>
      <Text color={palette.dimmed}>{' → '}</Text>
      <Text color={palette.neonCyan} dimColor>
        {pr.baseRefName}
      </Text>
    </Text>
  );
}

function FocusedSignals({ pr }: { pr: PullRequest }): JSX.Element {
  const signals: Array<{ key: string; text: string; color: string; bold?: boolean }> = [];
  if (pr.checks.some(c => c.conclusion === 'FAILURE')) {
    signals.push({ key: 'ci', text: 'CI FAIL', color: semantic.error, bold: true });
  }
  if (pr.reviewDecision === 'CHANGES_REQUESTED') {
    signals.push({ key: 'changes', text: 'CHANGES', color: palette.coral, bold: true });
  }
  if (pr.isDraft) {
    signals.push({ key: 'draft', text: 'DRAFT', color: palette.electricPurple });
  }
  if (pr.mergeable === 'CONFLICTING') {
    signals.push({ key: 'conflict', text: 'CONFLICT', color: semantic.error });
  }
  if (pr.mergeable === 'MERGEABLE') {
    signals.push({ key: 'mergeable', text: 'MERGEABLE', color: semantic.success });
  }

  return (
    <>
      {signals.map(signal => (
        <Text key={signal.key} color={signal.color} bold={signal.bold === true}>
          {' · '}
          {signal.text}
        </Text>
      ))}
    </>
  );
}

function FocusedMeta({
  pr,
  source,
}: {
  pr: PullRequest;
  source: PrRowProps['source'];
}): JSX.Element {
  const showAuthor = source !== 'mine';
  const hasDiff = pr.additions > 0 || pr.deletions > 0;

  return (
    <Box paddingLeft={3}>
      <Text>
        <Text color={semantic.muted}>{pr.repository.nameWithOwner}</Text>
        {showAuthor ? (
          <Text color={palette.coral}>
            {' · @'}
            {pr.author.login}
          </Text>
        ) : null}
        {hasDiff ? (
          <Text>
            <Text color={semantic.dim}>{' · '}</Text>
            <Text color={semantic.success}>+{pr.additions}</Text>
            <Text color={semantic.error}>
              {' −'}
              {pr.deletions}
            </Text>
            {pr.changedFiles > 0 ? (
              <Text color={palette.dimmed}>
                {' · '}
                {pr.changedFiles}f
              </Text>
            ) : null}
          </Text>
        ) : null}
        <FocusedSignals pr={pr} />
      </Text>
    </Box>
  );
}

export function PrRow({ pr, state, isFocused, source, radar }: PrRowProps): JSX.Element {
  const ci = ciSummary(pr.checks);
  const review = reviewIndicator(pr.reviewDecision);
  const stateColor = prStateColors[state];
  const ago = timeAgo(source === 'merged' ? (pr.mergedAt ?? pr.updatedAt) : pr.updatedAt);
  const badge = getSourceBadge(source, radar);
  const borderProps = isFocused
    ? {
        borderStyle: 'single' as const,
        borderColor: palette.electricPurple,
        borderLeft: true,
        borderRight: true,
        borderTop: false,
        borderBottom: false,
      }
    : {};

  return (
    <Box flexDirection="column" paddingX={1} {...borderProps}>
      {/* Main row */}
      <Box>
        <Text>{stateIndicators[state]}</Text>
        <Text color={palette.neonCyan} bold>
          {' #'}
          {pr.number}
        </Text>
        {badge && (
          <Text color={badge.color} bold>
            {' '}
            {badge.text}
          </Text>
        )}
        <Text color={semantic.dim}> </Text>
        <Box flexGrow={1}>
          <Text wrap="truncate-end" color={isFocused ? palette.fg : stateColor} bold={isFocused}>
            {pr.title}
          </Text>
        </Box>
        <BranchMeta pr={pr} />
        <Text color={palette.dimmed}> </Text>
        <MiniCiBar checks={pr.checks} />
        {ci.label !== '' && <Text color={ci.color}> {ci.label}</Text>}
        <Text color={review.color}> {review.symbol}</Text>
        <Text color={semantic.muted} dimColor>
          {' '}
          {ago}
        </Text>
      </Box>

      {/* Expanded detail when focused */}
      {isFocused ? <FocusedMeta pr={pr} source={source} /> : null}
    </Box>
  );
}
