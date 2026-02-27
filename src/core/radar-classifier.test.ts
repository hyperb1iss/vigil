import { describe, expect, test } from 'bun:test';

import type { PullRequest } from '../types/pr.js';
import type { RadarRepoConfig, TeamWatch } from '../types/radar.js';
import { classifyRelevance, topTier } from './radar-classifier.js';

function makePr(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    key: 'owner/repo#1',
    number: 1,
    title: 'Test PR',
    body: '',
    url: 'https://github.com/owner/repo/pull/1',
    repository: { name: 'repo', nameWithOwner: 'owner/repo' },
    author: { login: 'alice', isBot: false },
    headRefName: 'feat/radar',
    baseRefName: 'main',
    isDraft: false,
    state: 'OPEN',
    mergeable: 'MERGEABLE',
    reviewDecision: 'REVIEW_REQUIRED',
    reviews: [],
    comments: [],
    checks: [],
    labels: [],
    reviewRequests: [],
    additions: 10,
    deletions: 2,
    changedFiles: 3,
    createdAt: '2026-02-26T12:00:00.000Z',
    updatedAt: '2026-02-26T12:00:00.000Z',
    ...overrides,
  };
}

const repoConfig: RadarRepoConfig = {
  repo: 'owner/repo',
  domainRules: [
    { name: 'infra', pathPatterns: ['infra/**', '.github/workflows/**'], tier: 'domain' },
    { name: 'agents', pathPatterns: ['agents/**'], tier: 'watch', minFiles: 2 },
  ],
  relevantLabels: ['needs-platform-review'],
  watchAuthors: ['staff-eng'],
};

const teams: TeamWatch[] = [{ slug: 'owner/platform-maintainers', name: 'Platform Maintainers' }];

describe('radar classifier', () => {
  test('matches direct user review request', () => {
    const pr = makePr({ reviewRequests: [{ login: 'bliss' }] });
    const reasons = classifyRelevance(pr, [], repoConfig, teams, 'bliss');
    expect(reasons.some(r => r.tier === 'direct')).toBe(true);
    expect(topTier(reasons)).toBe('direct');
  });

  test('matches team review request by slug tail', () => {
    const pr = makePr({ reviewRequests: [{ slug: 'platform-maintainers' }] });
    const reasons = classifyRelevance(pr, [], repoConfig, teams, 'bliss');
    expect(reasons.some(r => r.matchedBy === 'owner/platform-maintainers')).toBe(true);
    expect(topTier(reasons)).toBe('direct');
  });

  test('matches domain globs and minFiles', () => {
    const pr = makePr();
    const reasons = classifyRelevance(
      pr,
      ['infra/cron.yaml', '.github/workflows/ci.yml', 'agents/a.ts'],
      repoConfig,
      teams,
      'bliss'
    );
    expect(reasons.some(r => r.matchedBy === 'infra' && r.tier === 'domain')).toBe(true);
    expect(reasons.some(r => r.matchedBy === 'agents')).toBe(false);
  });

  test('matches relevant labels and watched authors as watch tier', () => {
    const pr = makePr({
      author: { login: 'staff-eng', isBot: false },
      labels: [{ id: '1', name: 'needs-platform-review', color: 'red' }],
    });
    const reasons = classifyRelevance(pr, [], repoConfig, teams, 'bliss');
    expect(reasons.some(r => r.reason.includes('Label'))).toBe(true);
    expect(reasons.some(r => r.reason.includes('Watched author'))).toBe(true);
    expect(topTier(reasons)).toBe('watch');
  });
});
