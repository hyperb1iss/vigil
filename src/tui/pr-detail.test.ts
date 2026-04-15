import { describe, expect, test } from 'bun:test';

import type { PullRequest } from '../types/pr.js';
import { _internal } from './pr-detail.js';

const { detectAutomatedReviewVendor, partitionReviewFeedback, isBotNoise } = _internal;

function makePr(key = 'owner/repo#1', overrides: Partial<PullRequest> = {}): PullRequest {
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
    createdAt: '2026-04-15T00:00:00.000Z',
    updatedAt: '2026-04-15T00:00:00.000Z',
    ...overrides,
  };
}

describe('detectAutomatedReviewVendor', () => {
  test('detects Codex from the author login', () => {
    expect(detectAutomatedReviewVendor('openai-codex', 'Looks good')).toMatchObject({
      id: 'codex',
      label: 'CODEX',
    });
  });

  test('detects Claude from the review body', () => {
    expect(
      detectAutomatedReviewVendor('review-assistant', 'Claude review: consider extracting this.')
    ).toMatchObject({
      id: 'claude',
      label: 'CLAUDE',
    });
  });

  test('detects CodeRabbit from known login patterns', () => {
    expect(
      detectAutomatedReviewVendor('coderabbitai[bot]', 'Automated review suggestions below')
    ).toMatchObject({
      id: 'coderabbit',
      label: 'CODERABBIT',
    });
  });
});

describe('isBotNoise', () => {
  test('does not suppress agent review comments', () => {
    expect(
      isBotNoise('## Summary by CodeRabbit\nPlease rename this function.', 'coderabbitai[bot]')
    ).toBe(false);
  });

  test('still suppresses generic bot noise', () => {
    expect(isBotNoise('Dependency update complete.', 'dependabot[bot]')).toBe(true);
  });
});

describe('partitionReviewFeedback', () => {
  test('splits automated feedback out from human reviews and comments', () => {
    const pr = makePr('owner/repo#42', {
      reviews: [
        {
          id: 'r-human',
          author: { login: 'alice', isBot: false },
          state: 'CHANGES_REQUESTED',
          body: 'Please cover the edge case.',
          submittedAt: '2026-04-15T10:00:00.000Z',
        },
        {
          id: 'r-codex',
          author: { login: 'openai-codex', isBot: true },
          state: 'COMMENTED',
          body: 'Codex review: this branch has a missing null guard.',
          submittedAt: '2026-04-15T11:00:00.000Z',
        },
      ],
      comments: [
        {
          id: 'c-human',
          author: { login: 'bob', isBot: false },
          body: 'Can we rename this helper?',
          createdAt: '2026-04-15T09:00:00.000Z',
          url: 'https://github.com/owner/repo/pull/42#issuecomment-1',
        },
        {
          id: 'c-rabbit',
          author: { login: 'coderabbitai[bot]', isBot: true },
          body: '## Summary by CodeRabbit\nThere is duplicated validation logic.',
          createdAt: '2026-04-15T12:00:00.000Z',
          url: 'https://github.com/owner/repo/pull/42#issuecomment-2',
        },
        {
          id: 'c-bot-noise',
          author: { login: 'dependabot[bot]', isBot: true },
          body: 'Bump dependency metadata.',
          createdAt: '2026-04-15T08:00:00.000Z',
          url: 'https://github.com/owner/repo/pull/42#issuecomment-3',
        },
      ],
    });

    const feedback = partitionReviewFeedback(pr);

    expect(feedback.humanReviews.map(review => review.id)).toEqual(['r-human']);
    expect(feedback.humanComments.map(comment => comment.id)).toEqual(['c-human']);
    expect(feedback.suppressedBotComments).toBe(1);
    expect(feedback.automatedItems.map(item => item.key)).toEqual([
      'comment:c-rabbit',
      'review:r-codex',
    ]);
    expect(feedback.automatedItems.map(item => item.vendor.id)).toEqual(['coderabbit', 'codex']);
  });
});
