/**
 * File system tool definitions for Claude Agent SDK.
 *
 * Every operation is sandboxed to the provided worktree directory.
 * Path traversal attempts (e.g. ../../etc/passwd) are rejected before
 * any I/O happens.
 */

import { readdir } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

// ─── Path Safety ────────────────────────────────────────────────────────────

/**
 * Resolve `filePath` against `worktreeDir` and verify it stays within bounds.
 * Throws if the resolved path escapes the worktree.
 */
function safePath(worktreeDir: string, filePath: string): string {
  const resolved = resolve(worktreeDir, filePath);
  const rel = relative(worktreeDir, resolved);

  if (rel.startsWith('..') || resolve(worktreeDir, rel) !== resolved) {
    throw new Error(`Path "${filePath}" escapes the worktree boundary ("${worktreeDir}").`);
  }

  return resolved;
}

// ─── Tool Definitions ───────────────────────────────────────────────────────

export const readFile = tool(
  'read_file',
  'Read the contents of a file within the worktree.',
  {
    workingDir: z.string().describe('Absolute path to the worktree directory'),
    path: z.string().describe('File path relative to the worktree'),
  },
  async ({ workingDir, path }) => {
    const abs = safePath(workingDir, path);
    const file = Bun.file(abs);
    const text = await file.text();
    return { content: [{ type: 'text' as const, text }] };
  }
);

export const writeFile = tool(
  'write_file',
  'Write content to a file within the worktree. Creates parent directories as needed.',
  {
    workingDir: z.string().describe('Absolute path to the worktree directory'),
    path: z.string().describe('File path relative to the worktree'),
    content: z.string().describe('Content to write'),
  },
  async ({ workingDir, path, content }) => {
    const abs = safePath(workingDir, path);
    await Bun.write(abs, content);
    return {
      content: [{ type: 'text' as const, text: `Wrote ${content.length} bytes to ${path}.` }],
    };
  }
);

export const listFiles = tool(
  'list_files',
  'List files and directories at a path within the worktree.',
  {
    workingDir: z.string().describe('Absolute path to the worktree directory'),
    path: z
      .string()
      .optional()
      .describe('Directory path relative to the worktree (defaults to root)'),
    recursive: z.boolean().optional().describe('If true, list files recursively'),
  },
  async ({ workingDir, path, recursive }) => {
    const abs = safePath(workingDir, path ?? '.');
    const entries = await readdir(abs, { withFileTypes: true, recursive: recursive ?? false });
    const lines = entries.map(e => {
      const suffix = e.isDirectory() ? '/' : '';
      // parentPath may be the absolute dir; make it relative
      const parent = e.parentPath ? relative(abs, e.parentPath) : '';
      const entryPath = parent ? `${parent}/${e.name}${suffix}` : `${e.name}${suffix}`;
      return entryPath;
    });
    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  }
);

/** All filesystem tools bundled for convenience */
export const fsTools = [readFile, writeFile, listFiles];
