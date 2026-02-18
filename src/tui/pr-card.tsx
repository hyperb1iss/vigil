import { Box, Text } from 'ink';
import type { JSX } from 'react';
import type {
  CheckConclusion,
  PrCheck,
  PrReview,
  PrState,
  PullRequest,
  ReviewDecision,
} from '../types/index.js';
import {
  icons,
  palette,
  prStateColors,
  semantic,
  stateIndicators,
  stateLabels,
  timeAgo,
  truncate,
} from './theme.js';

// ─── CI Progress Bar ─────────────────────────────────────────────────

function CiBar({ checks }: { checks: PrCheck[] }): JSX.Element {
  if (checks.length === 0) {
    return (
      <Text color={semantic.dim}>
        <Text color={semantic.muted}>CI </Text>
        {'\u2500'}
      </Text>
    );
  }

  // Sort: passed first, then failed, then running
  const sorted = [...checks].sort((a, b) => {
    const order = (c: PrCheck): number => {
      if (c.status !== 'COMPLETED') return 2;
      const conclusion: CheckConclusion = c.conclusion;
      if (conclusion === 'SUCCESS' || conclusion === 'NEUTRAL' || conclusion === 'SKIPPED')
        return 0;
      return 1;
    };
    return order(a) - order(b);
  });

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
      c.conclusion !== 'SKIPPED'
  ).length;

  // Build colored block string segments
  const blocks = sorted.map(check => {
    if (check.status !== 'COMPLETED') return 'pending';
    if (
      check.conclusion === 'SUCCESS' ||
      check.conclusion === 'NEUTRAL' ||
      check.conclusion === 'SKIPPED'
    )
      return 'pass';
    return 'fail';
  });

  const countColor =
    failed > 0 ? semantic.error : passed === checks.length ? semantic.success : semantic.warning;

  return (
    <Text>
      <Text color={semantic.muted}>CI </Text>
      {blocks.map((type, i) => (
        <Text
          key={`ci-${i}`}
          color={
            type === 'pass' ? semantic.success : type === 'fail' ? semantic.error : semantic.warning
          }
        >
          {'\u2588'}
        </Text>
      ))}
      <Text color={countColor}>
        {' '}
        {passed}/{checks.length}
      </Text>
    </Text>
  );
}

// ─── Review Summary ──────────────────────────────────────────────────

function ReviewSummary({
  reviews,
  decision,
}: {
  reviews: PrReview[];
  decision: ReviewDecision;
}): JSX.Element {
  const approved = reviews.filter(r => r.state === 'APPROVED');
  const changes = reviews.filter(r => r.state === 'CHANGES_REQUESTED');
  const pending = reviews.filter(r => r.state === 'PENDING' || r.state === 'COMMENTED');

  if (reviews.length === 0 && decision === '') {
    return (
      <Text color={semantic.dim}>
        <Text color={semantic.muted}>Reviews </Text>
        {'\u2500'}
      </Text>
    );
  }

  return (
    <Text>
      <Text color={semantic.muted}>Reviews </Text>
      {approved.length > 0 && (
        <Text color={semantic.success}>
          {icons.check}
          {approved.length}{' '}
        </Text>
      )}
      {changes.length > 0 && (
        <Text color={semantic.error}>
          {icons.cross}
          {changes.length}{' '}
        </Text>
      )}
      {pending.length > 0 && (
        <Text color={semantic.warning}>
          {'\u25CF'}
          {pending.length}{' '}
        </Text>
      )}
      {decision === 'REVIEW_REQUIRED' && approved.length === 0 && changes.length === 0 && (
        <Text color={semantic.warning}>required</Text>
      )}
    </Text>
  );
}

// ─── PR Card ─────────────────────────────────────────────────────────

interface PrCardProps {
  pr: PullRequest;
  state: PrState;
  isFocused: boolean;
  width?: number;
}

export function PrCard({ pr, state, isFocused, width }: PrCardProps): JSX.Element {
  const stateColor = prStateColors[state];

  return (
    <Box
      flexDirection="column"
      borderStyle={isFocused ? 'double' : 'round'}
      borderColor={isFocused ? palette.electricPurple : stateColor}
      paddingX={1}
      width={width}
    >
      {/* Row 1: State badge + PR number + title (single Text to prevent wrapping) */}
      <Text wrap="truncate-end">
        {stateIndicators[state]}
        <Text color={stateColor} bold>
          {' '}
          {stateLabels[state]}
        </Text>
        <Text color={semantic.dim}> {icons.middleDot} </Text>
        <Text color={semantic.number} bold>
          #{pr.number}
        </Text>
        <Text color={palette.fg} bold={isFocused}>
          {' '}
          {pr.title}
        </Text>
      </Text>

      {/* Row 2: Repo + branch flow */}
      <Text wrap="truncate-end">
        <Text color={semantic.muted}> {pr.repository.nameWithOwner}</Text>
        <Text color={semantic.dim}> {icons.middleDot} </Text>
        <Text color={semantic.branch}>
          {icons.branch} {truncate(pr.headRefName, 22)}
        </Text>
        <Text color={semantic.dim}> {icons.arrow} </Text>
        <Text color={semantic.branch}>{pr.baseRefName}</Text>
      </Text>

      {/* Row 3: CI + Reviews */}
      <Text wrap="truncate-end">
        {'  '}
        <CiBar checks={pr.checks} />
        {'   '}
        <ReviewSummary reviews={pr.reviews} decision={pr.reviewDecision} />
      </Text>

      {/* Row 4: Diff stats + meta */}
      <Text wrap="truncate-end">
        {'  '}
        <Text color={semantic.success}>
          {icons.plus}
          {pr.additions}
        </Text>
        <Text color={semantic.error}>
          {' '}
          {icons.minus}
          {pr.deletions}
        </Text>
        <Text color={semantic.dim}> {icons.middleDot} </Text>
        <Text color={semantic.muted}>{pr.changedFiles} files</Text>
        {pr.mergeable === 'MERGEABLE' && (
          <Text color={semantic.success}> {icons.middleDot} Mergeable</Text>
        )}
        {pr.mergeable === 'CONFLICTING' && (
          <Text color={semantic.error}>
            {' '}
            {icons.middleDot} {icons.conflict} Conflict
          </Text>
        )}
        {pr.isDraft && <Text color={semantic.warning}> {icons.middleDot} Draft</Text>}
        <Text color={semantic.dim}> {icons.middleDot} </Text>
        <Text color={semantic.timestamp}>{timeAgo(pr.updatedAt)}</Text>
      </Text>
    </Box>
  );
}
