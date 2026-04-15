import { Box, Text, useStdout } from 'ink';
import type { JSX } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { useStore } from 'zustand';

import { vigilStore } from '../store/index.js';
import type { DetailFocus, PrCheck, PrState, PullRequest } from '../types/index.js';
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

/** Non-content chrome: breadcrumb (1) + scroll indicator (1) + keybind bar divider (1) + keybind bar (1) */
const CHROME_LINES = 4;
const MAX_INLINE_PASSING = 4;
const MAX_COMMENTS = 12;
const MAX_COMMENT_BODY = 3;
const MAX_AGENT_ITEMS = 8;
const MAX_AGENT_BODY = 4;
/** Minimum content width to enable two-column layout */
const TWO_COL_MIN_WIDTH = 100;
const DETAIL_PANEL_BREAKPOINT = 118;
const STACKED_NAVIGATOR_MIN_HEIGHT = 8;
const STACKED_NAVIGATOR_MAX_HEIGHT = 12;
const PANEL_CHROME_LINES = 2;

function mergeStatusStyle(status: PullRequest['mergeStateStatus']): {
  label: string;
  color: string;
} | null {
  if (!status || status === 'UNKNOWN') return null;

  switch (status) {
    case 'CLEAN':
    case 'HAS_HOOKS':
      return { label: status, color: semantic.success };
    case 'BLOCKED':
    case 'DIRTY':
      return { label: status, color: semantic.error };
    case 'BEHIND':
    case 'DRAFT':
    case 'UNSTABLE':
      return { label: status, color: semantic.warning };
    default:
      return { label: status, color: semantic.muted };
  }
}

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

type AutomatedReviewVendorId = 'codex' | 'claude' | 'coderabbit';

interface AutomatedReviewVendor {
  id: AutomatedReviewVendorId;
  label: string;
  icon: string;
  color: string;
  loginPatterns: readonly RegExp[];
  bodyPatterns: readonly RegExp[];
}

interface AutomatedReviewItem {
  key: string;
  kind: 'review' | 'comment';
  vendor: AutomatedReviewVendor;
  authorLogin: string;
  body: string;
  timestamp: string;
  reviewState?: PullRequest['reviews'][number]['state'];
}

interface FeedbackSections {
  automatedItems: AutomatedReviewItem[];
  humanReviews: PullRequest['reviews'];
  humanComments: PullRequest['comments'];
  suppressedBotComments: number;
}

type DetailItemKind = 'overview' | 'agent' | 'review' | 'comment' | 'check';

interface DetailItemMeta {
  label: string;
  value: string;
  color?: string | undefined;
}

interface DetailItem {
  key: string;
  kind: DetailItemKind;
  title: string;
  subtitle: string;
  timestamp?: string | undefined;
  icon: string;
  accent: string;
  body: string;
  meta: DetailItemMeta[];
}

interface NavigatorRow {
  key: string;
  kind: 'section' | 'item';
  label: string;
  itemIndex?: number | undefined;
  item?: DetailItem | undefined;
}

const AUTOMATED_REVIEW_VENDORS: readonly AutomatedReviewVendor[] = [
  {
    id: 'codex',
    label: 'CODEX',
    icon: icons.terminal,
    color: palette.neonCyan,
    loginPatterns: [/\bcodex\b/i],
    bodyPatterns: [/\bcodex\b/i, /\bopenai codex\b/i],
  },
  {
    id: 'claude',
    label: 'CLAUDE',
    icon: icons.bolt,
    color: palette.coral,
    loginPatterns: [/\bclaude\b/i],
    bodyPatterns: [/\bclaude\b/i],
  },
  {
    id: 'coderabbit',
    label: 'CODERABBIT',
    icon: icons.eye,
    color: palette.electricYellow,
    loginPatterns: [/\bcoderabbit\b/i, /\bcoderabbitai\b/i],
    bodyPatterns: [/\bcoderabbit\b/i],
  },
] as const;

function matchesPatterns(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(value));
}

function detectAutomatedReviewVendor(
  authorLogin: string,
  body: string
): AutomatedReviewVendor | null {
  const normalizedBody = stripMarkup(body);

  for (const vendor of AUTOMATED_REVIEW_VENDORS) {
    if (matchesPatterns(authorLogin, vendor.loginPatterns)) {
      return vendor;
    }
    if (normalizedBody && matchesPatterns(normalizedBody, vendor.bodyPatterns)) {
      return vendor;
    }
  }

  return null;
}

function isBotNoise(body: string, authorLogin: string): boolean {
  if (detectAutomatedReviewVendor(authorLogin, body)) return false;

  const stripped = stripMarkup(body);
  if (stripped.length === 0 || /^[\s\n]*$/.test(stripped)) return true;
  if (/\[bot\]$/.test(authorLogin)) return true;
  if (/^(dependabot|renovate|codecov|sonarcloud|vercel|netlify|github-actions)/i.test(authorLogin))
    return true;
  return false;
}

function partitionReviewFeedback(pr: PullRequest): FeedbackSections {
  const automatedItems: AutomatedReviewItem[] = [];
  const humanReviews: PullRequest['reviews'] = [];
  const humanComments: PullRequest['comments'] = [];
  let suppressedBotComments = 0;

  for (const review of pr.reviews) {
    const vendor = detectAutomatedReviewVendor(review.author.login, review.body);
    if (vendor) {
      automatedItems.push({
        key: `review:${review.id}`,
        kind: 'review',
        vendor,
        authorLogin: review.author.login,
        body: review.body,
        timestamp: review.submittedAt,
        reviewState: review.state,
      });
      continue;
    }

    humanReviews.push(review);
  }

  for (const comment of pr.comments) {
    const vendor = detectAutomatedReviewVendor(comment.author.login, comment.body);
    if (vendor) {
      automatedItems.push({
        key: `comment:${comment.id}`,
        kind: 'comment',
        vendor,
        authorLogin: comment.author.login,
        body: comment.body,
        timestamp: comment.createdAt,
      });
      continue;
    }

    if (isBotNoise(comment.body, comment.author.login)) {
      suppressedBotComments += 1;
      continue;
    }

    humanComments.push(comment);
  }

  automatedItems.sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));

  return {
    automatedItems,
    humanReviews,
    humanComments,
    suppressedBotComments,
  };
}

const DETAIL_GROUP_LABELS: Record<DetailItemKind, string> = {
  overview: 'SNAPSHOT',
  agent: 'AGENT FEEDBACK',
  review: 'REVIEWS',
  comment: 'COMMENTS',
  check: 'CI WATCH',
};

function formatDecision(decision: PullRequest['reviewDecision']): string {
  return decision ? decision.replace(/_/g, ' ').toLowerCase() : 'awaiting review';
}

function reviewDecisionColor(decision: PullRequest['reviewDecision']): string {
  switch (decision) {
    case 'APPROVED':
      return semantic.success;
    case 'CHANGES_REQUESTED':
      return semantic.error;
    case 'REVIEW_REQUIRED':
      return semantic.warning;
    default:
      return semantic.muted;
  }
}

function joinSummary(values: Array<string | undefined>, fallback: string): string {
  const filtered = values.filter((value): value is string => Boolean(value?.trim()));
  return filtered.length > 0 ? filtered.join(', ') : fallback;
}

function summarizeChecks(pr: PullRequest): string {
  if (pr.checks.length === 0) return 'none';
  const passing = pr.checks.filter(
    check =>
      check.status === 'COMPLETED' &&
      (check.conclusion === 'SUCCESS' ||
        check.conclusion === 'NEUTRAL' ||
        check.conclusion === 'SKIPPED')
  ).length;
  const failing = pr.checks.filter(check => check.conclusion === 'FAILURE').length;
  const running = pr.checks.filter(check => check.status !== 'COMPLETED').length;
  const parts = [`${passing}/${pr.checks.length} passing`];
  if (failing > 0) parts.push(`${failing} failing`);
  if (running > 0) parts.push(`${running} running`);
  return parts.join(' · ');
}

function reviewerSummary(pr: PullRequest): string {
  return joinSummary(
    (pr.reviewRequests ?? []).map(request => request.login ?? request.slug ?? request.name),
    'none'
  );
}

function cleanBody(text: string, fallback: string): string {
  const stripped = stripMarkup(text);
  return stripped.length > 0 ? stripped : fallback;
}

function checkStatusDescriptor(check: PrCheck): {
  label: string;
  color: string;
  icon: string;
} {
  if (check.status !== 'COMPLETED') {
    return {
      label: check.status === 'IN_PROGRESS' ? 'running' : check.status.toLowerCase(),
      color: semantic.warning,
      icon: checkIndicators.pending.symbol,
    };
  }

  switch (check.conclusion) {
    case 'FAILURE':
      return { label: 'failure', color: semantic.error, icon: checkIndicators.failing.symbol };
    case 'CANCELLED':
      return { label: 'cancelled', color: semantic.muted, icon: checkIndicators.skipped.symbol };
    case 'SUCCESS':
      return { label: 'success', color: semantic.success, icon: checkIndicators.passing.symbol };
    case 'NEUTRAL':
      return { label: 'neutral', color: semantic.muted, icon: checkIndicators.skipped.symbol };
    case 'SKIPPED':
      return { label: 'skipped', color: semantic.muted, icon: checkIndicators.skipped.symbol };
    default:
      return { label: 'pending', color: semantic.warning, icon: checkIndicators.pending.symbol };
  }
}

function surfacedChecks(pr: PullRequest): PrCheck[] {
  const actionable = pr.checks.filter(
    check =>
      check.status !== 'COMPLETED' ||
      check.conclusion === 'FAILURE' ||
      check.conclusion === 'CANCELLED'
  );
  if (actionable.length > 0) return actionable;
  return pr.checks.slice(0, Math.min(3, pr.checks.length));
}

export function buildDetailItems(pr: PullRequest): DetailItem[] {
  const feedback = partitionReviewFeedback(pr);
  const items: DetailItem[] = [
    {
      key: 'overview',
      kind: 'overview',
      title: 'PR Snapshot',
      subtitle: formatDecision(pr.reviewDecision),
      timestamp: pr.updatedAt,
      icon: icons.dashboard,
      accent: palette.electricPurple,
      body: cleanBody(pr.body, 'No pull request description.'),
      meta: [
        { label: 'Author', value: pr.author.login, color: palette.neonCyan },
        {
          label: 'Review',
          value: formatDecision(pr.reviewDecision),
          color: reviewDecisionColor(pr.reviewDecision),
        },
        {
          label: 'Checks',
          value: summarizeChecks(pr),
          color: pr.checks.some(check => check.conclusion === 'FAILURE')
            ? semantic.error
            : semantic.muted,
        },
        { label: 'Requested', value: reviewerSummary(pr), color: semantic.info },
        {
          label: 'Labels',
          value: joinSummary(
            pr.labels.map(label => label.name),
            'none'
          ),
          color: semantic.warning,
        },
      ],
    },
  ];

  for (const item of feedback.automatedItems) {
    const kind = automatedItemKindStyle(item);
    items.push({
      key: item.key,
      kind: 'agent',
      title: `${item.vendor.label} ${kind.label}`,
      subtitle: item.authorLogin,
      timestamp: item.timestamp,
      icon: item.vendor.icon,
      accent: item.vendor.color,
      body: cleanBody(item.body, 'No automated review details.'),
      meta: [
        { label: 'Agent', value: item.vendor.label, color: item.vendor.color },
        { label: 'Author', value: item.authorLogin, color: palette.neonCyan },
        { label: 'State', value: kind.label, color: kind.color },
      ],
    });
  }

  for (const review of feedback.humanReviews) {
    const style = reviewStateStyle(review.state);
    items.push({
      key: `review:${review.id}`,
      kind: 'review',
      title: review.author.login,
      subtitle: style.label,
      timestamp: review.submittedAt,
      icon: style.symbol,
      accent: style.color,
      body: cleanBody(review.body, 'No review body.'),
      meta: [
        { label: 'Reviewer', value: review.author.login, color: palette.neonCyan },
        { label: 'State', value: style.label, color: style.color },
      ],
    });
  }

  for (const comment of feedback.humanComments) {
    items.push({
      key: `comment:${comment.id}`,
      kind: 'comment',
      title: comment.author.login,
      subtitle: 'comment',
      timestamp: comment.createdAt,
      icon: icons.comment,
      accent: palette.coral,
      body: cleanBody(comment.body, 'No comment body.'),
      meta: [
        { label: 'Author', value: comment.author.login, color: palette.neonCyan },
        { label: 'Kind', value: 'comment', color: palette.coral },
      ],
    });
  }

  for (const check of surfacedChecks(pr)) {
    const status = checkStatusDescriptor(check);
    items.push({
      key: `check:${check.name}`,
      kind: 'check',
      title: check.name,
      subtitle: status.label,
      icon: status.icon,
      accent: status.color,
      body: cleanBody(
        joinSummary([check.workflowName, check.detailsUrl], 'No additional CI details.'),
        'No additional CI details.'
      ),
      meta: [
        { label: 'Status', value: status.label, color: status.color },
        ...(check.workflowName
          ? [{ label: 'Workflow', value: check.workflowName, color: semantic.info }]
          : []),
      ],
    });
  }

  return items;
}

export function findRelativeReviewItemIndex(
  items: DetailItem[],
  currentIndex: number,
  delta: -1 | 1
): number {
  const reviewIndexes = items
    .map((item, index) => (item.kind === 'agent' || item.kind === 'review' ? index : -1))
    .filter(index => index >= 0);
  if (reviewIndexes.length === 0) return currentIndex;

  if (delta < 0) {
    for (let index = reviewIndexes.length - 1; index >= 0; index -= 1) {
      const reviewIndex = reviewIndexes[index];
      if (reviewIndex !== undefined && reviewIndex < currentIndex) {
        return reviewIndex;
      }
    }
    return reviewIndexes[0] ?? currentIndex;
  }

  for (const reviewIndex of reviewIndexes) {
    if (reviewIndex !== undefined && reviewIndex > currentIndex) {
      return reviewIndex;
    }
  }
  return reviewIndexes[reviewIndexes.length - 1] ?? currentIndex;
}

function wrapTextLines(text: string, width: number): string[] {
  const normalized = text.replace(/\r/g, '');
  const paragraphs = normalized.split('\n');
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph.trim().length === 0) {
      if (lines.length === 0 || lines[lines.length - 1] !== '') {
        lines.push('');
      }
      continue;
    }

    let current = '';
    for (const word of paragraph.split(/\s+/)) {
      if (current.length === 0) {
        current = word;
        continue;
      }

      if (`${current} ${word}`.length <= width) {
        current = `${current} ${word}`;
        continue;
      }

      lines.push(current);
      current = word;
    }

    if (current.length > 0) {
      lines.push(current);
    }
  }

  return lines.length > 0 ? lines : [''];
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

/** Get color, symbol, and label for a review state. */
function reviewStateStyle(state: string): { color: string; symbol: string; label: string } {
  switch (state) {
    case 'APPROVED':
      return { color: semantic.success, symbol: checkIndicators.passing.symbol, label: 'approved' };
    case 'CHANGES_REQUESTED':
      return {
        color: semantic.error,
        symbol: checkIndicators.failing.symbol,
        label: 'changes requested',
      };
    default:
      return {
        color: semantic.muted,
        symbol: checkIndicators.pending.symbol,
        label: state.toLowerCase(),
      };
  }
}

/** Build content lines for a single review entry. */
function buildSingleReviewLines(
  review: PullRequest['reviews'][number],
  w: number,
  c: string
): ContentLine[] {
  const { color, symbol, label } = reviewStateStyle(review.state);
  const lines: ContentLine[] = [
    spacedCardRow(
      `review-${review.id}`,
      <Text>
        <Text color={color}>{symbol} </Text>
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
    ),
  ];

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

  return lines;
}

function buildReviewsCard(reviews: PullRequest['reviews'], w: number): ContentLine[] {
  const c = palette.electricPurple;
  const lines: ContentLine[] = [];

  const approved = reviews.filter(r => r.state === 'APPROVED').length;
  const changes = reviews.filter(r => r.state === 'CHANGES_REQUESTED').length;
  const parts: string[] = [`${reviews.length}`];
  if (approved > 0) parts.push(`${checkIndicators.passing.symbol}${approved}`);
  if (changes > 0) parts.push(`${checkIndicators.failing.symbol}${changes}`);
  const sub = reviews.length > 0 ? `(${parts.join(' \u00B7 ')})` : '(none)';

  lines.push(cardTop('reviews-top', 'Reviews', sub, w, c));

  if (reviews.length === 0) {
    lines.push(
      cardRow(
        'reviews-empty',
        <Text color={semantic.dim} italic>
          No human reviews yet
        </Text>,
        w,
        c
      )
    );
  } else {
    for (const review of reviews) {
      lines.push(...buildSingleReviewLines(review, w, c));
    }
  }

  lines.push(cardBottom('reviews-bottom', w, c));
  return lines;
}

function automatedItemKindStyle(item: AutomatedReviewItem): {
  color: string;
  symbol: string;
  label: string;
} {
  if (item.kind === 'review' && item.reviewState) {
    return reviewStateStyle(item.reviewState);
  }

  return {
    color: semantic.muted,
    symbol: icons.comment,
    label: 'comment',
  };
}

function buildAutomatedFeedbackCard(items: AutomatedReviewItem[], w: number): ContentLine[] {
  if (items.length === 0) return [];

  const c = palette.neonCyan;
  const lines: ContentLine[] = [];
  const shown = items.slice(0, MAX_AGENT_ITEMS);
  const hiddenCount = Math.max(0, items.length - shown.length);
  const activeVendors = new Set<AutomatedReviewVendorId>(items.map(item => item.vendor.id));

  lines.push(
    cardTop(
      'agent-feedback-top',
      `${icons.cogs} Agent Feedback`,
      activeVendors.size > 1
        ? `(${items.length} \u00B7 ${activeVendors.size} agents)`
        : `(${items.length})`,
      w,
      c
    )
  );

  if (hiddenCount > 0) {
    lines.push(
      cardRow(
        'agent-feedback-hidden',
        <Text color={semantic.dim}>
          {`${icons.ellipsis} ${hiddenCount} earlier item${hiddenCount !== 1 ? 's' : ''}`}
        </Text>,
        w,
        c
      )
    );
  }

  for (let index = 0; index < shown.length; index += 1) {
    const item = shown[index];
    if (!item) continue;

    if (index > 0) {
      lines.push(cardBlank(`agent-feedback-sep-${item.key}`, w, c));
    }

    const kind = automatedItemKindStyle(item);
    lines.push(
      spacedCardRow(
        `agent-feedback-header-${item.key}`,
        <Text wrap="truncate-end">
          <Text color={item.vendor.color} bold>
            {item.vendor.icon} {item.vendor.label}
          </Text>
          <Text color={semantic.dim}>{' · '}</Text>
          <Text color={palette.neonCyan} bold>
            {item.authorLogin}
          </Text>
          <Text color={semantic.dim}>{' · '}</Text>
          <Text color={kind.color}>
            {kind.symbol} {kind.label}
          </Text>
        </Text>,
        <Text color={semantic.timestamp} dimColor>
          {timeAgo(item.timestamp)}
        </Text>,
        w,
        c
      )
    );

    const bodyLines = stripMarkup(item.body)
      .split('\n')
      .filter(line => line.trim().length > 0)
      .slice(0, MAX_AGENT_BODY);

    for (let lineIndex = 0; lineIndex < bodyLines.length; lineIndex += 1) {
      const line = bodyLines[lineIndex];
      if (!line) continue;
      lines.push(
        cardRow(
          `agent-feedback-body-${item.key}-${lineIndex}`,
          <Text color={semantic.muted} wrap="truncate-end">
            {`  ${truncate(line, w - 10)}`}
          </Text>,
          w,
          c
        )
      );
    }
  }

  lines.push(cardBottom('agent-feedback-bottom', w, c));
  return lines;
}

// ─── Section: CI Checks ──────────────────────────────────────────────

/** Build a single check row with the given indicator style. */
function buildCheckRow(
  prefix: string,
  check: PullRequest['checks'][number],
  indicator: { color: string; symbol: string },
  statusText: JSX.Element,
  w: number,
  c: string,
  nameStyle?: string
): ContentLine {
  return spacedCardRow(
    `ci-${prefix}-${check.name}`,
    <Text>
      <Text color={indicator.color}>{`${indicator.symbol} `}</Text>
      <Text color={nameStyle ?? palette.fg} bold={prefix === 'fail'}>
        {truncate(check.name, w - 20)}
      </Text>
    </Text>,
    statusText,
    w,
    c
  );
}

/** Build CI progress bar as a content line. */
function buildCIProgressBar(
  passing: number,
  failing: number,
  running: number,
  total: number,
  w: number,
  c: string
): ContentLine {
  const barWidth = Math.min(w - 8, 40);
  const passN = Math.round((passing / total) * barWidth);
  const failN = Math.round((failing / total) * barWidth);
  const runN = running > 0 ? Math.max(1, Math.round((running / total) * barWidth)) : 0;
  const emptyN = Math.max(0, barWidth - passN - failN - runN);

  return cardRow(
    'ci-bar',
    <Text>
      {passN > 0 && <Text color={semantic.success}>{'\u2588'.repeat(passN)}</Text>}
      {failN > 0 && <Text color={semantic.error}>{'\u2588'.repeat(failN)}</Text>}
      {runN > 0 && <Text color={semantic.warning}>{'\u2588'.repeat(runN)}</Text>}
      {emptyN > 0 && <Text color={semantic.dim}>{'\u2591'.repeat(emptyN)}</Text>}
    </Text>,
    w,
    c
  );
}

/** Build passing check rows, collapsing if there are many. */
function buildPassingCheckRows(
  passing: PullRequest['checks'],
  w: number,
  c: string
): ContentLine[] {
  const lines: ContentLine[] = [];
  const indicator = checkIndicators.passing;
  const statusEl = (
    <Text color={semantic.success} dimColor>
      success
    </Text>
  );

  if (passing.length <= MAX_INLINE_PASSING) {
    for (const check of passing) {
      lines.push(buildCheckRow('pass', check, indicator, statusEl, w, c, semantic.muted));
    }
  } else {
    for (let i = 0; i < 3; i++) {
      const check = passing[i];
      if (!check) break;
      lines.push(buildCheckRow('pass', check, indicator, statusEl, w, c, semantic.muted));
    }
    const rest = passing.length - 3;
    lines.push(
      cardRow(
        'ci-pass-more',
        <Text color={semantic.success} dimColor>
          {`${indicator.symbol} ${icons.ellipsis} and ${rest} more passing`}
        </Text>,
        w,
        c
      )
    );
  }

  return lines;
}

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
    lines.push(buildCIProgressBar(passing.length, failing.length, running.length, total, w, c));

    for (const check of failing) {
      lines.push(
        buildCheckRow(
          'fail',
          check,
          checkIndicators.failing,
          <Text color={semantic.error} bold>
            FAILURE
          </Text>,
          w,
          c
        )
      );
    }

    for (const check of running) {
      const label = check.status === 'IN_PROGRESS' ? 'running' : check.status.toLowerCase();
      lines.push(
        buildCheckRow(
          'run',
          check,
          checkIndicators.pending,
          <Text color={semantic.warning}>{label}</Text>,
          w,
          c
        )
      );
    }

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

    lines.push(...buildPassingCheckRows(passing, w, c));
  }

  lines.push(cardBottom('ci-bottom', w, c));
  return lines;
}

// ─── Section: Comments ───────────────────────────────────────────────

function buildCommentsCard(
  comments: PullRequest['comments'],
  suppressedBotComments: number,
  w: number
): ContentLine[] {
  const c = palette.coral;
  const lines: ContentLine[] = [];

  let sub = `(${comments.length})`;
  if (suppressedBotComments > 0) sub = `(${comments.length} \u00B7 ${suppressedBotComments} bot)`;

  lines.push(cardTop('comments-top', 'Comments', sub, w, c));

  if (comments.length === 0) {
    lines.push(
      cardRow(
        'comments-empty',
        <Text color={semantic.dim} italic>
          {suppressedBotComments > 0 ? 'No human comments' : 'No comments'}
        </Text>,
        w,
        c
      )
    );
  } else {
    const shown = comments.slice(-MAX_COMMENTS);
    const hiddenCount = comments.length - shown.length;

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
          <Text color={semantic.success}> {icons.middleDot} NO CONFLICTS</Text>
        )}
        {(() => {
          const status = mergeStatusStyle(pr.mergeStateStatus);
          if (!status) return null;
          return (
            <Text color={status.color}>
              {' '}
              {icons.middleDot} {status.label}
            </Text>
          );
        })()}
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

function buildOverviewDetailLines(pr: PullRequest, width: number): ContentLine[] {
  const lines: ContentLine[] = [];
  const feedback = partitionReviewFeedback(pr);

  // Conflict card (always full width)
  const conflict = buildConflictCard(pr, width);
  if (conflict.length > 0) {
    lines.push(...conflict);
    lines.push(gap('conflict-gap'));
  }

  const automatedFeedback = buildAutomatedFeedbackCard(feedback.automatedItems, width);
  if (automatedFeedback.length > 0) {
    lines.push(...automatedFeedback);
    lines.push(gap('agent-feedback-gap'));
  }

  // Two-column layout for Reviews + CI on wide terminals
  if (width >= TWO_COL_MIN_WIDTH) {
    const colGap = 2;
    const leftW = Math.floor((width - colGap) / 2);
    const rightW = width - leftW - colGap;

    const reviews = buildReviewsCard(feedback.humanReviews, leftW);
    const ci = buildCICard(pr, rightW);

    lines.push(...mergeColumns(reviews, ci, leftW, rightW, width, colGap));
    lines.push(gap('reviews-ci-gap'));
  } else {
    lines.push(...buildReviewsCard(feedback.humanReviews, width));
    lines.push(gap('reviews-gap'));

    lines.push(...buildCICard(pr, width));
    lines.push(gap('ci-gap'));
  }

  // Comments (full width — text content benefits from space)
  lines.push(...buildCommentsCard(feedback.humanComments, feedback.suppressedBotComments, width));

  // Labels (full width)
  const labels = buildLabelsCard(pr, width);
  if (labels.length > 0) {
    lines.push(gap('labels-gap'));
    lines.push(...labels);
  }

  return lines;
}

function computeWindowOffset(target: number, total: number, visible: number): number {
  if (visible >= total) return 0;
  const centered = target - Math.floor(visible / 2);
  return Math.max(0, Math.min(total - visible, centered));
}

function buildNavigatorRows(items: DetailItem[]): NavigatorRow[] {
  const rows: NavigatorRow[] = [];
  let previousKind: DetailItemKind | null = null;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item) continue;

    if (item.kind !== previousKind) {
      rows.push({
        key: `nav-section-${item.kind}`,
        kind: 'section',
        label: DETAIL_GROUP_LABELS[item.kind],
      });
      previousKind = item.kind;
    }

    rows.push({
      key: `nav-item-${item.key}`,
      kind: 'item',
      label: item.title,
      itemIndex: index,
      item,
    });
  }

  return rows;
}

function visibleNavigatorWindow(
  items: DetailItem[],
  height: number,
  selectedIndex: number
): { rows: NavigatorRow[]; offset: number } {
  const rows = buildNavigatorRows(items);
  const selectedLine = Math.max(
    0,
    rows.findIndex(row => row.kind === 'item' && row.itemIndex === selectedIndex)
  );
  const bodyVisible = Math.max(1, height - PANEL_CHROME_LINES);
  const offset = computeWindowOffset(selectedLine, rows.length, bodyVisible);

  return { rows, offset };
}

export function detailNavigatorItemIndexAtRow(
  items: DetailItem[],
  height: number,
  selectedIndex: number,
  bodyRow: number
): number | null {
  const { rows, offset } = visibleNavigatorWindow(items, height, selectedIndex);
  const row = rows[offset + bodyRow];
  return row?.kind === 'item' ? (row.itemIndex ?? null) : null;
}

function buildNavigatorBodyLines(
  items: DetailItem[],
  width: number,
  selectedIndex: number,
  borderColor: string
): { lines: ContentLine[]; selectedLine: number } {
  const lines: ContentLine[] = [];
  let selectedLine = 0;
  const rows = buildNavigatorRows(items);

  for (let lineIndex = 0; lineIndex < rows.length; lineIndex += 1) {
    const row = rows[lineIndex];
    if (!row) continue;

    if (row.kind === 'section') {
      lines.push(
        cardRow(
          row.key,
          <Text color={semantic.dim} bold>
            {row.label}
          </Text>,
          width,
          borderColor
        )
      );
      continue;
    }

    const item = row.item;
    if (!item) continue;

    const isSelected = row.itemIndex === selectedIndex;
    if (isSelected) selectedLine = lineIndex;

    lines.push(
      spacedCardRow(
        row.key,
        <Text wrap="truncate-end">
          <Text color={isSelected ? item.accent : semantic.dim}>{isSelected ? '▸ ' : '  '}</Text>
          <Text color={isSelected ? item.accent : semantic.muted}>{item.icon}</Text>
          <Text color={isSelected ? palette.fg : semantic.muted} bold={isSelected}>
            {` ${item.title}`}
          </Text>
          {item.subtitle && (
            <Text color={semantic.dim}>{` ${icons.middleDot} ${truncate(item.subtitle, 18)}`}</Text>
          )}
        </Text>,
        item.timestamp ? (
          <Text color={isSelected ? semantic.timestamp : semantic.dim} dimColor={!isSelected}>
            {timeAgo(item.timestamp)}
          </Text>
        ) : (
          <Text color={semantic.dim}> </Text>
        ),
        width,
        borderColor
      )
    );
  }

  return { lines, selectedLine };
}

function buildNavigatorPanelLines(
  items: DetailItem[],
  width: number,
  height: number,
  selectedIndex: number,
  focus: DetailFocus
): ContentLine[] {
  const borderColor = focus === 'navigator' ? palette.electricPurple : semantic.dim;
  const { lines: bodyLines, selectedLine } = buildNavigatorBodyLines(
    items,
    width,
    selectedIndex,
    borderColor
  );
  const bodyVisible = Math.max(1, height - PANEL_CHROME_LINES);
  const offset = computeWindowOffset(selectedLine, bodyLines.length, bodyVisible);
  const visible = bodyLines.slice(offset, offset + bodyVisible);
  const fillerCount = Math.max(0, bodyVisible - visible.length);

  return [
    cardTop(
      'detail-nav-top',
      `${icons.list} Review Lane`,
      `(${selectedIndex + 1}/${items.length}${focus === 'navigator' ? ' · nav' : ''})`,
      width,
      borderColor
    ),
    ...visible,
    ...Array.from({ length: fillerCount }, (_, index) =>
      cardBlank(`detail-nav-fill-${index}`, width, borderColor)
    ),
    cardBottom('detail-nav-bottom', width, borderColor),
  ];
}

function inspectorTitle(item: DetailItem): string {
  return `${item.icon} ${item.title}`;
}

function buildInspectorHeaderLines(
  item: DetailItem,
  width: number,
  borderColor: string,
  selectedIndex: number,
  totalItems: number
): ContentLine[] {
  const lines: ContentLine[] = [
    cardTop(
      'detail-inspector-top',
      inspectorTitle(item),
      `(${selectedIndex + 1}/${totalItems})`,
      width,
      borderColor
    ),
  ];

  if (item.subtitle.length > 0) {
    lines.push(
      cardRow(
        'detail-inspector-subtitle',
        <Text color={item.accent} bold wrap="truncate-end">
          {item.subtitle}
        </Text>,
        width,
        borderColor
      )
    );
  }

  for (let index = 0; index < item.meta.length; index += 1) {
    const meta = item.meta[index];
    if (!meta) continue;
    lines.push(
      spacedCardRow(
        `detail-inspector-meta-${meta.label}-${index}`,
        <Text wrap="truncate-end">
          <Text color={semantic.dim}>{meta.label}</Text>
        </Text>,
        <Text color={meta.color ?? semantic.muted} wrap="truncate-end">
          {truncate(meta.value, Math.max(12, width - 20))}
        </Text>,
        width,
        borderColor
      )
    );
  }

  return lines;
}

function buildInspectorBodyLines(pr: PullRequest, item: DetailItem, width: number): ContentLine[] {
  if (item.kind === 'overview') {
    return buildOverviewDetailLines(pr, width);
  }

  const borderColor = item.accent;
  const wrapped = wrapTextLines(item.body, Math.max(12, width - 6));
  return wrapped.map((line, index) =>
    cardRow(
      `detail-inspector-body-${item.key}-${index}`,
      <Text color={line.length === 0 ? semantic.dim : semantic.muted}>
        {line.length === 0 ? ' ' : line}
      </Text>,
      width,
      borderColor
    )
  );
}

function buildInspectorPanelLines(
  pr: PullRequest,
  item: DetailItem,
  width: number,
  height: number,
  focus: DetailFocus,
  scrollOffset: number,
  selectedIndex: number,
  totalItems: number
): {
  lines: ContentLine[];
  clampedOffset: number;
  totalBodyLines: number;
  visibleBodyLines: number;
} {
  const borderColor = focus === 'inspector' ? item.accent : semantic.dim;
  const headerLines = buildInspectorHeaderLines(
    item,
    width,
    borderColor,
    selectedIndex,
    totalItems
  );
  const bodyLines = buildInspectorBodyLines(pr, item, width);
  const visibleBodyLines = Math.max(1, height - headerLines.length - 1);
  const maxScroll = Math.max(0, bodyLines.length - visibleBodyLines);
  const clampedOffset = Math.min(scrollOffset, maxScroll);
  const visibleBody = bodyLines.slice(clampedOffset, clampedOffset + visibleBodyLines);
  const fillerCount = Math.max(0, visibleBodyLines - visibleBody.length);

  return {
    lines: [
      ...headerLines,
      ...visibleBody,
      ...Array.from({ length: fillerCount }, (_, index) =>
        cardBlank(`detail-inspector-fill-${index}`, width, borderColor)
      ),
      cardBottom('detail-inspector-bottom', width, borderColor),
    ],
    clampedOffset,
    totalBodyLines: bodyLines.length,
    visibleBodyLines,
  };
}

interface DetailPanelLayout {
  isWide: boolean;
  panelGap: number;
  navigatorWidth: number;
  inspectorWidth: number;
  navigatorHeight: number;
  inspectorHeight: number;
}

export function resolveDetailPanelLayout(
  contentWidth: number,
  availableHeight: number
): DetailPanelLayout {
  const isWide = contentWidth >= DETAIL_PANEL_BREAKPOINT;
  const panelGap = isWide ? 2 : 0;
  const navigatorWidth = isWide
    ? Math.max(34, Math.floor((contentWidth - panelGap) * 0.34))
    : contentWidth;
  const inspectorWidth = isWide ? contentWidth - navigatorWidth - panelGap : contentWidth;
  const navigatorHeight = isWide
    ? availableHeight
    : Math.min(
        STACKED_NAVIGATOR_MAX_HEIGHT,
        Math.max(STACKED_NAVIGATOR_MIN_HEIGHT, Math.floor(availableHeight * 0.35))
      );
  const inspectorHeight = isWide
    ? availableHeight
    : Math.max(1, availableHeight - navigatorHeight - 1);

  return {
    isWide,
    panelGap,
    navigatorWidth,
    inspectorWidth,
    navigatorHeight,
    inspectorHeight,
  };
}

export function detailHeaderLineCount(pr: PullRequest, hasAgentActivity: boolean): number {
  return 6 + (hasAgentActivity ? 1 : 0) + (pr.worktree ? 1 : 0);
}

export function measureDetailViewport(
  pr: PullRequest,
  contentWidth: number,
  termRows: number,
  hasAgentActivity: boolean
): {
  headerLineCount: number;
  availableHeight: number;
  layout: DetailPanelLayout;
} {
  const headerLineCount = detailHeaderLineCount(pr, hasAgentActivity);
  const availableHeight = Math.max(1, termRows - headerLineCount - CHROME_LINES);

  return {
    headerLineCount,
    availableHeight,
    layout: resolveDetailPanelLayout(contentWidth, availableHeight),
  };
}

function renderPanelLines(lines: ContentLine[]): JSX.Element {
  return (
    <>
      {lines.map(line => (
        <Box key={line.key}>{line.element}</Box>
      ))}
    </>
  );
}

function DetailPanels({
  layout,
  navigatorLines,
  inspectorLines,
}: {
  layout: DetailPanelLayout;
  navigatorLines: ContentLine[];
  inspectorLines: ContentLine[];
}): JSX.Element {
  if (layout.isWide) {
    return (
      <Box gap={layout.panelGap} flexGrow={1}>
        <Box flexDirection="column">{renderPanelLines(navigatorLines)}</Box>
        <Box flexDirection="column" flexGrow={1}>
          {renderPanelLines(inspectorLines)}
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      {renderPanelLines(navigatorLines)}
      <Box height={1} />
      <Box flexDirection="column">{renderPanelLines(inspectorLines)}</Box>
    </Box>
  );
}

export const _internal = {
  detectAutomatedReviewVendor,
  partitionReviewFeedback,
  isBotNoise,
  buildDetailItems,
  findRelativeReviewItemIndex,
  detailHeaderLineCount,
};

// ─── Hook: Line Count for Scroll Max ─────────────────────────────────

export function useDetailLineCount(): number {
  const focusedPr = useStore(vigilStore, s => s.focusedPr);
  const detailSelection = useStore(vigilStore, s => s.detailSelection);
  const prs = useStore(vigilStore, s => s.prs);
  const radarPrs = useStore(vigilStore, s => s.radarPrs);
  const mergedRadarPrs = useStore(vigilStore, s => s.mergedRadarPrs);
  const { stdout } = useStdout();
  const termWidth = stdout.columns ?? 80;
  const contentWidth = termWidth - 2;
  const pr = focusedPr
    ? (prs.get(focusedPr) ?? radarPrs.get(focusedPr)?.pr ?? mergedRadarPrs.get(focusedPr)?.pr)
    : undefined;

  return useMemo(() => {
    if (!pr) return 0;
    const items = buildDetailItems(pr);
    const selected = items[Math.max(0, Math.min(items.length - 1, detailSelection))] ?? items[0];
    if (!selected) return 0;
    return buildInspectorBodyLines(pr, selected, contentWidth).length;
  }, [pr, contentWidth, detailSelection]);
}

function DetailPlaceholder({ message }: { message: string }): JSX.Element {
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box paddingX={1}>
        <Text>
          <Text color={semantic.dim}>{'Esc'}</Text>
          <Text color={semantic.dim}>{' ‹ '}</Text>
          <Text color={semantic.muted}>Dashboard</Text>
        </Text>
      </Box>
      <Box flexGrow={1} justifyContent="center" alignItems="center">
        <Text color={semantic.muted}>{message}</Text>
      </Box>
      <KeybindBar />
    </Box>
  );
}

// ─── Main Component ─────────────────────────────────────────────────

export function PrDetail(): JSX.Element | null {
  const focusedPr = useStore(vigilStore, s => s.focusedPr);
  const detailFocus = useStore(vigilStore, s => s.detailFocus);
  const detailSelection = useStore(vigilStore, s => s.detailSelection);
  const setDetailSelection = useStore(vigilStore, s => s.setDetailSelection);
  const prs = useStore(vigilStore, s => s.prs);
  const prStates = useStore(vigilStore, s => s.prStates);
  const radarPrs = useStore(vigilStore, s => s.radarPrs);
  const mergedRadarPrs = useStore(vigilStore, s => s.mergedRadarPrs);
  const activeAgents = useStore(vigilStore, s => s.activeAgents);
  const scrollOffset = useStore(vigilStore, s => s.scrollOffsets.detail);
  const { stdout } = useStdout();
  const termWidth = stdout.columns ?? 80;
  const termRows = stdout.rows ?? 24;
  const contentWidth = termWidth - 2;
  const cachedByKey = useRef<Map<string, PullRequest>>(new Map());

  const radar = focusedPr ? (radarPrs.get(focusedPr) ?? mergedRadarPrs.get(focusedPr)) : undefined;
  const livePr = focusedPr ? (prs.get(focusedPr) ?? radar?.pr) : undefined;

  useEffect(() => {
    if (!focusedPr || !livePr) return;
    cachedByKey.current.set(focusedPr, livePr);
  }, [focusedPr, livePr]);

  const pr = focusedPr ? (livePr ?? cachedByKey.current.get(focusedPr)) : undefined;
  const isRefreshing = Boolean(focusedPr && !livePr && pr);
  const state: PrState =
    focusedPr && pr
      ? (prStates.get(focusedPr) ??
        (radar?.topTier === 'direct' ? 'hot' : radar?.topTier === 'domain' ? 'waiting' : 'dormant'))
      : 'dormant';
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
  const detailItems = useMemo(() => (pr ? buildDetailItems(pr) : []), [pr]);
  const clampedSelection = Math.max(0, Math.min(detailItems.length - 1, detailSelection));
  const selectedItem = detailItems[clampedSelection] ?? detailItems[0];

  useEffect(() => {
    if (detailItems.length === 0) return;
    if (clampedSelection !== detailSelection) {
      setDetailSelection(clampedSelection);
    }
  }, [detailItems.length, clampedSelection, detailSelection, setDetailSelection]);

  if (!focusedPr) {
    return <DetailPlaceholder message="No pull request selected" />;
  }
  if (!pr) {
    return <DetailPlaceholder message="Loading pull request details..." />;
  }

  if (!selectedItem) {
    return <DetailPlaceholder message="No detail items available" />;
  }

  const viewport = measureDetailViewport(pr, contentWidth, termRows, Boolean(agentActivity));
  const layout = viewport.layout;

  const navigatorLines = buildNavigatorPanelLines(
    detailItems,
    layout.navigatorWidth,
    layout.navigatorHeight,
    clampedSelection,
    detailFocus
  );
  const inspector = buildInspectorPanelLines(
    pr,
    selectedItem,
    layout.inspectorWidth,
    layout.inspectorHeight,
    detailFocus,
    scrollOffset,
    clampedSelection,
    detailItems.length
  );

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* ── Breadcrumb ───────────────────────────────────────────── */}
      <Box paddingX={1}>
        <Text>
          <Text color={semantic.dim}>{'Esc'}</Text>
          <Text color={semantic.dim}>{' ‹ '}</Text>
          <Text color={semantic.muted}>Dashboard</Text>
          <Text color={semantic.dim}>{' › '}</Text>
          <Text color={palette.neonCyan}>{pr.repository.nameWithOwner}</Text>
          <Text color={semantic.dim}>{'#'}</Text>
          <Text color={palette.coral}>{pr.number}</Text>
          {isRefreshing && <Text color={semantic.warning}> {'· refreshing...'}</Text>}
        </Text>
      </Box>

      {/* ── Header Card (fixed) ─────────────────────────────────── */}
      <Box flexDirection="column" paddingX={1}>
        {headerLines.map(line => (
          <Box key={line.key}>{line.element}</Box>
        ))}
      </Box>

      {/* ── Interactive Detail Panels ───────────────────────────── */}
      <Box flexDirection="column" paddingX={1} flexGrow={1}>
        <DetailPanels
          layout={layout}
          navigatorLines={navigatorLines}
          inspectorLines={inspector.lines}
        />
      </Box>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <ScrollIndicator
        current={inspector.clampedOffset}
        total={inspector.totalBodyLines}
        visible={inspector.visibleBodyLines}
      />
      <KeybindBar />
    </Box>
  );
}
