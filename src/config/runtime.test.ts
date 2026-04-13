import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { findGitRepoRoot, loadRuntimeRepoContexts } from './runtime.js';

const tempDirs: string[] = [];

async function runGit(args: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(['git', ...args], {
    cwd,
    stdout: 'ignore',
    stderr: 'pipe',
  });
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(stderr || `git ${args.join(' ')} failed`);
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('findGitRepoRoot', () => {
  test('returns the git root for a nested directory', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'vigil-runtime-'));
    tempDirs.push(repoDir);
    await runGit(['init'], repoDir);

    const nestedDir = join(repoDir, 'src', 'nested');
    mkdirSync(nestedDir, { recursive: true });
    await Bun.write(join(nestedDir, '.keep'), '');

    const repoRoot = await findGitRepoRoot(nestedDir);
    expect(repoRoot).toBe(realpathSync(repoDir));
  });
});

describe('loadRuntimeRepoContexts', () => {
  test('loads the current repo config into a runtime map', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'vigil-runtime-config-'));
    tempDirs.push(repoDir);
    await runGit(['init'], repoDir);

    writeFileSync(
      join(repoDir, '.vigilrc.json'),
      JSON.stringify({
        owner: 'acme',
        repo: 'webapp',
        baseBranch: 'main',
        worktrees: {
          autoDiscover: true,
          searchPaths: ['~/worktrees/webapp'],
          displayFormat: 'both',
        },
      })
    );

    const contexts = await loadRuntimeRepoContexts(repoDir);
    const context = contexts.get('acme/webapp');

    expect(context?.repoDir).toBe(realpathSync(repoDir));
    expect(context?.config.baseBranch).toBe('main');
    expect(context?.config.worktrees?.searchPaths).toEqual(['~/worktrees/webapp']);
  });
});
