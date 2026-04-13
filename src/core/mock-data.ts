/**
 * Mock PR data for visual testing and demo mode.
 * Seed the store with realistic PR scenarios.
 */

import type { PrState, PullRequest } from '../types/index.js';

const now = Date.now();
const min = 60_000;
const hour = 3_600_000;
const day = 86_400_000;

function iso(offset: number): string {
  return new Date(now - offset).toISOString();
}

export const mockPrs: PullRequest[] = [
  {
    key: 'acme/console#142',
    number: 142,
    title: 'Fix authentication token refresh on session timeout',
    body: 'Tokens were silently expiring without triggering refresh',
    url: 'https://github.com/acme/console/pull/142',
    repository: { name: 'console', nameWithOwner: 'acme/console' },
    author: { login: 'alex', isBot: false },
    headRefName: 'fix/auth-token-refresh',
    baseRefName: 'main',
    isDraft: false,
    state: 'OPEN',
    mergeable: 'MERGEABLE',
    reviewDecision: 'CHANGES_REQUESTED',
    reviews: [
      {
        id: 'r1',
        author: { login: 'jsmith', isBot: false },
        state: 'APPROVED',
        body: 'LGTM',
        submittedAt: iso(2 * hour),
      },
      {
        id: 'r2',
        author: { login: 'alice', isBot: false },
        state: 'CHANGES_REQUESTED',
        body: 'Needs error handling',
        submittedAt: iso(1 * hour),
      },
    ],
    comments: [
      {
        id: 'c1',
        author: { login: 'alice', isBot: false },
        body: 'Can you add a retry mechanism for the token refresh?',
        createdAt: iso(45 * min),
        url: '',
      },
      {
        id: 'c2',
        author: { login: 'alex', isBot: false },
        body: 'Good call, will add exponential backoff',
        createdAt: iso(30 * min),
        url: '',
      },
    ],
    checks: [
      { name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'test-unit', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'test-integration', status: 'COMPLETED', conclusion: 'FAILURE' },
      { name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'typecheck', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'coverage', status: 'IN_PROGRESS', conclusion: null },
    ],
    labels: [{ id: 'l1', name: 'bug', color: 'fc2929' }],
    additions: 142,
    deletions: 38,
    changedFiles: 12,
    createdAt: iso(2 * day),
    updatedAt: iso(30 * min),
  },
  {
    key: 'acme/console#139',
    number: 139,
    title: 'Add rate limiting middleware to API endpoints',
    body: 'Implement sliding window rate limiting',
    url: 'https://github.com/acme/console/pull/139',
    repository: { name: 'console', nameWithOwner: 'acme/console' },
    author: { login: 'alex', isBot: false },
    headRefName: 'feat/rate-limiting',
    baseRefName: 'main',
    isDraft: false,
    state: 'OPEN',
    mergeable: 'MERGEABLE',
    reviewDecision: 'REVIEW_REQUIRED',
    reviews: [],
    comments: [],
    checks: [
      { name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'test-unit', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'test-integration', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' },
    ],
    labels: [{ id: 'l2', name: 'enhancement', color: '84b6eb' }],
    additions: 287,
    deletions: 12,
    changedFiles: 8,
    createdAt: iso(3 * day),
    updatedAt: iso(5 * hour),
  },
  {
    key: 'acme/console#137',
    number: 137,
    title: 'Upgrade to React 19 with concurrent features',
    body: 'Major upgrade with new hook patterns',
    url: 'https://github.com/acme/console/pull/137',
    repository: { name: 'console', nameWithOwner: 'acme/console' },
    author: { login: 'alex', isBot: false },
    headRefName: 'chore/react-19',
    baseRefName: 'main',
    isDraft: false,
    state: 'OPEN',
    mergeable: 'MERGEABLE',
    reviewDecision: 'APPROVED',
    reviews: [
      {
        id: 'r3',
        author: { login: 'bob', isBot: false },
        state: 'APPROVED',
        body: 'Nice!',
        submittedAt: iso(1 * day),
      },
      {
        id: 'r4',
        author: { login: 'carol', isBot: false },
        state: 'APPROVED',
        body: 'Tested locally, works great',
        submittedAt: iso(12 * hour),
      },
    ],
    comments: [],
    checks: [
      { name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'test-unit', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'test-integration', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'typecheck', status: 'COMPLETED', conclusion: 'SUCCESS' },
    ],
    labels: [{ id: 'l3', name: 'dependencies', color: '0366d6' }],
    additions: 524,
    deletions: 389,
    changedFiles: 34,
    createdAt: iso(5 * day),
    updatedAt: iso(12 * hour),
  },
  {
    key: 'acme/console#135',
    number: 135,
    title: 'Fix merge conflict in CI pipeline configuration',
    body: 'Conflicting changes from parallel PRs',
    url: 'https://github.com/acme/console/pull/135',
    repository: { name: 'console', nameWithOwner: 'acme/console' },
    author: { login: 'alex', isBot: false },
    headRefName: 'fix/ci-config',
    baseRefName: 'main',
    isDraft: false,
    state: 'OPEN',
    mergeable: 'CONFLICTING',
    reviewDecision: 'REVIEW_REQUIRED',
    reviews: [],
    comments: [
      {
        id: 'c3',
        author: { login: 'github-actions', isBot: true },
        body: 'Merge conflict detected in .github/workflows/ci.yml',
        createdAt: iso(6 * hour),
        url: '',
      },
    ],
    checks: [
      { name: 'build', status: 'COMPLETED', conclusion: 'FAILURE' },
      { name: 'test-unit', status: 'COMPLETED', conclusion: 'CANCELLED' },
    ],
    labels: [],
    additions: 15,
    deletions: 8,
    changedFiles: 2,
    createdAt: iso(4 * day),
    updatedAt: iso(6 * hour),
  },
  {
    key: 'open-tools/cli-kit#89',
    number: 89,
    title: 'Update dependency tree for security patches',
    body: 'Automated security update',
    url: 'https://github.com/open-tools/cli-kit/pull/89',
    repository: { name: 'cli-kit', nameWithOwner: 'open-tools/cli-kit' },
    author: { login: 'dependabot[bot]', isBot: true },
    headRefName: 'dependabot/npm_and_yarn/deps',
    baseRefName: 'main',
    isDraft: false,
    state: 'OPEN',
    mergeable: 'MERGEABLE',
    reviewDecision: '',
    reviews: [],
    comments: [],
    checks: [
      { name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'audit', status: 'COMPLETED', conclusion: 'SUCCESS' },
    ],
    labels: [{ id: 'l4', name: 'dependencies', color: '0366d6' }],
    additions: 42,
    deletions: 18,
    changedFiles: 3,
    createdAt: iso(1 * day),
    updatedAt: iso(8 * hour),
  },
  {
    key: 'personal/notesync#234',
    number: 234,
    title: 'Implement vector similarity search with cosine distance',
    body: 'New search backend using FalkorDB vector index',
    url: 'https://github.com/personal/notesync/pull/234',
    repository: { name: 'notesync', nameWithOwner: 'personal/notesync' },
    author: { login: 'alex', isBot: false },
    headRefName: 'feat/vector-search',
    baseRefName: 'main',
    isDraft: true,
    state: 'OPEN',
    mergeable: 'UNKNOWN',
    reviewDecision: '',
    reviews: [],
    comments: [],
    checks: [
      { name: 'build', status: 'QUEUED', conclusion: null },
      { name: 'test', status: 'QUEUED', conclusion: null },
    ],
    labels: [{ id: 'l5', name: 'WIP', color: 'fbca04' }],
    additions: 891,
    deletions: 45,
    changedFiles: 18,
    createdAt: iso(12 * hour),
    updatedAt: iso(2 * hour),
  },
  {
    key: 'labs/device-link#12',
    number: 12,
    title: 'Add screen mirroring via scrcpy integration',
    body: 'Stream Android screen to terminal with scrcpy backend',
    url: 'https://github.com/labs/device-link/pull/12',
    repository: { name: 'device-link', nameWithOwner: 'labs/device-link' },
    author: { login: 'alex', isBot: false },
    headRefName: 'feat/screen-mirror',
    baseRefName: 'main',
    isDraft: false,
    state: 'OPEN',
    mergeable: 'MERGEABLE',
    reviewDecision: '',
    reviews: [],
    comments: [
      {
        id: 'c4',
        author: { login: 'alex', isBot: false },
        body: 'Testing with Pixel 8 and Samsung S24, both work smoothly',
        createdAt: iso(3 * hour),
        url: '',
      },
    ],
    checks: [
      { name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'mypy', status: 'COMPLETED', conclusion: 'SUCCESS' },
    ],
    labels: [],
    additions: 356,
    deletions: 22,
    changedFiles: 7,
    createdAt: iso(2 * day),
    updatedAt: iso(3 * hour),
  },
];

export const mockStates: Map<string, PrState> = new Map([
  ['acme/console#142', 'hot'],
  ['acme/console#139', 'waiting'],
  ['acme/console#137', 'ready'],
  ['acme/console#135', 'blocked'],
  ['open-tools/cli-kit#89', 'dormant'],
  ['personal/notesync#234', 'waiting'],
  ['labs/device-link#12', 'dormant'],
]);

export function seedMockData(store: {
  getState: () => {
    setPrs: (prs: Map<string, PullRequest>) => void;
    setPrState: (key: string, state: PrState) => void;
    setLastPollAt: (ts: string) => void;
  };
}): void {
  const s = store.getState();
  const prMap = new Map<string, PullRequest>();
  for (const pr of mockPrs) {
    prMap.set(pr.key, pr);
  }
  s.setPrs(prMap);
  for (const [key, state] of mockStates) {
    s.setPrState(key, state);
  }
  s.setLastPollAt(new Date().toISOString());
}
