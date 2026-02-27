import picomatch from 'picomatch';

import type { PullRequest } from '../types/pr.js';
import type { RadarRepoConfig, RelevanceReason, RelevanceTier, TeamWatch } from '../types/radar.js';

const TIER_WEIGHT: Record<RelevanceTier, number> = {
  direct: 0,
  domain: 1,
  watch: 2,
};

function normalizeTeamSlug(slug: string): string {
  return slug
    .trim()
    .toLowerCase()
    .replace(/^team:/, '');
}

function normalizeRequestSlug(slug: string): string {
  return normalizeTeamSlug(slug).replace(/^teams?\//, '');
}

function teamRequestMatches(requestSlug: string, teamSlug: string): boolean {
  const req = normalizeRequestSlug(requestSlug);
  const team = normalizeTeamSlug(teamSlug);
  if (req === team) return true;
  const reqTail = req.split('/').at(-1);
  const teamTail = team.split('/').at(-1);
  return reqTail !== undefined && reqTail === teamTail;
}

function dedupeReasons(reasons: RelevanceReason[]): RelevanceReason[] {
  const seen = new Set<string>();
  const deduped: RelevanceReason[] = [];
  for (const reason of reasons) {
    const key = `${reason.tier}:${reason.matchedBy}:${reason.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(reason);
  }
  return deduped;
}

export function topTier(reasons: RelevanceReason[]): RelevanceTier {
  let top: RelevanceTier = 'watch';
  for (const reason of reasons) {
    if (TIER_WEIGHT[reason.tier] < TIER_WEIGHT[top]) {
      top = reason.tier;
    }
  }
  return top;
}

/** Classify a PR's relevance for incoming review radar. */
export function classifyRelevance(
  pr: PullRequest,
  filePaths: string[],
  repoConfig: RadarRepoConfig,
  teams: TeamWatch[],
  username: string
): RelevanceReason[] {
  const reasons: RelevanceReason[] = [];
  const reviewRequests = pr.reviewRequests ?? [];
  const normalizedUsername = username.toLowerCase();

  if (
    reviewRequests.some(
      request =>
        typeof request.login === 'string' && request.login.toLowerCase() === normalizedUsername
    )
  ) {
    reasons.push({
      tier: 'direct',
      reason: 'You are requested as reviewer',
      matchedBy: username,
    });
  }

  for (const team of teams) {
    const matched = reviewRequests.some(request => {
      if (typeof request.slug !== 'string') return false;
      return teamRequestMatches(request.slug, team.slug);
    });
    if (!matched) continue;
    reasons.push({
      tier: 'direct',
      reason: `${team.name} review requested`,
      matchedBy: team.slug,
    });
  }

  for (const rule of repoConfig.domainRules) {
    const matchesPattern = rule.pathPatterns.map(pattern => picomatch(pattern, { dot: true }));
    let matchCount = 0;
    for (const path of filePaths) {
      if (matchesPattern.some(match => match(path))) {
        matchCount++;
      }
    }
    if (matchCount < (rule.minFiles ?? 1)) continue;
    reasons.push({
      tier: rule.tier,
      reason: `Touches ${rule.name} (${matchCount} files)`,
      matchedBy: rule.name,
    });
  }

  if (repoConfig.relevantLabels && repoConfig.relevantLabels.length > 0) {
    const labels = new Set(repoConfig.relevantLabels);
    for (const label of pr.labels) {
      if (!labels.has(label.name)) continue;
      reasons.push({
        tier: 'watch',
        reason: `Label: ${label.name}`,
        matchedBy: label.name,
      });
    }
  }

  if (
    repoConfig.watchAuthors?.some(author => author.toLowerCase() === pr.author.login.toLowerCase())
  ) {
    reasons.push({
      tier: 'watch',
      reason: `Watched author: ${pr.author.login}`,
      matchedBy: pr.author.login,
    });
  }

  return dedupeReasons(reasons);
}
