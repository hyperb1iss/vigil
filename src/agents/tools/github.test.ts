import { describe, expect, test } from 'bun:test';

import { _internal } from './github.js';

describe('createGithubTools', () => {
  test('defaults to read-only GitHub tools', () => {
    const tools = _internal.createGithubTools();
    expect(tools.map(tool => tool.name)).toEqual(['gh_search_code']);
  });

  test('includes write-capable tools only when explicitly enabled', () => {
    const tools = _internal.createGithubTools({ allowWrite: true });
    expect(tools.map(tool => tool.name)).toEqual([
      'gh_pr_comment',
      'gh_pr_merge',
      'gh_search_code',
    ]);
  });
});
