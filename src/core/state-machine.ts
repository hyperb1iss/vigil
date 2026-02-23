import type { PrState, PullRequest } from '../types/pr.js';

const HOT_COOLDOWN_HOURS = 7 * 24;

/**
 * Classify a PR into one of five states based on real-time signals.
 *
 * Priority order (first match wins):
 *  1. blocked  — draft, closed, or merged
 *  2. hot      — changes requested or merge conflict (needs author action)
 *     (auto-cools to dormant if untouched for 7+ days)
 *  3. ready    — all checks green, approved, mergeable
 *  4. dormant  — no activity beyond threshold
 *  5. waiting  — CI running/failing, reviews pending, etc.
 */
export function classifyPr(pr: PullRequest, dormantThresholdHours: number): PrState {
  // Blocked: not actionable
  if (pr.state !== 'OPEN' || pr.isDraft) {
    return 'blocked';
  }

  const hoursSinceUpdate = (Date.now() - new Date(pr.updatedAt).getTime()) / (1000 * 60 * 60);

  // Hot: requires immediate author action
  const hasBlockingReview = pr.reviewDecision === 'CHANGES_REQUESTED';
  const hasConflict = pr.mergeable === 'CONFLICTING';
  const hasCiFailure =
    pr.checks.length > 0 &&
    pr.checks.some(
      c => c.status === 'COMPLETED' && (c.conclusion === 'FAILURE' || c.conclusion === 'CANCELLED')
    );

  // If a hot signal has sat untouched for a long time, cool it down to dormant.
  if ((hasBlockingReview || hasConflict || hasCiFailure) && hoursSinceUpdate > HOT_COOLDOWN_HOURS) {
    return 'dormant';
  }

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
  if (hoursSinceUpdate > dormantThresholdHours) {
    return 'dormant';
  }

  // Waiting: CI running, reviews pending, failures being addressed
  return 'waiting';
}
