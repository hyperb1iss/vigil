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
  test('buildDirectReviewSearchQuery requests all open direct review requests', () => {
    expect(_internal.buildDirectReviewSearchQuery()).toBe('is:pr is:open review-requested:@me');
  });

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

  test('buildSearchPullRequest creates a search-backed stub with stable identity', () => {
    const pr = _internal.buildSearchPullRequest({
      number: 42,
      title: 'Review me',
      state: 'OPEN',
      isDraft: false,
      url: 'https://github.com/owner/repo/pull/42',
      body: 'stub',
      createdAt: '2026-04-10T00:00:00Z',
      updatedAt: '2026-04-11T00:00:00Z',
      labels: [{ name: 'priority', color: 'ff00ff' }],
      repository: { name: 'repo', nameWithOwner: 'owner/repo' },
      author: { login: 'reviewer' },
    });

    expect(pr.key).toBe('owner/repo#42');
    expect(pr.headRefName).toBe('');
    expect(pr.labels[0]?.name).toBe('priority');
  });

  test('connectionHasNextPage detects pagination markers', () => {
    expect(
      _internal.connectionHasNextPage({
        pageInfo: {
          hasNextPage: true,
        },
      })
    ).toBe(true);
    expect(_internal.connectionHasNextPage(undefined)).toBe(false);
  });

  test('isGraphqlRadarPrMetadataTruncated flags clipped review metadata', () => {
    expect(
      _internal.isGraphqlRadarPrMetadataTruncated({
        number: 7,
        title: 'Big review queue',
        state: 'OPEN',
        isDraft: false,
        url: 'https://github.com/owner/repo/pull/7',
        createdAt: '2026-04-10T00:00:00Z',
        updatedAt: '2026-04-10T00:00:00Z',
        reviews: {
          nodes: [],
          pageInfo: {
            hasNextPage: true,
          },
        },
      })
    ).toBe(true);

    expect(
      _internal.isGraphqlRadarPrMetadataTruncated({
        number: 7,
        title: 'Normal queue',
        state: 'OPEN',
        isDraft: false,
        url: 'https://github.com/owner/repo/pull/7',
        createdAt: '2026-04-10T00:00:00Z',
        updatedAt: '2026-04-10T00:00:00Z',
        labels: {
          nodes: [],
          pageInfo: {
            hasNextPage: false,
          },
        },
        reviews: {
          nodes: [],
          pageInfo: {
            hasNextPage: false,
          },
        },
        comments: {
          nodes: [],
          pageInfo: {
            hasNextPage: false,
          },
        },
        statusCheckRollup: {
          contexts: {
            nodes: [],
            pageInfo: {
              hasNextPage: false,
            },
          },
        },
        reviewRequests: {
          nodes: [],
          pageInfo: {
            hasNextPage: false,
          },
        },
      })
    ).toBe(false);
  });

  test('isGraphqlRadarPrFilesTruncated flags clipped file lists', () => {
    expect(
      _internal.isGraphqlRadarPrFilesTruncated({
        number: 9,
        title: 'Many files',
        state: 'OPEN',
        isDraft: false,
        url: 'https://github.com/owner/repo/pull/9',
        createdAt: '2026-04-10T00:00:00Z',
        updatedAt: '2026-04-10T00:00:00Z',
        files: {
          nodes: [],
          pageInfo: {
            hasNextPage: true,
          },
        },
      })
    ).toBe(true);

    expect(
      _internal.isGraphqlRadarPrFilesTruncated({
        number: 9,
        title: 'Few files',
        state: 'OPEN',
        isDraft: false,
        url: 'https://github.com/owner/repo/pull/9',
        createdAt: '2026-04-10T00:00:00Z',
        updatedAt: '2026-04-10T00:00:00Z',
        files: {
          nodes: [],
          pageInfo: {
            hasNextPage: false,
          },
        },
      })
    ).toBe(false);
  });

  test('shouldExcludeDirectReviewPr respects self-review exclusion', () => {
    expect(
      _internal.shouldExcludeDirectReviewPr(
        makePr({ author: { login: 'reviewer', isBot: false } }),
        makeRadarConfig({ excludeOwnPrs: true }),
        'reviewer'
      )
    ).toBe(true);

    expect(
      _internal.shouldExcludeDirectReviewPr(
        makePr({ author: { login: 'teammate', isBot: false } }),
        makeRadarConfig({ excludeOwnPrs: true }),
        'reviewer'
      )
    ).toBe(false);
  });
});
