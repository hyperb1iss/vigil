import { graphql } from '@octokit/graphql';

const DEFAULT_GITHUB_API_TIMEOUT_MS = 30_000;
const DEFAULT_GITHUB_API_RETRIES = 3;
const GITHUB_API_RETRY_BASE_DELAY_MS = 400;
const GITHUB_VIEWER_LOGIN_QUERY = `
  query {
    viewer {
      login
    }
  }
`;

let githubTokenPromise: Promise<string> | null = null;
let viewerLoginPromise: Promise<string> | null = null;

export interface GitHubGraphqlRequestOptions {
  timeoutMs?: number;
  attempts?: number;
}

function resolveGitHubTokenFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const directToken = env.GITHUB_TOKEN?.trim();
  if (directToken) {
    return directToken;
  }

  const ghToken = env.GH_TOKEN?.trim();
  return ghToken || undefined;
}

function normalizeGitHubGraphqlBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/graphql')) {
    return trimmed.slice(0, -'/graphql'.length);
  }
  if (trimmed.endsWith('/api/v3')) {
    return trimmed.slice(0, -'/v3'.length);
  }
  return trimmed;
}

function getConfiguredGitHubGraphqlBaseUrl(
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  const explicit = env.VIGIL_GITHUB_GRAPHQL_BASE_URL?.trim() || env.GITHUB_GRAPHQL_BASE_URL?.trim();
  if (explicit) {
    return normalizeGitHubGraphqlBaseUrl(explicit);
  }

  const apiUrl = env.GITHUB_API_URL?.trim();
  if (apiUrl) {
    return normalizeGitHubGraphqlBaseUrl(apiUrl);
  }

  const host = env.GITHUB_HOST?.trim() || env.GH_HOST?.trim();
  if (!host || host === 'github.com' || host === 'api.github.com') {
    return;
  }

  return `https://${host}/api`;
}

function buildGhAuthTokenArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  const args = ['auth', 'token'];
  const host = env.GITHUB_HOST?.trim() || env.GH_HOST?.trim();
  if (host) {
    args.push('--hostname', host);
  }
  return args;
}

async function readGhAuthToken(timeoutMs = DEFAULT_GITHUB_API_TIMEOUT_MS): Promise<string> {
  const proc = Bun.spawn(['gh', ...buildGhAuthTokenArgs()], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    const processPromise = Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          // best effort
        }
        reject(new Error(`GitHub auth token lookup timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
    });

    const [stdout, stderr, exitCode] = await Promise.race([processPromise, timeoutPromise]);
    if (exitCode !== 0) {
      throw new Error(stderr.trim() || 'GitHub auth token lookup failed.');
    }

    const token = stdout.trim();
    if (!token) {
      throw new Error('GitHub auth token lookup returned an empty token.');
    }

    return token;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function getGitHubToken(): Promise<string> {
  const envToken = resolveGitHubTokenFromEnv();
  if (envToken) {
    return envToken;
  }

  if (!githubTokenPromise) {
    githubTokenPromise = readGhAuthToken().catch(error => {
      githubTokenPromise = null;
      throw error;
    });
  }

  return githubTokenPromise;
}

function createAbortSignal(timeoutMs: number): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    dispose: () => clearTimeout(timeoutId),
  };
}

function isTransientGitHubApiFailure(error: unknown): boolean {
  const status = getGitHubErrorStatus(error);
  if (status !== undefined && status >= 500) {
    return true;
  }

  const text = getGitHubErrorText(error);
  const lower = text.toLowerCase();

  return (
    lower.includes('aborterror') ||
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('server error') ||
    lower.includes('service unavailable') ||
    lower.includes('bad gateway') ||
    lower.includes('connection reset') ||
    lower.includes('econnreset') ||
    lower.includes('eai_again') ||
    lower.includes('fetch failed') ||
    /http\s+5\d\d/.test(lower)
  );
}

function getGitHubErrorStatus(error: unknown): number | undefined {
  return typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
    ? error.status
    : undefined;
}

function getGitHubErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isGitHubAuthFailure(error: unknown): boolean {
  const status = getGitHubErrorStatus(error);
  const lower = getGitHubErrorText(error).toLowerCase();

  return (
    status === 401 ||
    lower.includes('bad credentials') ||
    lower.includes('requires authentication') ||
    lower.includes('could not resolve to a user') ||
    lower.includes('authentication')
  );
}

function isGitHubRateLimitFailure(error: unknown): boolean {
  const status = getGitHubErrorStatus(error);
  const lower = getGitHubErrorText(error).toLowerCase();

  return (
    status === 403 ||
    status === 429 ||
    lower.includes('rate limit') ||
    lower.includes('secondary rate limit')
  );
}

function classifyGitHubApiError(error: unknown): Error {
  const lower = getGitHubErrorText(error).toLowerCase();

  if (isGitHubAuthFailure(error)) {
    return new Error(
      'GitHub API authentication failure — set GITHUB_TOKEN/GH_TOKEN or run `gh auth login`.'
    );
  }

  if (isGitHubRateLimitFailure(error)) {
    return new Error('GitHub API rate limit exceeded.');
  }

  if (lower.includes('aborterror')) {
    return new Error('GitHub API request timed out.');
  }

  return error instanceof Error ? error : new Error(String(error));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function runGitHubGraphqlWithRetry<TData>(
  query: string,
  variables: Record<string, unknown> = {},
  options: GitHubGraphqlRequestOptions = {}
): Promise<TData> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_GITHUB_API_TIMEOUT_MS;
  const attempts = Math.max(1, Math.floor(options.attempts ?? DEFAULT_GITHUB_API_RETRIES));

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const { signal, dispose } = createAbortSignal(timeoutMs);

    try {
      const token = await getGitHubToken();
      const baseUrl = getConfiguredGitHubGraphqlBaseUrl();
      const graphqlWithAuth = graphql.defaults({
        ...(baseUrl ? { baseUrl } : {}),
        headers: {
          authorization: `token ${token}`,
        },
      });

      return await graphqlWithAuth<TData>(query, {
        ...variables,
        request: {
          signal,
        },
      });
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === attempts;
      if (isLastAttempt || !isTransientGitHubApiFailure(error)) {
        if (isGitHubAuthFailure(error)) {
          resetGitHubClientCaches();
        }
        throw classifyGitHubApiError(error);
      }

      const backoffMs = GITHUB_API_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      await sleep(backoffMs);
    } finally {
      dispose();
    }
  }

  throw classifyGitHubApiError(lastError);
}

export async function getGitHubViewerLogin(): Promise<string> {
  if (!viewerLoginPromise) {
    viewerLoginPromise = runGitHubGraphqlWithRetry<{ viewer: { login: string } }>(
      GITHUB_VIEWER_LOGIN_QUERY
    )
      .then(result => result.viewer.login.trim())
      .catch(error => {
        viewerLoginPromise = null;
        throw error;
      });
  }

  return viewerLoginPromise;
}

function resetGitHubClientCaches(): void {
  githubTokenPromise = null;
  viewerLoginPromise = null;
}

export const _internal = {
  buildGhAuthTokenArgs,
  classifyGitHubApiError,
  getConfiguredGitHubGraphqlBaseUrl,
  getGitHubErrorStatus,
  getGitHubErrorText,
  isGitHubAuthFailure,
  isGitHubRateLimitFailure,
  isTransientGitHubApiFailure,
  normalizeGitHubGraphqlBaseUrl,
  resetGitHubClientCaches,
  resolveGitHubTokenFromEnv,
};
