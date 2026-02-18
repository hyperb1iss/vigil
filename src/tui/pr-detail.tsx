import { Box, Text, useStdout } from 'ink';
import type { JSX } from 'react';
import { useMemo } from 'react';
import { useStore } from 'zustand';
import { vigilStore } from '../store/index.js';
import type { PrCheck, PrComment, PrLabel, PrReview, PrState } from '../types/index.js';
import { KeybindBar } from './keybind-bar.js';
import { ScrollIndicator } from './scroll-indicator.js';
import {
  checkIndicators,
  icons,
  palette,
  prStateColors,
  semantic,
  stateIndicators,
  stateLabels,
  timeAgo,
} from './theme.js';

// ─── Constants ───────────────────────────────────────────────────────

/** Lines reserved for: header card (~5) + keybind bar (2) + scroll indicator (1) */
const CHROME_LINES = 8;

// ─── Content Line Builder ────────────────────────────────────────────

/** A single renderable line in the virtual scroll list */
interface ContentLine {
  key: string;
  element: JSX.Element;
}

function sectionHeader(title: string, width: number): ContentLine {
  const lineLen = Math.max(0, width - title.length - 4);
  return {
    key: `section-${title}`,
    element: (
      <Box paddingTop={1}>
        <Text color={palette.electricPurple} bold>
          {'\u2500\u2500 '}
          {title}{' '}
        </Text>
        <Text color={semantic.dim}>{'\u2500'.repeat(lineLen)}</Text>
      </Box>
    ),
  };
}

function buildReviewLines(reviews: PrReview[]): ContentLine[] {
  if (reviews.length === 0) {
    return [
      {
        key: 'reviews-empty',
        element: (
          <Text color={semantic.muted} italic>
            {'  '}No reviews yet
          </Text>
        ),
      },
    ];
  }

  const lines: ContentLine[] = [];
  for (const review of reviews) {
    const stateColor =
      review.state === 'APPROVED'
        ? semantic.success
        : review.state === 'CHANGES_REQUESTED'
          ? semantic.error
          : semantic.warning;
    const symbol =
      review.state === 'APPROVED'
        ? checkIndicators.passing.symbol
        : review.state === 'CHANGES_REQUESTED'
          ? checkIndicators.failing.symbol
          : checkIndicators.pending.symbol;

    lines.push({
      key: `review-${review.id}`,
      element: (
        <Box gap={1} paddingLeft={1}>
          <Text color={stateColor} bold>
            {symbol}
          </Text>
          <Text color={palette.neonCyan}>{review.author.login}</Text>
          <Text color={semantic.muted}>{review.state.toLowerCase().replace('_', ' ')}</Text>
          <Text color={semantic.timestamp} dimColor>
            {timeAgo(review.submittedAt)}
          </Text>
        </Box>
      ),
    });

    // Show first line of review body if present
    if (review.body.trim().length > 0) {
      const firstLine = review.body.trim().split('\n')[0] ?? '';
      const truncated = firstLine.length > 80 ? `${firstLine.slice(0, 79)}\u2026` : firstLine;
      lines.push({
        key: `review-body-${review.id}`,
        element: (
          <Text color={semantic.dim} wrap="truncate-end">
            {'    > "'}
            {truncated}
            {'"'}
          </Text>
        ),
      });
    }
  }

  return lines;
}

function buildCheckLines(checks: PrCheck[]): ContentLine[] {
  if (checks.length === 0) {
    return [
      {
        key: 'checks-empty',
        element: (
          <Text color={semantic.muted} italic>
            {'  '}No CI checks
          </Text>
        ),
      },
    ];
  }

  const lines: ContentLine[] = [];

  // Summary bar
  const total = checks.length;
  const passed = checks.filter(
    c =>
      c.status === 'COMPLETED' &&
      (c.conclusion === 'SUCCESS' || c.conclusion === 'NEUTRAL' || c.conclusion === 'SKIPPED')
  ).length;
  const failed = checks.filter(
    c => c.status === 'COMPLETED' && c.conclusion === 'FAILURE'
  ).length;
  const running = total - passed - failed;

  const ciWidth = 10;
  const passN = Math.round((passed / total) * ciWidth);
  const failN = Math.round((failed / total) * ciWidth);
  const runN = Math.min(ciWidth - passN - failN, running > 0 ? ciWidth : 0);
  const emptyN = ciWidth - passN - failN - runN;

  lines.push({
    key: 'checks-summary',
    element: (
      <Box paddingLeft={1} gap={1}>
        <Text color={semantic.dim}>CI </Text>
        <Text>
          {passN > 0 && <Text color={semantic.success}>{'\u2588'.repeat(passN)}</Text>}
          {failN > 0 && <Text color={semantic.error}>{'\u2588'.repeat(failN)}</Text>}
          {runN > 0 && <Text color={semantic.warning}>{'\u2588'.repeat(runN)}</Text>}
          {emptyN > 0 && <Text color={semantic.dim}>{'\u2591'.repeat(emptyN)}</Text>}
        </Text>
        <Text color={failed > 0 ? semantic.error : passed === total ? semantic.success : semantic.warning}>
          {passed}/{total}
        </Text>
      </Box>
    ),
  });

  // Individual checks
  for (const check of checks) {
    const indicator =
      check.status !== 'COMPLETED'
        ? checkIndicators.pending
        : check.conclusion === 'SUCCESS' ||
            check.conclusion === 'NEUTRAL' ||
            check.conclusion === 'SKIPPED'
          ? checkIndicators.passing
          : checkIndicators.failing;

    const statusText =
      check.status === 'COMPLETED' ? (check.conclusion?.toLowerCase() ?? '') : 'running';
    const statusColor = check.status === 'COMPLETED' ? semantic.muted : semantic.warning;

    lines.push({
      key: `check-${check.name}`,
      element: (
        <Box gap={1} paddingLeft={1}>
          <Text color={indicator.color}>{indicator.symbol}</Text>
          <Text color={palette.fg}>{check.name}</Text>
          <Text color={statusColor} dimColor>
            {statusText}
          </Text>
        </Box>
      ),
    });
  }

  return lines;
}

function buildCommentLines(comments: PrComment[]): ContentLine[] {
  if (comments.length === 0) {
    return [
      {
        key: 'comments-empty',
        element: (
          <Text color={semantic.muted} italic>
            {'  '}No comments
          </Text>
        ),
      },
    ];
  }

  const lines: ContentLine[] = [];
  const shown = comments.slice(-8);
  const hiddenCount = comments.length - shown.length;

  for (const comment of shown) {
    // Author + timestamp line
    lines.push({
      key: `comment-header-${comment.id}`,
      element: (
        <Box gap={1} paddingLeft={1}>
          <Text color={palette.neonCyan} bold>
            {comment.author.login}
          </Text>
          <Text color={semantic.timestamp} dimColor>
            {timeAgo(comment.createdAt)}
          </Text>
        </Box>
      ),
    });

    // Body lines (up to 3)
    const bodyLines = comment.body
      .replace(/\r\n/g, '\n')
      .split('\n')
      .filter(l => l.trim().length > 0)
      .slice(0, 3);

    for (let i = 0; i < bodyLines.length; i++) {
      const line = bodyLines[i] ?? '';
      const truncated = line.length > 100 ? `${line.slice(0, 99)}\u2026` : line;
      lines.push({
        key: `comment-body-${comment.id}-${i}`,
        element: (
          <Text color={semantic.muted} wrap="truncate-end">
            {'    '}
            {truncated}
          </Text>
        ),
      });
    }
  }

  if (hiddenCount > 0) {
    lines.push({
      key: 'comments-more',
      element: (
        <Text color={semantic.dim} dimColor>
          {'  '}
          {icons.ellipsis} and {hiddenCount} more
        </Text>
      ),
    });
  }

  return lines;
}

function buildLabelLines(labels: PrLabel[]): ContentLine[] {
  if (labels.length === 0) return [];

  return [
    {
      key: 'labels',
      element: (
        <Box paddingLeft={1} gap={1}>
          {labels.map(label => (
            <Text key={label.id} color={label.color ? `#${label.color}` : semantic.muted}>
              {label.name}
            </Text>
          ))}
        </Box>
      ),
    },
  ];
}

// ─── Main Component ──────────────────────────────────────────────────

export function PrDetail(): JSX.Element | null {
  const focusedPr = useStore(vigilStore, s => s.focusedPr);
  const prs = useStore(vigilStore, s => s.prs);
  const prStates = useStore(vigilStore, s => s.prStates);
  const activeAgents = useStore(vigilStore, s => s.activeAgents);
  const scrollOffset = useStore(vigilStore, s => s.scrollOffsets.detail);
  const { stdout } = useStdout();
  const termWidth = stdout.columns ?? 80;
  const termRows = stdout.rows ?? 24;
  const contentWidth = Math.min(termWidth - 4, 100);

  const pr = focusedPr ? prs.get(focusedPr) : undefined;
  const state: PrState = focusedPr ? (prStates.get(focusedPr) ?? 'dormant') : 'dormant';
  const stateColor = prStateColors[state];

  // Find agent activity for this PR
  const agentActivity = useMemo(() => {
    if (!focusedPr) return null;
    for (const [, run] of activeAgents) {
      if (run.prKey === focusedPr && run.status === 'running') {
        return run;
      }
    }
    return null;
  }, [activeAgents, focusedPr]);

  // Build virtual content lines
  const contentLines = useMemo((): ContentLine[] => {
    if (!pr) return [];

    const lines: ContentLine[] = [];

    // Reviews
    lines.push(sectionHeader('Reviews', contentWidth));
    lines.push(...buildReviewLines(pr.reviews));

    // CI Checks
    lines.push(sectionHeader('CI Checks', contentWidth));
    lines.push(...buildCheckLines(pr.checks));

    // Comments
    const commentLabel =
      pr.comments.length > 8
        ? `Comments (${Math.min(8, pr.comments.length)} of ${pr.comments.length})`
        : `Comments (${pr.comments.length})`;
    lines.push(sectionHeader(commentLabel, contentWidth));
    lines.push(...buildCommentLines(pr.comments));

    // Labels
    if (pr.labels.length > 0) {
      lines.push(sectionHeader('Labels', contentWidth));
      lines.push(...buildLabelLines(pr.labels));
    }

    return lines;
  }, [pr, contentWidth]);

  if (!focusedPr || !pr) return null;

  // Windowed rendering
  const availableHeight = Math.max(1, termRows - CHROME_LINES);
  const visibleLines = contentLines.slice(scrollOffset, scrollOffset + availableHeight);

  // Export line count for keybind max (read by app.tsx via store)
  // We store this as a side-effect-free computed value

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Header card */}
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={stateColor}
        paddingX={1}
        marginX={1}
      >
        {/* Row 1: State + Number + Title */}
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
          <Text color={palette.fg} bold>
            {' '}
            {pr.title}
          </Text>
        </Text>

        {/* Row 2: Repo + branches */}
        <Text wrap="truncate-end">
          {'  '}
          <Text color={semantic.muted}>{pr.repository.nameWithOwner}</Text>
          <Text color={semantic.dim}> {icons.middleDot} </Text>
          <Text color={semantic.branch}>
            {icons.branch} {pr.headRefName}
          </Text>
          <Text color={semantic.dim}> {icons.arrow} </Text>
          <Text color={semantic.branch}>{pr.baseRefName}</Text>
          {pr.isDraft && <Text color={semantic.warning}> DRAFT</Text>}
        </Text>

        {/* Row 3: Stats */}
        <Text wrap="truncate-end">
          {'  '}
          <Text color={semantic.success}>+{pr.additions}</Text>
          <Text color={semantic.error}>
            {' '}
            {icons.minus}
            {pr.deletions}
          </Text>
          <Text color={semantic.dim}> {icons.middleDot} </Text>
          <Text color={semantic.muted}>{pr.changedFiles} files</Text>
          {pr.mergeable === 'CONFLICTING' && (
            <Text color={semantic.error}>
              {' '}
              {icons.middleDot} {icons.conflict} CONFLICTING
            </Text>
          )}
          {pr.mergeable === 'MERGEABLE' && (
            <Text color={semantic.success}> {icons.middleDot} MERGEABLE</Text>
          )}
          <Text color={semantic.dim}> {icons.middleDot} </Text>
          <Text color={semantic.timestamp}>updated {timeAgo(pr.updatedAt)}</Text>
        </Text>

        {/* Row 4: Agent activity (conditional) */}
        {agentActivity && (
          <Text wrap="truncate-end">
            {'  '}
            <Text color={palette.electricPurple}>
              {icons.bolt} agent-{agentActivity.agent}
            </Text>
            <Text color={semantic.dim}>: {agentActivity.streamingOutput.split('\n').pop() ?? 'running'}</Text>
          </Text>
        )}

        {/* Worktree */}
        {pr.worktree && (
          <Text wrap="truncate-end">
            {'  '}
            <Text color={semantic.path}>
              {icons.folder} {pr.worktree.path}
            </Text>
            {!pr.worktree.isClean && (
              <Text color={semantic.warning}> ({pr.worktree.uncommittedChanges} uncommitted)</Text>
            )}
          </Text>
        )}
      </Box>

      {/* Scrollable content */}
      <Box flexDirection="column" paddingX={2} flexGrow={1}>
        {visibleLines.map(line => (
          <Box key={line.key}>{line.element}</Box>
        ))}
        <Box flexGrow={1} />
      </Box>

      {/* Scroll indicator */}
      <ScrollIndicator
        current={scrollOffset}
        total={contentLines.length}
        visible={availableHeight}
      />

      {/* Keybind footer */}
      <KeybindBar />
    </Box>
  );
}

/** Get the number of content lines for the current detail view (for scroll max) */
export function useDetailLineCount(): number {
  const focusedPr = useStore(vigilStore, s => s.focusedPr);
  const prs = useStore(vigilStore, s => s.prs);
  const pr = focusedPr ? prs.get(focusedPr) : undefined;

  return useMemo(() => {
    if (!pr) return 0;
    // Approximate: sections + reviews + checks + comments + labels
    let count = 1; // Reviews header
    count += Math.max(1, pr.reviews.length * 2); // review + body
    count += 1; // CI header
    count += Math.max(1, 1 + pr.checks.length); // summary + each check
    count += 1; // Comments header
    count += Math.max(1, Math.min(8, pr.comments.length) * 4); // header + up to 3 body lines
    if (pr.comments.length > 8) count += 1; // "N more"
    if (pr.labels.length > 0) count += 2; // header + labels
    return count;
  }, [pr]);
}
