import { Box, Text, useStdout } from 'ink';
import type { JSX } from 'react';
import { useMemo } from 'react';
import { useStore } from 'zustand';
import { vigilStore } from '../store/index.js';
import type { PrState, PullRequest } from '../types/index.js';
import { KeybindBar } from './keybind-bar.js';
import { ScrollIndicator } from './scroll-indicator.js';
import {
  checkIndicators,
  icons,
  palette,
  prStateColors,
  semantic,
  stateLabels,
  timeAgo,
  truncate,
} from './theme.js';

// ─── Constants ───────────────────────────────────────────────────────

/** Footer lines: scroll indicator (1) + keybind bar divider (1) + keybind bar (1) */
const FOOTER_LINES = 3;
const MAX_INLINE_PASSING = 4;
const MAX_COMMENTS = 12;
const MAX_COMMENT_BODY = 3;
/** Minimum content width to enable two-column layout */
const TWO_COL_MIN_WIDTH = 100;

// ─── Markup Stripping ────────────────────────────────────────────────

function stripMarkup(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/#{1,6}\s/g, '')
    .replace(/```[\s\S]*?```/g, '[code]')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isBotNoise(body: string, authorLogin: string): boolean {
  const stripped = stripMarkup(body);
  if (stripped.length === 0 || /^[\s\n]*$/.test(stripped)) return true;
  if (/\[bot\]$/.test(authorLogin)) return true;
  if (/^(dependabot|renovate|codecov|sonarcloud|vercel|netlify|github-actions)/i.test(authorLogin))
    return true;
  return false;
}

// ─── Virtual Line ────────────────────────────────────────────────────

interface ContentLine {
  key: string;
  element: JSX.Element;
}

// ─── Card Border Helpers ─────────────────────────────────────────────

/** Top border of a card: ╭── Title (subtitle) ────────╮ */
function cardTop(
  key: string,
  title: string,
  subtitle: string,
  width: number,
  color: string
): ContentLine {
  const inner = width - 2;
  const subText = subtitle ? ` ${subtitle}` : '';
  const headerLen = 3 + title.length + subText.length + 1;
  const fillLen = Math.max(1, inner - headerLen);
  return {
    key,
    element: (
      <Box width={width}>
        <Text>
          <Text color={color}>{'╭── '}</Text>
          <Text color={color} bold>
            {title}
          </Text>
          {subtitle && <Text color={semantic.muted}>{subText}</Text>}
          <Text color={color}>{` ${'─'.repeat(fillLen)}╮`}</Text>
        </Text>
      </Box>
    ),
  };
}

/** Bottom border of a card: ╰─────────────────────────╯ */
function cardBottom(key: string, width: number, color: string): ContentLine {
  return {
    key,
    element: (
      <Box width={width}>
        <Text color={color}>{`╰${'─'.repeat(width - 2)}╯`}</Text>
      </Box>
    ),
  };
}

/** Content row inside a card with side borders: │ content │ */
function cardRow(key: string, content: JSX.Element, width: number, color: string): ContentLine {
  return {
    key,
    element: (
      <Box width={width}>
        <Text color={color}>{'│ '}</Text>
        {content}
        <Box flexGrow={1} />
        <Text color={color}>{' │'}</Text>
      </Box>
    ),
  };
}

/**
 * Card row with left/right separation — spacer is a DIRECT child of the
 * width-constrained outer Box so Yoga actually expands it.
 */
function spacedCardRow(
  key: string,
  left: JSX.Element,
  right: JSX.Element,
  width: number,
  color: string
): ContentLine {
  return {
    key,
    element: (
      <Box width={width}>
        <Text color={color}>{'│ '}</Text>
        {left}
        <Box flexGrow={1} />
        {right}
        <Text color={color}>{' │'}</Text>
      </Box>
    ),
  };
}

/** Empty row inside a card: │                           │ */
function cardBlank(key: string, width: number, color: string): ContentLine {
  return {
    key,
    element: (
      <Box width={width}>
        <Text color={color}>{'│'}</Text>
        <Box flexGrow={1} />
        <Text color={color}>{'│'}</Text>
      </Box>
    ),
  };
}

/** Gap between cards (blank line) */
function gap(key: string): ContentLine {
  return { key, element: <Text> </Text> };
}

// ─── Two-Column Merge ────────────────────────────────────────────────

/** Merge two columns of ContentLines side by side with a gap between */
function mergeColumns(
  left: ContentLine[],
  right: ContentLine[],
  leftWidth: number,
  rightWidth: number,
  totalWidth: number,
  gapWidth = 1
): ContentLine[] {
  const maxLen = Math.max(left.length, right.length);
  const result: ContentLine[] = [];

  for (let i = 0; i < maxLen; i++) {
    const lEl = left[i]?.element ?? <Box width={leftWidth} />;
    const rEl = right[i]?.element ?? <Box width={rightWidth} />;
    const lKey = left[i]?.key ?? `lp${i}`;
    const rKey = right[i]?.key ?? `rp${i}`;

    result.push({
      key: `col-${lKey}-${rKey}`,
      element: (
        <Box width={totalWidth}>
          {lEl}
          <Box width={gapWidth} />
          {rEl}
        </Box>
      ),
    });
  }

  return result;
}

// ─── Section: Merge Conflict ─────────────────────────────────────────

function buildConflictCard(pr: PullRequest, w: number): ContentLine[] {
  if (pr.mergeable !== 'CONFLICTING') return [];
  const c = semantic.error;
  return [
    cardTop('conflict-top', `${icons.conflict} Merge Conflict`, '', w, c),
    cardRow(
      'conflict-info',
      <Text color={semantic.error}>
        <Text bold>{pr.headRefName}</Text>
        <Text>{' conflicts with '}</Text>
        <Text bold>{pr.baseRefName}</Text>
      </Text>,
      w,
      c
    ),
    cardRow(
      'conflict-hint',
      <Text color={semantic.muted}>
        <Text>{'Rebase onto '}</Text>
        <Text color={semantic.branch}>{pr.baseRefName}</Text>
        <Text>{' or merge into '}</Text>
        <Text color={semantic.branch}>{pr.headRefName}</Text>
      </Text>,
      w,
      c
    ),
    cardBottom('conflict-bottom', w, c),
  ];
}

// ─── Section: Reviews ────────────────────────────────────────────────

function buildReviewsCard(pr: PullRequest, w: number): ContentLine[] {
  const c = palette.electricPurple;
  const lines: ContentLine[] = [];

  const approved = pr.reviews.filter(r => r.state === 'APPROVED').length;
  const changes = pr.reviews.filter(r => r.state === 'CHANGES_REQUESTED').length;
  const parts: string[] = [`${pr.reviews.length}`];
  if (approved > 0) parts.push(`${checkIndicators.passing.symbol}${approved}`);
  if (changes > 0) parts.push(`${checkIndicators.failing.symbol}${changes}`);
  const sub = pr.reviews.length > 0 ? `(${parts.join(' \u00B7 ')})` : '(none)';

  lines.push(cardTop('reviews-top', 'Reviews', sub, w, c));

  if (pr.reviews.length === 0) {
    lines.push(
      cardRow(
        'reviews-empty',
        <Text color={semantic.dim} italic>
          No reviews yet
        </Text>,
        w,
        c
      )
    );
  } else {
    for (const review of pr.reviews) {
      const rc =
        review.state === 'APPROVED'
          ? semantic.success
          : review.state === 'CHANGES_REQUESTED'
            ? semantic.error
            : semantic.muted;
      const sym =
        review.state === 'APPROVED'
          ? checkIndicators.passing.symbol
          : review.state === 'CHANGES_REQUESTED'
            ? checkIndicators.failing.symbol
            : checkIndicators.pending.symbol;
      const label =
        review.state === 'CHANGES_REQUESTED' ? 'changes requested' : review.state.toLowerCase();

      lines.push(
        spacedCardRow(
          `review-${review.id}`,
          <Text>
            <Text color={rc}>{sym} </Text>
            <Text color={palette.neonCyan} bold>
              {review.author.login}
            </Text>
            <Text color={semantic.dim}>{` ${label}`}</Text>
          </Text>,
          <Text color={semantic.timestamp} dimColor>
            {timeAgo(review.submittedAt)}
          </Text>,
          w,
          c
        )
      );

      if (review.body.trim().length > 0) {
        const stripped = stripMarkup(review.body);
        const firstLine = stripped.split('\n').find(l => l.trim().length > 0);
        if (firstLine) {
          lines.push(
            cardRow(
              `review-body-${review.id}`,
              <Text color={semantic.dim} wrap="truncate-end">
                {`  \u201C${truncate(firstLine, w - 14)}\u201D`}
              </Text>,
              w,
              c
            )
          );
        }
      }
    }
  }

  lines.push(cardBottom('reviews-bottom', w, c));
  return lines;
}

// ─── Section: CI Checks ──────────────────────────────────────────────

function buildCICard(pr: PullRequest, w: number): ContentLine[] {
  const total = pr.checks.length;
  const passing = pr.checks.filter(
    ch =>
      ch.status === 'COMPLETED' &&
      (ch.conclusion === 'SUCCESS' || ch.conclusion === 'NEUTRAL' || ch.conclusion === 'SKIPPED')
  );
  const failing = pr.checks.filter(ch => ch.status === 'COMPLETED' && ch.conclusion === 'FAILURE');
  const cancelled = pr.checks.filter(
    ch => ch.status === 'COMPLETED' && ch.conclusion === 'CANCELLED'
  );
  const running = pr.checks.filter(ch => ch.status !== 'COMPLETED');

  const c = palette.neonCyan;
  const sub = total > 0 ? `(${passing.length}/${total})` : '(none)';
  const lines: ContentLine[] = [];

  lines.push(cardTop('ci-top', 'CI Checks', sub, w, c));

  if (total === 0) {
    lines.push(
      cardRow(
        'ci-empty',
        <Text color={semantic.dim} italic>
          No CI checks configured
        </Text>,
        w,
        c
      )
    );
  } else {
    // Progress bar
    const barWidth = Math.min(w - 8, 40);
    const passN = Math.round((passing.length / total) * barWidth);
    const failN = Math.round((failing.length / total) * barWidth);
    const runN =
      running.length > 0 ? Math.max(1, Math.round((running.length / total) * barWidth)) : 0;
    const emptyN = Math.max(0, barWidth - passN - failN - runN);

    lines.push(
      cardRow(
        'ci-bar',
        <Text>
          {passN > 0 && <Text color={semantic.success}>{'\u2588'.repeat(passN)}</Text>}
          {failN > 0 && <Text color={semantic.error}>{'\u2588'.repeat(failN)}</Text>}
          {runN > 0 && <Text color={semantic.warning}>{'\u2588'.repeat(runN)}</Text>}
          {emptyN > 0 && <Text color={semantic.dim}>{'\u2591'.repeat(emptyN)}</Text>}
        </Text>,
        w,
        c
      )
    );

    // Failing checks (always shown)
    for (const check of failing) {
      lines.push(
        spacedCardRow(
          `ci-fail-${check.name}`,
          <Text>
            <Text color={checkIndicators.failing.color}>
              {`${checkIndicators.failing.symbol} `}
            </Text>
            <Text color={palette.fg} bold>
              {truncate(check.name, w - 20)}
            </Text>
          </Text>,
          <Text color={semantic.error} bold>
            FAILURE
          </Text>,
          w,
          c
        )
      );
    }

    // Running checks (always shown)
    for (const check of running) {
      const statusLabel = check.status === 'IN_PROGRESS' ? 'running' : check.status.toLowerCase();
      lines.push(
        spacedCardRow(
          `ci-run-${check.name}`,
          <Text>
            <Text color={checkIndicators.pending.color}>
              {`${checkIndicators.pending.symbol} `}
            </Text>
            <Text color={palette.fg}>{truncate(check.name, w - 20)}</Text>
          </Text>,
          <Text color={semantic.warning}>{statusLabel}</Text>,
          w,
          c
        )
      );
    }

    // Cancelled checks
    for (const check of cancelled) {
      lines.push(
        spacedCardRow(
          `ci-cancel-${check.name}`,
          <Text color={semantic.dim}>
            {`${checkIndicators.skipped.symbol} `}
            {truncate(check.name, w - 20)}
          </Text>,
          <Text color={semantic.dim}>cancelled</Text>,
          w,
          c
        )
      );
    }

    // Passing checks — show individually if few, collapse if many
    if (passing.length <= MAX_INLINE_PASSING) {
      for (const check of passing) {
        lines.push(
          spacedCardRow(
            `ci-pass-${check.name}`,
            <Text>
              <Text color={checkIndicators.passing.color}>
                {`${checkIndicators.passing.symbol} `}
              </Text>
              <Text color={semantic.muted}>{truncate(check.name, w - 20)}</Text>
            </Text>,
            <Text color={semantic.success} dimColor>
              success
            </Text>,
            w,
            c
          )
        );
      }
    } else {
      for (let i = 0; i < 3; i++) {
        const check = passing[i];
        if (!check) break;
        lines.push(
          spacedCardRow(
            `ci-pass-${check.name}`,
            <Text>
              <Text color={checkIndicators.passing.color}>
                {`${checkIndicators.passing.symbol} `}
              </Text>
              <Text color={semantic.muted}>{truncate(check.name, w - 20)}</Text>
            </Text>,
            <Text color={semantic.success} dimColor>
              success
            </Text>,
            w,
            c
          )
        );
      }
      const rest = passing.length - 3;
      lines.push(
        cardRow(
          'ci-pass-more',
          <Text color={semantic.success} dimColor>
            {`${checkIndicators.passing.symbol} ${icons.ellipsis} and ${rest} more passing`}
          </Text>,
          w,
          c
        )
      );
    }
  }

  lines.push(cardBottom('ci-bottom', w, c));
  return lines;
}

// ─── Section: Comments ───────────────────────────────────────────────

function buildCommentsCard(pr: PullRequest, w: number): ContentLine[] {
  const c = palette.coral;
  const lines: ContentLine[] = [];

  const meaningful = pr.comments.filter(cm => !isBotNoise(cm.body, cm.author.login));
  const botCount = pr.comments.length - meaningful.length;
  let sub = `(${meaningful.length})`;
  if (botCount > 0) sub = `(${meaningful.length} \u00B7 ${botCount} bot)`;

  lines.push(cardTop('comments-top', 'Comments', sub, w, c));

  if (meaningful.length === 0) {
    lines.push(
      cardRow(
        'comments-empty',
        <Text color={semantic.dim} italic>
          {pr.comments.length > 0 ? 'Only bot comments' : 'No comments'}
        </Text>,
        w,
        c
      )
    );
  } else {
    const shown = meaningful.slice(-MAX_COMMENTS);
    const hiddenCount = meaningful.length - shown.length;

    if (hiddenCount > 0) {
      lines.push(
        cardRow(
          'comments-hidden',
          <Text color={semantic.dim}>
            {`${icons.ellipsis} ${hiddenCount} earlier comment${hiddenCount !== 1 ? 's' : ''}`}
          </Text>,
          w,
          c
        )
      );
    }

    for (let ci = 0; ci < shown.length; ci++) {
      const comment = shown[ci];
      if (!comment) continue;

      // Blank line separator between comments (not before first)
      if (ci > 0) {
        lines.push(cardBlank(`comment-sep-${comment.id}`, w, c));
      }

      // Author + time — uses spacedCardRow so timestamp pushes right
      lines.push(
        spacedCardRow(
          `comment-hdr-${comment.id}`,
          <Text color={palette.neonCyan} bold>
            {comment.author.login}
          </Text>,
          <Text color={semantic.timestamp} dimColor>
            {timeAgo(comment.createdAt)}
          </Text>,
          w,
          c
        )
      );

      // Body (stripped, up to N lines)
      const stripped = stripMarkup(comment.body);
      const bodyLines = stripped
        .split('\n')
        .filter(l => l.trim().length > 0)
        .slice(0, MAX_COMMENT_BODY);

      for (let li = 0; li < bodyLines.length; li++) {
        const line = bodyLines[li];
        if (!line) continue;
        lines.push(
          cardRow(
            `comment-body-${comment.id}-${li}`,
            <Text color={semantic.muted} wrap="truncate-end">
              {`  ${truncate(line, w - 10)}`}
            </Text>,
            w,
            c
          )
        );
      }
    }
  }

  lines.push(cardBottom('comments-bottom', w, c));
  return lines;
}

// ─── Section: Labels ─────────────────────────────────────────────────

function buildLabelsCard(pr: PullRequest, w: number): ContentLine[] {
  if (pr.labels.length === 0) return [];
  const c = palette.electricYellow;
  return [
    cardTop('labels-top', 'Labels', '', w, c),
    cardRow(
      'labels-row',
      <Text wrap="truncate-end">
        {pr.labels.map((label, i) => (
          <Text key={label.id}>
            {i > 0 && <Text color={semantic.dim}>{' \u00B7 '}</Text>}
            <Text color={label.color ? `#${label.color}` : semantic.muted}>{label.name}</Text>
          </Text>
        ))}
      </Text>,
      w,
      c
    ),
    cardBottom('labels-bottom', w, c),
  ];
}

// ─── Header Card Builder ────────────────────────────────────────────

function buildHeaderCard(
  pr: PullRequest,
  state: PrState,
  stateColor: string,
  w: number,
  agentActivity: { agent: string; streamingOutput: string } | null
): ContentLine[] {
  const lines: ContentLine[] = [];

  // Top border: ╭── STATE ──────────────────╮
  lines.push(cardTop('header-top', stateLabels[state], `#${pr.number}`, w, stateColor));

  // Title row
  lines.push(
    cardRow(
      'header-title',
      <Text color={palette.fg} bold wrap="truncate-end">
        {pr.title}
      </Text>,
      w,
      stateColor
    )
  );

  // Repo + branches
  lines.push(
    cardRow(
      'header-repo',
      <Text wrap="truncate-end">
        <Text color={semantic.muted}>{pr.repository.nameWithOwner}</Text>
        <Text color={semantic.dim}> {icons.middleDot} </Text>
        <Text color={semantic.branch}>
          {icons.branch} {pr.headRefName}
        </Text>
        <Text color={semantic.dim}> {icons.arrow} </Text>
        <Text color={semantic.branch}>{pr.baseRefName}</Text>
        {pr.isDraft && <Text color={semantic.warning}> DRAFT</Text>}
      </Text>,
      w,
      stateColor
    )
  );

  // Stats line — uses spacedCardRow so "updated Xh" pushes right
  lines.push(
    spacedCardRow(
      'header-stats',
      <Text>
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
      </Text>,
      <Text color={semantic.timestamp} bold>
        updated {timeAgo(pr.updatedAt)}
      </Text>,
      w,
      stateColor
    )
  );

  // Agent activity (optional)
  if (agentActivity) {
    lines.push(
      cardRow(
        'header-agent',
        <Text wrap="truncate-end">
          <Text color={palette.electricPurple}>
            {icons.bolt} agent-{agentActivity.agent}
          </Text>
          <Text color={semantic.dim}>
            : {agentActivity.streamingOutput.split('\n').pop() ?? 'running'}
          </Text>
        </Text>,
        w,
        stateColor
      )
    );
  }

  // Worktree (optional)
  if (pr.worktree) {
    lines.push(
      cardRow(
        'header-worktree',
        <Text wrap="truncate-end">
          <Text color={semantic.path}>
            {icons.folder} {pr.worktree.path}
          </Text>
          {!pr.worktree.isClean && (
            <Text color={semantic.warning}> ({pr.worktree.uncommittedChanges} uncommitted)</Text>
          )}
        </Text>,
        w,
        stateColor
      )
    );
  }

  lines.push(cardBottom('header-bottom', w, stateColor));
  return lines;
}

// ─── Main Content Builder ───────────────────────────────────────────

function buildContentLines(pr: PullRequest, width: number): ContentLine[] {
  const lines: ContentLine[] = [];

  // Conflict card (always full width)
  const conflict = buildConflictCard(pr, width);
  if (conflict.length > 0) {
    lines.push(...conflict);
    lines.push(gap('conflict-gap'));
  }

  // Two-column layout for Reviews + CI on wide terminals
  if (width >= TWO_COL_MIN_WIDTH) {
    const colGap = 2;
    const leftW = Math.floor((width - colGap) / 2);
    const rightW = width - leftW - colGap;

    const reviews = buildReviewsCard(pr, leftW);
    const ci = buildCICard(pr, rightW);

    lines.push(...mergeColumns(reviews, ci, leftW, rightW, width, colGap));
    lines.push(gap('reviews-ci-gap'));
  } else {
    lines.push(...buildReviewsCard(pr, width));
    lines.push(gap('reviews-gap'));

    lines.push(...buildCICard(pr, width));
    lines.push(gap('ci-gap'));
  }

  // Comments (full width — text content benefits from space)
  lines.push(...buildCommentsCard(pr, width));

  // Labels (full width)
  const labels = buildLabelsCard(pr, width);
  if (labels.length > 0) {
    lines.push(gap('labels-gap'));
    lines.push(...labels);
  }

  return lines;
}

// ─── Hook: Line Count for Scroll Max ─────────────────────────────────

export function useDetailLineCount(): number {
  const focusedPr = useStore(vigilStore, s => s.focusedPr);
  const prs = useStore(vigilStore, s => s.prs);
  const { stdout } = useStdout();
  const termWidth = stdout.columns ?? 80;
  const contentWidth = termWidth - 2;
  const pr = focusedPr ? prs.get(focusedPr) : undefined;

  return useMemo(() => {
    if (!pr) return 0;
    return buildContentLines(pr, contentWidth).length;
  }, [pr, contentWidth]);
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
  const contentWidth = termWidth - 2;

  const pr = focusedPr ? prs.get(focusedPr) : undefined;
  const state: PrState = focusedPr ? (prStates.get(focusedPr) ?? 'dormant') : 'dormant';
  const stateColor = prStateColors[state];

  const agentActivity = useMemo(() => {
    if (!focusedPr) return null;
    for (const [, run] of activeAgents) {
      if (run.prKey === focusedPr && run.status === 'running') {
        return run;
      }
    }
    return null;
  }, [activeAgents, focusedPr]);

  // Build fixed header card
  const headerLines = useMemo((): ContentLine[] => {
    if (!pr) return [];
    return buildHeaderCard(pr, state, stateColor, contentWidth, agentActivity);
  }, [pr, state, stateColor, contentWidth, agentActivity]);

  // Build scrollable content
  const contentLines = useMemo((): ContentLine[] => {
    if (!pr) return [];
    return buildContentLines(pr, contentWidth);
  }, [pr, contentWidth]);

  if (!focusedPr || !pr) return null;

  const availableHeight = Math.max(1, termRows - headerLines.length - FOOTER_LINES);

  // Clamp scroll so content can't scroll past the end
  const maxScroll = Math.max(0, contentLines.length - availableHeight);
  const clampedOffset = Math.min(scrollOffset, maxScroll);
  const visibleLines = contentLines.slice(clampedOffset, clampedOffset + availableHeight);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* ── Header Card (fixed) ─────────────────────────────────── */}
      <Box flexDirection="column" paddingX={1}>
        {headerLines.map(line => (
          <Box key={line.key}>{line.element}</Box>
        ))}
      </Box>

      {/* ── Scrollable Content ──────────────────────────────────── */}
      <Box flexDirection="column" paddingX={1} flexGrow={1}>
        {visibleLines.map(line => (
          <Box key={line.key}>{line.element}</Box>
        ))}
        <Box flexGrow={1} />
      </Box>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <ScrollIndicator
        current={clampedOffset}
        total={contentLines.length}
        visible={availableHeight}
      />
      <KeybindBar />
    </Box>
  );
}
