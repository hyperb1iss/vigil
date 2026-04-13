import { afterEach, describe, expect, test } from 'bun:test';

import type { RepoRuntimeContext } from '../types/config.js';
import { _internal } from './worktrees.js';

const { parsePorcelainOutput, resolveWorktreeSearchPaths, resolveWorktreeTargetDir } = _internal;

const originalHome = process.env.HOME;

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
});

function makeRepoContext(overrides: Partial<RepoRuntimeContext> = {}): RepoRuntimeContext {
  return {
    repoDir: '/tmp/repos/vigil',
    config: {
      owner: 'hyperb1iss',
      repo: 'vigil',
      baseBranch: 'main',
      worktrees: {
        autoDiscover: true,
        searchPaths: ['~/dev/worktrees/vigil', './extra-worktrees'],
        displayFormat: 'both',
      },
    },
    ...overrides,
  };
}

describe('parsePorcelainOutput', () => {
  test('parses branch-backed worktrees and skips detached entries', () => {
    const output = [
      'worktree /tmp/repos/vigil',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /tmp/worktrees/vigil/feature-x',
      'HEAD def456',
      'branch refs/heads/feature/x',
      '',
      'worktree /tmp/worktrees/vigil/detached',
      'HEAD ghi789',
      'detached',
    ].join('\n');

    expect(parsePorcelainOutput(output)).toEqual([
      { path: '/tmp/repos/vigil', branch: 'main', sha: 'abc123' },
      { path: '/tmp/worktrees/vigil/feature-x', branch: 'feature/x', sha: 'def456' },
    ]);
  });
});

describe('resolveWorktreeSearchPaths', () => {
  test('includes the repo root and resolves configured search paths', () => {
    process.env.HOME = '/Users/bliss';
    const repoContext = makeRepoContext();

    expect(resolveWorktreeSearchPaths(repoContext.repoDir, repoContext)).toEqual([
      '/tmp/repos/vigil',
      '/Users/bliss/dev/worktrees/vigil',
      '/tmp/repos/vigil/extra-worktrees',
    ]);
  });

  test('falls back to the repo root when autodiscovery is disabled and no extra paths exist', () => {
    const repoContext = makeRepoContext({
      config: {
        owner: 'hyperb1iss',
        repo: 'vigil',
        baseBranch: 'main',
        worktrees: {
          autoDiscover: false,
          searchPaths: [],
          displayFormat: 'both',
        },
      },
    });

    expect(resolveWorktreeSearchPaths(repoContext.repoDir, repoContext)).toEqual([
      '/tmp/repos/vigil',
    ]);
  });
});

describe('resolveWorktreeTargetDir', () => {
  test('places new worktrees under the first configured search path', () => {
    process.env.HOME = '/Users/bliss';
    const repoContext = makeRepoContext();

    expect(resolveWorktreeTargetDir(repoContext.repoDir, 'stef/auto-keys', repoContext)).toBe(
      '/Users/bliss/dev/worktrees/vigil/stef/auto-keys'
    );
  });

  test('falls back to a repo-adjacent vigil worktree root', () => {
    expect(resolveWorktreeTargetDir('/tmp/repos/vigil', 'feat/test')).toBe(
      '/tmp/repos/.vigil-worktrees/vigil/feat/test'
    );
  });
});
