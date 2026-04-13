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
import { runGhWithRetry } from './github.js';
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
  data?: {
    repository?: {
      pullRequests?: GhConnection<GhGraphqlRadarPr> | null;
    } | null;
  } | null;
}

const RADAR_RETRY_ATTEMPTS = 2;
const RADAR_GH_TIMEOUT_MS = 12_000;

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
  }
  statusCheckRollup {
    contexts(first: 100) {
      nodes {
        __typename
        ... on CheckRun {
          name
          status
          conclusion
          workflowName
          detailsUrl
        }
        ... on StatusContext {
          context
          state
          targetUrl
        }
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

let viewerLoginCache: string | null = null;

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
      workflowName: item.workflowName,
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

async function fetchRepoOpenPrs(repo: string): Promise<GhRadarPr[]> {
  const nodes = await runRepoPullRequestQuery(repo, RADAR_OPEN_QUERY);
  return nodes.map(flattenGraphqlRadarPr);
}

async function fetchRepoMergedPrs(repo: string, maxAgeMs: number): Promise<GhRadarPr[]> {
  const nodes = await runRepoPullRequestQuery(
    repo,
    RADAR_MERGED_QUERY,
    pageNodes =>
      pageNodes.length > 0 && pageNodes.every(node => isPastAgeLimit(node.updatedAt, maxAgeMs))
  );
  return nodes.map(flattenGraphqlRadarPr);
}

export async function getViewerLogin(): Promise<string> {
  if (viewerLoginCache) return viewerLoginCache;
  const login = await runGhWithRetry(
    ['api', 'user', '--jq', '.login'],
    RADAR_RETRY_ATTEMPTS,
    RADAR_GH_TIMEOUT_MS
  );
  viewerLoginCache = login.trim();
  return viewerLoginCache;
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
    const args = [
      'api',
      'graphql',
      '-f',
      `query=${query}`,
      '-F',
      `owner=${owner}`,
      '-F',
      `repo=${name}`,
    ];
    if (endCursor) {
      args.push('-F', `endCursor=${endCursor}`);
    }

    const json = await runGhWithRetry(args, RADAR_RETRY_ATTEMPTS, RADAR_GH_TIMEOUT_MS);
    const page = JSON.parse(json) as GhGraphqlRepoPage;
    const connection = page.data?.repository?.pullRequests;
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
async function collectOpenRepoRadar(
  config: RadarConfig,
  repoConfig: RadarRepoConfig,
  viewerLogin: string,
  openPrs: Map<string, RadarPr>
): Promise<void> {
  const rawOpenPrs = await fetchRepoOpenPrs(repoConfig.repo);
  for (const raw of rawOpenPrs) {
    const pr = buildPullRequest(raw, repoConfig.repo);
    if (shouldExcludePr(pr, config, repoConfig, viewerLogin)) continue;

    const relevance = classifyRelevance(
      pr,
      getFilePaths(raw),
      repoConfig,
      config.teams,
      viewerLogin
    );
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
    const pr = buildPullRequest(raw, repoConfig.repo);
    if (isPastAgeLimit(pr.mergedAt ?? pr.updatedAt, maxAgeMs)) {
      continue;
    }

    const relevance = classifyRelevance(
      pr,
      getFilePaths(raw),
      repoConfig,
      config.teams,
      viewerLogin
    );
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

  await Promise.all(
    config.repos.map(async repoConfig => {
      await Promise.all([
        collectOpenRepoRadar(config, repoConfig, viewerLogin, openPrs),
        collectMergedRepoRadar(config, repoConfig, viewerLogin, mergedPrs),
      ]);
    })
  );

  return {
    viewerLogin,
    openPrs,
    mergedPrs: limitMergedPrs(mergedPrs, config.merged.limit),
  };
}

export const _internal = {
  buildMergedSearchQuery,
  limitMergedPrs,
  shouldExcludePr,
};
