import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { _internal } from './fs.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('safePath', () => {
  test('allows regular files inside the worktree', () => {
    const worktree = mkdtempSync(join(tmpdir(), 'vigil-fs-'));
    tempDirs.push(worktree);
    writeFileSync(join(worktree, 'inside.txt'), 'hello');

    const resolved = _internal.safePath(worktree, 'inside.txt');
    expect(resolved).toBe(join(realpathSync(worktree), 'inside.txt'));
  });

  test('rejects symlink escapes for reads', () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'vigil-fs-'));
    const outside = mkdtempSync(join(tmpdir(), 'vigil-fs-outside-'));
    tempDirs.push(sandbox, outside);
    writeFileSync(join(outside, 'secret.txt'), 'shh');
    symlinkSync(join(outside, 'secret.txt'), join(sandbox, 'secret-link.txt'));

    expect(() => _internal.safePath(sandbox, 'secret-link.txt')).toThrow('escapes the worktree');
  });

  test('rejects writes through symlinked directories', () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'vigil-fs-'));
    const outside = mkdtempSync(join(tmpdir(), 'vigil-fs-outside-'));
    tempDirs.push(sandbox, outside);
    mkdirSync(join(outside, 'nested'), { recursive: true });
    symlinkSync(outside, join(sandbox, 'linked-dir'));

    expect(() => _internal.safePath(sandbox, 'linked-dir/file.txt', true)).toThrow(
      'escapes the worktree'
    );
  });
});
