/**
 * File system tool definitions for Claude Agent SDK.
 *
 * Every operation is sandboxed to the bound worktree directory.
 * Path traversal attempts (e.g. ../../etc/passwd) are rejected before
 * any I/O happens.
 */

import { existsSync, realpathSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

// ─── Path Safety ────────────────────────────────────────────────────────────

/**
 * Resolve `filePath` against `worktreeDir`, following symlinks on the path
 * that already exists, and verify it stays within bounds.
 */
function safePath(worktreeDir: string, filePath: string, allowCreate = false): string {
  const worktreeRoot = realpathSync(worktreeDir);
  const resolved = resolve(worktreeRoot, filePath);
  const existingPath = findExistingPath(allowCreate ? dirname(resolved) : resolved);
  const checkedPath = realpathSync(existingPath);
  const rel = relative(worktreeRoot, checkedPath);

  if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) {
    throw new Error(`Path "${filePath}" escapes the worktree boundary ("${worktreeDir}").`);
  }

  return resolved;
}

function findExistingPath(path: string): string {
  let current = path;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`No existing path found while validating "${path}".`);
    }
    current = parent;
  }
  return current;
}

// ─── Tool Definitions ───────────────────────────────────────────────────────

export function createFsTools(worktreeDir: string) {
  const readFile = tool(
    'read_file',
    'Read the contents of a file within the bound worktree.',
    {
      path: z.string().describe('File path relative to the worktree'),
    },
    async ({ path }) => {
      const abs = safePath(worktreeDir, path);
      const file = Bun.file(abs);
      const text = await file.text();
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  const writeFile = tool(
    'write_file',
    'Write content to a file within the bound worktree. Creates parent directories as needed.',
    {
      path: z.string().describe('File path relative to the worktree'),
      content: z.string().describe('Content to write'),
    },
    async ({ path, content }) => {
      const abs = safePath(worktreeDir, path, true);
      await Bun.write(abs, content);
      return {
        content: [{ type: 'text' as const, text: `Wrote ${content.length} bytes to ${path}.` }],
      };
    }
  );

  const listFiles = tool(
    'list_files',
    'List files and directories at a path within the bound worktree.',
    {
      path: z.string().optional().describe('Directory path relative to the worktree'),
      recursive: z.boolean().optional().describe('If true, list files recursively'),
    },
    async ({ path, recursive }) => {
      const abs = safePath(worktreeDir, path ?? '.');
      const entries = await readdir(abs, { withFileTypes: true, recursive: recursive ?? false });
      const lines = entries.map(e => {
        const suffix = e.isDirectory() ? '/' : '';
        const parent = e.parentPath ? relative(abs, e.parentPath) : '';
        return parent ? `${parent}/${e.name}${suffix}` : `${e.name}${suffix}`;
      });
      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    }
  );

  return [readFile, writeFile, listFiles];
}

export const _internal = {
  findExistingPath,
  safePath,
};
