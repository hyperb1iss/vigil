import { describe, expect, test } from 'bun:test';
import type { PullRequest } from '../types/pr.js';
import { diffPrs } from './differ.js';

// ─── Test Helpers ──────────────────────────────────────────────────────

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

function toMap(...prs: PullRequest[]): Map<string, PullRequest> {
  return new Map(prs.map(pr => [pr.key, pr]));
}

// ─── New PRs ───────────────────────────────────────────────────────────

describe('diffPrs → new PRs', () => {
  test('new PR emits pr_opened event', () => {
    const pr = makePr();
    const events = diffPrs(new Map(), toMap(pr));

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('pr_opened');
    expect(events[0]?.prKey).toBe('owner/repo#1');
  });

  test('multiple new PRs emit multiple pr_opened events', () => {
    const pr1 = makePr({ key: 'a/b#1', number: 1 });
    const pr2 = makePr({ key: 'a/b#2', number: 2 });
    const events = diffPrs(new Map(), toMap(pr1, pr2));

    const opened = events.filter(e => e.type === 'pr_opened');
    expect(opened).toHaveLength(2);
  });
});

// ─── Removed PRs ───────────────────────────────────────────────────────

describe('diffPrs → removed PRs', () => {
  test('PR disappearing emits pr_closed', () => {
    const pr = makePr();
    const events = diffPrs(toMap(pr), new Map());

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('pr_closed');
    expect(events[0]?.prKey).toBe('owner/repo#1');
  });
});

// ─── State Transitions ─────────────────────────────────────────────────

describe('diffPrs → state transitions', () => {
  test('OPEN → MERGED emits pr_merged', () => {
    const prev = makePr({ state: 'OPEN' });
    const curr = makePr({ state: 'MERGED' });
    const events = diffPrs(toMap(prev), toMap(curr));

    expect(events.some(e => e.type === 'pr_merged')).toBe(true);
  });

  test('OPEN → CLOSED emits pr_closed', () => {
    const prev = makePr({ state: 'OPEN' });
    const curr = makePr({ state: 'CLOSED' });
    const events = diffPrs(toMap(prev), toMap(curr));

    expect(events.some(e => e.type === 'pr_closed')).toBe(true);
  });

  test('same state emits nothing', () => {
    const prev = makePr({ state: 'OPEN' });
    const curr = makePr({ state: 'OPEN' });
    const events = diffPrs(toMap(prev), toMap(curr));

    const stateEvents = events.filter(e => e.type === 'pr_merged' || e.type === 'pr_closed');
    expect(stateEvents).toHaveLength(0);
  });
});

// ─── Draft Transitions ─────────────────────────────────────────────────

describe('diffPrs → draft transitions', () => {
  test('draft → undrafted emits undrafted', () => {
    const prev = makePr({ isDraft: true });
    const curr = makePr({ isDraft: false });
    const events = diffPrs(toMap(prev), toMap(curr));

    expect(events.some(e => e.type === 'undrafted')).toBe(true);
  });

  test('undraft → draft emits became_draft', () => {
    const prev = makePr({ isDraft: false });
    const curr = makePr({ isDraft: true });
    const events = diffPrs(toMap(prev), toMap(curr));

    expect(events.some(e => e.type === 'became_draft')).toBe(true);
  });

  test('no draft change emits nothing', () => {
    const prev = makePr({ isDraft: false });
    const curr = makePr({ isDraft: false });
    const events = diffPrs(toMap(prev), toMap(curr));

    const draftEvents = events.filter(e => e.type === 'undrafted' || e.type === 'became_draft');
    expect(draftEvents).toHaveLength(0);
  });
});

// ─── Reviews ───────────────────────────────────────────────────────────

describe('diffPrs → reviews', () => {
  test('new review emits review_submitted', () => {
    const prev = makePr({ reviews: [] });
    const curr = makePr({
      reviews: [
        {
          id: 'r1',
          author: { login: 'alice', isBot: false },
          state: 'APPROVED',
          body: 'LGTM',
          submittedAt: new Date().toISOString(),
        },
      ],
    });
    const events = diffPrs(toMap(prev), toMap(curr));

    const reviewEvents = events.filter(e => e.type === 'review_submitted');
    expect(reviewEvents).toHaveLength(1);
    expect(reviewEvents[0]?.data?.type).toBe('review_submitted');
  });

  test('same reviews emit nothing', () => {
    const review = {
      id: 'r1',
      author: { login: 'alice', isBot: false },
      state: 'APPROVED' as const,
      body: 'LGTM',
      submittedAt: new Date().toISOString(),
    };
    const prev = makePr({ reviews: [review] });
    const curr = makePr({ reviews: [review] });
    const events = diffPrs(toMap(prev), toMap(curr));

    const reviewEvents = events.filter(e => e.type === 'review_submitted');
    expect(reviewEvents).toHaveLength(0);
  });

  test('multiple new reviews each emit an event', () => {
    const prev = makePr({ reviews: [] });
    const curr = makePr({
      reviews: [
        {
          id: 'r1',
          author: { login: 'alice', isBot: false },
          state: 'APPROVED',
          body: '',
          submittedAt: new Date().toISOString(),
        },
        {
          id: 'r2',
          author: { login: 'bob', isBot: false },
          state: 'CHANGES_REQUESTED',
          body: '',
          submittedAt: new Date().toISOString(),
        },
      ],
    });
    const events = diffPrs(toMap(prev), toMap(curr));

    const reviewEvents = events.filter(e => e.type === 'review_submitted');
    expect(reviewEvents).toHaveLength(2);
  });
});

// ─── Comments ──────────────────────────────────────────────────────────

describe('diffPrs → comments', () => {
  test('new comment emits comment_added', () => {
    const prev = makePr({ comments: [] });
    const curr = makePr({
      comments: [
        {
          id: 'c1',
          author: { login: 'alice', isBot: false },
          body: 'Nice work',
          createdAt: new Date().toISOString(),
          url: '',
        },
      ],
    });
    const events = diffPrs(toMap(prev), toMap(curr));

    const commentEvents = events.filter(e => e.type === 'comment_added');
    expect(commentEvents).toHaveLength(1);
  });

  test('existing comments do not re-emit', () => {
    const comment = {
      id: 'c1',
      author: { login: 'alice', isBot: false },
      body: 'Nice',
      createdAt: new Date().toISOString(),
      url: '',
    };
    const prev = makePr({ comments: [comment] });
    const curr = makePr({ comments: [comment] });
    const events = diffPrs(toMap(prev), toMap(curr));

    const commentEvents = events.filter(e => e.type === 'comment_added');
    expect(commentEvents).toHaveLength(0);
  });
});

// ─── Check Status Changes ──────────────────────────────────────────────

describe('diffPrs → checks', () => {
  test('check conclusion change emits checks_changed', () => {
    const prev = makePr({
      checks: [{ name: 'build', status: 'IN_PROGRESS', conclusion: null }],
    });
    const curr = makePr({
      checks: [{ name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    });
    const events = diffPrs(toMap(prev), toMap(curr));

    expect(events.some(e => e.type === 'checks_changed')).toBe(true);
  });

  test('same check state emits nothing', () => {
    const check = { name: 'build', status: 'COMPLETED' as const, conclusion: 'SUCCESS' as const };
    const prev = makePr({ checks: [check] });
    const curr = makePr({ checks: [check] });
    const events = diffPrs(toMap(prev), toMap(curr));

    expect(events.some(e => e.type === 'checks_changed')).toBe(false);
  });

  test('new check added emits checks_changed', () => {
    const prev = makePr({
      checks: [{ name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    });
    const curr = makePr({
      checks: [
        { name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
        { name: 'test', status: 'IN_PROGRESS', conclusion: null },
      ],
    });
    const events = diffPrs(toMap(prev), toMap(curr));

    expect(events.some(e => e.type === 'checks_changed')).toBe(true);
  });
});

// ─── Conflict Transitions ──────────────────────────────────────────────

describe('diffPrs → conflicts', () => {
  test('entering conflict state emits conflict_detected', () => {
    const prev = makePr({ mergeable: 'MERGEABLE' });
    const curr = makePr({ mergeable: 'CONFLICTING' });
    const events = diffPrs(toMap(prev), toMap(curr));

    expect(events.some(e => e.type === 'conflict_detected')).toBe(true);
  });

  test('resolving conflict emits conflict_resolved', () => {
    const prev = makePr({ mergeable: 'CONFLICTING' });
    const curr = makePr({ mergeable: 'MERGEABLE' });
    const events = diffPrs(toMap(prev), toMap(curr));

    expect(events.some(e => e.type === 'conflict_resolved')).toBe(true);
  });

  test('unknown → conflicting emits conflict_detected', () => {
    const prev = makePr({ mergeable: 'UNKNOWN' });
    const curr = makePr({ mergeable: 'CONFLICTING' });
    const events = diffPrs(toMap(prev), toMap(curr));

    expect(events.some(e => e.type === 'conflict_detected')).toBe(true);
  });

  test('staying conflicting emits nothing', () => {
    const prev = makePr({ mergeable: 'CONFLICTING' });
    const curr = makePr({ mergeable: 'CONFLICTING' });
    const events = diffPrs(toMap(prev), toMap(curr));

    const conflictEvents = events.filter(
      e => e.type === 'conflict_detected' || e.type === 'conflict_resolved'
    );
    expect(conflictEvents).toHaveLength(0);
  });
});

// ─── Label Changes ─────────────────────────────────────────────────────

describe('diffPrs → labels', () => {
  test('adding a label emits labels_changed', () => {
    const prev = makePr({ labels: [] });
    const curr = makePr({ labels: [{ id: 'l1', name: 'bug', color: 'red' }] });
    const events = diffPrs(toMap(prev), toMap(curr));

    const labelEvents = events.filter(e => e.type === 'labels_changed');
    expect(labelEvents).toHaveLength(1);
    if (labelEvents[0]?.data?.type === 'labels_changed') {
      expect(labelEvents[0].data.added).toContain('bug');
      expect(labelEvents[0].data.removed).toHaveLength(0);
    }
  });

  test('removing a label emits labels_changed', () => {
    const prev = makePr({ labels: [{ id: 'l1', name: 'bug', color: 'red' }] });
    const curr = makePr({ labels: [] });
    const events = diffPrs(toMap(prev), toMap(curr));

    const labelEvents = events.filter(e => e.type === 'labels_changed');
    expect(labelEvents).toHaveLength(1);
    if (labelEvents[0]?.data?.type === 'labels_changed') {
      expect(labelEvents[0].data.removed).toContain('bug');
      expect(labelEvents[0].data.added).toHaveLength(0);
    }
  });

  test('same labels emit nothing', () => {
    const label = { id: 'l1', name: 'bug', color: 'red' };
    const prev = makePr({ labels: [label] });
    const curr = makePr({ labels: [label] });
    const events = diffPrs(toMap(prev), toMap(curr));

    expect(events.some(e => e.type === 'labels_changed')).toBe(false);
  });
});

// ─── Ready to Merge ────────────────────────────────────────────────────

describe('diffPrs → ready_to_merge', () => {
  test('transition to ready emits ready_to_merge', () => {
    const prev = makePr({
      reviewDecision: 'REVIEW_REQUIRED',
      mergeable: 'MERGEABLE',
      checks: [{ name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    });
    const curr = makePr({
      reviewDecision: 'APPROVED',
      mergeable: 'MERGEABLE',
      checks: [{ name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    });
    const events = diffPrs(toMap(prev), toMap(curr));

    expect(events.some(e => e.type === 'ready_to_merge')).toBe(true);
  });

  test('already ready does not re-emit', () => {
    const readyPr = makePr({
      reviewDecision: 'APPROVED',
      mergeable: 'MERGEABLE',
      checks: [{ name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    });
    const events = diffPrs(toMap(readyPr), toMap(readyPr));

    expect(events.some(e => e.type === 'ready_to_merge')).toBe(false);
  });
});

// ─── Edge Cases ────────────────────────────────────────────────────────

describe('diffPrs → edge cases', () => {
  test('empty → empty produces no events', () => {
    const events = diffPrs(new Map(), new Map());
    expect(events).toHaveLength(0);
  });

  test('unchanged PR produces no events', () => {
    const pr = makePr();
    const events = diffPrs(toMap(pr), toMap(pr));
    expect(events).toHaveLength(0);
  });

  test('multiple changes on same PR produce multiple events', () => {
    const prev = makePr({
      isDraft: true,
      reviews: [],
      labels: [],
      checks: [{ name: 'build', status: 'IN_PROGRESS', conclusion: null }],
    });
    const curr = makePr({
      isDraft: false,
      reviews: [
        {
          id: 'r1',
          author: { login: 'alice', isBot: false },
          state: 'APPROVED',
          body: '',
          submittedAt: new Date().toISOString(),
        },
      ],
      labels: [{ id: 'l1', name: 'approved', color: 'green' }],
      checks: [{ name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    });
    const events = diffPrs(toMap(prev), toMap(curr));

    // undrafted + review_submitted + labels_changed + checks_changed
    expect(events.length).toBeGreaterThanOrEqual(4);
    const types = new Set(events.map(e => e.type));
    expect(types.has('undrafted')).toBe(true);
    expect(types.has('review_submitted')).toBe(true);
    expect(types.has('labels_changed')).toBe(true);
    expect(types.has('checks_changed')).toBe(true);
  });
});
