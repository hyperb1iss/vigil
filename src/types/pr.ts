export type PrState = 'hot' | 'waiting' | 'ready' | 'dormant' | 'blocked';

export type CheckStatus = 'COMPLETED' | 'IN_PROGRESS' | 'QUEUED' | 'PENDING';
export type CheckConclusion = 'SUCCESS' | 'FAILURE' | 'SKIPPED' | 'CANCELLED' | 'NEUTRAL' | null;
export type MergeableState = 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
export type ReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | '';
export type ReviewState = 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';

export interface PrAuthor {
  login: string;
  name?: string | undefined;
  isBot: boolean;
}

export interface PrLabel {
  id: string;
  name: string;
  color: string;
}

export interface PrReview {
  id: string;
  author: PrAuthor;
  state: ReviewState;
  body: string;
  submittedAt: string;
}

export interface PrComment {
  id: string;
  author: PrAuthor;
  body: string;
  createdAt: string;
  url: string;
}

export interface PrCheck {
  name: string;
  status: CheckStatus;
  conclusion: CheckConclusion;
  workflowName?: string | undefined;
  detailsUrl?: string | undefined;
}

export interface PrWorktree {
  path: string;
  branch: string;
  isClean: boolean;
  uncommittedChanges: number;
}

export interface PullRequest {
  /** Unique key: "owner/repo#number" */
  key: string;
  number: number;
  title: string;
  body: string;
  url: string;
  repository: {
    name: string;
    nameWithOwner: string;
  };
  author: PrAuthor;
  headRefName: string;
  baseRefName: string;
  isDraft: boolean;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  mergeable: MergeableState;
  reviewDecision: ReviewDecision;
  reviews: PrReview[];
  comments: PrComment[];
  checks: PrCheck[];
  labels: PrLabel[];
  additions: number;
  deletions: number;
  changedFiles: number;
  createdAt: string;
  updatedAt: string;
  worktree?: PrWorktree | undefined;
}
