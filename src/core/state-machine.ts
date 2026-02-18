import type { PrState, PullRequest } from '../types/pr.js';

/**
 * Classify a PR into one of five states based on real-time signals.
 *
 * Priority order (first match wins):
 *  1. blocked  — draft, closed, or merged
 *  2. hot      — failing CI, blocking review, or merge conflict
 *  3. ready    — all checks green, approved, mergeable
 *  4. dormant  — no activity beyond threshold
 *  5. waiting  — everything else (CI running, reviews pending, etc.)
 */
export function classifyPr(pr: PullRequest, dormantThresholdHours: number): PrState {
  if (pr.state !== 'OPEN' || pr.isDraft) {
    return 'blocked';
  }

  const hasCiFailure = pr.checks.some(c => c.conclusion === 'FAILURE');
  const hasBlockingReview = pr.reviewDecision === 'CHANGES_REQUESTED';
  const hasConflict = pr.mergeable === 'CONFLICTING';

  if (hasCiFailure || hasBlockingReview || hasConflict) {
    return 'hot';
  }

  const allChecksPassing =
    pr.checks.length > 0 &&
    pr.checks.every(
      c => c.conclusion === 'SUCCESS' || c.conclusion === 'SKIPPED' || c.conclusion === 'NEUTRAL'
    );
  const isApproved = pr.reviewDecision === 'APPROVED';
  const isMergeable = pr.mergeable === 'MERGEABLE';

  if (allChecksPassing && isApproved && isMergeable) {
    return 'ready';
  }

  const hoursSinceUpdate = (Date.now() - new Date(pr.updatedAt).getTime()) / (1000 * 60 * 60);

  if (hoursSinceUpdate > dormantThresholdHours) {
    return 'dormant';
  }

  return 'waiting';
}
