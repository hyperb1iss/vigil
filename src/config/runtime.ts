import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import type { LocalRepoConfig, RepoRuntimeContext } from '../types/config.js';
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

function expandPath(path: string): string {
  if (path === '~') {
    return homedir();
  }

  if (path.startsWith('~/') || path.startsWith('~\\')) {
    return resolve(homedir(), path.slice(2));
  }

  return path;
}

function repoContextKey(repoContext: RepoRuntimeContext): string {
  return `${repoContext.config.owner}/${repoContext.config.repo}`;
}

async function loadRepoContextFromPath(startDir: string): Promise<RepoRuntimeContext | null> {
  const repoRoot = await findGitRepoRoot(startDir);
  if (!repoRoot) {
    return null;
  }

  const repoConfig = await loadRepoConfig(repoRoot);
  if (!repoConfig) {
    return null;
  }

  return {
    repoDir: repoRoot,
    config: repoConfig,
  };
}

async function loadConfiguredRepoContext(
  localRepo: LocalRepoConfig
): Promise<RepoRuntimeContext | null> {
  const repoPath = resolve(expandPath(localRepo.path));
  const repoContext = await loadRepoContextFromPath(repoPath);
  if (!repoContext) {
    console.error(
      `[vigil] ignoring local repo ${localRepo.repo} at ${repoPath}: missing git metadata or .vigilrc.json`
    );
    return null;
  }

  const actualRepo = repoContextKey(repoContext);
  if (actualRepo !== localRepo.repo) {
    console.error(
      `[vigil] ignoring local repo ${localRepo.repo} at ${repoPath}: .vigilrc.json declares ${actualRepo}`
    );
    return null;
  }

  return repoContext;
}

export async function loadRuntimeRepoContexts(
  startDir = process.cwd(),
  localRepos: LocalRepoConfig[] = []
): Promise<Map<string, RepoRuntimeContext>> {
  const contexts = new Map<string, RepoRuntimeContext>();

  const configuredContexts = await Promise.all(localRepos.map(loadConfiguredRepoContext));
  for (const repoContext of configuredContexts) {
    if (!repoContext) continue;
    contexts.set(repoContextKey(repoContext), repoContext);
  }

  const currentRepoContext = await loadRepoContextFromPath(startDir);
  if (currentRepoContext) {
    contexts.set(repoContextKey(currentRepoContext), currentRepoContext);
  }

  return contexts;
}
