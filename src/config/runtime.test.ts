import { afterEach, describe, expect, mock, test } from 'bun:test';
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
  mock.restore();
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

  test('loads configured sibling repos alongside the current repo', async () => {
    const currentRepoDir = mkdtempSync(join(tmpdir(), 'vigil-runtime-current-'));
    const siblingRepoDir = mkdtempSync(join(tmpdir(), 'vigil-runtime-sibling-'));
    tempDirs.push(currentRepoDir, siblingRepoDir);

    await runGit(['init'], currentRepoDir);
    await runGit(['init'], siblingRepoDir);

    writeFileSync(
      join(currentRepoDir, '.vigilrc.json'),
      JSON.stringify({
        owner: 'acme',
        repo: 'webapp',
        baseBranch: 'main',
      })
    );
    writeFileSync(
      join(siblingRepoDir, '.vigilrc.json'),
      JSON.stringify({
        owner: 'acme',
        repo: 'api',
        baseBranch: 'main',
      })
    );

    const contexts = await loadRuntimeRepoContexts(currentRepoDir, [
      {
        repo: 'acme/api',
        path: siblingRepoDir,
      },
    ]);

    expect([...contexts.keys()].sort()).toEqual(['acme/api', 'acme/webapp']);
    expect(contexts.get('acme/api')?.repoDir).toBe(realpathSync(siblingRepoDir));
    expect(contexts.get('acme/webapp')?.repoDir).toBe(realpathSync(currentRepoDir));
  });

  test('ignores configured repos whose local config does not match the declared repo', async () => {
    const currentRepoDir = mkdtempSync(join(tmpdir(), 'vigil-runtime-current-'));
    const mismatchedRepoDir = mkdtempSync(join(tmpdir(), 'vigil-runtime-mismatch-'));
    tempDirs.push(currentRepoDir, mismatchedRepoDir);

    await runGit(['init'], currentRepoDir);
    await runGit(['init'], mismatchedRepoDir);

    writeFileSync(
      join(currentRepoDir, '.vigilrc.json'),
      JSON.stringify({
        owner: 'acme',
        repo: 'webapp',
        baseBranch: 'main',
      })
    );
    writeFileSync(
      join(mismatchedRepoDir, '.vigilrc.json'),
      JSON.stringify({
        owner: 'acme',
        repo: 'different',
        baseBranch: 'main',
      })
    );

    const errorSpy = mock(() => undefined);
    console.error = errorSpy;

    const contexts = await loadRuntimeRepoContexts(currentRepoDir, [
      {
        repo: 'acme/api',
        path: mismatchedRepoDir,
      },
    ]);

    expect([...contexts.keys()]).toEqual(['acme/webapp']);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
