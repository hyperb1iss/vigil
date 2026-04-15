import { describe, expect, test } from 'bun:test';

import type { PullRequest } from '../types/pr.js';
import { _internal } from './pr-detail.js';

const {
  detectAutomatedReviewVendor,
  partitionReviewFeedback,
  isBotNoise,
  buildDetailItems,
  findRelativeReviewItemIndex,
} = _internal;

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

describe('buildDetailItems', () => {
  test('builds a navigator model with overview first and reviewables grouped after', () => {
    const pr = makePr('owner/repo#77', {
      body: 'Summary body',
      reviewDecision: 'CHANGES_REQUESTED',
      reviewRequests: [{ login: 'team-reviewer' }],
      labels: [{ id: 'l1', name: 'needs-fix', color: 'ff0000' }],
      reviews: [
        {
          id: 'r-human',
          author: { login: 'alice', isBot: false },
          state: 'CHANGES_REQUESTED',
          body: 'Fix the edge case.',
          submittedAt: '2026-04-15T10:00:00.000Z',
        },
      ],
      comments: [
        {
          id: 'c-codex',
          author: { login: 'openai-codex', isBot: true },
          body: 'Codex review: tighten the null handling.',
          createdAt: '2026-04-15T12:00:00.000Z',
          url: 'https://github.com/owner/repo/pull/77#issuecomment-2',
        },
        {
          id: 'c-human',
          author: { login: 'bob', isBot: false },
          body: 'Please rename this helper.',
          createdAt: '2026-04-15T13:00:00.000Z',
          url: 'https://github.com/owner/repo/pull/77#issuecomment-3',
        },
      ],
      checks: [
        {
          name: 'build',
          status: 'COMPLETED',
          conclusion: 'FAILURE',
          workflowName: 'CI',
        },
      ],
    });

    const items = buildDetailItems(pr);

    expect(items.map(item => item.kind)).toEqual([
      'overview',
      'agent',
      'review',
      'comment',
      'check',
    ]);
    expect(items[0]).toMatchObject({
      key: 'overview',
      title: 'PR Snapshot',
      subtitle: 'changes requested',
    });
    expect(items[1]).toMatchObject({
      key: 'comment:c-codex',
      kind: 'agent',
      title: 'CODEX comment',
    });
    expect(items[2]).toMatchObject({
      key: 'review:r-human',
      kind: 'review',
      title: 'alice',
    });
  });
});

describe('findRelativeReviewItemIndex', () => {
  test('jumps between review items without stopping on overview or comments', () => {
    const items = buildDetailItems(
      makePr('owner/repo#88', {
        reviews: [
          {
            id: 'r-human',
            author: { login: 'alice', isBot: false },
            state: 'COMMENTED',
            body: 'First review.',
            submittedAt: '2026-04-15T10:00:00.000Z',
          },
        ],
        comments: [
          {
            id: 'c-human',
            author: { login: 'bob', isBot: false },
            body: 'Plain comment.',
            createdAt: '2026-04-15T11:00:00.000Z',
            url: 'https://github.com/owner/repo/pull/88#issuecomment-1',
          },
        ],
        checks: [{ name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }],
      })
    );

    expect(findRelativeReviewItemIndex(items, 0, 1)).toBe(1);
    expect(findRelativeReviewItemIndex(items, 1, 1)).toBe(1);
    expect(findRelativeReviewItemIndex(items, items.length - 1, -1)).toBe(1);
  });
});
