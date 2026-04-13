/**
 * GitHub data layer — wraps the `gh` CLI for fetching PR data.
 *
 * Uses a two-pass approach for fetchMyOpenPrs:
 *   1. gh search prs — broad discovery (lacks reviews, checks, mergeable)
 *   2. gh pr list per-repo — full detail fill-in
 */

import type {
  CheckConclusion,
  CheckStatus,
  MergeableState,
  MergeStateStatus,
  PrAuthor,
  PrCheck,
  PrComment,
  PrLabel,
  PrReview,
  PrReviewRequest,
  PullRequest,
  RepoRuntimeContext,
  ReviewDecision,
  ReviewState,
} from '../types/index.js';
import { attachWorktreesToPrs } from './worktrees.js';

// ─── Error Types ────────────────────────────────────────────────────────────

export class GhError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number,
    public readonly stderr: string
  ) {
    super(message);
    this.name = 'GhError';
  }
}

export class GhAuthError extends GhError {
  constructor(stderr: string) {
    super('GitHub CLI authentication failure — run `gh auth login`', 1, stderr);
    this.name = 'GhAuthError';
  }
}

export class GhRateLimitError extends GhError {
  constructor(stderr: string) {
    super('GitHub API rate limit exceeded', 1, stderr);
    this.name = 'GhRateLimitError';
  }
}

// ─── Raw JSON Shapes from gh CLI ────────────────────────────────────────────

/** What gh search prs returns per item */
interface GhSearchPr {
  number: number;
  title: string;
  state: string;
  isDraft: boolean;
  url: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  labels: GhLabel[];
  repository: { name: string; nameWithOwner: string };
  author?: GhAuthor;
}

/** What gh pr list / gh pr view returns per item */
interface GhPrDetail {
  number: number;
  title: string;
  state: string;
  isDraft: boolean;
  url: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  headRefName: string;
  baseRefName: string;
  mergeable: string;
  mergeStateStatus: string;
  reviewDecision: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  labels: GhLabel[];
  reviews: GhReview[];
  comments: GhCommentNode[];
  statusCheckRollup: GhCheckRollupItem[];
  reviewRequests: GhReviewRequest[];
  assignees: GhAssignee[];
  mergedAt?: string | null;
  author?: GhAuthor;
}

interface GhAuthor {
  login: string;
  name?: string;
  type?: string;
  is_bot?: boolean;
}

interface GhLabel {
  id?: string;
  name: string;
  color?: string;
}

interface GhReview {
  id?: string;
  author?: GhAuthor;
  state: string;
  body: string;
  submittedAt: string;
}

interface GhCommentNode {
  id?: string;
  author?: GhAuthor;
  body: string;
  createdAt: string;
  url: string;
}

/** StatusCheckRollup can be either CheckRun or StatusContext */
interface GhCheckRollupItem {
  __typename: 'CheckRun' | 'StatusContext';
  // CheckRun fields
  name?: string;
  status?: string;
  conclusion?: string;
  workflowName?: string;
  detailsUrl?: string;
  // StatusContext fields
  state?: string;
  context?: string;
  targetUrl?: string;
}

interface GhReviewRequest {
  login?: string;
  name?: string;
  slug?: string;
}

interface GhAssignee {
  login: string;
  name?: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_GH_TIMEOUT_MS = 30_000;
const DETAIL_FETCH_CONCURRENCY = 8;
const GH_TRANSIENT_RETRIES = 3;
const GH_RETRY_BASE_DELAY_MS = 400;

/** Fields requested for the search pass (broad discovery) */
const SEARCH_FIELDS = [
  'number',
  'title',
  'repository',
  'state',
  'isDraft',
  'labels',
  'createdAt',
  'updatedAt',
  'url',
  'body',
  'author',
].join(',');

/** Fields requested for per-repo detail pass */
const DETAIL_FIELDS = [
  'number',
  'title',
  'state',
  'isDraft',
  'labels',
  'reviews',
  'statusCheckRollup',
  'mergeable',
  'mergeStateStatus',
  'reviewDecision',
  'headRefName',
  'baseRefName',
  'url',
  'body',
  'comments',
  'reviewRequests',
  'assignees',
  'additions',
  'deletions',
  'changedFiles',
  'updatedAt',
  'createdAt',
  'mergedAt',
  'author',
].join(',');

// ─── Core: Shell out to gh ──────────────────────────────────────────────────

/**
 * Execute a `gh` CLI command, capture stdout, throw on non-zero exit.
 * Timeout defaults to 30s.
 */
export async function runGh(args: string[], timeoutMs = DEFAULT_GH_TIMEOUT_MS): Promise<string> {
  const proc = Bun.spawn(['gh', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const processPromise = Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  try {
    // If we timeout, reject immediately even if gh never exits cleanly.
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          // best effort kill; timeout error still surfaces
        }
        reject(
          new GhError(
            `gh ${formatGhArgsForError(args)} timed out after ${timeoutMs}ms`,
            124,
            'timeout'
          )
        );
      }, timeoutMs);
    });

    // Avoid unhandled rejections if timeout wins the race.
    void processPromise.catch(() => {
      // Swallow late process rejections after timeout races.
    });

    const [stdout, stderr, exitCode] = await Promise.race([processPromise, timeoutPromise]);

    if (exitCode !== 0) {
      throwClassifiedError(exitCode, stderr, args);
    }

    return stdout.trim();
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function isTransientGhFailure(error: unknown): boolean {
  if (error instanceof GhRateLimitError || error instanceof GhAuthError) {
    return false;
  }

  const text =
    error instanceof GhError
      ? `${error.message}\n${error.stderr}`
      : error instanceof Error
        ? error.message
        : String(error);
  const lower = text.toLowerCase();

  return (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('server error') ||
    lower.includes('service unavailable') ||
    lower.includes('bad gateway') ||
    lower.includes('connection reset') ||
    lower.includes('econnreset') ||
    lower.includes('eai_again') ||
    /http\s+5\d\d/.test(lower)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function runGhWithRetry(
  args: string[],
  attempts = GH_TRANSIENT_RETRIES,
  timeoutMs = DEFAULT_GH_TIMEOUT_MS
): Promise<string> {
  const tries = Math.max(1, Math.floor(attempts));
  let lastError: unknown;

  for (let i = 1; i <= tries; i++) {
    try {
      return await runGh(args, timeoutMs);
    } catch (error) {
      lastError = error;
      const isLastAttempt = i === tries;
      if (isLastAttempt || !isTransientGhFailure(error)) {
        throw error;
      }
      const backoffMs = GH_RETRY_BASE_DELAY_MS * 2 ** (i - 1);
      await sleep(backoffMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Classify gh CLI errors into specific error types */
function throwClassifiedError(exitCode: number, stderr: string, args: string[]): never {
  const lower = stderr.toLowerCase();

  if (
    lower.includes('authentication') ||
    lower.includes('auth login') ||
    lower.includes('not logged in')
  ) {
    throw new GhAuthError(stderr);
  }

  if (lower.includes('rate limit') || lower.includes('api rate') || lower.includes('403')) {
    throw new GhRateLimitError(stderr);
  }

  throw new GhError(
    `gh ${formatGhArgsForError(args)} failed (exit ${exitCode}): ${stderr.slice(0, 500)}`,
    exitCode,
    stderr
  );
}

function formatGhArgsForError(args: string[]): string {
  const redacted: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }

    if (arg === '--body' || arg === '--field' || arg === '--raw-field' || arg === '--input') {
      redacted.push(arg);
      if (args[i + 1] !== undefined) {
        redacted.push('<redacted>');
        i += 1;
      }
      continue;
    }

    if (
      arg.startsWith('body=') ||
      arg.startsWith('input=') ||
      arg.startsWith('message=') ||
      arg.startsWith('comment=')
    ) {
      const key = arg.split('=')[0] ?? 'value';
      redacted.push(`${key}=<redacted>`);
      continue;
    }

    redacted.push(arg);
  }

  return redacted.join(' ');
}

// ─── Data Normalization ─────────────────────────────────────────────────────

function normalizeAuthor(raw?: GhAuthor): PrAuthor {
  const login = raw?.login ?? 'unknown';
  return {
    login,
    name: raw?.name,
    isBot: login.endsWith('[bot]') || raw?.type === 'Bot' || raw?.is_bot === true,
  };
}

function normalizeLabel(raw: GhLabel): PrLabel {
  return {
    id: raw.id ?? raw.name,
    name: raw.name,
    color: raw.color ?? '',
  };
}

function normalizeReview(raw: GhReview): PrReview {
  return {
    id: raw.id ?? '',
    author: normalizeAuthor(raw.author),
    state: raw.state as ReviewState,
    body: raw.body ?? '',
    submittedAt: raw.submittedAt,
  };
}

function normalizeComment(raw: GhCommentNode): PrComment {
  return {
    id: raw.id ?? '',
    author: normalizeAuthor(raw.author),
    body: raw.body ?? '',
    createdAt: raw.createdAt,
    url: raw.url ?? '',
  };
}

function normalizeReviewRequest(raw: GhReviewRequest): PrReviewRequest {
  return {
    login: raw.login,
    name: raw.name,
    slug: raw.slug,
  };
}

/**
 * Normalize StatusCheckRollup items into PrCheck[].
 * Handles both CheckRun and StatusContext __typename variants.
 */
function normalizeChecks(items: GhCheckRollupItem[] | null): PrCheck[] {
  if (!items) return [];

  return items.map(item => {
    if (item.__typename === 'StatusContext') {
      return {
        name: item.context ?? 'unknown',
        status: (item.state ? 'COMPLETED' : 'PENDING') as CheckStatus,
        conclusion: mapStatusContextState(item.state),
        detailsUrl: item.targetUrl,
      };
    }

    // CheckRun
    return {
      name: item.name ?? 'unknown',
      status: (item.status ?? 'QUEUED') as CheckStatus,
      conclusion: (item.conclusion as CheckConclusion) ?? null,
      workflowName: item.workflowName,
      detailsUrl: item.detailsUrl,
    };
  });
}

/** Map StatusContext state -> CheckConclusion */
function mapStatusContextState(state?: string): CheckConclusion {
  switch (state?.toUpperCase()) {
    case 'SUCCESS':
      return 'SUCCESS';
    case 'FAILURE':
    case 'ERROR':
      return 'FAILURE';
    case 'PENDING':
    case 'EXPECTED':
      return null;
    default:
      return null;
  }
}

function normalizeMergeable(raw: string | undefined): MergeableState {
  switch (raw?.toUpperCase()) {
    case 'MERGEABLE':
    case 'CLEAN':
      return 'MERGEABLE';
    case 'CONFLICTING':
      return 'CONFLICTING';
    default:
      return 'UNKNOWN';
  }
}

function normalizeMergeStateStatus(raw: string | undefined): MergeStateStatus {
  switch (raw?.toUpperCase()) {
    case 'BEHIND':
      return 'BEHIND';
    case 'BLOCKED':
      return 'BLOCKED';
    case 'CLEAN':
      return 'CLEAN';
    case 'DIRTY':
      return 'DIRTY';
    case 'DRAFT':
      return 'DRAFT';
    case 'HAS_HOOKS':
      return 'HAS_HOOKS';
    case 'UNSTABLE':
      return 'UNSTABLE';
    default:
      return 'UNKNOWN';
  }
}

function normalizeReviewDecision(raw: string | undefined): ReviewDecision {
  switch (raw?.toUpperCase()) {
    case 'APPROVED':
      return 'APPROVED';
    case 'CHANGES_REQUESTED':
      return 'CHANGES_REQUESTED';
    case 'REVIEW_REQUIRED':
      return 'REVIEW_REQUIRED';
    default:
      return '';
  }
}

// ─── PR Builders ────────────────────────────────────────────────────────────

/** Build a PullRequest from the full detail data (gh pr list / gh pr view) */
function buildPrFromDetail(raw: GhPrDetail, nameWithOwner: string): PullRequest {
  const repoName = nameWithOwner.split('/')[1] ?? nameWithOwner;
  return {
    key: `${nameWithOwner}#${raw.number}`,
    number: raw.number,
    title: raw.title,
    body: raw.body ?? '',
    url: raw.url,
    repository: {
      name: repoName,
      nameWithOwner,
    },
    author: normalizeAuthor(raw.author),
    headRefName: raw.headRefName ?? '',
    baseRefName: raw.baseRefName ?? '',
    isDraft: raw.isDraft,
    state: normalizeState(raw.state),
    mergeable: normalizeMergeable(raw.mergeable),
    mergeStateStatus: normalizeMergeStateStatus(raw.mergeStateStatus),
    reviewDecision: normalizeReviewDecision(raw.reviewDecision),
    reviews: (raw.reviews ?? []).map(normalizeReview),
    comments: (raw.comments ?? []).map(normalizeComment),
    checks: normalizeChecks(raw.statusCheckRollup),
    labels: (raw.labels ?? []).map(normalizeLabel),
    reviewRequests: (raw.reviewRequests ?? []).map(normalizeReviewRequest),
    additions: raw.additions ?? 0,
    deletions: raw.deletions ?? 0,
    changedFiles: raw.changedFiles ?? 0,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    mergedAt: raw.mergedAt ?? undefined,
    dataSource: 'detail',
  };
}

/** Build a partial PullRequest from search results (missing reviews, checks, etc.) */
function buildPrFromSearch(raw: GhSearchPr): PullRequest {
  const nameWithOwner = raw.repository.nameWithOwner;
  const repoName = raw.repository.name;
  return {
    key: `${nameWithOwner}#${raw.number}`,
    number: raw.number,
    title: raw.title,
    body: raw.body ?? '',
    url: raw.url,
    repository: {
      name: repoName,
      nameWithOwner,
    },
    author: normalizeAuthor(raw.author),
    headRefName: '',
    baseRefName: '',
    isDraft: raw.isDraft,
    state: normalizeState(raw.state),
    mergeable: 'UNKNOWN',
    mergeStateStatus: 'UNKNOWN',
    reviewDecision: '',
    reviews: [],
    comments: [],
    checks: [],
    labels: (raw.labels ?? []).map(normalizeLabel),
    reviewRequests: [],
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    dataSource: 'search',
  };
}

function normalizeState(raw: string): 'OPEN' | 'CLOSED' | 'MERGED' {
  switch (raw?.toUpperCase()) {
    case 'OPEN':
      return 'OPEN';
    case 'CLOSED':
      return 'CLOSED';
    case 'MERGED':
      return 'MERGED';
    default:
      return 'OPEN';
  }
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;

  const limit = Math.max(1, concurrency);
  const inFlight = new Set<Promise<void>>();

  for (const item of items) {
    const task = worker(item);
    inFlight.add(task);

    const cleanup = () => {
      inFlight.delete(task);
    };
    void task.then(cleanup, cleanup);

    if (inFlight.size >= limit) {
      await Promise.race(inFlight);
    }
  }

  await Promise.all(inFlight);
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch all open PRs authored by the current user.
 *
 * Two-pass approach:
 *   1. `gh search prs` for broad discovery across all repos (or scoped repos)
 *   2. `gh pr list --repo` per unique repo for full detail (reviews, checks, etc.)
 *
 * The detail pass replaces the search-pass stubs so we get complete data.
 */
export async function fetchMyOpenPrs(
  repos?: string[],
  knownPrs?: Map<string, PullRequest>,
  repoContexts?: Map<string, RepoRuntimeContext>
): Promise<PullRequest[]> {
  // Pass 1: Discover open PRs via search
  const searchArgs = [
    'search',
    'prs',
    '--author=@me',
    '--state=open',
    `--json=${SEARCH_FIELDS}`,
    '--limit=200',
  ];

  // If repos specified, add repo qualifiers
  if (repos && repos.length > 0) {
    for (const repo of repos) {
      searchArgs.push(`--repo=${repo}`);
    }
  }

  const searchJson = await runGhWithRetry(searchArgs);
  if (!searchJson) return [];

  const searchResults = JSON.parse(searchJson) as GhSearchPr[];
  if (searchResults.length === 0) return [];

  // Collect unique repos from search results
  const repoSet = new Set<string>();
  for (const pr of searchResults) {
    repoSet.add(pr.repository.nameWithOwner);
  }

  // Build a lookup map from search results (fallback if detail fetch fails)
  const prMap = new Map<string, PullRequest>();
  for (const raw of searchResults) {
    const pr = buildPrFromSearch(raw);
    prMap.set(pr.key, pr);
  }

  const detailRepos = findDetailRepos(repoSet, searchResults, knownPrs, prMap, repoContexts);
  const shouldReturnSearchStubsOnly =
    detailRepos.size === 0 && (!repoContexts || repoContexts.size === 0);
  if (shouldReturnSearchStubsOnly) {
    return [...prMap.values()];
  }

  // Pass 2: Fetch full detail only for stale repos, with bounded concurrency.
  await runWithConcurrency([...detailRepos], DETAIL_FETCH_CONCURRENCY, async nameWithOwner => {
    try {
      const detailJson = await runGh([
        'pr',
        'list',
        `--repo=${nameWithOwner}`,
        '--author=@me',
        '--state=open',
        '--limit=200',
        `--json=${DETAIL_FIELDS}`,
      ]);

      if (!detailJson) return;

      const details = JSON.parse(detailJson) as GhPrDetail[];
      for (const raw of details) {
        const pr = buildPrFromDetail(raw, nameWithOwner);
        prMap.set(pr.key, pr); // overwrite search stub with full detail
      }
    } catch {
      // If detail fetch fails, carry forward known data to prevent state degradation
      if (knownPrs) {
        carryForwardKnown(nameWithOwner, knownPrs, prMap);
      }
    }
  });

  await attachWorktreesToPrs(prMap, repoContexts);
  return [...prMap.values()];
}

/**
 * Fetch full detail for a single PR.
 */
export async function fetchPrDetail(
  owner: string,
  repo: string,
  number: number
): Promise<PullRequest> {
  const nameWithOwner = `${owner}/${repo}`;
  const json = await runGh([
    'pr',
    'view',
    String(number),
    `--repo=${nameWithOwner}`,
    `--json=${DETAIL_FIELDS}`,
  ]);

  const raw = JSON.parse(json) as GhPrDetail;
  return buildPrFromDetail(raw, nameWithOwner);
}

/**
 * Post a new comment on a PR.
 */
export async function postComment(
  owner: string,
  repo: string,
  number: number,
  body: string
): Promise<void> {
  await runGh(['pr', 'comment', String(number), `--repo=${owner}/${repo}`, '--body', body]);
}

/**
 * Edit an existing comment via the API.
 * `commentUrl` is the API URL for the comment (e.g. from PrComment.url).
 */
export async function editComment(
  _owner: string,
  _repo: string,
  commentUrl: string,
  body: string
): Promise<void> {
  // gh api expects a relative path or full URL — extract the API path
  const apiPath = extractApiPath(commentUrl);
  await runGh(['api', apiPath, '--method=PATCH', '--field', `body=${body}`]);
}

/**
 * Merge a PR with the given strategy.
 */
export async function mergePr(
  owner: string,
  repo: string,
  number: number,
  method: 'merge' | 'squash' | 'rebase' = 'squash'
): Promise<void> {
  const flag = method === 'merge' ? '--merge' : method === 'rebase' ? '--rebase' : '--squash';

  await runGh(['pr', 'merge', String(number), `--repo=${owner}/${repo}`, flag]);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract the API path from a GitHub comment URL.
 * Handles both API URLs and web URLs.
 */
function extractApiPath(url: string): string {
  // Already an API path
  if (url.startsWith('/repos/')) return url;

  try {
    const parsed = new URL(url);

    // API URL: https://api.github.com/repos/owner/repo/issues/comments/123
    if (parsed.hostname === 'api.github.com') {
      return parsed.pathname;
    }

    // Web URL: https://github.com/owner/repo/pull/1#issuecomment-123
    // Convert to API path
    const match = parsed.pathname.match(/^\/([^/]+\/[^/]+)\/(?:pull|issues)\/\d+/);
    const fragment = parsed.hash.match(/issuecomment-(\d+)/);
    if (match?.[1] && fragment?.[1]) {
      return `/repos/${match[1]}/issues/comments/${fragment[1]}`;
    }
  } catch {
    // Fall through
  }

  // Last resort: pass through and let gh figure it out
  return url;
}

// ─── Stale Repo Detection ────────────────────────────────────────────────────

/** Determine which repos need a detail fetch by comparing updatedAt timestamps. */
function findDetailRepos(
  repoSet: Set<string>,
  searchResults: GhSearchPr[],
  knownPrs: Map<string, PullRequest> | undefined,
  prMap: Map<string, PullRequest>,
  repoContexts?: Map<string, RepoRuntimeContext>
): Set<string> {
  const reposNeedingContext = new Set<string>();
  for (const repo of repoContexts?.keys() ?? []) {
    if (repoSet.has(repo)) {
      reposNeedingContext.add(repo);
    }
  }

  if (!knownPrs || knownPrs.size === 0) {
    return reposNeedingContext;
  }

  const stale = new Set<string>();
  for (const repo of repoSet) {
    if (repoHasChanges(repo, searchResults, knownPrs)) {
      stale.add(repo);
    } else {
      carryForwardKnown(repo, knownPrs, prMap);
    }
  }

  for (const repo of reposNeedingContext) {
    stale.add(repo);
  }
  return stale;
}

/** Check if any PR in this repo has a different updatedAt than what we know. */
function repoHasChanges(
  repo: string,
  searchResults: GhSearchPr[],
  knownPrs: Map<string, PullRequest>
): boolean {
  for (const raw of searchResults) {
    if (raw.repository.nameWithOwner !== repo) continue;
    const key = `${repo}#${raw.number}`;
    const known = knownPrs.get(key);
    if (!known || known.updatedAt !== raw.updatedAt) return true;
    // Search stub was never enriched by detail pass — force re-fetch
    if (!known.headRefName) return true;
  }
  return false;
}

/** Copy existing data from knownPrs into prMap for a given repo. */
function carryForwardKnown(
  repo: string,
  knownPrs: Map<string, PullRequest>,
  prMap: Map<string, PullRequest>
): void {
  const prefix = `${repo}#`;
  for (const [key, known] of knownPrs) {
    // Only preserve data for PRs still present in the current open-search snapshot.
    // Otherwise merged/closed PRs can linger indefinitely as stale cache entries.
    const current = prMap.get(key);
    if (key.startsWith(prefix) && current) {
      prMap.set(key, mergeKnownIntoCurrent(current, known));
    }
  }
}

function mergeKnownIntoCurrent(current: PullRequest, known: PullRequest): PullRequest {
  const currentUpdatedAt = Date.parse(current.updatedAt);
  const knownUpdatedAt = Date.parse(known.updatedAt);
  const currentIsNewer =
    Number.isFinite(currentUpdatedAt) &&
    Number.isFinite(knownUpdatedAt) &&
    currentUpdatedAt > knownUpdatedAt;

  if (!currentIsNewer) {
    return known;
  }

  return {
    ...current,
    headRefName: known.headRefName || current.headRefName,
    baseRefName: known.baseRefName || current.baseRefName,
    mergeable: current.mergeable === 'UNKNOWN' ? known.mergeable : current.mergeable,
    mergeStateStatus:
      current.mergeStateStatus === 'UNKNOWN' || current.mergeStateStatus === undefined
        ? known.mergeStateStatus
        : current.mergeStateStatus,
    reviewDecision: current.reviewDecision || known.reviewDecision,
    reviews: current.reviews.length > 0 ? current.reviews : known.reviews,
    comments: current.comments.length > 0 ? current.comments : known.comments,
    checks: current.checks.length > 0 ? current.checks : known.checks,
    reviewRequests:
      current.reviewRequests && current.reviewRequests.length > 0
        ? current.reviewRequests
        : known.reviewRequests,
    additions: current.additions > 0 ? current.additions : known.additions,
    deletions: current.deletions > 0 ? current.deletions : known.deletions,
    changedFiles: current.changedFiles > 0 ? current.changedFiles : known.changedFiles,
    worktree: current.worktree ?? known.worktree,
    dataSource: known.dataSource ?? current.dataSource,
  };
}

// ─── Test Exports ────────────────────────────────────────────────────────────

/** Exposed for unit testing only. Do not use in production code. */
export const _internal = {
  normalizeAuthor,
  normalizeLabel,
  normalizeReview,
  normalizeComment,
  normalizeChecks,
  normalizeMergeable,
  normalizeMergeStateStatus,
  normalizeReviewDecision,
  normalizeState,
  mapStatusContextState,
  extractApiPath,
  throwClassifiedError,
  buildPrFromDetail,
  buildPrFromSearch,
  carryForwardKnown,
  findDetailRepos,
  mergeKnownIntoCurrent,
  isTransientGhFailure,
  formatGhArgsForError,
};
