/**
 * Git tool definitions for Claude Agent SDK.
 *
 * Each tool is bound to a worktree directory and shells out via Bun.spawn.
 */

import { relative, resolve } from 'node:path';

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

function validateGitPath(worktreeDir: string, path: string): string {
  if (path.startsWith('-')) {
    throw new Error(`Git path "${path}" must not start with "-".`);
  }

  const resolved = resolve(worktreeDir, path);
  const rel = relative(worktreeDir, resolved);
  if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) {
    throw new Error(`Git path "${path}" escapes the worktree boundary.`);
  }

  return path;
}

// ─── Tool Definitions ───────────────────────────────────────────────────────

export function createGitTools(worktreeDir: string) {
  const gitStatus = tool(
    'git_status',
    'Show the working tree status of the bound git worktree.',
    {},
    async () => {
      const output = await runGit(['status', '--porcelain=v2', '--branch'], worktreeDir);
      return { content: [{ type: 'text' as const, text: output }] };
    }
  );

  const gitDiff = tool(
    'git_diff',
    'Show the diff of staged and/or unstaged changes. Use --staged for staged only.',
    {
      staged: z.boolean().optional().describe('If true, show only staged changes (--staged)'),
      path: z.string().optional().describe('Optional file path to scope the diff'),
    },
    async ({ staged, path }) => {
      const args = ['diff'];
      if (staged) args.push('--staged');
      if (path) args.push('--', validateGitPath(worktreeDir, path));
      const output = await runGit(args, worktreeDir);
      return { content: [{ type: 'text' as const, text: output }] };
    }
  );

  const gitAdd = tool(
    'git_add',
    'Stage files for the next commit.',
    {
      files: z.array(z.string()).describe('File paths to stage (relative to the worktree)'),
    },
    async ({ files }) => {
      const safeFiles = files.map(file => validateGitPath(worktreeDir, file));
      const output = await runGit(['add', '--', ...safeFiles], worktreeDir);
      return { content: [{ type: 'text' as const, text: output || 'Files staged successfully.' }] };
    }
  );

  const gitCommit = tool(
    'git_commit',
    'Create a new commit with the staged changes.',
    {
      message: z.string().describe('Commit message'),
    },
    async ({ message }) => {
      const output = await runGit(['commit', '-m', message], worktreeDir);
      return { content: [{ type: 'text' as const, text: output }] };
    }
  );

  return [gitStatus, gitDiff, gitAdd, gitCommit];
}

export const _internal = {
  validateGitPath,
};
