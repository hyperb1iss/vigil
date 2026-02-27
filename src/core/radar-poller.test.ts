import { describe, expect, test } from 'bun:test';

import type { PullRequest } from '../types/pr.js';
import type { RadarPr } from '../types/radar.js';
import { _internal } from './radar-poller.js';

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
    state: 'OPEN',
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRadarPr(key: string, topTier: RadarPr['topTier'], isMerged = false): RadarPr {
  const number = Number(key.split('#')[1] ?? '1');
  return {
    pr: makePr({
      key,
      number,
      state: isMerged ? 'MERGED' : 'OPEN',
      mergedAt: isMerged ? new Date().toISOString() : undefined,
    }),
    relevance: [{ tier: topTier, reason: topTier, matchedBy: topTier }],
    topTier,
    isMerged,
  };
}

describe('radar poller internals', () => {
  test('stabilizeCurrentSnapshot keeps missing PR on first miss', () => {
    const previous = new Map([['owner/repo#1', makeRadarPr('owner/repo#1', 'domain')]]);
    const current = new Map<string, RadarPr>();
    const streaks = new Map<string, number>();

    const stabilized = _internal.stabilizeCurrentSnapshot(previous, current, streaks, 2);
    expect(stabilized.has('owner/repo#1')).toBe(true);
    expect(streaks.get('owner/repo#1')).toBe(1);
  });

  test('makeChanges emits direct review and merged events', () => {
    const previousOpen = new Map<string, RadarPr>();
    const currentOpen = new Map([['owner/repo#1', makeRadarPr('owner/repo#1', 'direct')]]);
    const previousMerged = new Map<string, RadarPr>();
    const currentMerged = new Map([['owner/repo#2', makeRadarPr('owner/repo#2', 'domain', true)]]);

    const changes = _internal.makeChanges(previousOpen, currentOpen, previousMerged, currentMerged);
    expect(changes.some(c => c.kind === 'review_requested')).toBe(true);
    expect(changes.some(c => c.kind === 'domain_pr_merged')).toBe(true);
  });

  test('makeChanges emits escalation to direct tier', () => {
    const previousOpen = new Map([['owner/repo#1', makeRadarPr('owner/repo#1', 'domain')]]);
    const currentOpen = new Map([['owner/repo#1', makeRadarPr('owner/repo#1', 'direct')]]);
    const changes = _internal.makeChanges(
      previousOpen,
      currentOpen,
      new Map<string, RadarPr>(),
      new Map<string, RadarPr>()
    );

    expect(changes).toHaveLength(1);
    expect(changes[0]?.kind).toBe('review_requested');
  });

  test('preserveSnapshotDetails keeps enriched detail across refreshes', () => {
    const key = 'owner/repo#55';
    const previous = new Map([[key, makeRadarPr(key, 'domain', false)]]);
    const prev = previous.get(key);
    if (!prev) throw new Error('missing previous test data');
    prev.pr.headRefName = 'feature/real-detail';
    prev.pr.baseRefName = 'main';
    prev.pr.reviews = [
      {
        id: 'r1',
        author: { login: 'reviewer', isBot: false },
        state: 'APPROVED',
        body: 'looks good',
        submittedAt: new Date().toISOString(),
      },
    ];
    prev.pr.checks = [
      {
        name: 'ci',
        status: 'COMPLETED',
        conclusion: 'SUCCESS',
      },
    ];
    prev.pr.additions = 42;
    prev.pr.deletions = 11;
    prev.pr.changedFiles = 7;

    const fetched = new Map([
      [
        key,
        {
          ...makeRadarPr(key, 'direct', false),
          pr: makePr({
            key,
            number: 55,
            headRefName: '',
            baseRefName: '',
            reviews: [],
            checks: [],
            additions: 0,
            deletions: 0,
            changedFiles: 0,
            reviewRequests: [{ login: 'hyperb1iss' }],
          }),
        },
      ],
    ]);

    const merged = _internal.preserveSnapshotDetails(previous, fetched);
    const mergedPr = merged.get(key)?.pr;
    expect(mergedPr?.headRefName).toBe('feature/real-detail');
    expect(mergedPr?.reviews.length).toBe(1);
    expect(mergedPr?.checks.length).toBe(1);
    expect(mergedPr?.additions).toBe(42);
    expect(mergedPr?.changedFiles).toBe(7);
    expect(merged.get(key)?.topTier).toBe('direct');
  });
});
