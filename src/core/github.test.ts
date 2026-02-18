import { describe, expect, test } from 'bun:test';
import { _internal, GhAuthError, GhError, GhRateLimitError } from './github.js';

const {
  normalizeAuthor,
  normalizeLabel,
  normalizeReview,
  normalizeComment,
  normalizeChecks,
  normalizeMergeable,
  normalizeReviewDecision,
  normalizeState,
  mapStatusContextState,
  extractApiPath,
  throwClassifiedError,
  buildPrFromDetail,
  buildPrFromSearch,
} = _internal;

// ─── normalizeAuthor ───────────────────────────────────────────────────

describe('normalizeAuthor', () => {
  test('extracts login and name from raw author', () => {
    const result = normalizeAuthor({ login: 'alice', name: 'Alice' });
    expect(result.login).toBe('alice');
    expect(result.name).toBe('Alice');
    expect(result.isBot).toBe(false);
  });

  test('detects [bot] suffix as bot', () => {
    const result = normalizeAuthor({ login: 'dependabot[bot]' });
    expect(result.isBot).toBe(true);
  });

  test('detects Bot type as bot', () => {
    const result = normalizeAuthor({ login: 'renovate', type: 'Bot' });
    expect(result.isBot).toBe(true);
  });

  test('detects is_bot flag as bot', () => {
    const result = normalizeAuthor({ login: 'mybot', is_bot: true });
    expect(result.isBot).toBe(true);
  });

  test('handles undefined author with fallback', () => {
    const result = normalizeAuthor(undefined);
    expect(result.login).toBe('unknown');
    expect(result.isBot).toBe(false);
  });

  test('handles missing name gracefully', () => {
    const result = normalizeAuthor({ login: 'alice' });
    expect(result.name).toBeUndefined();
  });
});

// ─── normalizeLabel ────────────────────────────────────────────────────

describe('normalizeLabel', () => {
  test('extracts all fields', () => {
    const result = normalizeLabel({ id: 'l1', name: 'bug', color: 'fc2929' });
    expect(result).toEqual({ id: 'l1', name: 'bug', color: 'fc2929' });
  });

  test('uses name as id fallback', () => {
    const result = normalizeLabel({ name: 'enhancement' });
    expect(result.id).toBe('enhancement');
  });

  test('defaults color to empty string', () => {
    const result = normalizeLabel({ name: 'test' });
    expect(result.color).toBe('');
  });
});

// ─── normalizeReview ───────────────────────────────────────────────────

describe('normalizeReview', () => {
  test('normalizes a full review', () => {
    const result = normalizeReview({
      id: 'r1',
      author: { login: 'alice' },
      state: 'APPROVED',
      body: 'LGTM',
      submittedAt: '2026-02-18T12:00:00Z',
    });
    expect(result.id).toBe('r1');
    expect(result.author.login).toBe('alice');
    expect(result.state).toBe('APPROVED');
    expect(result.body).toBe('LGTM');
  });

  test('handles missing id and body', () => {
    const result = normalizeReview({
      state: 'COMMENTED',
      body: '',
      submittedAt: '2026-02-18T12:00:00Z',
    });
    expect(result.id).toBe('');
    expect(result.body).toBe('');
  });
});

// ─── normalizeComment ──────────────────────────────────────────────────

describe('normalizeComment', () => {
  test('normalizes a full comment', () => {
    const result = normalizeComment({
      id: 'c1',
      author: { login: 'bob' },
      body: 'Nice work!',
      createdAt: '2026-02-18T10:00:00Z',
      url: 'https://github.com/owner/repo/pull/1#issuecomment-123',
    });
    expect(result.id).toBe('c1');
    expect(result.author.login).toBe('bob');
    expect(result.body).toBe('Nice work!');
  });

  test('handles missing fields', () => {
    const result = normalizeComment({
      body: 'Hello',
      createdAt: '2026-02-18T10:00:00Z',
      url: '',
    });
    expect(result.id).toBe('');
    expect(result.author.login).toBe('unknown');
  });
});

// ─── normalizeChecks ───────────────────────────────────────────────────

describe('normalizeChecks', () => {
  test('returns empty array for null input', () => {
    expect(normalizeChecks(null)).toEqual([]);
  });

  test('normalizes CheckRun items', () => {
    const result = normalizeChecks([
      {
        __typename: 'CheckRun',
        name: 'build',
        status: 'COMPLETED',
        conclusion: 'SUCCESS',
        workflowName: 'CI',
        detailsUrl: 'https://example.com',
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: 'build',
      status: 'COMPLETED',
      conclusion: 'SUCCESS',
      workflowName: 'CI',
      detailsUrl: 'https://example.com',
    });
  });

  test('normalizes StatusContext items', () => {
    const result = normalizeChecks([
      {
        __typename: 'StatusContext',
        context: 'ci/circleci',
        state: 'SUCCESS',
        targetUrl: 'https://circleci.com/build/123',
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('ci/circleci');
    expect(result[0]?.status).toBe('COMPLETED');
    expect(result[0]?.conclusion).toBe('SUCCESS');
  });

  test('StatusContext with no state maps to PENDING', () => {
    const result = normalizeChecks([{ __typename: 'StatusContext', context: 'deploy' }]);
    expect(result[0]?.status).toBe('PENDING');
    expect(result[0]?.conclusion).toBeNull();
  });

  test('handles mixed CheckRun and StatusContext', () => {
    const result = normalizeChecks([
      { __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { __typename: 'StatusContext', context: 'deploy', state: 'FAILURE' },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]?.name).toBe('build');
    expect(result[1]?.name).toBe('deploy');
    expect(result[1]?.conclusion).toBe('FAILURE');
  });

  test('defaults name to unknown for CheckRun without name', () => {
    const result = normalizeChecks([{ __typename: 'CheckRun', status: 'QUEUED' }]);
    expect(result[0]?.name).toBe('unknown');
  });

  test('defaults status to QUEUED for CheckRun without status', () => {
    const result = normalizeChecks([{ __typename: 'CheckRun', name: 'test' }]);
    expect(result[0]?.status).toBe('QUEUED');
  });
});

// ─── mapStatusContextState ─────────────────────────────────────────────

describe('mapStatusContextState', () => {
  test('SUCCESS maps to SUCCESS', () => {
    expect(mapStatusContextState('SUCCESS')).toBe('SUCCESS');
  });

  test('FAILURE maps to FAILURE', () => {
    expect(mapStatusContextState('FAILURE')).toBe('FAILURE');
  });

  test('ERROR maps to FAILURE', () => {
    expect(mapStatusContextState('ERROR')).toBe('FAILURE');
  });

  test('PENDING maps to null', () => {
    expect(mapStatusContextState('PENDING')).toBeNull();
  });

  test('EXPECTED maps to null', () => {
    expect(mapStatusContextState('EXPECTED')).toBeNull();
  });

  test('undefined maps to null', () => {
    expect(mapStatusContextState(undefined)).toBeNull();
  });

  test('case insensitive', () => {
    expect(mapStatusContextState('success')).toBe('SUCCESS');
    expect(mapStatusContextState('failure')).toBe('FAILURE');
  });
});

// ─── normalizeMergeable ────────────────────────────────────────────────

describe('normalizeMergeable', () => {
  test('MERGEABLE returns MERGEABLE', () => {
    expect(normalizeMergeable('MERGEABLE')).toBe('MERGEABLE');
  });

  test('CLEAN returns MERGEABLE', () => {
    expect(normalizeMergeable('CLEAN')).toBe('MERGEABLE');
  });

  test('CONFLICTING returns CONFLICTING', () => {
    expect(normalizeMergeable('CONFLICTING')).toBe('CONFLICTING');
  });

  test('unknown string returns UNKNOWN', () => {
    expect(normalizeMergeable('SOMETHING')).toBe('UNKNOWN');
  });

  test('undefined returns UNKNOWN', () => {
    expect(normalizeMergeable(undefined)).toBe('UNKNOWN');
  });

  test('case insensitive', () => {
    expect(normalizeMergeable('mergeable')).toBe('MERGEABLE');
    expect(normalizeMergeable('conflicting')).toBe('CONFLICTING');
  });
});

// ─── normalizeReviewDecision ───────────────────────────────────────────

describe('normalizeReviewDecision', () => {
  test('APPROVED returns APPROVED', () => {
    expect(normalizeReviewDecision('APPROVED')).toBe('APPROVED');
  });

  test('CHANGES_REQUESTED returns CHANGES_REQUESTED', () => {
    expect(normalizeReviewDecision('CHANGES_REQUESTED')).toBe('CHANGES_REQUESTED');
  });

  test('REVIEW_REQUIRED returns REVIEW_REQUIRED', () => {
    expect(normalizeReviewDecision('REVIEW_REQUIRED')).toBe('REVIEW_REQUIRED');
  });

  test('empty string returns empty', () => {
    expect(normalizeReviewDecision('')).toBe('');
  });

  test('undefined returns empty', () => {
    expect(normalizeReviewDecision(undefined)).toBe('');
  });

  test('unknown value returns empty', () => {
    expect(normalizeReviewDecision('WHATEVER')).toBe('');
  });

  test('case insensitive', () => {
    expect(normalizeReviewDecision('approved')).toBe('APPROVED');
  });
});

// ─── extractApiPath ────────────────────────────────────────────────────

describe('extractApiPath', () => {
  test('passes through existing API paths', () => {
    const path = '/repos/owner/repo/issues/comments/123';
    expect(extractApiPath(path)).toBe(path);
  });

  test('extracts path from API URL', () => {
    const url = 'https://api.github.com/repos/owner/repo/issues/comments/123';
    expect(extractApiPath(url)).toBe('/repos/owner/repo/issues/comments/123');
  });

  test('converts web pull URL to API path', () => {
    const url = 'https://github.com/owner/repo/pull/42#issuecomment-999';
    expect(extractApiPath(url)).toBe('/repos/owner/repo/issues/comments/999');
  });

  test('converts web issues URL to API path', () => {
    const url = 'https://github.com/owner/repo/issues/10#issuecomment-555';
    expect(extractApiPath(url)).toBe('/repos/owner/repo/issues/comments/555');
  });

  test('passes through unrecognized URLs', () => {
    const url = 'https://example.com/something';
    expect(extractApiPath(url)).toBe(url);
  });

  test('passes through invalid strings', () => {
    expect(extractApiPath('not-a-url')).toBe('not-a-url');
  });
});

// ─── Error Classification ──────────────────────────────────────────────

describe('throwClassifiedError', () => {
  test('throws GhAuthError for authentication errors', () => {
    expect(() => throwClassifiedError(1, 'authentication required', ['pr', 'list'])).toThrow(
      GhAuthError
    );
  });

  test('throws GhAuthError for "auth login" message', () => {
    expect(() => throwClassifiedError(1, 'run gh auth login', ['pr', 'list'])).toThrow(GhAuthError);
  });

  test('throws GhAuthError for "not logged in"', () => {
    expect(() => throwClassifiedError(1, 'not logged in to any host', ['pr', 'list'])).toThrow(
      GhAuthError
    );
  });

  test('throws GhRateLimitError for rate limit', () => {
    expect(() => throwClassifiedError(1, 'API rate limit exceeded', ['search', 'prs'])).toThrow(
      GhRateLimitError
    );
  });

  test('throws GhRateLimitError for 403', () => {
    expect(() => throwClassifiedError(1, '403 Forbidden', ['api'])).toThrow(GhRateLimitError);
  });

  test('throws generic GhError for other errors', () => {
    expect(() => throwClassifiedError(2, 'some error', ['pr', 'view'])).toThrow(GhError);
  });

  test('GhError includes exit code and stderr', () => {
    try {
      throwClassifiedError(42, 'detailed error message', ['pr', 'list']);
    } catch (e) {
      expect(e).toBeInstanceOf(GhError);
      if (e instanceof GhError) {
        expect(e.exitCode).toBe(42);
        expect(e.stderr).toBe('detailed error message');
      }
    }
  });
});

// ─── normalizeState ────────────────────────────────────────────────────

describe('normalizeState', () => {
  test('OPEN returns OPEN', () => {
    expect(normalizeState('OPEN')).toBe('OPEN');
  });

  test('CLOSED returns CLOSED', () => {
    expect(normalizeState('CLOSED')).toBe('CLOSED');
  });

  test('MERGED returns MERGED', () => {
    expect(normalizeState('MERGED')).toBe('MERGED');
  });

  test('unknown defaults to OPEN', () => {
    expect(normalizeState('WHATEVER')).toBe('OPEN');
  });

  test('case insensitive', () => {
    expect(normalizeState('open')).toBe('OPEN');
    expect(normalizeState('closed')).toBe('CLOSED');
    expect(normalizeState('merged')).toBe('MERGED');
  });
});

// ─── buildPrFromDetail ─────────────────────────────────────────────────

describe('buildPrFromDetail', () => {
  test('builds a complete PullRequest from raw detail data', () => {
    const raw = {
      number: 42,
      title: 'Add feature',
      state: 'OPEN',
      isDraft: false,
      url: 'https://github.com/owner/repo/pull/42',
      body: 'Description here',
      createdAt: '2026-02-18T10:00:00Z',
      updatedAt: '2026-02-18T12:00:00Z',
      headRefName: 'feat/thing',
      baseRefName: 'main',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      reviewDecision: 'APPROVED',
      additions: 50,
      deletions: 10,
      changedFiles: 5,
      labels: [{ name: 'enhancement', color: '84b6eb' }],
      reviews: [
        {
          id: 'r1',
          author: { login: 'alice' },
          state: 'APPROVED',
          body: 'LGTM',
          submittedAt: '2026-02-18T11:00:00Z',
        },
      ],
      comments: [
        {
          id: 'c1',
          author: { login: 'bob' },
          body: 'Nice',
          createdAt: '2026-02-18T11:30:00Z',
          url: 'https://github.com/owner/repo/pull/42#issuecomment-1',
        },
      ],
      statusCheckRollup: [
        {
          __typename: 'CheckRun' as const,
          name: 'build',
          status: 'COMPLETED',
          conclusion: 'SUCCESS',
        },
      ],
      reviewRequests: [],
      assignees: [],
      author: { login: 'dev' },
    };

    const pr = buildPrFromDetail(raw, 'owner/repo');

    expect(pr.key).toBe('owner/repo#42');
    expect(pr.number).toBe(42);
    expect(pr.title).toBe('Add feature');
    expect(pr.state).toBe('OPEN');
    expect(pr.mergeable).toBe('MERGEABLE');
    expect(pr.reviewDecision).toBe('APPROVED');
    expect(pr.reviews).toHaveLength(1);
    expect(pr.comments).toHaveLength(1);
    expect(pr.checks).toHaveLength(1);
    expect(pr.labels).toHaveLength(1);
    expect(pr.repository.nameWithOwner).toBe('owner/repo');
    expect(pr.repository.name).toBe('repo');
    expect(pr.headRefName).toBe('feat/thing');
    expect(pr.baseRefName).toBe('main');
    expect(pr.additions).toBe(50);
    expect(pr.deletions).toBe(10);
  });

  test('handles missing optional fields gracefully', () => {
    const raw = {
      number: 1,
      title: 'Minimal',
      state: 'OPEN',
      isDraft: false,
      url: '',
      body: '',
      createdAt: '2026-02-18T10:00:00Z',
      updatedAt: '2026-02-18T10:00:00Z',
      headRefName: '',
      baseRefName: '',
      mergeable: '',
      mergeStateStatus: '',
      reviewDecision: '',
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      labels: [],
      reviews: [],
      comments: [],
      statusCheckRollup: [],
      reviewRequests: [],
      assignees: [],
    };

    const pr = buildPrFromDetail(raw, 'owner/repo');
    expect(pr.author.login).toBe('unknown');
    expect(pr.mergeable).toBe('UNKNOWN');
    expect(pr.reviewDecision).toBe('');
    expect(pr.checks).toHaveLength(0);
  });
});

// ─── buildPrFromSearch ─────────────────────────────────────────────────

describe('buildPrFromSearch', () => {
  test('builds a partial PullRequest from search results', () => {
    const raw = {
      number: 99,
      title: 'Search result PR',
      state: 'OPEN',
      isDraft: false,
      url: 'https://github.com/owner/repo/pull/99',
      body: 'Body text',
      createdAt: '2026-02-18T10:00:00Z',
      updatedAt: '2026-02-18T12:00:00Z',
      labels: [{ name: 'bug', color: 'fc2929' }],
      repository: { name: 'repo', nameWithOwner: 'owner/repo' },
      author: { login: 'dev' },
    };

    const pr = buildPrFromSearch(raw);

    expect(pr.key).toBe('owner/repo#99');
    expect(pr.number).toBe(99);
    expect(pr.title).toBe('Search result PR');
    expect(pr.state).toBe('OPEN');
    expect(pr.labels).toHaveLength(1);
    // Search results lack detail fields — should have defaults
    expect(pr.reviews).toHaveLength(0);
    expect(pr.comments).toHaveLength(0);
    expect(pr.checks).toHaveLength(0);
    expect(pr.mergeable).toBe('UNKNOWN');
    expect(pr.reviewDecision).toBe('');
    expect(pr.headRefName).toBe('');
    expect(pr.additions).toBe(0);
  });

  test('handles missing author in search results', () => {
    const raw = {
      number: 1,
      title: 'No author',
      state: 'OPEN',
      isDraft: true,
      url: '',
      body: '',
      createdAt: '2026-02-18T10:00:00Z',
      updatedAt: '2026-02-18T10:00:00Z',
      labels: [],
      repository: { name: 'repo', nameWithOwner: 'owner/repo' },
    };

    const pr = buildPrFromSearch(raw);
    expect(pr.author.login).toBe('unknown');
    expect(pr.isDraft).toBe(true);
  });
});
