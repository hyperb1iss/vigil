/**
 * Git tool definitions for Claude Agent SDK.
 *
 * Each tool is scoped to a worktree directory and shells out via Bun.spawn.
 * The workingDir parameter enforces that all git operations happen inside
 * the expected worktree boundary.
 */

import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

// ─── Helpers ────────────────────────────────────────────────────────────────

const GIT_TIMEOUT_MS = 30_000;

async function runGit(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const timeoutId = setTimeout(() => {
    proc.kill();
  }, GIT_TIMEOUT_MS);

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    clearTimeout(timeoutId);

    if (exitCode !== 0) {
      throw new Error(`git ${args.join(' ')} failed (exit ${exitCode}): ${stderr.trim()}`);
    }

    return stdout.trim();
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

// ─── Tool Definitions ───────────────────────────────────────────────────────

export const gitStatus = tool(
  'git_status',
  'Show the working tree status of the repository at the given worktree directory.',
  { workingDir: z.string().describe('Absolute path to the git worktree directory') },
  async ({ workingDir }) => {
    const output = await runGit(['status', '--porcelain=v2', '--branch'], workingDir);
    return { content: [{ type: 'text' as const, text: output }] };
  }
);

export const gitDiff = tool(
  'git_diff',
  'Show the diff of staged and/or unstaged changes. Use --staged for staged only.',
  {
    workingDir: z.string().describe('Absolute path to the git worktree directory'),
    staged: z.boolean().optional().describe('If true, show only staged changes (--staged)'),
    path: z.string().optional().describe('Optional file path to scope the diff'),
  },
  async ({ workingDir, staged, path }) => {
    const args = ['diff'];
    if (staged) args.push('--staged');
    if (path) args.push('--', path);
    const output = await runGit(args, workingDir);
    return { content: [{ type: 'text' as const, text: output }] };
  }
);

export const gitAdd = tool(
  'git_add',
  'Stage files for the next commit.',
  {
    workingDir: z.string().describe('Absolute path to the git worktree directory'),
    files: z.array(z.string()).describe('File paths to stage (relative to workingDir)'),
  },
  async ({ workingDir, files }) => {
    const output = await runGit(['add', ...files], workingDir);
    return { content: [{ type: 'text' as const, text: output || 'Files staged successfully.' }] };
  }
);

export const gitCommit = tool(
  'git_commit',
  'Create a new commit with the staged changes.',
  {
    workingDir: z.string().describe('Absolute path to the git worktree directory'),
    message: z.string().describe('Commit message'),
  },
  async ({ workingDir, message }) => {
    const output = await runGit(['commit', '-m', message], workingDir);
    return { content: [{ type: 'text' as const, text: output }] };
  }
);

export const gitPush = tool(
  'git_push',
  'Push commits to the remote. Use with caution.',
  {
    workingDir: z.string().describe('Absolute path to the git worktree directory'),
    remote: z.string().optional().describe('Remote name (defaults to origin)'),
    branch: z.string().optional().describe('Branch name to push'),
  },
  async ({ workingDir, remote, branch }) => {
    const args = ['push'];
    if (remote) args.push(remote);
    if (branch) args.push(branch);
    const output = await runGit(args, workingDir);
    return { content: [{ type: 'text' as const, text: output || 'Push completed.' }] };
  }
);

/** All git tools bundled for convenience */
export const gitTools = [gitStatus, gitDiff, gitAdd, gitCommit, gitPush];
