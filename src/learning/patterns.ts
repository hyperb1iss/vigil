import type { PrEvent, PullRequest } from '../types/index.js';

/**
 * Extract review patterns from a PR's review history.
 * Focuses on actionable feedback: CHANGES_REQUESTED and COMMENTED reviews.
 */
export function extractReviewPatterns(pr: PullRequest): string[] {
  const patterns: string[] = [];

  for (const review of pr.reviews) {
    if (review.state !== 'CHANGES_REQUESTED' && review.state !== 'COMMENTED') continue;
    if (!review.body.trim()) continue;

    const snippet = review.body.trim().slice(0, 100);
    const suffix = review.body.trim().length > 100 ? '...' : '';
    patterns.push(`**${review.author.login}** flagged: ${snippet}${suffix}`);
  }

  return patterns;
}

/**
 * Extract CI failure patterns from a PR's check results.
 */
export function extractCiPatterns(pr: PullRequest): string[] {
  const patterns: string[] = [];

  for (const check of pr.checks) {
    if (check.conclusion !== 'FAILURE') continue;
    const workflow = check.workflowName ?? 'unknown workflow';
    patterns.push(`**${check.name}** failed in ${workflow}`);
  }

  return patterns;
}

/**
 * Produce a markdown summary of the PR lifecycle suitable for
 * appending to the knowledge file.
 */
export function summarizeForLearning(pr: PullRequest, events: PrEvent[]): string {
  const lines: string[] = [];

  lines.push(`#### ${pr.repository.nameWithOwner}#${pr.number}: ${pr.title}`);
  lines.push('');

  // Basic stats
  lines.push(
    `- **State:** ${pr.state} | **Files:** ${pr.changedFiles} | +${pr.additions}/-${pr.deletions}`
  );
  lines.push(
    `- **Author:** ${pr.author.login} | **Branch:** ${pr.headRefName} -> ${pr.baseRefName}`
  );

  // Review patterns
  const reviewPatterns = extractReviewPatterns(pr);
  if (reviewPatterns.length > 0) {
    lines.push('');
    lines.push('**Review Feedback:**');
    for (const p of reviewPatterns) {
      lines.push(`- ${p}`);
    }
  }

  // CI patterns
  const ciPatterns = extractCiPatterns(pr);
  if (ciPatterns.length > 0) {
    lines.push('');
    lines.push('**CI Failures:**');
    for (const p of ciPatterns) {
      lines.push(`- ${p}`);
    }
  }

  // Event timeline
  if (events.length > 0) {
    lines.push('');
    lines.push('**Timeline:**');
    for (const event of events) {
      lines.push(`- \`${event.timestamp}\` ${event.type}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}
