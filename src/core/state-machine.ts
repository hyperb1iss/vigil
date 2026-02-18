import type { PrState, PullRequest } from '../types/pr.js';

/**
 * Classify a PR into one of five states based on real-time signals.
 *
 * Priority order (first match wins):
 *  1. blocked  — draft, closed, or merged
 *  2. hot      — changes requested or merge conflict (needs author action)
 *  3. ready    — all checks green, approved, mergeable
 *  4. dormant  — no activity beyond threshold
 *  5. waiting  — CI running/failing, reviews pending, etc.
 */
export function classifyPr(pr: PullRequest, dormantThresholdHours: number): PrState {
  // Blocked: not actionable
  if (pr.state !== 'OPEN' || pr.isDraft) {
    return 'blocked';
  }

  // Hot: requires immediate author action
  const hasBlockingReview = pr.reviewDecision === 'CHANGES_REQUESTED';
  const hasConflict = pr.mergeable === 'CONFLICTING';
  const hasCiFailure =
    pr.checks.length > 0 &&
    pr.checks.some(
      c => c.status === 'COMPLETED' && (c.conclusion === 'FAILURE' || c.conclusion === 'CANCELLED')
    );

  if (hasBlockingReview || hasConflict || hasCiFailure) {
    return 'hot';
  }

  // Ready: ship it
  const allChecksPassing =
    pr.checks.length > 0 &&
    pr.checks.every(
      c =>
        c.status === 'COMPLETED' &&
        (c.conclusion === 'SUCCESS' || c.conclusion === 'SKIPPED' || c.conclusion === 'NEUTRAL')
    );
  const isApproved = pr.reviewDecision === 'APPROVED';
  const isMergeable = pr.mergeable === 'MERGEABLE';

  if (allChecksPassing && isApproved && isMergeable) {
    return 'ready';
  }

  // Dormant: stale
  const hoursSinceUpdate = (Date.now() - new Date(pr.updatedAt).getTime()) / (1000 * 60 * 60);

  if (hoursSinceUpdate > dormantThresholdHours) {
    return 'dormant';
  }

  // Waiting: CI running, reviews pending, failures being addressed
  return 'waiting';
}
