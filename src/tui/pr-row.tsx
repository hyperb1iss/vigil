import { Box, Text } from 'ink';
import type { JSX } from 'react';
import type { CheckConclusion, PrState, PullRequest, ReviewDecision } from '../types/index.js';
import {
  checkIndicators,
  icons,
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

export function PrRow({ pr, state, isFocused }: PrRowProps): JSX.Element {
  const ci = ciSummary(pr.checks);
  const review = reviewIndicator(pr.reviewDecision);
  const stateColor = prStateColors[state];
  const ago = timeAgo(pr.updatedAt);

  return (
    <Box
      flexDirection="column"
      paddingX={1}
      {...(isFocused
        ? {
            borderStyle: 'single' as const,
            borderColor: palette.electricPurple,
            borderLeft: true,
            borderRight: true,
            borderTop: false,
            borderBottom: false,
          }
        : {})}
    >
      {/* Main row */}
      <Box gap={1}>
        <Text>{stateIndicators[state]}</Text>
        <Text color={semantic.number} bold>
          #{pr.number}
        </Text>
        <Text color={isFocused ? palette.fg : stateColor} bold={isFocused}>
          {truncate(pr.title, 44)}
        </Text>
        <Box flexGrow={1} />
        <Text color={semantic.branch} dimColor={!isFocused}>
          {truncate(pr.headRefName, 18)}
        </Text>
        <Text color={semantic.dim}>{icons.arrow}</Text>
        <Text color={semantic.branch} dimColor={!isFocused}>
          {pr.baseRefName}
        </Text>
        <MiniCiBar checks={pr.checks} />
        <Text color={ci.color}>{ci.label ? ` ${ci.label}` : ''}</Text>
        <Text color={review.color}>{review.symbol}</Text>
        <Text color={semantic.timestamp} dimColor>
          {ago}
        </Text>
      </Box>

      {/* Expanded detail when focused */}
      {isFocused && (
        <Box paddingLeft={3} gap={1}>
          <Text color={semantic.muted}>{pr.repository.nameWithOwner}</Text>
          <Text color={semantic.dim}>{icons.middleDot}</Text>
          <Text color={semantic.success}>+{pr.additions}</Text>
          <Text color={semantic.error}>
            {icons.minus}
            {pr.deletions}
          </Text>
          <Text color={semantic.muted}>({pr.changedFiles} files)</Text>
          {pr.isDraft && <Text color={semantic.warning}>DRAFT</Text>}
          {pr.mergeable === 'CONFLICTING' && <Text color={semantic.error}>CONFLICT</Text>}
          {pr.mergeable === 'MERGEABLE' && <Text color={semantic.success}>MERGEABLE</Text>}
          {pr.worktree && (
            <Text color={semantic.path}>
              {icons.folder} {truncate(pr.worktree.path, 30)}
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}
