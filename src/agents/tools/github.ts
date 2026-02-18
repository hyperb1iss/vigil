/**
 * GitHub tool definitions for Claude Agent SDK.
 *
 * Thin wrappers around the functions in src/core/github.ts,
 * exposed as SDK tools that agents can invoke.
 */

import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { mergePr, postComment, runGh } from '../../core/github.js';

// ─── Tool Definitions ───────────────────────────────────────────────────────

export const ghPrComment = tool(
  'gh_pr_comment',
  'Post a new comment on a GitHub pull request.',
  {
    owner: z.string().describe('Repository owner (e.g. "hyperb1iss")'),
    repo: z.string().describe('Repository name (e.g. "vigil")'),
    number: z.number().describe('PR number'),
    body: z.string().describe('Comment body (Markdown)'),
  },
  async ({ owner, repo, number, body }) => {
    await postComment(owner, repo, number, body);
    return {
      content: [{ type: 'text' as const, text: `Comment posted on ${owner}/${repo}#${number}.` }],
    };
  }
);

export const ghPrMerge = tool(
  'gh_pr_merge',
  'Merge a pull request with the specified strategy.',
  {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    number: z.number().describe('PR number'),
    method: z
      .enum(['merge', 'squash', 'rebase'])
      .optional()
      .describe('Merge strategy (defaults to squash)'),
  },
  async ({ owner, repo, number, method }) => {
    await mergePr(owner, repo, number, method ?? 'squash');
    return {
      content: [
        {
          type: 'text' as const,
          text: `PR ${owner}/${repo}#${number} merged via ${method ?? 'squash'}.`,
        },
      ],
    };
  }
);

export const ghSearchCode = tool(
  'gh_search_code',
  'Search for code in a GitHub repository.',
  {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    query: z.string().describe('Search query string'),
    limit: z.number().optional().describe('Max results to return (default 20)'),
  },
  async ({ owner, repo, query, limit }) => {
    const output = await runGh([
      'search',
      'code',
      query,
      `--repo=${owner}/${repo}`,
      `--limit=${String(limit ?? 20)}`,
      '--json=path,repository,textMatches',
    ]);
    return { content: [{ type: 'text' as const, text: output }] };
  }
);

/** All GitHub tools bundled for convenience */
export const githubTools = [ghPrComment, ghPrMerge, ghSearchCode];
