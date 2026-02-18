import { Box, Text } from 'ink';
import type { JSX } from 'react';
import type { CheckConclusion, PrState, PullRequest, ReviewDecision } from '../types/index.js';
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
  const hasBranch = pr.headRefName.length > 0;

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
      <Box>
        <Text>{stateIndicators[state]}</Text>
        <Text color={palette.neonCyan} bold>
          {' #'}
          {pr.number}
        </Text>
        <Text color={semantic.dim}> </Text>
        <Box flexGrow={1}>
          <Text wrap="truncate-end" color={isFocused ? palette.fg : stateColor} bold={isFocused}>
            {pr.title}
          </Text>
        </Box>
        {hasBranch && (
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
        )}
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
      {isFocused && (
        <Box paddingLeft={3}>
          <Text>
            <Text color={semantic.muted}>{pr.repository.nameWithOwner}</Text>
            {(pr.additions > 0 || pr.deletions > 0) && (
              <Text>
                <Text color={semantic.dim}>{' · '}</Text>
                <Text color={semantic.success}>+{pr.additions}</Text>
                <Text color={semantic.error}>
                  {' −'}
                  {pr.deletions}
                </Text>
                {pr.changedFiles > 0 && (
                  <Text color={palette.dimmed}>
                    {' · '}
                    {pr.changedFiles}f
                  </Text>
                )}
              </Text>
            )}
            {pr.checks.some(c => c.conclusion === 'FAILURE') && (
              <Text color={semantic.error} bold>
                {' · CI FAIL'}
              </Text>
            )}
            {pr.reviewDecision === 'CHANGES_REQUESTED' && (
              <Text color={palette.coral} bold>
                {' · CHANGES'}
              </Text>
            )}
            {pr.isDraft && <Text color={palette.electricPurple}>{' · DRAFT'}</Text>}
            {pr.mergeable === 'CONFLICTING' && <Text color={semantic.error}>{' · CONFLICT'}</Text>}
            {pr.mergeable === 'MERGEABLE' && <Text color={semantic.success}>{' · MERGEABLE'}</Text>}
          </Text>
        </Box>
      )}
    </Box>
  );
}
