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
  truncate,
} from './theme.js';

// ─── Constants ───────────────────────────────────────────────────────

/** Lines reserved for: header card (~5) + keybind bar (2) + scroll indicator (1) */
const CHROME_LINES = 8;

// ─── Markup Stripping ────────────────────────────────────────────────

/** Strip HTML tags, comments, and markdown formatting from text */
function stripMarkup(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, '') // HTML comments
    .replace(/<[^>]+>/g, '') // HTML tags
    .replace(/\*\*(.+?)\*\*/g, '$1') // **bold**
    .replace(/__(.+?)__/g, '$1') // __bold__
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [text](url)
    .replace(/#{1,6}\s/g, '') // ## headers
    .replace(/\n{3,}/g, '\n\n') // collapse excessive newlines
    .trim();
}

/** Check if a comment is purely bot noise (hidden summaries, link-backs, etc.) */
function isBotNoise(body: string): boolean {
  const stripped = stripMarkup(body);
  // Empty after stripping
  if (stripped.length === 0) return true;
  // Common bot patterns that produce no useful content
  if (/^[\s\n]*$/.test(stripped)) return true;
  return false;
}

// ─── Content Line Builder ────────────────────────────────────────────

/** A single renderable element in the virtual scroll list */
interface ContentLine {
  key: string;
  element: JSX.Element;
}

// ─── Reviews Card ────────────────────────────────────────────────────

function ReviewsCard({
  reviews,
  width,
}: {
  reviews: PrReview[];
  width: number;
}): JSX.Element {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={palette.dimmed}
      paddingX={1}
      width={width}
    >
      {/* Card header */}
      <Box>
        <Text color={palette.electricPurple} bold>
          Reviews
        </Text>
        <Text color={semantic.muted}> ({reviews.length})</Text>
      </Box>

      {reviews.length === 0 ? (
        <Text color={semantic.dim} italic>
          No reviews yet
        </Text>
      ) : (
        <Box flexDirection="column">
          {reviews.map(review => {
            const stateColor =
              review.state === 'APPROVED'
                ? semantic.success
                : review.state === 'CHANGES_REQUESTED'
                  ? semantic.error
                  : semantic.muted;
            const symbol =
              review.state === 'APPROVED'
                ? checkIndicators.passing.symbol
                : review.state === 'CHANGES_REQUESTED'
                  ? checkIndicators.failing.symbol
                  : checkIndicators.pending.symbol;
            const stateText = review.state === 'CHANGES_REQUESTED'
              ? 'changes'
              : review.state.toLowerCase();

            return (
              <Box key={review.id} gap={1}>
                <Text color={stateColor}>{symbol}</Text>
                <Text color={palette.neonCyan} bold>
                  {truncate(review.author.login, 18)}
                </Text>
                <Box flexGrow={1}>
                  <Text color={semantic.dim}>{stateText}</Text>
                </Box>
                <Text color={semantic.timestamp} dimColor>
                  {timeAgo(review.submittedAt)}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}

// ─── CI Checks Card ─────────────────────────────────────────────────

function ChecksCard({
  checks,
  width,
}: {
  checks: PrCheck[];
  width: number;
}): JSX.Element {
  const total = checks.length;
  const passing = checks.filter(
    c =>
      c.status === 'COMPLETED' &&
      (c.conclusion === 'SUCCESS' || c.conclusion === 'NEUTRAL' || c.conclusion === 'SKIPPED')
  );
  const failing = checks.filter(
    c => c.status === 'COMPLETED' && c.conclusion === 'FAILURE'
  );
  const running = checks.filter(c => c.status !== 'COMPLETED');

  // CI summary bar
  const ciWidth = 12;
  const passN = total > 0 ? Math.round((passing.length / total) * ciWidth) : 0;
  const failN = total > 0 ? Math.round((failing.length / total) * ciWidth) : 0;
  const runN = Math.min(ciWidth - passN - failN, running.length > 0 ? ciWidth : 0);
  const emptyN = Math.max(0, ciWidth - passN - failN - runN);

  const countColor =
    failing.length > 0
      ? semantic.error
      : passing.length === total
        ? semantic.success
        : semantic.warning;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={palette.dimmed}
      paddingX={1}
      width={width}
    >
      {/* Card header with inline CI bar */}
      <Box gap={1}>
        <Text color={palette.electricPurple} bold>
          CI
        </Text>
        {total === 0 ? (
          <Text color={semantic.dim}>{'─'.repeat(ciWidth)}</Text>
        ) : (
          <>
            <Text>
              {passN > 0 && <Text color={semantic.success}>{'\u2588'.repeat(passN)}</Text>}
              {failN > 0 && <Text color={semantic.error}>{'\u2588'.repeat(failN)}</Text>}
              {runN > 0 && <Text color={semantic.warning}>{'\u2588'.repeat(runN)}</Text>}
              {emptyN > 0 && <Text color={semantic.dim}>{'\u2591'.repeat(emptyN)}</Text>}
            </Text>
            <Text color={countColor} bold>
              {passing.length}/{total}
            </Text>
          </>
        )}
      </Box>

      {total === 0 ? (
        <Text color={semantic.dim} italic>
          No CI checks
        </Text>
      ) : (
        <Box flexDirection="column">
          {/* Show failing checks individually */}
          {failing.map(check => (
            <Box key={check.name} gap={1}>
              <Text color={checkIndicators.failing.color}>{checkIndicators.failing.symbol}</Text>
              <Text color={palette.fg}>{truncate(check.name, width - 10)}</Text>
            </Box>
          ))}

          {/* Show running checks individually */}
          {running.map(check => (
            <Box key={check.name} gap={1}>
              <Text color={checkIndicators.pending.color}>{checkIndicators.pending.symbol}</Text>
              <Text color={palette.fg}>{truncate(check.name, width - 18)}</Text>
              <Text color={semantic.warning} dimColor>
                running
              </Text>
            </Box>
          ))}

          {/* Divider between individual + collapsed */}
          {(failing.length > 0 || running.length > 0) && passing.length > 0 && (
            <Text color={semantic.dim}>
              {'\u2500'.repeat(Math.max(0, Math.min(width - 6, 30)))}
            </Text>
          )}

          {/* Collapse passing into summary */}
          {passing.length > 0 && (
            <Box gap={1}>
              <Text color={checkIndicators.passing.color}>{checkIndicators.passing.symbol}</Text>
              <Text color={semantic.success}>
                {passing.length} check{passing.length !== 1 ? 's' : ''} passing
              </Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}

// ─── Comments Card ──────────────────────────────────────────────────

function CommentsCard({
  comments,
  width,
}: {
  comments: PrComment[];
  width: number;
}): JSX.Element {
  // Filter out bot noise, show human-readable comments
  const meaningful = comments.filter(c => !isBotNoise(c.body));
  const shown = meaningful.slice(-5);
  const hiddenCount = meaningful.length - shown.length;
  const bodyMaxLen = Math.max(40, width - 12);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={palette.dimmed}
      paddingX={1}
      width={width}
    >
      {/* Card header */}
      <Box>
        <Text color={palette.electricPurple} bold>
          Comments
        </Text>
        <Text color={semantic.muted}> ({meaningful.length})</Text>
        {comments.length !== meaningful.length && (
          <Text color={semantic.dim} dimColor>
            {' '}
            {icons.middleDot} {comments.length - meaningful.length} bot
          </Text>
        )}
      </Box>

      {meaningful.length === 0 ? (
        <Text color={semantic.dim} italic>
          No comments
        </Text>
      ) : (
        <Box flexDirection="column">
          {shown.map((comment, idx) => {
            const stripped = stripMarkup(comment.body);
            const bodyLines = stripped
              .split('\n')
              .filter(l => l.trim().length > 0)
              .slice(0, 2);

            return (
              <Box key={comment.id} flexDirection="column" {...(idx > 0 ? { paddingTop: 1 } : {})}>
                {/* Author + time */}
                <Box gap={1}>
                  <Text color={palette.neonCyan} bold>
                    {comment.author.login}
                  </Text>
                  <Text color={semantic.dim}>{icons.middleDot}</Text>
                  <Text color={semantic.timestamp} dimColor>
                    {timeAgo(comment.createdAt)}
                  </Text>
                </Box>
                {/* Body (stripped, up to 2 lines) */}
                {bodyLines.map((line, i) => (
                  <Text key={i} color={semantic.muted} wrap="truncate-end">
                    {'  '}
                    {truncate(line, bodyMaxLen)}
                  </Text>
                ))}
              </Box>
            );
          })}

          {hiddenCount > 0 && (
            <Box paddingTop={1}>
              <Text color={semantic.dim}>
                {icons.ellipsis} and {hiddenCount} more
              </Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}

// ─── Labels Card ────────────────────────────────────────────────────

function LabelsCard({
  labels,
  width,
}: {
  labels: PrLabel[];
  width: number;
}): JSX.Element {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={palette.dimmed}
      paddingX={1}
      width={width}
    >
      <Box gap={2}>
        <Text color={palette.electricPurple} bold>
          Labels
        </Text>
        <Text wrap="truncate-end">
          {labels.map((label, i) => (
            <Text key={label.id}>
              {i > 0 && <Text color={semantic.dim}> {icons.middleDot} </Text>}
              <Text color={label.color ? `#${label.color}` : semantic.muted}>{label.name}</Text>
            </Text>
          ))}
        </Text>
      </Box>
    </Box>
  );
}

// ─── Content Line Builders ──────────────────────────────────────────

function buildSectionCards(
  reviews: PrReview[],
  checks: PrCheck[],
  comments: PrComment[],
  labels: PrLabel[],
  contentWidth: number,
  isWide: boolean
): ContentLine[] {
  const lines: ContentLine[] = [];

  if (isWide) {
    // Two-column: Reviews + CI side by side
    const halfWidth = Math.floor((contentWidth - 1) / 2);
    lines.push({
      key: 'reviews-and-ci',
      element: (
        <Box gap={1}>
          <ReviewsCard reviews={reviews} width={halfWidth} />
          <ChecksCard checks={checks} width={halfWidth} />
        </Box>
      ),
    });
  } else {
    // Stacked: Reviews then CI
    lines.push({
      key: 'reviews-card',
      element: <ReviewsCard reviews={reviews} width={contentWidth} />,
    });
    lines.push({
      key: 'checks-card',
      element: <ChecksCard checks={checks} width={contentWidth} />,
    });
  }

  // Comments (always full width)
  lines.push({
    key: 'comments-card',
    element: <CommentsCard comments={comments} width={contentWidth} />,
  });

  // Labels (if any)
  if (labels.length > 0) {
    lines.push({
      key: 'labels-card',
      element: <LabelsCard labels={labels} width={contentWidth} />,
    });
  }

  return lines;
}

// ─── Main Component ─────────────────────────────────────────────────

export function PrDetail(): JSX.Element | null {
  const focusedPr = useStore(vigilStore, s => s.focusedPr);
  const prs = useStore(vigilStore, s => s.prs);
  const prStates = useStore(vigilStore, s => s.prStates);
  const activeAgents = useStore(vigilStore, s => s.activeAgents);
  const scrollOffset = useStore(vigilStore, s => s.scrollOffsets.detail);
  const { stdout } = useStdout();
  const termWidth = stdout.columns ?? 80;
  const termRows = stdout.rows ?? 24;
  const contentWidth = Math.min(termWidth - 2, 120);
  const isWide = termWidth >= 100;

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

  // Build virtual content lines (each is a card or card pair)
  const contentLines = useMemo((): ContentLine[] => {
    if (!pr) return [];
    return buildSectionCards(
      pr.reviews,
      pr.checks,
      pr.comments,
      pr.labels,
      contentWidth,
      isWide
    );
  }, [pr, contentWidth, isWide]);

  if (!focusedPr || !pr) return null;

  // Windowed rendering
  const availableHeight = Math.max(1, termRows - CHROME_LINES);
  const visibleLines = contentLines.slice(scrollOffset, scrollOffset + availableHeight);

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
        <Box>
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
        </Box>

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

        {/* Row 3: Stats + signals */}
        <Box>
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
        </Box>

        {/* Row 4: Agent activity (conditional) */}
        {agentActivity && (
          <Text wrap="truncate-end">
            {'  '}
            <Text color={palette.electricPurple}>
              {icons.bolt} agent-{agentActivity.agent}
            </Text>
            <Text color={semantic.dim}>
              : {agentActivity.streamingOutput.split('\n').pop() ?? 'running'}
            </Text>
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
              <Text color={semantic.warning}>
                {' '}
                ({pr.worktree.uncommittedChanges} uncommitted)
              </Text>
            )}
          </Text>
        )}
      </Box>

      {/* Scrollable section cards */}
      <Box flexDirection="column" paddingX={1} flexGrow={1}>
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
  const { stdout } = useStdout();
  const termWidth = stdout.columns ?? 80;
  const isWide = termWidth >= 100;
  const pr = focusedPr ? prs.get(focusedPr) : undefined;

  return useMemo(() => {
    if (!pr) return 0;
    // Cards: reviews+ci (1 or 2) + comments (1) + labels (0 or 1)
    let count = isWide ? 1 : 2; // reviews + ci
    count += 1; // comments
    if (pr.labels.length > 0) count += 1; // labels
    return count;
  }, [pr, isWide]);
}
