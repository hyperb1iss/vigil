import { Box, Text } from 'ink';
import type { JSX } from 'react';

import type {
  CheckConclusion,
  PrCheck,
  PrLabel,
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

// ─── CI Bar (fixed-width proportional) ──────────────────────────────

const CI_WIDTH = 10;

function CiBar({ checks }: { checks: PrCheck[] }): JSX.Element | null {
  if (checks.length === 0) return null;

  const total = checks.length;
  const passed = checks.filter(
    c =>
      c.status === 'COMPLETED' &&
      (c.conclusion === 'SUCCESS' || c.conclusion === 'NEUTRAL' || c.conclusion === 'SKIPPED')
  ).length;
  const failed = checks.filter(c => {
    if (c.status !== 'COMPLETED') return false;
    const conclusion: CheckConclusion = c.conclusion;
    return (
      conclusion !== 'SUCCESS' &&
      conclusion !== 'NEUTRAL' &&
      conclusion !== 'SKIPPED' &&
      conclusion !== null
    );
  }).length;

  const passN = Math.round((passed / total) * CI_WIDTH);
  const failN = Math.round((failed / total) * CI_WIDTH);
  const runN = Math.min(CI_WIDTH - passN - failN, total - passed - failed > 0 ? CI_WIDTH : 0);
  const emptyN = CI_WIDTH - passN - failN - runN;

  const countColor =
    failed > 0 ? semantic.error : passed === total ? semantic.success : semantic.warning;

  return (
    <Text>
      <Text color={semantic.dim}>CI </Text>
      {passN > 0 && <Text color={semantic.success}>{'█'.repeat(passN)}</Text>}
      {failN > 0 && <Text color={semantic.error}>{'█'.repeat(failN)}</Text>}
      {runN > 0 && <Text color={semantic.warning}>{'█'.repeat(runN)}</Text>}
      {emptyN > 0 && <Text color={semantic.dim}>{'░'.repeat(emptyN)}</Text>}
      <Text color={countColor}>
        {' '}
        {passed}/{total}
      </Text>
    </Text>
  );
}

// ─── Review Summary (compact) ───────────────────────────────────────

function ReviewBadge({
  reviews,
  decision,
}: {
  reviews: PrReview[];
  decision: ReviewDecision;
}): JSX.Element | null {
  const approved = reviews.filter(r => r.state === 'APPROVED').length;
  const changes = reviews.filter(r => r.state === 'CHANGES_REQUESTED').length;

  if (reviews.length === 0 && decision === '') return null;

  return (
    <Text>
      {approved > 0 && (
        <Text color={semantic.success}>
          {' '}
          {icons.check}
          {approved}
        </Text>
      )}
      {changes > 0 && (
        <Text color={semantic.error}>
          {' '}
          {icons.cross}
          {changes}
        </Text>
      )}
      {approved === 0 && changes === 0 && decision === 'REVIEW_REQUIRED' && (
        <Text color={palette.electricPurple}>{' ● review'}</Text>
      )}
    </Text>
  );
}

// ─── Label Badges ───────────────────────────────────────────────────

function LabelBadges({ labels }: { labels: PrLabel[] }): JSX.Element | null {
  if (labels.length === 0) return null;

  return (
    <Box paddingTop={0}>
      <Text wrap="truncate-end">
        {labels.map((label, i) => (
          <Text key={label.id}>
            {i > 0 && <Text> </Text>}
            <Text color={`#${label.color}`}>{label.name}</Text>
          </Text>
        ))}
      </Text>
    </Box>
  );
}

// ─── Short repo name ────────────────────────────────────────────────

function shortRepo(nameWithOwner: string): string {
  const parts = nameWithOwner.split('/');
  return parts[1] ?? nameWithOwner;
}

// ─── PR Card ────────────────────────────────────────────────────────

interface PrCardProps {
  pr: PullRequest;
  state: PrState;
  isFocused: boolean;
  width?: number;
}

export function PrCard({ pr, state, isFocused, width }: PrCardProps): JSX.Element {
  const stateColor = prStateColors[state];
  const ago = timeAgo(pr.updatedAt);
  const hasBranches = pr.headRefName.length > 0;
  const hasDiff = pr.additions > 0 || pr.deletions > 0;

  // Signal flags
  const hasCiFail = pr.checks.some(c => c.conclusion === 'FAILURE');
  const hasChangesRequested = pr.reviewDecision === 'CHANGES_REQUESTED';

  return (
    <Box
      flexDirection="column"
      borderStyle={isFocused ? 'double' : 'round'}
      borderColor={isFocused ? palette.electricPurple : palette.dimmed}
      paddingX={1}
      width={width}
    >
      {/* Row 1: State + Number (left) ── Flags + Age (right) */}
      <Box>
        <Text>
          <Text>{stateIndicators[state]}</Text>
          <Text color={stateColor}> {stateLabels[state]}</Text>
          <Text color={semantic.dim}>{' · '}</Text>
          <Text color={palette.neonCyan}>
            {'#'}
            {pr.number}
          </Text>
        </Text>
        <Box flexGrow={1} />
        <Text>
          {hasCiFail && (
            <Text color={semantic.error} bold>
              {'CI FAIL '}
            </Text>
          )}
          {hasChangesRequested && (
            <Text color={palette.coral} bold>
              {'CHANGES '}
            </Text>
          )}
          {pr.isDraft && <Text color={palette.electricPurple}>{'DRAFT '}</Text>}
          {pr.mergeable === 'CONFLICTING' && <Text color={semantic.error}>{'CONFLICT '}</Text>}
          {pr.mergeable === 'MERGEABLE' && !hasCiFail && !hasChangesRequested && (
            <Text color={semantic.success}>{'✓ '}</Text>
          )}
          <Text color={semantic.muted}>{ago}</Text>
        </Text>
      </Box>

      {/* Row 2: Title (hero — full width, always bold) */}
      <Text wrap="truncate-end" color={palette.fg} bold>
        {pr.title}
      </Text>

      {/* Row 3: Repo · branch → base */}
      <Text wrap="truncate-end">
        <Text color={palette.dimmed}>{shortRepo(pr.repository.nameWithOwner)}</Text>
        {hasBranches && (
          <Text>
            <Text color={palette.dimmed}>{' · '}</Text>
            <Text color={palette.neonCyan} dimColor>
              {icons.branch} {truncate(pr.headRefName, 24)}
            </Text>
            <Text color={palette.dimmed}>{' → '}</Text>
            <Text color={palette.neonCyan} dimColor>
              {pr.baseRefName}
            </Text>
          </Text>
        )}
      </Text>

      {/* Row 4: Metrics bar — CI + reviews + diff (spread across width) */}
      <Box>
        <CiBar checks={pr.checks} />
        <ReviewBadge reviews={pr.reviews} decision={pr.reviewDecision} />
        {hasDiff && (
          <Box flexGrow={1} justifyContent="flex-end">
            <Text>
              <Text color={semantic.success}>
                {'+'}
                {pr.additions}
              </Text>
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
          </Box>
        )}
      </Box>

      {/* Row 5: Labels (optional) */}
      <LabelBadges labels={pr.labels} />
    </Box>
  );
}
