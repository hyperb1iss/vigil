import { describe, expect, test } from 'bun:test';

import type { PullRequest } from '../types/pr.js';
import type { RadarConfig, RadarPr, RadarRepoConfig } from '../types/radar.js';
import { _internal } from './radar-github.js';

function makePr(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    key: 'owner/repo#1',
    number: 1,
    title: 'Radar PR',
    body: '',
    url: 'https://github.com/owner/repo/pull/1',
    repository: { name: 'repo', nameWithOwner: 'owner/repo' },
    author: { login: 'alice', isBot: false },
    headRefName: 'feat/radar',
    baseRefName: 'main',
    isDraft: false,
    state: 'MERGED',
    mergeable: 'MERGEABLE',
    reviewDecision: 'REVIEW_REQUIRED',
    reviews: [],
    comments: [],
    checks: [],
    labels: [],
    reviewRequests: [],
    additions: 1,
    deletions: 1,
    changedFiles: 1,
    createdAt: '2026-04-10T00:00:00Z',
    updatedAt: '2026-04-10T00:00:00Z',
    mergedAt: '2026-04-10T00:00:00Z',
    ...overrides,
  };
}

function makeRadarPr(key: string, mergedAt: string): RadarPr {
  const number = Number(key.split('#')[1] ?? '1');
  return {
    pr: makePr({
      key,
      number,
      mergedAt,
      updatedAt: mergedAt,
    }),
    relevance: [{ tier: 'domain', reason: 'domain', matchedBy: 'domain' }],
    topTier: 'domain',
    isMerged: true,
  };
}

function makeRadarConfig(overrides: Partial<RadarConfig> = {}): RadarConfig {
  return {
    enabled: true,
    repos: [],
    teams: [],
    pollIntervalMs: 60_000,
    merged: { limit: 10, maxAgeHours: 48, domainOnly: true },
    notifications: {
      onDirectReviewRequest: true,
      onNewDomainPr: true,
      onMergedDomainPr: false,
    },
    excludeBotDrafts: true,
    excludeOwnPrs: true,
    staleCutoffDays: 30,
    ...overrides,
  };
}

function makeRepoConfig(overrides: Partial<RadarRepoConfig> = {}): RadarRepoConfig {
  return {
    repo: 'owner/repo',
    domainRules: [],
    ...overrides,
  };
}

describe('radar github internals', () => {
  test('buildMergedSearchQuery constrains merged PR backfill by timestamp', () => {
    expect(_internal.buildMergedSearchQuery('owner/repo', '2026-04-01T00:00:00Z')).toBe(
      'repo:owner/repo is:pr is:merged merged:>=2026-04-01T00:00:00Z'
    );
  });

  test('limitMergedPrs keeps the most recently merged entries', () => {
    const merged = new Map<string, RadarPr>([
      ['owner/repo#1', makeRadarPr('owner/repo#1', '2026-04-10T00:00:00Z')],
      ['owner/repo#2', makeRadarPr('owner/repo#2', '2026-04-12T00:00:00Z')],
      ['owner/repo#3', makeRadarPr('owner/repo#3', '2026-04-11T00:00:00Z')],
    ]);

    const limited = _internal.limitMergedPrs(merged, 2);

    expect([...limited.keys()]).toEqual(['owner/repo#2', 'owner/repo#3']);
  });

  test('watchAll bypasses stale-cutoff filtering for slower personal repos', () => {
    const stalePr = makePr({
      state: 'OPEN',
      mergedAt: undefined,
      updatedAt: '2026-01-01T00:00:00Z',
    });

    expect(
      _internal.shouldExcludePr(
        stalePr,
        makeRadarConfig(),
        makeRepoConfig({ watchAll: true }),
        'reviewer'
      )
    ).toBe(false);
  });
});
