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
} from './theme.js';

interface PrRowProps {
  pr: PullRequest;
  state: PrState;
  isFocused: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────

const STATE_PRIORITY: PrState[] = ['hot', 'waiting', 'ready', 'blocked', 'dormant'];

/** Priority index for sorting — lower = hotter. */
export function statePriority(state: PrState): number {
  const idx = STATE_PRIORITY.indexOf(state);
  return idx === -1 ? STATE_PRIORITY.length : idx;
}

/** Truncate a string to maxLen, appending ellipsis if needed. */
function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? `${str.slice(0, maxLen - 1)}\u2026` : str;
}

/** Human-readable relative time from an ISO timestamp. */
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/** Summarize CI checks into a compact indicator + counts. */
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

/** Map review decision to a compact indicator. */
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

// ─── Component ────────────────────────────────────────────────────────

export function PrRow({ pr, state, isFocused }: PrRowProps): JSX.Element {
  const ci = ciSummary(pr.checks);
  const review = reviewIndicator(pr.reviewDecision);
  const stateColor = prStateColors[state];
  const ago = timeAgo(pr.updatedAt);

  return (
    <Box
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
      {...(isFocused
        ? { borderStyle: 'single' as const, borderColor: palette.electricPurple }
        : {})}
    >
      {/* Main row */}
      <Box gap={1}>
        <Text>{stateIndicators[state]}</Text>
        <Text color={semantic.number} bold>
          #{pr.number}
        </Text>
        <Text color={isFocused ? palette.fg : stateColor} bold={isFocused}>
          {truncate(pr.title, 50)}
        </Text>
        <Box flexGrow={1} />
        <Text color={semantic.branch} dimColor={!isFocused}>
          {icons.branch} {truncate(pr.headRefName, 24)}
        </Text>
        <Text color={ci.color}>
          {ci.symbol}
          {ci.label ? ` ${ci.label}` : ''}
        </Text>
        <Text color={review.color}>{review.symbol}</Text>
        <Text color={semantic.timestamp} dimColor>
          {ago}
        </Text>
      </Box>

      {/* Focused detail line */}
      {isFocused && (
        <Box paddingLeft={3} gap={1}>
          <Text color={semantic.muted}>{pr.repository.nameWithOwner}</Text>
          <Text color={semantic.muted}>
            {icons.dot} +{pr.additions} -{pr.deletions} ({pr.changedFiles} files)
          </Text>
          {pr.isDraft && <Text color={semantic.warning}>DRAFT</Text>}
          {pr.mergeable === 'CONFLICTING' && <Text color={semantic.error}>CONFLICT</Text>}
          {pr.worktree && (
            <Text color={semantic.path}>
              {icons.folder} {pr.worktree.path}
              {!pr.worktree.isClean && (
                <Text color={semantic.warning}>
                  {' '}
                  ({pr.worktree.uncommittedChanges} uncommitted)
                </Text>
              )}
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}
