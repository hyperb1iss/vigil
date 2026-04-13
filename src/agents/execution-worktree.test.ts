import { describe, expect, test } from 'bun:test';

import type { ProposedAction } from '../types/agents.js';
import type { PullRequest } from '../types/pr.js';
import { _internal } from './execution-worktree.js';

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
    mergeable: 'UNKNOWN',
    mergeStateStatus: 'UNKNOWN',
    reviewDecision: '',
    reviews: [],
    comments: [],
    checks: [],
    labels: [],
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-01T00:00:00Z',
    ...overrides,
  };
}

function makeAction(overrides: Partial<ProposedAction> = {}): ProposedAction {
  return {
    id: 'a1',
    type: 'apply_fix',
    prKey: 'owner/repo#1',
    agent: 'fix',
    description: 'Test action',
    requiresConfirmation: false,
    status: 'approved',
    ...overrides,
  };
}

describe('resolveExecutionWorktreePath', () => {
  test('prefers the PR attached worktree path', () => {
    const path = _internal.resolveExecutionWorktreePath(
      makeAction({
        context: {
          worktreePath: '/tmp/worktrees/repo/live',
          event: {
            type: 'pr_opened',
            timestamp: '2026-03-01T00:00:00Z',
            pr: makePr({
              worktree: {
                path: '/tmp/worktrees/repo/event',
                branch: 'feat/test',
                isClean: true,
                uncommittedChanges: 0,
              },
            }),
          },
        },
      }),
      makePr({
        worktree: {
          path: '/tmp/worktrees/repo/live',
          branch: 'feat/test',
          isClean: true,
          uncommittedChanges: 0,
        },
      })
    );

    expect(path).toBe('/tmp/worktrees/repo/live');
  });

  test('falls back to the event worktree path when the PR copy lacks one', () => {
    const path = _internal.resolveExecutionWorktreePath(
      makeAction({
        context: {
          event: {
            type: 'pr_opened',
            timestamp: '2026-03-01T00:00:00Z',
            pr: makePr({
              worktree: {
                path: '/tmp/worktrees/repo/event',
                branch: 'feat/test',
                isClean: true,
                uncommittedChanges: 0,
              },
            }),
          },
        },
      }),
      makePr()
    );

    expect(path).toBe('/tmp/worktrees/repo/event');
  });

  test('rejects stale action context paths that do not match the attached worktree', () => {
    expect(() =>
      _internal.resolveExecutionWorktreePath(
        makeAction({
          context: {
            worktreePath: '/tmp/worktrees/repo/stale',
            event: {
              type: 'pr_opened',
              timestamp: '2026-03-01T00:00:00Z',
              pr: makePr({
                worktree: {
                  path: '/tmp/worktrees/repo/live',
                  branch: 'feat/test',
                  isClean: true,
                  uncommittedChanges: 0,
                },
              }),
            },
          },
        }),
        makePr({
          worktree: {
            path: '/tmp/worktrees/repo/live',
            branch: 'feat/test',
            isClean: true,
            uncommittedChanges: 0,
          },
        })
      )
    ).toThrow('references stale worktree path');
  });

  test('rejects execution without any attached worktree', () => {
    expect(() => _internal.resolveExecutionWorktreePath(makeAction(), makePr())).toThrow(
      'has no attached worktree'
    );
  });
});
