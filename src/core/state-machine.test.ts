import { describe, expect, test } from 'bun:test';
import type { PullRequest } from '../types/pr.js';
import { classifyPr } from './state-machine.js';

// ─── Test Helpers ──────────────────────────────────────────────────────

/** Build a minimal PullRequest with sensible defaults, override what you need. */
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
    additions: 10,
    deletions: 5,
    changedFiles: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const THRESHOLD_HOURS = 48;

// ─── Blocked State ─────────────────────────────────────────────────────

describe('classifyPr → blocked', () => {
  test('draft PRs are blocked', () => {
    const pr = makePr({ isDraft: true });
    expect(classifyPr(pr, THRESHOLD_HOURS)).toBe('blocked');
  });

  test('closed PRs are blocked', () => {
    const pr = makePr({ state: 'CLOSED' });
    expect(classifyPr(pr, THRESHOLD_HOURS)).toBe('blocked');
  });

  test('merged PRs are blocked', () => {
    const pr = makePr({ state: 'MERGED' });
    expect(classifyPr(pr, THRESHOLD_HOURS)).toBe('blocked');
  });

  test('draft with everything else green is still blocked', () => {
    const pr = makePr({
      isDraft: true,
      reviewDecision: 'APPROVED',
      checks: [{ name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    });
    expect(classifyPr(pr, THRESHOLD_HOURS)).toBe('blocked');
  });
});

// ─── Hot State ─────────────────────────────────────────────────────────

describe('classifyPr → hot', () => {
  test('changes requested review makes it hot', () => {
    const pr = makePr({ reviewDecision: 'CHANGES_REQUESTED' });
    expect(classifyPr(pr, THRESHOLD_HOURS)).toBe('hot');
  });

  test('merge conflict makes it hot', () => {
    const pr = makePr({ mergeable: 'CONFLICTING' });
    expect(classifyPr(pr, THRESHOLD_HOURS)).toBe('hot');
  });

  test('CI failure makes it hot', () => {
    const pr = makePr({
      checks: [
        { name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
        { name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' },
      ],
    });
    expect(classifyPr(pr, THRESHOLD_HOURS)).toBe('hot');
  });

  test('cancelled CI check makes it hot', () => {
    const pr = makePr({
      checks: [{ name: 'build', status: 'COMPLETED', conclusion: 'CANCELLED' }],
    });
    expect(classifyPr(pr, THRESHOLD_HOURS)).toBe('hot');
  });

  test('conflict + changes requested + CI failure = still just hot', () => {
    const pr = makePr({
      reviewDecision: 'CHANGES_REQUESTED',
      mergeable: 'CONFLICTING',
      checks: [{ name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' }],
    });
    expect(classifyPr(pr, THRESHOLD_HOURS)).toBe('hot');
  });

  test('in-progress checks with one failure is hot', () => {
    const pr = makePr({
      checks: [
        { name: 'build', status: 'IN_PROGRESS', conclusion: null },
        { name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE' },
      ],
    });
    expect(classifyPr(pr, THRESHOLD_HOURS)).toBe('hot');
  });
});

// ─── Ready State ───────────────────────────────────────────────────────

describe('classifyPr → ready', () => {
  test('all checks green + approved + mergeable = ready', () => {
    const pr = makePr({
      reviewDecision: 'APPROVED',
      mergeable: 'MERGEABLE',
      checks: [
        { name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
        { name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' },
        { name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' },
      ],
    });
    expect(classifyPr(pr, THRESHOLD_HOURS)).toBe('ready');
  });

  test('skipped checks count as passing for ready', () => {
    const pr = makePr({
      reviewDecision: 'APPROVED',
      mergeable: 'MERGEABLE',
      checks: [
        { name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
        { name: 'e2e', status: 'COMPLETED', conclusion: 'SKIPPED' },
      ],
    });
    expect(classifyPr(pr, THRESHOLD_HOURS)).toBe('ready');
  });

  test('neutral checks count as passing for ready', () => {
    const pr = makePr({
      reviewDecision: 'APPROVED',
      mergeable: 'MERGEABLE',
      checks: [
        { name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
        { name: 'info', status: 'COMPLETED', conclusion: 'NEUTRAL' },
      ],
    });
    expect(classifyPr(pr, THRESHOLD_HOURS)).toBe('ready');
  });

  test('no checks means not ready (even if approved + mergeable)', () => {
    const pr = makePr({
      reviewDecision: 'APPROVED',
      mergeable: 'MERGEABLE',
      checks: [],
    });
    // No checks = allChecksPassing is false → falls through to dormant or waiting
    expect(classifyPr(pr, THRESHOLD_HOURS)).not.toBe('ready');
  });

  test('approved but unknown mergeable is not ready', () => {
    const pr = makePr({
      reviewDecision: 'APPROVED',
      mergeable: 'UNKNOWN',
      checks: [{ name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    });
    expect(classifyPr(pr, THRESHOLD_HOURS)).not.toBe('ready');
  });
});

// ─── Dormant State ─────────────────────────────────────────────────────

describe('classifyPr → dormant', () => {
  test('PR with no activity beyond threshold is dormant', () => {
    const oldDate = new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString(); // 49 hours ago
    const pr = makePr({ updatedAt: oldDate });
    expect(classifyPr(pr, THRESHOLD_HOURS)).toBe('dormant');
  });

  test('PR exactly at threshold boundary is not dormant', () => {
    // Exactly at 48 hours — should NOT be dormant (> not >=)
    const exactDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const pr = makePr({ updatedAt: exactDate });
    expect(classifyPr(pr, THRESHOLD_HOURS)).not.toBe('dormant');
  });

  test('custom threshold of 24h catches fresher PRs', () => {
    const date = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25 hours ago
    const pr = makePr({ updatedAt: date });
    expect(classifyPr(pr, 24)).toBe('dormant');
  });

  test('stale PR with hot signals is still hot (priority)', () => {
    const oldDate = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    const pr = makePr({
      updatedAt: oldDate,
      reviewDecision: 'CHANGES_REQUESTED',
    });
    expect(classifyPr(pr, THRESHOLD_HOURS)).toBe('hot');
  });
});

// ─── Waiting State (Fallthrough) ───────────────────────────────────────

describe('classifyPr → waiting', () => {
  test('open PR with no signals is waiting', () => {
    const pr = makePr();
    expect(classifyPr(pr, THRESHOLD_HOURS)).toBe('waiting');
  });

  test('PR with running CI is waiting', () => {
    const pr = makePr({
      checks: [{ name: 'build', status: 'IN_PROGRESS', conclusion: null }],
    });
    expect(classifyPr(pr, THRESHOLD_HOURS)).toBe('waiting');
  });

  test('PR with pending reviews is waiting', () => {
    const pr = makePr({ reviewDecision: 'REVIEW_REQUIRED' });
    expect(classifyPr(pr, THRESHOLD_HOURS)).toBe('waiting');
  });

  test('all checks green but not approved is waiting', () => {
    const pr = makePr({
      reviewDecision: '',
      mergeable: 'MERGEABLE',
      checks: [{ name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    });
    expect(classifyPr(pr, THRESHOLD_HOURS)).toBe('waiting');
  });

  test('approved but CI still running is waiting', () => {
    const pr = makePr({
      reviewDecision: 'APPROVED',
      mergeable: 'MERGEABLE',
      checks: [
        { name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
        { name: 'e2e', status: 'IN_PROGRESS', conclusion: null },
      ],
    });
    expect(classifyPr(pr, THRESHOLD_HOURS)).toBe('waiting');
  });

  test('queued checks are waiting', () => {
    const pr = makePr({
      checks: [{ name: 'build', status: 'QUEUED', conclusion: null }],
    });
    expect(classifyPr(pr, THRESHOLD_HOURS)).toBe('waiting');
  });
});

// ─── Priority Order ────────────────────────────────────────────────────

describe('classifyPr priority', () => {
  test('blocked takes precedence over everything', () => {
    const pr = makePr({
      isDraft: true,
      reviewDecision: 'CHANGES_REQUESTED',
      mergeable: 'CONFLICTING',
    });
    expect(classifyPr(pr, THRESHOLD_HOURS)).toBe('blocked');
  });

  test('hot takes precedence over ready signals', () => {
    const pr = makePr({
      reviewDecision: 'CHANGES_REQUESTED', // hot signal
      mergeable: 'MERGEABLE',
      checks: [{ name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    });
    expect(classifyPr(pr, THRESHOLD_HOURS)).toBe('hot');
  });
});
