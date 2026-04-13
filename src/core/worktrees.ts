import { execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { promisify } from 'node:util';

import simpleGit from 'simple-git';

import type { RepoRuntimeContext } from '../types/config.js';
import type { PrWorktree, PullRequest } from '../types/pr.js';

const execFileAsync = promisify(execFile);

// ─── Types ───────────────────────────────────────────────────────────

export interface WorktreeInfo {
  path: string;
  branch: string;
  sha: string;
}

// ─── Discovery ───────────────────────────────────────────────────────

/**
 * Parse `git worktree list --porcelain` output into WorktreeInfo entries.
 *
 * Porcelain format emits blocks separated by blank lines:
 *   worktree /path/to/tree
 *   HEAD abc123...
 *   branch refs/heads/feature-x
 *
 * Detached worktrees have `detached` instead of `branch ...` — we skip those
 * since we can't meaningfully map them to PR branches.
 */
function parsePorcelainOutput(output: string): WorktreeInfo[] {
  const results: WorktreeInfo[] = [];
  const blocks = output.split('\n\n');

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length === 0) continue;

    let path: string | undefined;
    let sha: string | undefined;
    let branch: string | undefined;

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        path = line.slice('worktree '.length);
      } else if (line.startsWith('HEAD ')) {
        sha = line.slice('HEAD '.length);
      } else if (line.startsWith('branch ')) {
        const ref = line.slice('branch '.length);
        branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
      }
    }

    if (path && sha && branch) {
      results.push({ path, branch, sha });
    }
  }

  return results;
}

/**
 * Run `git worktree list --porcelain` in a directory and collect results.
 * Returns an empty array if the directory isn't a git repo or the command fails.
 */
async function listWorktreesInDir(dir: string): Promise<WorktreeInfo[]> {
  try {
    const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], {
      cwd: dir,
    });
    return parsePorcelainOutput(stdout);
  } catch {
    return [];
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

export function resolveWorktreeSearchPaths(
  repoDir: string,
  repoContext?: RepoRuntimeContext | null | undefined
): string[] {
  const roots = new Set<string>();
  const config = repoContext?.config.worktrees;

  if (config?.autoDiscover ?? true) {
    roots.add(resolve(repoDir));
  }

  for (const searchPath of config?.searchPaths ?? []) {
    roots.add(resolve(repoDir, expandPath(searchPath)));
  }

  if (roots.size === 0) {
    roots.add(resolve(repoDir));
  }

  return [...roots];
}

export function resolveWorktreeTargetDir(
  repoDir: string,
  branch: string,
  repoContext?: RepoRuntimeContext | null | undefined
): string {
  const configuredRoot = repoContext?.config.worktrees?.searchPaths[0];
  const baseDir = configuredRoot
    ? resolve(repoDir, expandPath(configuredRoot))
    : resolve(dirname(repoDir), '.vigil-worktrees', basename(repoDir));

  const segments = branch.split('/').filter(Boolean);
  return resolve(baseDir, ...segments);
}

/**
 * Discover all git worktrees across search paths and return a map of
 * branch name to worktree info.
 *
 * If no search paths are provided, defaults to the current working directory.
 * Duplicate branches are resolved by last-write-wins (later search paths override).
 */
export async function discoverWorktrees(
  searchPaths?: string[]
): Promise<Map<string, WorktreeInfo>> {
  const dirs = searchPaths && searchPaths.length > 0 ? searchPaths : [process.cwd()];
  const map = new Map<string, WorktreeInfo>();

  const results = await Promise.all(dirs.map(dir => listWorktreesInDir(dir)));

  for (const worktrees of results) {
    for (const wt of worktrees) {
      map.set(wt.branch, wt);
    }
  }

  return map;
}

// ─── Matching ────────────────────────────────────────────────────────

export function findWorktreeForBranch(
  branch: string,
  worktrees: Map<string, WorktreeInfo>
): WorktreeInfo | undefined {
  const bare = branch.startsWith('refs/heads/') ? branch.slice('refs/heads/'.length) : branch;
  return worktrees.get(bare);
}

// ─── Status ──────────────────────────────────────────────────────────

export async function getWorktreeStatus(path: string): Promise<PrWorktree> {
  const git = simpleGit(path);
  const status = await git.status();

  const uncommittedChanges =
    status.not_added.length +
    status.modified.length +
    status.deleted.length +
    status.staged.length +
    status.renamed.length +
    status.conflicted.length;

  return {
    path,
    branch: status.current ?? 'HEAD',
    isClean: status.isClean(),
    uncommittedChanges,
  };
}

// ─── Creation ────────────────────────────────────────────────────────

async function refExists(repoDir: string, ref: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['show-ref', '--verify', '--quiet', ref], {
      cwd: repoDir,
    });
    return true;
  } catch {
    return false;
  }
}

export async function createWorktree(
  repoDir: string,
  branch: string,
  targetDir: string
): Promise<string> {
  const absoluteTargetDir = resolve(targetDir);
  mkdirSync(dirname(absoluteTargetDir), { recursive: true });

  if (await refExists(repoDir, `refs/heads/${branch}`)) {
    await execFileAsync('git', ['worktree', 'add', absoluteTargetDir, branch], {
      cwd: repoDir,
    });
    return absoluteTargetDir;
  }

  if (await refExists(repoDir, `refs/remotes/origin/${branch}`)) {
    await execFileAsync(
      'git',
      ['worktree', 'add', '-b', branch, absoluteTargetDir, `origin/${branch}`],
      {
        cwd: repoDir,
      }
    );
    return absoluteTargetDir;
  }

  await execFileAsync('git', ['worktree', 'add', absoluteTargetDir, branch], {
    cwd: repoDir,
  });
  return absoluteTargetDir;
}

export async function attachWorktreesToPrs(
  prs: Map<string, PullRequest>,
  repoContexts?: Map<string, RepoRuntimeContext>
): Promise<void> {
  if (!repoContexts || repoContexts.size === 0) {
    return;
  }

  await Promise.all(
    [...repoContexts.entries()].map(async ([nameWithOwner, repoContext]) => {
      const matchingPrs = [...prs.values()].filter(
        pr => pr.repository.nameWithOwner === nameWithOwner && pr.headRefName
      );

      if (matchingPrs.length === 0) {
        return;
      }

      try {
        const worktrees = await discoverWorktrees(
          resolveWorktreeSearchPaths(repoContext.repoDir, repoContext)
        );
        if (worktrees.size === 0) {
          return;
        }

        await Promise.all(
          matchingPrs.map(async pr => {
            try {
              const worktree = findWorktreeForBranch(pr.headRefName, worktrees);
              if (!worktree) {
                pr.worktree = undefined;
                return;
              }

              pr.worktree = await getWorktreeStatus(worktree.path);
            } catch {
              pr.worktree = undefined;
            }
          })
        );
      } catch {
        // Local worktree lookup is best-effort and must not fail polling.
      }
    })
  );
}

export const _internal = {
  expandPath,
  parsePorcelainOutput,
  refExists,
  resolveWorktreeSearchPaths,
  resolveWorktreeTargetDir,
};
