import { beforeEach, describe, expect, test } from 'bun:test';

import type { PrEvent } from '../types/events.js';
import type { PrComment, PrReview, PullRequest } from '../types/pr.js';
import { _internal, shouldSkipTriageForStalePr } from './orchestrator.js';

function makePr(updatedAt: string): PullRequest {
  return {
    key: 'owner/repo#1',
    number: 1,
    title: 'Test PR',
    body: '',
    url: 'https://github.com/owner/repo/pull/1',
    repository: { name: 'repo', nameWithOwner: 'owner/repo' },
    author: { login: 'dev', isBot: false },
    headRefName: 'feat/test',
    baseRefName: 'main',
    isDraft: false,
    state: 'OPEN',
    mergeable: 'MERGEABLE',
    reviewDecision: '',
    reviews: [],
    comments: [],
    checks: [],
    labels: [],
    additions: 1,
    deletions: 1,
    changedFiles: 1,
    createdAt: updatedAt,
    updatedAt,
  };
}

function makeEvent(updatedAt: string, timestamp: string): PrEvent {
  return {
    type: 'pr_opened',
    prKey: 'owner/repo#1',
    pr: makePr(updatedAt),
    timestamp,
  };
}

function makeReview(id: string, submittedAt: string): PrReview {
  return {
    id,
    author: { login: 'reviewer', isBot: false },
    state: 'COMMENTED',
    body: 'Looks good',
    submittedAt,
  };
}

function makeComment(id: string, createdAt: string): PrComment {
  return {
    id,
    author: { login: 'reviewer', isBot: false },
    body: 'nit: rename this',
    createdAt,
    url: `https://github.com/owner/repo/pull/1#issuecomment-${id}`,
  };
}

function makeReviewEvent(id: string, timestamp: string): PrEvent {
  const updatedAt = '2026-02-20T00:00:00.000Z';
  return {
    type: 'review_submitted',
    prKey: 'owner/repo#1',
    pr: makePr(updatedAt),
    timestamp,
    data: {
      type: 'review_submitted',
      review: makeReview(id, timestamp),
    },
  };
}

function makeCommentEvent(id: string, timestamp: string): PrEvent {
  const updatedAt = '2026-02-20T00:00:00.000Z';
  return {
    type: 'comment_added',
    prKey: 'owner/repo#1',
    pr: makePr(updatedAt),
    timestamp,
    data: {
      type: 'comment_added',
      comment: makeComment(id, timestamp),
    },
  };
}

describe('shouldSkipTriageForStalePr', () => {
  test('returns true for PRs untouched for more than 7 days', () => {
    const event = makeEvent('2026-02-01T00:00:00.000Z', '2026-02-09T00:00:01.000Z');
    expect(shouldSkipTriageForStalePr(event)).toBe(true);
  });

  test('returns false for fresh PRs', () => {
    const event = makeEvent('2026-02-08T12:00:00.000Z', '2026-02-09T00:00:00.000Z');
    expect(shouldSkipTriageForStalePr(event)).toBe(false);
  });

  test('returns false at the exact 7-day boundary', () => {
    const event = makeEvent('2026-02-02T00:00:00.000Z', '2026-02-09T00:00:00.000Z');
    expect(shouldSkipTriageForStalePr(event)).toBe(false);
  });

  test('returns false for invalid timestamps', () => {
    const event = makeEvent('not-a-date', 'also-not-a-date');
    expect(shouldSkipTriageForStalePr(event)).toBe(false);
  });
});

describe('event dedupe', () => {
  beforeEach(() => {
    _internal.resetEventDedupeState();
  });

  test('dedupes only truly identical batch events', () => {
    const timestamp = '2026-02-27T18:58:47.613Z';
    const events = [
      makeCommentEvent('1', timestamp),
      makeCommentEvent('2', timestamp),
      makeReviewEvent('r1', timestamp),
    ];
    const deduped = _internal.dedupeBatchEvents(events);
    expect(deduped).toHaveLength(3);
    expect(deduped.map(event => event.type)).toEqual([
      'comment_added',
      'comment_added',
      'review_submitted',
    ]);
  });

  test('keeps distinct comments with the same timestamp', () => {
    const timestamp = '2026-02-27T18:58:47.613Z';
    const events = [makeCommentEvent('1', timestamp), makeCommentEvent('2', timestamp)];

    const deduped = _internal.dedupeBatchEvents(events);
    expect(deduped).toHaveLength(2);
    expect(
      deduped.map(event => event.data?.type === 'comment_added' && event.data.comment.id)
    ).toEqual(['1', '2']);
  });

  test('cooldown dedupes repeated pr_opened for same pr in short window', () => {
    const event = makeEvent('2026-02-20T00:00:00.000Z', '2026-02-27T18:58:47.613Z');
    const first = _internal.isDuplicateRecentEvent(event, 1_000);
    const second = _internal.isDuplicateRecentEvent(
      {
        ...event,
        pr: { ...event.pr, updatedAt: '2026-02-20T00:00:05.000Z' },
        timestamp: '2026-02-27T18:58:50.000Z',
      },
      10_000
    );

    expect(first.isDuplicate).toBe(false);
    expect(second).toEqual({ isDuplicate: true, reason: 'cooldown' });
  });
});
