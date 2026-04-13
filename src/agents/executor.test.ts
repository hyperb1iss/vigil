import { afterEach, describe, expect, mock, test } from 'bun:test';

import { vigilStore } from '../store/index.js';
import type { ProposedAction } from '../types/agents.js';
import { executeAction } from './executor.js';

function makeAction(overrides: Partial<ProposedAction> = {}): ProposedAction {
  return {
    id: 'a1',
    type: 'dismiss',
    prKey: 'owner/repo#1',
    agent: 'triage',
    description: 'Test action',
    requiresConfirmation: false,
    status: 'approved',
    ...overrides,
  };
}

afterEach(() => {
  vigilStore.getState().setPrs(new Map());
  mock.restore();
});

describe('executeAction', () => {
  test('returns a no-op summary for dismiss', async () => {
    const output = await executeAction(makeAction({ type: 'dismiss' }));
    expect(output).toBe('Dismissed.');
  });

  test('returns a no-op summary for apply_fix', async () => {
    const output = await executeAction(makeAction({ type: 'apply_fix' }));
    expect(output).toContain('No-op executor');
  });

  test('creates a worktree and updates the PR state when context is available', async () => {
    vigilStore.getState().setPrs(
      new Map([
        [
          'owner/repo#1',
          {
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
            reviewRequests: [],
            additions: 0,
            deletions: 0,
            changedFiles: 0,
            createdAt: '2026-03-01T00:00:00Z',
            updatedAt: '2026-03-01T00:00:00Z',
          },
        ],
      ])
    );

    const createWorktreeFn = mock(async () => '/tmp/worktrees/repo/feat/test');
    const getWorktreeStatusFn = mock(async () => ({
      path: '/tmp/worktrees/repo/feat/test',
      branch: 'feat/test',
      isClean: true,
      uncommittedChanges: 0,
    }));

    const output = await executeAction(makeAction({ type: 'create_worktree' }), {
      repoContexts: new Map([
        [
          'owner/repo',
          {
            repoDir: '/tmp/repos/repo',
            config: {
              owner: 'owner',
              repo: 'repo',
              baseBranch: 'main',
              worktrees: {
                autoDiscover: true,
                searchPaths: ['/tmp/worktrees/repo'],
                displayFormat: 'both',
              },
            },
          },
        ],
      ]),
      createWorktreeFn,
      getWorktreeStatusFn,
    });

    expect(output).toContain('Created worktree');
    expect(createWorktreeFn).toHaveBeenCalledTimes(1);
    expect(vigilStore.getState().prs.get('owner/repo#1')?.worktree?.path).toBe(
      '/tmp/worktrees/repo/feat/test'
    );
  });

  test('throws when create_worktree has no local repo context', async () => {
    await expect(executeAction(makeAction({ type: 'create_worktree' }))).rejects.toThrow(
      'No local repo context'
    );
  });

  test('throws for post_comment without detail text', async () => {
    await expect(executeAction(makeAction({ type: 'post_comment', detail: '' }))).rejects.toThrow(
      'missing detail text'
    );
  });

  test('throws for invalid PR key before network operations', async () => {
    await expect(
      executeAction(makeAction({ type: 'post_comment', prKey: 'bad-key', detail: 'hello' }))
    ).rejects.toThrow('Invalid PR key');
  });
});
