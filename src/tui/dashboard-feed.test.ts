import { describe, expect, test } from 'bun:test';

import type { PullRequest } from '../types/pr.js';
import type { DashboardFeedState } from './dashboard-feed.js';
import { buildDashboardItems } from './dashboard-feed.js';

function makePr(key: string, overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    key,
    number: Number(key.split('#')[1] ?? 1),
    title: `PR ${key}`,
    body: '',
    url: `https://github.com/${key.replace('#', '/pull/')}`,
    repository: {
      name: key.split('/')[1]?.split('#')[0] ?? 'repo',
      nameWithOwner: key.split('#')[0] ?? key,
    },
    author: { login: 'someone', isBot: false },
    headRefName: 'feature',
    baseRefName: 'main',
    isDraft: false,
    state: 'OPEN',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    reviewDecision: '',
    reviews: [],
    comments: [],
    checks: [],
    labels: [],
    reviewRequests: [],
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    createdAt: '2026-02-27T00:00:00.000Z',
    updatedAt: '2026-02-27T00:00:00.000Z',
    ...overrides,
  };
}

function baseState(mode: DashboardFeedState['dashboardFeedMode']): DashboardFeedState {
  return {
    prs: new Map(),
    prStates: new Map(),
    radarPrs: new Map(),
    mergedRadarPrs: new Map(),
    dashboardFeedMode: mode,
    radarFilter: null,
    sortMode: 'activity',
  };
}

describe('buildDashboardItems', () => {
  test('dedupes duplicate PR keys in both feed mode', () => {
    const pr = makePr('acme/repo#42');
    const state = baseState('both');
    state.prs.set(pr.key, pr);
    state.prStates.set(pr.key, 'waiting');
    state.radarPrs.set(pr.key, {
      pr,
      relevance: [{ tier: 'direct', reason: 'You are requested as reviewer', matchedBy: 'me' }],
      topTier: 'direct',
      isMerged: false,
    });

    const items = buildDashboardItems(state);

    expect(items).toHaveLength(1);
    expect(items[0]?.key).toBe(pr.key);
    expect(items[0]?.source).toBe('incoming');
  });

  test('keeps mine item when duplicate exists only in merged radar', () => {
    const pr = makePr('acme/repo#99');
    const state = baseState('both');
    state.prs.set(pr.key, pr);
    state.prStates.set(pr.key, 'ready');
    state.mergedRadarPrs.set(pr.key, {
      pr: { ...pr, mergedAt: '2026-02-27T01:00:00.000Z' },
      relevance: [{ tier: 'watch', reason: 'Recently merged', matchedBy: 'recently-merged' }],
      topTier: 'watch',
      isMerged: true,
    });

    const items = buildDashboardItems(state);

    expect(items).toHaveLength(1);
    expect(items[0]?.key).toBe(pr.key);
    expect(items[0]?.source).toBe('mine');
  });
});
