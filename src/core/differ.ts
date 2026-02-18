import type { PrEvent } from '../types/events.js';
import type { PullRequest } from '../types/pr.js';

/**
 * Compare previous and current PR snapshots, emit granular events
 * for everything that changed.
 */
export function diffPrs(
  previous: Map<string, PullRequest>,
  current: Map<string, PullRequest>,
): PrEvent[] {
  const events: PrEvent[] = [];
  const now = new Date().toISOString();

  for (const [key, pr] of current) {
    const prev = previous.get(key);

    // New PR appeared
    if (!prev) {
      events.push({ type: 'pr_opened', prKey: key, pr, timestamp: now });
      continue;
    }

    // State transitions
    if (prev.state === 'OPEN' && pr.state === 'MERGED') {
      events.push({ type: 'pr_merged', prKey: key, pr, timestamp: now });
    } else if (prev.state === 'OPEN' && pr.state === 'CLOSED') {
      events.push({ type: 'pr_closed', prKey: key, pr, timestamp: now });
    }

    // Draft transitions
    if (prev.isDraft && !pr.isDraft) {
      events.push({ type: 'undrafted', prKey: key, pr, timestamp: now });
    } else if (!prev.isDraft && pr.isDraft) {
      events.push({ type: 'became_draft', prKey: key, pr, timestamp: now });
    }

    // New reviews
    const prevReviewIds = new Set(prev.reviews.map((r) => r.id));
    for (const review of pr.reviews) {
      if (!prevReviewIds.has(review.id)) {
        events.push({
          type: 'review_submitted',
          prKey: key,
          pr,
          timestamp: now,
          data: { type: 'review_submitted', review },
        });
      }
    }

    // New comments
    const prevCommentIds = new Set(prev.comments.map((c) => c.id));
    for (const comment of pr.comments) {
      if (!prevCommentIds.has(comment.id)) {
        events.push({
          type: 'comment_added',
          prKey: key,
          pr,
          timestamp: now,
          data: { type: 'comment_added', comment },
        });
      }
    }

    // Check status transitions
    if (checksChanged(prev, pr)) {
      events.push({
        type: 'checks_changed',
        prKey: key,
        pr,
        timestamp: now,
        data: { type: 'checks_changed', checks: pr.checks, previousChecks: prev.checks },
      });
    }

    // Conflict transitions
    if (prev.mergeable !== 'CONFLICTING' && pr.mergeable === 'CONFLICTING') {
      events.push({ type: 'conflict_detected', prKey: key, pr, timestamp: now });
    } else if (prev.mergeable === 'CONFLICTING' && pr.mergeable !== 'CONFLICTING') {
      events.push({ type: 'conflict_resolved', prKey: key, pr, timestamp: now });
    }

    // Label changes
    const prevLabels = new Set(prev.labels.map((l) => l.name));
    const currLabels = new Set(pr.labels.map((l) => l.name));
    const added = [...currLabels].filter((l) => !prevLabels.has(l));
    const removed = [...prevLabels].filter((l) => !currLabels.has(l));
    if (added.length > 0 || removed.length > 0) {
      events.push({
        type: 'labels_changed',
        prKey: key,
        pr,
        timestamp: now,
        data: { type: 'labels_changed', added, removed },
      });
    }

    // Ready to merge (transition into ready state)
    if (isReadyToMerge(pr) && !isReadyToMerge(prev)) {
      events.push({ type: 'ready_to_merge', prKey: key, pr, timestamp: now });
    }
  }

  // PRs that disappeared (closed/merged externally)
  for (const [key, prev] of previous) {
    if (!current.has(key)) {
      events.push({
        type: 'pr_closed',
        prKey: key,
        pr: prev,
        timestamp: now,
      });
    }
  }

  return events;
}

/** Check if any CI check conclusion changed between snapshots. */
function checksChanged(prev: PullRequest, curr: PullRequest): boolean {
  if (prev.checks.length !== curr.checks.length) return true;

  const prevMap = new Map(prev.checks.map((c) => [c.name, c.conclusion]));
  return curr.checks.some((c) => prevMap.get(c.name) !== c.conclusion);
}

/** Determine if a PR is in a "ready to merge" state. */
function isReadyToMerge(pr: PullRequest): boolean {
  const allGreen =
    pr.checks.length > 0 &&
    pr.checks.every(
      (c) =>
        c.conclusion === 'SUCCESS' ||
        c.conclusion === 'SKIPPED' ||
        c.conclusion === 'NEUTRAL',
    );
  return allGreen && pr.reviewDecision === 'APPROVED' && pr.mergeable === 'MERGEABLE';
}
