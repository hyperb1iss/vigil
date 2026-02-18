import type { PrCheck, PrComment, PrReview, PullRequest } from './pr.js';

export type EventType =
  | 'pr_opened'
  | 'pr_closed'
  | 'pr_merged'
  | 'review_submitted'
  | 'comment_added'
  | 'checks_changed'
  | 'conflict_detected'
  | 'conflict_resolved'
  | 'branch_behind'
  | 'labels_changed'
  | 'ready_to_merge'
  | 'became_draft'
  | 'undrafted';

export interface PrEvent {
  type: EventType;
  prKey: string;
  pr: PullRequest;
  timestamp: string;
  data?: EventData | undefined;
}

export type EventData =
  | ReviewSubmittedData
  | CommentAddedData
  | ChecksChangedData
  | BranchBehindData
  | LabelsChangedData;

export interface ReviewSubmittedData {
  type: 'review_submitted';
  review: PrReview;
}

export interface CommentAddedData {
  type: 'comment_added';
  comment: PrComment;
}

export interface ChecksChangedData {
  type: 'checks_changed';
  checks: PrCheck[];
  previousChecks: PrCheck[];
}

export interface BranchBehindData {
  type: 'branch_behind';
  commitsBehind: number;
}

export interface LabelsChangedData {
  type: 'labels_changed';
  added: string[];
  removed: string[];
}
