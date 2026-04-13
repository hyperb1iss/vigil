import { describe, expect, test } from 'bun:test';

import type { PullRequest } from '../types/pr.js';
import { _internal } from './evidence.js';

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
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-01T00:00:00Z',
    ...overrides,
  };
}

describe('findEvidenceCommentTarget', () => {
  test('selects the latest comment with verification headings', () => {
    const pr = makePr({
      comments: [
        {
          id: 'c1',
          author: { login: 'bot', isBot: true },
          body: 'hello',
          createdAt: '2026-03-01T00:00:00Z',
          url: 'https://github.com/owner/repo/pull/1#issuecomment-1',
        },
        {
          id: 'c2',
          author: { login: 'bot', isBot: true },
          body: '### Verification\n- passed',
          createdAt: '2026-03-01T00:10:00Z',
          url: 'https://github.com/owner/repo/pull/1#issuecomment-2',
        },
      ],
    });

    expect(_internal.findEvidenceCommentTarget(pr)).toBe(
      'https://github.com/owner/repo/pull/1#issuecomment-2'
    );
  });

  test('returns undefined when there is no editable evidence comment', () => {
    expect(_internal.findEvidenceCommentTarget(makePr())).toBeUndefined();
  });
});
