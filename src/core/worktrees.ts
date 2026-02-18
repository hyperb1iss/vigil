import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import simpleGit from 'simple-git';
import type { PrWorktree } from '../types/pr.js';

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
        // Strip refs/heads/ prefix to get the bare branch name
        branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
      }
      // `detached` lines are intentionally ignored
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

/**
 * Discover all git worktrees across search paths and return a map of
 * branch name to worktree info.
 *
 * If no search paths are provided, defaults to the current working directory.
 * Duplicate branches are resolved by last-write-wins (later search paths override).
 */
export async function discoverWorktrees(
  searchPaths?: string[],
): Promise<Map<string, WorktreeInfo>> {
  const dirs = searchPaths && searchPaths.length > 0 ? searchPaths : [process.cwd()];
  const map = new Map<string, WorktreeInfo>();

  // Fan out discovery across all search paths concurrently
  const results = await Promise.all(dirs.map((dir) => listWorktreesInDir(dir)));

  for (const worktrees of results) {
    for (const wt of worktrees) {
      map.set(wt.branch, wt);
    }
  }

  return map;
}

// ─── Matching ────────────────────────────────────────────────────────

/**
 * Find the worktree entry that corresponds to a PR branch name.
 * Handles both bare names (`feature-x`) and fully-qualified refs
 * (`refs/heads/feature-x`).
 */
export function findWorktreeForBranch(
  branch: string,
  worktrees: Map<string, WorktreeInfo>,
): WorktreeInfo | undefined {
  const bare = branch.startsWith('refs/heads/') ? branch.slice('refs/heads/'.length) : branch;
  return worktrees.get(bare);
}

// ─── Status ──────────────────────────────────────────────────────────

/**
 * Get the worktree status for the given path using simple-git.
 * Returns a `PrWorktree` with cleanliness info and uncommitted change count.
 */
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

/**
 * Create a new worktree for the given branch at `targetDir`.
 * Runs `git worktree add <targetDir> <branch>` inside `repoDir`.
 * Returns the absolute path of the created worktree.
 */
export async function createWorktree(
  repoDir: string,
  branch: string,
  targetDir: string,
): Promise<string> {
  await execFileAsync('git', ['worktree', 'add', targetDir, branch], {
    cwd: repoDir,
  });
  return targetDir;
}
