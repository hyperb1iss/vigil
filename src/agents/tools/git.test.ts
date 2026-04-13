import { describe, expect, test } from 'bun:test';

import { _internal } from './git.js';

describe('validateGitPath', () => {
  test('accepts normal relative paths', () => {
    expect(_internal.validateGitPath('/tmp/worktree', 'src/app.ts')).toBe('src/app.ts');
  });

  test('rejects option-like paths', () => {
    expect(() => _internal.validateGitPath('/tmp/worktree', '-A')).toThrow(
      'must not start with "-"'
    );
  });

  test('rejects paths outside the worktree', () => {
    expect(() => _internal.validateGitPath('/tmp/worktree', '../secret.txt')).toThrow(
      'escapes the worktree boundary'
    );
  });
});
