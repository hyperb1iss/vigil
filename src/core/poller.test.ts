import { describe, expect, test } from 'bun:test';

import type { PullRequest } from '../types/pr.js';
import { _internal } from './poller.js';

function makePr(overrides: Partial<PullRequest> = {}): PullRequest {
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function toMap(...prs: PullRequest[]): Map<string, PullRequest> {
  return new Map(prs.map(pr => [pr.key, pr]));
}

describe('stabilizeCurrentSnapshot', () => {
  test('keeps a missing PR on first miss and increments streak', () => {
    const previous = toMap(makePr());
    const fetchedCurrent = new Map<string, PullRequest>();
    const streaks = new Map<string, number>();

    const stabilized = _internal.stabilizeCurrentSnapshot(previous, fetchedCurrent, streaks, 2);
    expect(stabilized.has('owner/repo#1')).toBe(true);
    expect(streaks.get('owner/repo#1')).toBe(1);
  });

  test('drops PR after confirm threshold and clears streak', () => {
    const previous = toMap(makePr());
    const fetchedCurrent = new Map<string, PullRequest>();
    const streaks = new Map<string, number>([['owner/repo#1', 1]]);

    const stabilized = _internal.stabilizeCurrentSnapshot(previous, fetchedCurrent, streaks, 2);
    expect(stabilized.has('owner/repo#1')).toBe(false);
    expect(streaks.has('owner/repo#1')).toBe(false);
  });

  test('resets streak when PR reappears', () => {
    const previous = toMap(makePr({ title: 'Old' }));
    const fetchedCurrent = toMap(makePr({ title: 'Fresh' }));
    const streaks = new Map<string, number>([['owner/repo#1', 1]]);

    const stabilized = _internal.stabilizeCurrentSnapshot(previous, fetchedCurrent, streaks, 2);
    expect(stabilized.get('owner/repo#1')?.title).toBe('Fresh');
    expect(streaks.has('owner/repo#1')).toBe(false);
  });

  test('cleans orphan streak entries no longer in either snapshot', () => {
    const previous = new Map<string, PullRequest>();
    const fetchedCurrent = new Map<string, PullRequest>();
    const streaks = new Map<string, number>([['owner/repo#42', 3]]);

    _internal.stabilizeCurrentSnapshot(previous, fetchedCurrent, streaks, 2);
    expect(streaks.has('owner/repo#42')).toBe(false);
  });
});
