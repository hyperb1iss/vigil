import { describe, expect, test } from 'bun:test';
import { homedir } from 'node:os';

import type { RepoRuntimeContext } from '../types/config.js';
import { _internal } from './worktrees.js';

const { parsePorcelainOutput, resolveWorktreeSearchPaths, resolveWorktreeTargetDir } = _internal;

function makeRepoContext(overrides: Partial<RepoRuntimeContext> = {}): RepoRuntimeContext {
  return {
    repoDir: '/tmp/repos/webapp',
    config: {
      owner: 'acme',
      repo: 'webapp',
      baseBranch: 'main',
      worktrees: {
        autoDiscover: true,
        searchPaths: ['~/worktrees/webapp', './extra-worktrees'],
        displayFormat: 'both',
      },
    },
    ...overrides,
  };
}

describe('parsePorcelainOutput', () => {
  test('parses branch-backed worktrees and skips detached entries', () => {
    const output = [
      'worktree /tmp/repos/webapp',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /tmp/worktrees/webapp/feature-x',
      'HEAD def456',
      'branch refs/heads/feature/x',
      '',
      'worktree /tmp/worktrees/webapp/detached',
      'HEAD ghi789',
      'detached',
    ].join('\n');

    expect(parsePorcelainOutput(output)).toEqual([
      { path: '/tmp/repos/webapp', branch: 'main', sha: 'abc123' },
      { path: '/tmp/worktrees/webapp/feature-x', branch: 'feature/x', sha: 'def456' },
    ]);
  });
});

describe('resolveWorktreeSearchPaths', () => {
  test('includes the repo root and resolves configured search paths', () => {
    const repoContext = makeRepoContext();

    expect(resolveWorktreeSearchPaths(repoContext.repoDir, repoContext)).toEqual([
      '/tmp/repos/webapp',
      `${homedir()}/worktrees/webapp`,
      '/tmp/repos/webapp/extra-worktrees',
    ]);
  });

  test('falls back to the repo root when autodiscovery is disabled and no extra paths exist', () => {
    const repoContext = makeRepoContext({
      config: {
        owner: 'acme',
        repo: 'webapp',
        baseBranch: 'main',
        worktrees: {
          autoDiscover: false,
          searchPaths: [],
          displayFormat: 'both',
        },
      },
    });

    expect(resolveWorktreeSearchPaths(repoContext.repoDir, repoContext)).toEqual([
      '/tmp/repos/webapp',
    ]);
  });
});

describe('resolveWorktreeTargetDir', () => {
  test('places new worktrees under the first configured search path', () => {
    const repoContext = makeRepoContext();

    expect(resolveWorktreeTargetDir(repoContext.repoDir, 'feature/auto-keys', repoContext)).toBe(
      `${homedir()}/worktrees/webapp/feature/auto-keys`
    );
  });

  test('falls back to a repo-adjacent vigil worktree root', () => {
    expect(resolveWorktreeTargetDir('/tmp/repos/webapp', 'feat/test')).toBe(
      '/tmp/repos/.vigil-worktrees/webapp/feat/test'
    );
  });
});
