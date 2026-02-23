import { describe, expect, test } from 'bun:test';

import type { PrEvent } from '../types/events.js';
import type { PullRequest } from '../types/pr.js';
import { shouldSkipTriageForStalePr } from './orchestrator.js';

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
