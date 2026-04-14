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
  ReviewDecision,
  ReviewState,
} from '../types/index.js';
import type { RadarConfig, RadarPr, RadarRepoConfig, RelevanceReason } from '../types/radar.js';
import { fetchPrDetail } from './github.js';
import { getGitHubViewerLogin, runGitHubGraphqlWithRetry } from './github-client.js';
import { classifyRelevance, topTier } from './radar-classifier.js';

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

interface GhCheckRollupItem {
  __typename: 'CheckRun' | 'StatusContext';
  name?: string;
  status?: string;
  conclusion?: string;
  workflowName?: string;
  checkSuite?: {
    workflowRun?: {
      workflow?: {
        name?: string;
      } | null;
    } | null;
  } | null;
  detailsUrl?: string;
  state?: string;
  context?: string;
  targetUrl?: string;
}

interface GhReviewRequest {
  login?: string;
  name?: string;
  slug?: string;
}

interface GhPrFile {
  path?: string;
}

interface GhConnection<T> {
  nodes?: Array<T | null> | null;
  pageInfo?: {
    hasNextPage: boolean;
    endCursor?: string | null;
  } | null;
}

interface GhRadarPr {
  number: number;
  title: string;
  state: string;
  isDraft: boolean;
  url: string;
  body?: string;
  createdAt: string;
  updatedAt: string;
  mergedAt?: string | null;
  headRefName?: string;
  baseRefName?: string;
  mergeable?: string;
  mergeStateStatus?: string;
  reviewDecision?: string;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  labels: GhLabel[];
  reviews?: GhReview[];
  comments?: GhCommentNode[];
  statusCheckRollup?: GhCheckRollupItem[] | null;
  reviewRequests?: GhReviewRequest[];
  author?: GhAuthor;
  files: GhPrFile[];
}

interface GhSearchPr {
  number: number;
  title: string;
  state: string;
  isDraft: boolean;
  url: string;
  body?: string;
  createdAt: string;
  updatedAt: string;
  labels?: GhLabel[];
  repository: {
    name: string;
    nameWithOwner: string;
  };
  author?: GhAuthor;
}

interface GhGraphqlSearchPr {
  number: number;
  title: string;
  state: string;
  isDraft: boolean;
  url: string;
  body?: string;
  createdAt: string;
  updatedAt: string;
  labels?: GhConnection<GhLabel> | null;
  repository: {
    name: string;
    nameWithOwner: string;
  };
  author?: GhAuthor;
}

interface GhGraphqlRadarPr {
  number: number;
  title: string;
  state: string;
  isDraft: boolean;
  url: string;
  body?: string;
  createdAt: string;
  updatedAt: string;
  mergedAt?: string | null;
  headRefName?: string;
  baseRefName?: string;
  mergeable?: string;
  mergeStateStatus?: string;
  reviewDecision?: string;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  labels?: GhConnection<GhLabel> | null;
  reviews?: GhConnection<GhReview> | null;
  comments?: GhConnection<GhCommentNode> | null;
  statusCheckRollup?: {
    contexts?: GhConnection<GhCheckRollupItem> | null;
  } | null;
  reviewRequests?: GhConnection<{
    requestedReviewer?: {
      login?: string;
      name?: string;
      slug?: string;
    } | null;
  }> | null;
  author?: GhAuthor;
  files?: GhConnection<GhPrFile> | null;
}

interface GhGraphqlRepoPage {
  repository?: {
    pullRequests?: GhConnection<GhGraphqlRadarPr> | null;
  } | null;
}

interface GhGraphqlSearchPage<TNode> {
  search?: GhConnection<TNode> | null;
}

interface GhPrFilesResponse {
  repository?: {
    pullRequest?: {
      files?: GhConnection<GhPrFile> | null;
    } | null;
  } | null;
}

const RADAR_RETRY_ATTEMPTS = 2;
const RADAR_GH_TIMEOUT_MS = 12_000;
const RADAR_GRAPHQL_SEARCH_CEILING = 1000;
const DIRECT_REVIEW_DETAIL_CONCURRENCY = 6;
const PR_FILES_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!, $endCursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        files(first: 100, after: $endCursor) {
          nodes {
            path
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`;

const DIRECT_REVIEW_SEARCH_QUERY = `
  query($searchQuery: String!, $endCursor: String) {
    search(query: $searchQuery, type: ISSUE, first: 100, after: $endCursor) {
      nodes {
        ... on PullRequest {
          number
          title
          state
          isDraft
          url
          body
          createdAt
          updatedAt
          labels(first: 100) {
            nodes {
              id
              name
              color
            }
          }
          repository {
            name
            nameWithOwner
          }
          author {
            login
            type: __typename
            ... on User {
              name
            }
            ... on Organization {
              name
            }
            ... on EnterpriseUserAccount {
              name
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const RADAR_PR_NODE_FIELDS = `
  number
  title
  state
  isDraft
  url
  body
  createdAt
  updatedAt
  mergedAt
  headRefName
  baseRefName
  mergeable
  mergeStateStatus
  reviewDecision
  additions
  deletions
  changedFiles
  labels(first: 100) {
    nodes {
      id
      name
      color
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
  reviews(first: 100) {
    nodes {
      id
      author {
        login
        type: __typename
        ... on User {
          name
        }
        ... on Organization {
          name
        }
        ... on EnterpriseUserAccount {
          name
        }
      }
      state
      body
      submittedAt
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
  comments(first: 100) {
    nodes {
      id
      author {
        login
        type: __typename
        ... on User {
          name
        }
        ... on Organization {
          name
        }
        ... on EnterpriseUserAccount {
          name
        }
      }
      body
      createdAt
      url
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
  statusCheckRollup {
    contexts(first: 100) {
      nodes {
        __typename
        ... on CheckRun {
          name
          status
          conclusion
          checkSuite {
            workflowRun {
              workflow {
                name
              }
            }
          }
          detailsUrl
        }
        ... on StatusContext {
          context
          state
          targetUrl
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
  reviewRequests(first: 100) {
    nodes {
      requestedReviewer {
        ... on User {
          login
          name
        }
        ... on Team {
          slug
          name
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
  author {
    login
    type: __typename
    ... on User {
      name
    }
    ... on Organization {
      name
    }
    ... on EnterpriseUserAccount {
      name
    }
  }
  files(first: 100) {
    nodes {
      path
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
`;

const RADAR_OPEN_QUERY = `
  query($owner: String!, $repo: String!, $endCursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequests(first: 100, after: $endCursor, states: [OPEN], orderBy: { field: UPDATED_AT, direction: DESC }) {
        nodes {
          ${RADAR_PR_NODE_FIELDS}
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

const RADAR_MERGED_QUERY = `
  query($owner: String!, $repo: String!, $endCursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequests(first: 100, after: $endCursor, states: [MERGED], orderBy: { field: UPDATED_AT, direction: DESC }) {
        nodes {
          ${RADAR_PR_NODE_FIELDS}
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

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

function normalizeChecks(items: GhCheckRollupItem[] | null | undefined): PrCheck[] {
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
    return {
      name: item.name ?? 'unknown',
      status: (item.status ?? 'QUEUED') as CheckStatus,
      conclusion: (item.conclusion as CheckConclusion) ?? null,
      workflowName: item.workflowName ?? item.checkSuite?.workflowRun?.workflow?.name,
      detailsUrl: item.detailsUrl,
    };
  });
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

function normalizeState(raw: string): 'OPEN' | 'CLOSED' | 'MERGED' {
  switch (raw.toUpperCase()) {
    case 'OPEN':
      return 'OPEN';
    case 'MERGED':
      return 'MERGED';
    case 'CLOSED':
      return 'CLOSED';
    default:
      return 'OPEN';
  }
}

function buildPullRequest(raw: GhRadarPr, repo: string): PullRequest {
  const repoName = repo.split('/')[1] ?? repo;
  return {
    key: `${repo}#${raw.number}`,
    number: raw.number,
    title: raw.title,
    body: raw.body ?? '',
    url: raw.url,
    repository: {
      name: repoName,
      nameWithOwner: repo,
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
  };
}

function buildSearchPullRequest(raw: GhSearchPr): PullRequest {
  return {
    key: `${raw.repository.nameWithOwner}#${raw.number}`,
    number: raw.number,
    title: raw.title,
    body: raw.body ?? '',
    url: raw.url,
    repository: {
      name: raw.repository.name,
      nameWithOwner: raw.repository.nameWithOwner,
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
  };
}

function getFilePaths(raw: GhRadarPr): string[] {
  const files = raw.files ?? [];
  const paths: string[] = [];
  for (const file of files) {
    if (typeof file.path === 'string' && file.path.length > 0) {
      paths.push(file.path);
    }
  }
  return paths;
}

function parseTs(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isPastAgeLimit(timestamp: string | undefined, maxAgeMs: number): boolean {
  const ts = parseTs(timestamp);
  if (ts === null) return false;
  return Date.now() - ts > maxAgeMs;
}

function shouldExcludePr(
  pr: PullRequest,
  radarConfig: RadarConfig,
  repoConfig: RadarRepoConfig,
  viewerLogin: string
): boolean {
  const author = pr.author.login.toLowerCase();

  if (repoConfig.excludeAuthors?.some(excluded => excluded.toLowerCase() === author)) {
    return true;
  }

  if (radarConfig.excludeBotDrafts && pr.author.isBot && pr.isDraft) {
    return true;
  }

  if (radarConfig.excludeOwnPrs && author === viewerLogin.toLowerCase()) {
    return true;
  }

  if (
    !repoConfig.watchAll &&
    isPastAgeLimit(pr.updatedAt, radarConfig.staleCutoffDays * 24 * 60 * 60 * 1000)
  ) {
    return true;
  }

  return false;
}

function shouldExcludeDirectReviewPr(
  pr: PullRequest,
  radarConfig: RadarConfig,
  viewerLogin: string
): boolean {
  const author = pr.author.login.toLowerCase();
  if (radarConfig.excludeBotDrafts && pr.author.isBot && pr.isDraft) {
    return true;
  }
  if (radarConfig.excludeOwnPrs && author === viewerLogin.toLowerCase()) {
    return true;
  }
  return false;
}

function toRadarPr(pr: PullRequest, relevance: RelevanceReason[], isMerged: boolean): RadarPr {
  return {
    pr,
    relevance,
    topTier: topTier(relevance),
    isMerged,
  };
}

function mergeReasons(
  current: RadarPr | undefined,
  nextReasons: RelevanceReason[]
): RelevanceReason[] {
  if (!current) return nextReasons;
  const combined = [...current.relevance, ...nextReasons];
  const seen = new Set<string>();
  const deduped: RelevanceReason[] = [];
  for (const reason of combined) {
    const key = `${reason.tier}:${reason.matchedBy}:${reason.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(reason);
  }
  return deduped;
}

function buildDirectReviewSearchQuery(): string {
  return 'is:pr is:open review-requested:@me';
}

function connectionHasNextPage<T>(connection: GhConnection<T> | null | undefined): boolean {
  return connection?.pageInfo?.hasNextPage === true;
}

function isGraphqlRadarPrMetadataTruncated(raw: GhGraphqlRadarPr): boolean {
  return (
    connectionHasNextPage(raw.labels) ||
    connectionHasNextPage(raw.reviews) ||
    connectionHasNextPage(raw.comments) ||
    connectionHasNextPage(raw.statusCheckRollup?.contexts) ||
    connectionHasNextPage(raw.reviewRequests)
  );
}

function isGraphqlRadarPrFilesTruncated(raw: GhGraphqlRadarPr): boolean {
  return connectionHasNextPage(raw.files);
}

async function fetchPrFiles(repo: string, number: number): Promise<string[]> {
  const { owner, name } = splitRepo(repo);
  const paths: string[] = [];
  let endCursor: string | undefined;

  for (;;) {
    const response = await runGitHubGraphqlWithRetry<GhPrFilesResponse>(
      PR_FILES_QUERY,
      {
        owner,
        repo: name,
        number,
        endCursor,
      },
      {
        attempts: RADAR_RETRY_ATTEMPTS,
        timeoutMs: RADAR_GH_TIMEOUT_MS,
      }
    );
    const connection = response.repository?.pullRequest?.files;
    paths.push(
      ...flattenConnectionNodes(connection?.nodes).flatMap(file =>
        typeof file.path === 'string' && file.path.length > 0 ? [file.path] : []
      )
    );

    const nextCursor = connection?.pageInfo?.endCursor;
    if (!connection?.pageInfo?.hasNextPage || !nextCursor) {
      break;
    }

    endCursor = nextCursor;
  }

  return paths;
}

async function fetchRepoOpenPrs(repo: string): Promise<GhGraphqlRadarPr[]> {
  return runRepoPullRequestQuery(repo, RADAR_OPEN_QUERY);
}

async function fetchRepoMergedPrs(repo: string, maxAgeMs: number): Promise<GhGraphqlRadarPr[]> {
  return runRepoPullRequestQuery(
    repo,
    RADAR_MERGED_QUERY,
    pageNodes =>
      pageNodes.length > 0 && pageNodes.every(node => isPastAgeLimit(node.updatedAt, maxAgeMs))
  );
}

export async function getViewerLogin(): Promise<string> {
  return getGitHubViewerLogin();
}

export interface RadarFetchResult {
  viewerLogin: string;
  openPrs: Map<string, RadarPr>;
  mergedPrs: Map<string, RadarPr>;
}

function upsertRadarPr(
  map: Map<string, RadarPr>,
  pr: PullRequest,
  relevance: RelevanceReason[],
  isMerged: boolean
): void {
  const existing = map.get(pr.key);
  const mergedReasons = mergeReasons(existing, relevance);
  map.set(pr.key, toRadarPr(pr, mergedReasons, isMerged));
}

function defaultMergedRelevance(): RelevanceReason[] {
  return [
    {
      tier: 'watch',
      reason: 'Recently merged',
      matchedBy: 'recently-merged',
    },
  ];
}

function directReviewReason(viewerLogin: string): RelevanceReason[] {
  return [
    {
      tier: 'direct',
      reason: 'You are requested as reviewer',
      matchedBy: viewerLogin,
    },
  ];
}

function buildMergedSearchQuery(repo: string, mergedAfter: string): string {
  return `repo:${repo} is:pr is:merged merged:>=${mergedAfter}`;
}

function splitRepo(repo: string): { owner: string; name: string } {
  const [owner, name] = repo.split('/');
  if (!owner || !name) {
    throw new Error(`Invalid repo name: ${repo}`);
  }
  return { owner, name };
}

function flattenConnectionNodes<T>(nodes: Array<T | null> | null | undefined): T[] {
  if (!nodes) return [];
  return nodes.filter((node): node is T => node !== null);
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

async function runRadarGraphqlSearch<TNode>(query: string, searchQuery: string): Promise<TNode[]> {
  const results: TNode[] = [];
  let endCursor: string | undefined;

  for (;;) {
    const page = await runGitHubGraphqlWithRetry<GhGraphqlSearchPage<TNode>>(
      query,
      {
        searchQuery,
        endCursor,
      },
      {
        attempts: RADAR_RETRY_ATTEMPTS,
        timeoutMs: RADAR_GH_TIMEOUT_MS,
      }
    );
    const connection = page.search;
    results.push(...flattenConnectionNodes(connection?.nodes));

    const nextCursor = connection?.pageInfo?.endCursor;
    if (!connection?.pageInfo?.hasNextPage || !nextCursor) {
      break;
    }

    endCursor = nextCursor;
  }

  return results;
}

const warnedSearchCeilings = new Set<string>();

function warnSearchCeiling(scope: string): void {
  if (warnedSearchCeilings.has(scope)) return;
  warnedSearchCeilings.add(scope);
  console.warn(
    `[vigil] GitHub search hit its ${RADAR_GRAPHQL_SEARCH_CEILING}-PR ceiling for ${scope}; results beyond that may be omitted.`
  );
}

async function fetchDirectReviewSearchResults(): Promise<GhSearchPr[]> {
  const nodes = await runRadarGraphqlSearch<GhGraphqlSearchPr>(
    DIRECT_REVIEW_SEARCH_QUERY,
    buildDirectReviewSearchQuery()
  );
  if (nodes.length >= RADAR_GRAPHQL_SEARCH_CEILING) {
    warnSearchCeiling('direct review requests');
  }
  return nodes.map(raw => ({
    ...raw,
    labels: flattenConnectionNodes(raw.labels?.nodes),
  }));
}

function flattenGraphqlRadarPr(raw: GhGraphqlRadarPr): GhRadarPr {
  return {
    ...raw,
    labels: flattenConnectionNodes(raw.labels?.nodes),
    reviews: flattenConnectionNodes(raw.reviews?.nodes),
    comments: flattenConnectionNodes(raw.comments?.nodes),
    statusCheckRollup: flattenConnectionNodes(raw.statusCheckRollup?.contexts?.nodes),
    reviewRequests: flattenConnectionNodes(raw.reviewRequests?.nodes)
      .map(node => node.requestedReviewer)
      .filter(
        (
          reviewer
        ): reviewer is {
          login?: string;
          name?: string;
          slug?: string;
        } => reviewer !== null && reviewer !== undefined
      ),
    files: flattenConnectionNodes(raw.files?.nodes),
  };
}

async function runRepoPullRequestQuery(
  repo: string,
  query: string,
  stopAfterPage?: ((pageNodes: GhGraphqlRadarPr[]) => boolean) | undefined
): Promise<GhGraphqlRadarPr[]> {
  const { owner, name } = splitRepo(repo);
  const results: GhGraphqlRadarPr[] = [];
  let endCursor: string | undefined;

  for (;;) {
    const page = await runGitHubGraphqlWithRetry<GhGraphqlRepoPage>(
      query,
      {
        owner,
        repo: name,
        endCursor,
      },
      {
        attempts: RADAR_RETRY_ATTEMPTS,
        timeoutMs: RADAR_GH_TIMEOUT_MS,
      }
    );
    const connection = page.repository?.pullRequests;
    const pageNodes = flattenConnectionNodes(connection?.nodes);
    results.push(...pageNodes);
    if (stopAfterPage?.(pageNodes)) {
      break;
    }

    const nextCursor = connection?.pageInfo?.endCursor;
    if (!connection?.pageInfo?.hasNextPage || !nextCursor) {
      break;
    }
    endCursor = nextCursor;
  }

  return results;
}

async function hydrateRadarMetadata(
  raw: GhGraphqlRadarPr,
  repo: string,
  fallbackPr: PullRequest
): Promise<PullRequest> {
  if (!isGraphqlRadarPrMetadataTruncated(raw)) {
    return fallbackPr;
  }

  try {
    const { owner, name } = splitRepo(repo);
    return await fetchPrDetail(owner, name, raw.number);
  } catch {
    return fallbackPr;
  }
}

async function hydrateRadarFilePaths(
  raw: GhGraphqlRadarPr,
  repo: string,
  fallbackPaths: string[]
): Promise<string[]> {
  if (!isGraphqlRadarPrFilesTruncated(raw)) {
    return fallbackPaths;
  }

  try {
    return await fetchPrFiles(repo, raw.number);
  } catch {
    return fallbackPaths;
  }
}

async function collectDirectReviewRadar(
  config: RadarConfig,
  viewerLogin: string,
  openPrs: Map<string, RadarPr>
): Promise<void> {
  const seen = new Set<string>();
  const directRequests = (await fetchDirectReviewSearchResults()).filter(raw => {
    const key = `${raw.repository.nameWithOwner}#${raw.number}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  await runWithConcurrency(directRequests, DIRECT_REVIEW_DETAIL_CONCURRENCY, async raw => {
    let pr = buildSearchPullRequest(raw);

    try {
      const { owner, name } = splitRepo(raw.repository.nameWithOwner);
      pr = await fetchPrDetail(owner, name, raw.number);
    } catch {
      // Fall back to search data when detail hydration fails.
    }

    if (shouldExcludeDirectReviewPr(pr, config, viewerLogin)) {
      return;
    }

    upsertRadarPr(openPrs, pr, directReviewReason(viewerLogin), false);
  });
}

async function collectOpenRepoRadar(
  config: RadarConfig,
  repoConfig: RadarRepoConfig,
  viewerLogin: string,
  openPrs: Map<string, RadarPr>
): Promise<void> {
  const rawOpenPrs = await fetchRepoOpenPrs(repoConfig.repo);
  for (const raw of rawOpenPrs) {
    const flattened = flattenGraphqlRadarPr(raw);
    let pr = buildPullRequest(flattened, repoConfig.repo);
    if (shouldExcludePr(pr, config, repoConfig, viewerLogin)) continue;
    pr = await hydrateRadarMetadata(raw, repoConfig.repo, pr);
    const filePaths = await hydrateRadarFilePaths(raw, repoConfig.repo, getFilePaths(flattened));

    const relevance = classifyRelevance(pr, filePaths, repoConfig, config.teams, viewerLogin);
    if (relevance.length === 0) continue;
    upsertRadarPr(openPrs, pr, relevance, false);
  }
}

async function collectMergedRepoRadar(
  config: RadarConfig,
  repoConfig: RadarRepoConfig,
  viewerLogin: string,
  mergedPrs: Map<string, RadarPr>
): Promise<void> {
  if (config.merged.limit <= 0) return;

  const maxAgeMs = config.merged.maxAgeHours * 60 * 60 * 1000;
  const rawMergedPrs = await fetchRepoMergedPrs(repoConfig.repo, maxAgeMs);

  for (const raw of rawMergedPrs) {
    const flattened = flattenGraphqlRadarPr(raw);
    let pr = buildPullRequest(flattened, repoConfig.repo);
    if (isPastAgeLimit(pr.mergedAt ?? pr.updatedAt, maxAgeMs)) {
      continue;
    }
    pr = await hydrateRadarMetadata(raw, repoConfig.repo, pr);
    const filePaths = await hydrateRadarFilePaths(raw, repoConfig.repo, getFilePaths(flattened));

    const relevance = classifyRelevance(pr, filePaths, repoConfig, config.teams, viewerLogin);
    const hasDomainReason = relevance.some(reason => reason.tier === 'domain');
    if (config.merged.domainOnly && !hasDomainReason) continue;

    upsertRadarPr(mergedPrs, pr, relevance.length > 0 ? relevance : defaultMergedRelevance(), true);
  }
}

function limitMergedPrs(mergedPrs: Map<string, RadarPr>, limit: number): Map<string, RadarPr> {
  if (limit <= 0) return new Map();
  if (mergedPrs.size <= limit) return mergedPrs;

  const sorted = [...mergedPrs.values()].sort((a, b) => {
    const aTs = parseTs(a.pr.mergedAt ?? a.pr.updatedAt) ?? 0;
    const bTs = parseTs(b.pr.mergedAt ?? b.pr.updatedAt) ?? 0;
    return bTs - aTs;
  });

  const limited = new Map<string, RadarPr>();
  for (const radarPr of sorted.slice(0, limit)) {
    limited.set(radarPr.pr.key, radarPr);
  }
  return limited;
}

export async function fetchRadarPrs(config: RadarConfig): Promise<RadarFetchResult> {
  const viewerLogin = await getViewerLogin();
  const openPrs = new Map<string, RadarPr>();
  const mergedPrs = new Map<string, RadarPr>();

  await Promise.all([
    collectDirectReviewRadar(config, viewerLogin, openPrs),
    ...config.repos.map(async repoConfig => {
      await Promise.all([
        collectOpenRepoRadar(config, repoConfig, viewerLogin, openPrs),
        collectMergedRepoRadar(config, repoConfig, viewerLogin, mergedPrs),
      ]);
    }),
  ]);

  return {
    viewerLogin,
    openPrs,
    mergedPrs: limitMergedPrs(mergedPrs, config.merged.limit),
  };
}

export const _internal = {
  buildMergedSearchQuery,
  buildDirectReviewSearchQuery,
  buildSearchPullRequest,
  connectionHasNextPage,
  directReviewReason,
  isGraphqlRadarPrFilesTruncated,
  isGraphqlRadarPrMetadataTruncated,
  limitMergedPrs,
  shouldExcludeDirectReviewPr,
  shouldExcludePr,
};
