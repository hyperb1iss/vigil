import type { PrEvent } from '../types/events.js';
import type { PullRequest } from '../types/pr.js';

/**
 * Compare previous and current PR snapshots, emit granular events
 * for everything that changed.
 */
export function diffPrs(
  previous: Map<string, PullRequest>,
  current: Map<string, PullRequest>
): PrEvent[] {
  const events: PrEvent[] = [];
  const now = new Date().toISOString();

  for (const [key, pr] of current) {
    const prev = previous.get(key);
    if (!prev) {
      events.push({ type: 'pr_opened', prKey: key, pr, timestamp: now });
      continue;
    }
    diffSinglePr(key, prev, pr, now, events);
  }

  // PRs that disappeared (closed/merged externally)
  for (const [key, prev] of previous) {
    if (!current.has(key)) {
      events.push({ type: 'pr_closed', prKey: key, pr: prev, timestamp: now });
    }
  }

  return events;
}

/** Diff a single PR against its previous snapshot. */
function diffSinglePr(
  key: string,
  prev: PullRequest,
  pr: PullRequest,
  now: string,
  events: PrEvent[]
): void {
  diffStateTransitions(key, prev, pr, now, events);
  diffDraftTransitions(key, prev, pr, now, events);
  diffNewReviews(key, prev, pr, now, events);
  diffNewComments(key, prev, pr, now, events);
  diffCheckChanges(key, prev, pr, now, events);
  diffConflicts(key, prev, pr, now, events);
  diffLabels(key, prev, pr, now, events);

  if (isReadyToMerge(pr) && !isReadyToMerge(prev)) {
    events.push({ type: 'ready_to_merge', prKey: key, pr, timestamp: now });
  }
}

function diffStateTransitions(
  key: string,
  prev: PullRequest,
  pr: PullRequest,
  now: string,
  events: PrEvent[]
): void {
  if (prev.state === 'OPEN' && pr.state === 'MERGED') {
    events.push({ type: 'pr_merged', prKey: key, pr, timestamp: now });
  } else if (prev.state === 'OPEN' && pr.state === 'CLOSED') {
    events.push({ type: 'pr_closed', prKey: key, pr, timestamp: now });
  }
}

function diffDraftTransitions(
  key: string,
  prev: PullRequest,
  pr: PullRequest,
  now: string,
  events: PrEvent[]
): void {
  if (prev.isDraft && !pr.isDraft) {
    events.push({ type: 'undrafted', prKey: key, pr, timestamp: now });
  } else if (!prev.isDraft && pr.isDraft) {
    events.push({ type: 'became_draft', prKey: key, pr, timestamp: now });
  }
}

function diffNewReviews(
  key: string,
  prev: PullRequest,
  pr: PullRequest,
  now: string,
  events: PrEvent[]
): void {
  const prevIds = new Set(prev.reviews.map(r => r.id));
  for (const review of pr.reviews) {
    if (!prevIds.has(review.id)) {
      events.push({
        type: 'review_submitted',
        prKey: key,
        pr,
        timestamp: now,
        data: { type: 'review_submitted', review },
      });
    }
  }
}

function diffNewComments(
  key: string,
  prev: PullRequest,
  pr: PullRequest,
  now: string,
  events: PrEvent[]
): void {
  const prevIds = new Set(prev.comments.map(c => c.id));
  for (const comment of pr.comments) {
    if (!prevIds.has(comment.id)) {
      events.push({
        type: 'comment_added',
        prKey: key,
        pr,
        timestamp: now,
        data: { type: 'comment_added', comment },
      });
    }
  }
}

function diffCheckChanges(
  key: string,
  prev: PullRequest,
  pr: PullRequest,
  now: string,
  events: PrEvent[]
): void {
  if (checksChanged(prev, pr)) {
    events.push({
      type: 'checks_changed',
      prKey: key,
      pr,
      timestamp: now,
      data: { type: 'checks_changed', checks: pr.checks, previousChecks: prev.checks },
    });
  }
}

function diffConflicts(
  key: string,
  prev: PullRequest,
  pr: PullRequest,
  now: string,
  events: PrEvent[]
): void {
  if (prev.mergeable !== 'CONFLICTING' && pr.mergeable === 'CONFLICTING') {
    events.push({ type: 'conflict_detected', prKey: key, pr, timestamp: now });
  } else if (prev.mergeable === 'CONFLICTING' && pr.mergeable !== 'CONFLICTING') {
    events.push({ type: 'conflict_resolved', prKey: key, pr, timestamp: now });
  }
}

function diffLabels(
  key: string,
  prev: PullRequest,
  pr: PullRequest,
  now: string,
  events: PrEvent[]
): void {
  const prevLabels = new Set(prev.labels.map(l => l.name));
  const currLabels = new Set(pr.labels.map(l => l.name));
  const added = [...currLabels].filter(l => !prevLabels.has(l));
  const removed = [...prevLabels].filter(l => !currLabels.has(l));
  if (added.length > 0 || removed.length > 0) {
    events.push({
      type: 'labels_changed',
      prKey: key,
      pr,
      timestamp: now,
      data: { type: 'labels_changed', added, removed },
    });
  }
}

/** Check if any CI check conclusion changed between snapshots. */
function checksChanged(prev: PullRequest, curr: PullRequest): boolean {
  if (prev.checks.length !== curr.checks.length) return true;

  const prevMap = new Map(prev.checks.map(c => [c.name, c.conclusion]));
  return curr.checks.some(c => prevMap.get(c.name) !== c.conclusion);
}

/** Determine if a PR is in a "ready to merge" state. */
function isReadyToMerge(pr: PullRequest): boolean {
  const allGreen =
    pr.checks.length > 0 &&
    pr.checks.every(
      c => c.conclusion === 'SUCCESS' || c.conclusion === 'SKIPPED' || c.conclusion === 'NEUTRAL'
    );
  return allGreen && pr.reviewDecision === 'APPROVED' && pr.mergeable === 'MERGEABLE';
}
