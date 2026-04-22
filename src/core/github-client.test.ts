import { describe, expect, test } from 'bun:test';

import { _internal } from './github-client.js';

describe('resolveGitHubTokenFromEnv', () => {
  test('prefers GITHUB_TOKEN over GH_TOKEN', () => {
    expect(
      _internal.resolveGitHubTokenFromEnv({
        GITHUB_TOKEN: 'github-token',
        GH_TOKEN: 'gh-token',
      } as NodeJS.ProcessEnv)
    ).toBe('github-token');
  });

  test('falls back to GH_TOKEN when needed', () => {
    expect(
      _internal.resolveGitHubTokenFromEnv({
        GH_TOKEN: 'gh-token',
      } as NodeJS.ProcessEnv)
    ).toBe('gh-token');
  });

  test('returns undefined when no token env is set', () => {
    expect(_internal.resolveGitHubTokenFromEnv({} as NodeJS.ProcessEnv)).toBeUndefined();
  });
});

describe('normalizeGitHubGraphqlBaseUrl', () => {
  test('normalizes GitHub Enterprise REST urls to GraphQL base urls', () => {
    expect(_internal.normalizeGitHubGraphqlBaseUrl('https://github.acme.dev/api/v3')).toBe(
      'https://github.acme.dev/api'
    );
  });

  test('removes explicit graphql suffixes and trailing slashes', () => {
    expect(_internal.normalizeGitHubGraphqlBaseUrl('https://api.github.com/graphql/')).toBe(
      'https://api.github.com'
    );
  });
});

describe('getConfiguredGitHubGraphqlBaseUrl', () => {
  test('uses explicit graphql base url when configured', () => {
    expect(
      _internal.getConfiguredGitHubGraphqlBaseUrl({
        GITHUB_GRAPHQL_BASE_URL: 'https://github.acme.dev/api/graphql',
      } as NodeJS.ProcessEnv)
    ).toBe('https://github.acme.dev/api');
  });

  test('derives enterprise api base url from GH_HOST', () => {
    expect(
      _internal.getConfiguredGitHubGraphqlBaseUrl({
        GH_HOST: 'github.acme.dev',
      } as NodeJS.ProcessEnv)
    ).toBe('https://github.acme.dev/api');
  });

  test('ignores the default github.com host', () => {
    expect(
      _internal.getConfiguredGitHubGraphqlBaseUrl({
        GH_HOST: 'github.com',
      } as NodeJS.ProcessEnv)
    ).toBeUndefined();
  });
});

describe('buildGhAuthTokenArgs', () => {
  test('uses the configured host when present', () => {
    expect(
      _internal.buildGhAuthTokenArgs({
        GH_HOST: 'github.acme.dev',
      } as NodeJS.ProcessEnv)
    ).toEqual(['auth', 'token', '--hostname', 'github.acme.dev']);
  });

  test('defaults to the current authenticated host', () => {
    expect(_internal.buildGhAuthTokenArgs({} as NodeJS.ProcessEnv)).toEqual(['auth', 'token']);
  });
});

describe('classifyGitHubApiError', () => {
  test('maps auth failures to a clear login message', () => {
    const error = _internal.classifyGitHubApiError({
      status: 401,
      message: 'Bad credentials',
    });
    expect(error.message).toContain('gh auth login');
  });

  test('maps rate-limit failures to a clear rate-limit message', () => {
    const error = _internal.classifyGitHubApiError({
      status: 429,
      message: 'rate limit',
    });
    expect(error.message).toContain('rate limit');
  });

  test('keeps non-rate-limit 403s intact', () => {
    const error = _internal.classifyGitHubApiError({
      status: 403,
      message: 'Resource not accessible by integration',
    });
    expect(error.message).toBe('Resource not accessible by integration');
  });
});

describe('getGitHubRateLimitRetryAt', () => {
  test('prefers retry-after when GitHub provides it', () => {
    const retryAt = _internal.getGitHubRateLimitRetryAt(
      {
        status: 429,
        response: {
          headers: {
            'retry-after': '15',
          },
        },
      },
      1_000
    );

    expect(retryAt).toBe(17_000);
  });

  test('falls back to x-ratelimit-reset when available', () => {
    const retryAt = _internal.getGitHubRateLimitRetryAt({
      status: 403,
      response: {
        headers: {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': '123',
        },
      },
    });

    expect(retryAt).toBe(124_000);
  });
});

describe('rate-limit backoff state', () => {
  test('tracks the latest retry time until reset', () => {
    _internal.setGitHubRateLimitBackoffUntil(5_000);
    expect(_internal.getGitHubRateLimitBackoffUntil(4_000)).toBe(5_000);

    _internal.resetGitHubClientCaches();
    expect(_internal.getGitHubRateLimitBackoffUntil(4_000)).toBeUndefined();
  });
});
