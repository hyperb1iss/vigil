import { Box, Text } from 'ink';
import type { JSX } from 'react';
import { useStore } from 'zustand';
import { vigilStore } from '../store/index.js';
import type { PrState, PullRequest } from '../types/index.js';
import { KeybindBar } from './keybind-bar.js';
import {
  checkIndicators,
  divider,
  icons,
  palette,
  prStateColors,
  semantic,
  stateIndicators,
  stateLabels,
  timeAgo,
} from './theme.js';

// ─── Review Section ───────────────────────────────────────────────────

function ReviewSection({ pr }: { pr: PullRequest }): JSX.Element {
  if (pr.reviews.length === 0) {
    return (
      <Text color={semantic.muted} italic>
        No reviews yet
      </Text>
    );
  }

  return (
    <Box flexDirection="column">
      {pr.reviews.map(review => {
        const stateColor =
          review.state === 'APPROVED'
            ? semantic.success
            : review.state === 'CHANGES_REQUESTED'
              ? semantic.error
              : semantic.warning;
        return (
          <Box key={review.id} gap={1} paddingLeft={1}>
            <Text color={stateColor} bold>
              {review.state === 'APPROVED'
                ? checkIndicators.passing.symbol
                : review.state === 'CHANGES_REQUESTED'
                  ? checkIndicators.failing.symbol
                  : checkIndicators.pending.symbol}
            </Text>
            <Text color={palette.neonCyan}>{review.author.login}</Text>
            <Text color={semantic.muted}>{review.state.toLowerCase().replace('_', ' ')}</Text>
            <Text color={semantic.timestamp} dimColor>
              {timeAgo(review.submittedAt)}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

// ─── Check Section ────────────────────────────────────────────────────

function CheckSection({ pr }: { pr: PullRequest }): JSX.Element {
  if (pr.checks.length === 0) {
    return (
      <Text color={semantic.muted} italic>
        No CI checks
      </Text>
    );
  }

  return (
    <Box flexDirection="column">
      {pr.checks.map(check => {
        const indicator =
          check.status !== 'COMPLETED'
            ? checkIndicators.pending
            : check.conclusion === 'SUCCESS' ||
                check.conclusion === 'NEUTRAL' ||
                check.conclusion === 'SKIPPED'
              ? checkIndicators.passing
              : checkIndicators.failing;

        return (
          <Box key={check.name} gap={1} paddingLeft={1}>
            <Text color={indicator.color}>{indicator.symbol}</Text>
            <Text color={palette.fg}>{check.name}</Text>
            {check.status === 'COMPLETED' && (
              <Text color={semantic.muted} dimColor>
                {check.conclusion?.toLowerCase()}
              </Text>
            )}
            {check.status !== 'COMPLETED' && (
              <Text color={semantic.warning} dimColor>
                running
              </Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

// ─── Comment Section ──────────────────────────────────────────────────

function CommentSection({ pr }: { pr: PullRequest }): JSX.Element {
  if (pr.comments.length === 0) {
    return (
      <Text color={semantic.muted} italic>
        No comments
      </Text>
    );
  }

  const recent = pr.comments.slice(-5);
  return (
    <Box flexDirection="column">
      {recent.map(comment => {
        const truncated =
          comment.body.length > 80 ? `${comment.body.slice(0, 79)}\u2026` : comment.body;
        return (
          <Box key={comment.id} flexDirection="column" paddingLeft={1}>
            <Box gap={1}>
              <Text color={palette.neonCyan} bold>
                {comment.author.login}
              </Text>
              <Text color={semantic.timestamp} dimColor>
                {timeAgo(comment.createdAt)}
              </Text>
            </Box>
            <Text color={semantic.muted} wrap="truncate-end">
              {'  '}
              {truncated.replace(/\n/g, ' ')}
            </Text>
          </Box>
        );
      })}
      {pr.comments.length > 5 && (
        <Text color={semantic.muted} dimColor>
          {icons.ellipsis} and {pr.comments.length - 5} more
        </Text>
      )}
    </Box>
  );
}

// ─── Section Header ───────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }): JSX.Element {
  return (
    <Box paddingTop={1}>
      <Text color={palette.electricPurple} bold>
        {title}
      </Text>
    </Box>
  );
}

// ─── Main Component ───────────────────────────────────────────────────

export function PrDetail(): JSX.Element | null {
  const focusedPr = useStore(vigilStore, s => s.focusedPr);
  const prs = useStore(vigilStore, s => s.prs);
  const prStates = useStore(vigilStore, s => s.prStates);

  if (!focusedPr) return null;
  const pr = prs.get(focusedPr);
  if (!pr) return null;

  const state: PrState = prStates.get(focusedPr) ?? 'dormant';
  const stateColor = prStateColors[state];

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={stateColor}
        paddingX={1}
        marginX={1}
      >
        {/* Header */}
        <Box gap={1}>
          <Text>{stateIndicators[state]}</Text>
          <Text color={stateColor} bold>
            {stateLabels[state]}
          </Text>
          <Text color={semantic.dim}>{icons.middleDot}</Text>
          <Text color={semantic.number} bold>
            #{pr.number}
          </Text>
          <Text color={palette.fg} bold>
            {pr.title}
          </Text>
        </Box>

        <Box gap={1} paddingLeft={2}>
          <Text color={semantic.muted}>{pr.repository.nameWithOwner}</Text>
          <Text color={semantic.branch}>
            {icons.branch} {pr.headRefName}
          </Text>
          <Text color={semantic.dim}>{icons.arrow}</Text>
          <Text color={semantic.branch}>{pr.baseRefName}</Text>
          {pr.isDraft && <Text color={semantic.warning}>DRAFT</Text>}
        </Box>

        {/* Stats */}
        <Box gap={2} paddingLeft={2} paddingTop={1}>
          <Text color={semantic.success}>+{pr.additions}</Text>
          <Text color={semantic.error}>
            {icons.minus}
            {pr.deletions}
          </Text>
          <Text color={semantic.muted}>({pr.changedFiles} files)</Text>
          {pr.mergeable === 'CONFLICTING' && <Text color={semantic.error}>CONFLICTING</Text>}
          {pr.mergeable === 'MERGEABLE' && <Text color={semantic.success}>MERGEABLE</Text>}
        </Box>

        {/* Worktree */}
        {pr.worktree && (
          <Box paddingLeft={2} paddingTop={1}>
            <Text color={semantic.path}>
              {icons.folder} {pr.worktree.path}
              {!pr.worktree.isClean && (
                <Text color={semantic.warning}>
                  {' '}
                  ({pr.worktree.uncommittedChanges} uncommitted)
                </Text>
              )}
            </Text>
          </Box>
        )}
      </Box>

      {/* Sections */}
      <Box flexDirection="column" paddingX={2}>
        <Box paddingTop={1}>
          <Text color={semantic.dim}>{divider(56)}</Text>
        </Box>

        <SectionHeader title="Reviews" />
        <ReviewSection pr={pr} />

        <SectionHeader title="CI Checks" />
        <CheckSection pr={pr} />

        <SectionHeader title="Recent Comments" />
        <CommentSection pr={pr} />
      </Box>

      <Box flexGrow={1} />
      <KeybindBar />
    </Box>
  );
}
