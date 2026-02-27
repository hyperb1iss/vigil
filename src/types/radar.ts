import type { PullRequest } from './pr.js';

/** Why a PR appears in incoming review radar. */
export type RelevanceTier = 'direct' | 'domain' | 'watch';

/** Dashboard feed source mode. */
export type DashboardFeedMode = 'mine' | 'incoming' | 'both';

/** Relevance reason attached to each tracked PR. */
export interface RelevanceReason {
  tier: RelevanceTier;
  reason: string;
  matchedBy: string;
}

/** Domain path-based match rule. */
export interface DomainRule {
  name: string;
  pathPatterns: string[];
  minFiles?: number | undefined;
  tier: RelevanceTier;
}

/** Team membership that implies direct review responsibility. */
export interface TeamWatch {
  slug: string;
  name: string;
}

/** Recently merged PR tracking settings. */
export interface MergedTracking {
  limit: number;
  maxAgeHours: number;
  domainOnly: boolean;
}

export interface RadarRepoConfig {
  repo: string;
  domainRules: DomainRule[];
  relevantLabels?: string[] | undefined;
  watchAuthors?: string[] | undefined;
  excludeAuthors?: string[] | undefined;
}

export interface RadarConfig {
  enabled: boolean;
  repos: RadarRepoConfig[];
  teams: TeamWatch[];
  pollIntervalMs: number;
  merged: MergedTracking;
  notifications: {
    onDirectReviewRequest: boolean;
    onNewDomainPr: boolean;
    onMergedDomainPr: boolean;
  };
  excludeBotDrafts: boolean;
  excludeOwnPrs: boolean;
  staleCutoffDays: number;
}

/** A PR tracked by Review Radar. */
export interface RadarPr {
  pr: PullRequest;
  relevance: RelevanceReason[];
  topTier: RelevanceTier;
  isMerged: boolean;
}

export interface RadarFilter {
  tier?: RelevanceTier | undefined;
  repo?: string | undefined;
  domain?: string | undefined;
}
