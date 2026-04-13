import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { promisify } from 'node:util';

import type { RepoRuntimeContext } from '../types/config.js';
import { loadRepoConfig } from './loader.js';

const execFileAsync = promisify(execFile);

export async function findGitRepoRoot(startDir = process.cwd()): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
      cwd: startDir,
    });
    const repoRoot = stdout.trim();
    return repoRoot.length > 0 ? realpathSync(repoRoot) : null;
  } catch {
    return null;
  }
}

export async function loadRuntimeRepoContexts(
  startDir = process.cwd()
): Promise<Map<string, RepoRuntimeContext>> {
  const repoRoot = await findGitRepoRoot(startDir);
  if (!repoRoot) {
    return new Map();
  }

  const repoConfig = await loadRepoConfig(repoRoot);
  if (!repoConfig) {
    return new Map();
  }

  return new Map([
    [
      `${repoConfig.owner}/${repoConfig.repo}`,
      {
        repoDir: repoRoot,
        config: repoConfig,
      },
    ],
  ]);
}
