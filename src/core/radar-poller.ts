import { vigilStore } from '../store/index.js';
import type { PullRequest } from '../types/pr.js';
import type { RadarConfig, RadarPr } from '../types/radar.js';
import { fetchRadarPrs } from './radar-github.js';

export type RadarChangeKind = 'review_requested' | 'domain_pr_opened' | 'domain_pr_merged';

export interface RadarChange {
  kind: RadarChangeKind;
  key: string;
  radarPr: RadarPr;
  timestamp: string;
}

export interface RadarPollerOptions {
  intervalMs: number;
  radarConfig: RadarConfig;
  onChanges?: ((changes: RadarChange[]) => Promise<void>) | undefined;
  onError?: ((error: unknown) => void) | undefined;
}

let radarPollerTimer: ReturnType<typeof setInterval> | null = null;
const DISAPPEARANCE_CONFIRM_POLLS = 2;
const missingStreaks = new Map<string, number>();

function resetRadarPollerState(
  timer: ReturnType<typeof setInterval> | null,
  streaks: Map<string, number>,
  clearTimer: typeof clearInterval = clearInterval
): null {
  if (timer) {
    clearTimer(timer);
  }
  streaks.clear();
  return null;
}

function hasEnrichedDetail(pr: PullRequest): boolean {
  return (
    pr.headRefName.length > 0 ||
    pr.baseRefName.length > 0 ||
    pr.reviews.length > 0 ||
    pr.comments.length > 0 ||
    pr.checks.length > 0 ||
    pr.additions > 0 ||
    pr.deletions > 0 ||
    pr.changedFiles > 0
  );
}

function mergePullRequestSnapshot(next: PullRequest, previous: PullRequest): PullRequest {
  if (!hasEnrichedDetail(previous)) return next;

  return {
    ...previous,
    ...next,
    headRefName: next.headRefName || previous.headRefName,
    baseRefName: next.baseRefName || previous.baseRefName,
    mergeable: next.mergeable !== 'UNKNOWN' ? next.mergeable : previous.mergeable,
    mergeStateStatus:
      next.mergeStateStatus && next.mergeStateStatus !== 'UNKNOWN'
        ? next.mergeStateStatus
        : previous.mergeStateStatus,
    reviewDecision: next.reviewDecision || previous.reviewDecision,
    reviews: next.reviews.length > 0 ? next.reviews : previous.reviews,
    comments: next.comments.length > 0 ? next.comments : previous.comments,
    checks: next.checks.length > 0 ? next.checks : previous.checks,
    additions: next.additions > 0 ? next.additions : previous.additions,
    deletions: next.deletions > 0 ? next.deletions : previous.deletions,
    changedFiles: next.changedFiles > 0 ? next.changedFiles : previous.changedFiles,
    worktree: next.worktree ?? previous.worktree,
  };
}

function preserveSnapshotDetails(
  previous: Map<string, RadarPr>,
  fetched: Map<string, RadarPr>
): Map<string, RadarPr> {
  const merged = new Map<string, RadarPr>();
  for (const [key, next] of fetched) {
    const prev = previous.get(key);
    if (!prev) {
      merged.set(key, next);
      continue;
    }

    merged.set(key, {
      ...next,
      pr: mergePullRequestSnapshot(next.pr, prev.pr),
    });
  }
  return merged;
}

function stabilizeCurrentSnapshot(
  previous: Map<string, RadarPr>,
  fetchedCurrent: Map<string, RadarPr>,
  streaks: Map<string, number>,
  confirmAfterPolls = DISAPPEARANCE_CONFIRM_POLLS
): Map<string, RadarPr> {
  const threshold = Math.max(1, Math.floor(confirmAfterPolls));
  const stabilized = new Map(fetchedCurrent);

  for (const key of [...streaks.keys()]) {
    if (!previous.has(key) && !fetchedCurrent.has(key)) {
      streaks.delete(key);
    }
  }

  for (const key of fetchedCurrent.keys()) {
    streaks.delete(key);
  }

  for (const [key, previousPr] of previous) {
    if (fetchedCurrent.has(key)) continue;
    const nextStreak = (streaks.get(key) ?? 0) + 1;
    if (nextStreak < threshold) {
      streaks.set(key, nextStreak);
      stabilized.set(key, previousPr);
      continue;
    }
    streaks.delete(key);
  }

  return stabilized;
}

function makeChanges(
  previousOpen: Map<string, RadarPr>,
  currentOpen: Map<string, RadarPr>,
  previousMerged: Map<string, RadarPr>,
  currentMerged: Map<string, RadarPr>
): RadarChange[] {
  const now = new Date().toISOString();
  const changes: RadarChange[] = [];

  for (const [key, current] of currentOpen) {
    const prev = previousOpen.get(key);
    if (!prev) {
      if (current.topTier === 'direct') {
        changes.push({ kind: 'review_requested', key, radarPr: current, timestamp: now });
      } else if (current.topTier === 'domain') {
        changes.push({ kind: 'domain_pr_opened', key, radarPr: current, timestamp: now });
      }
      continue;
    }

    if (prev.topTier !== 'direct' && current.topTier === 'direct') {
      changes.push({ kind: 'review_requested', key, radarPr: current, timestamp: now });
    }
  }

  for (const [key, merged] of currentMerged) {
    if (!previousMerged.has(key)) {
      changes.push({ kind: 'domain_pr_merged', key, radarPr: merged, timestamp: now });
    }
  }

  return changes;
}

export async function pollRadar(radarConfig: RadarConfig): Promise<RadarChange[]> {
  const store = vigilStore;
  const state = store.getState();

  store.getState().setRadarPolling(true);

  try {
    const result = await fetchRadarPrs(radarConfig);
    const hydratedOpen = preserveSnapshotDetails(state.radarPrs, result.openPrs);
    const hydratedMerged = preserveSnapshotDetails(state.mergedRadarPrs, result.mergedPrs);
    const stabilizedOpen = stabilizeCurrentSnapshot(state.radarPrs, hydratedOpen, missingStreaks);
    const changes = makeChanges(
      state.radarPrs,
      stabilizedOpen,
      state.mergedRadarPrs,
      hydratedMerged
    );

    store.getState().setRadarPrs(stabilizedOpen);
    store.getState().setMergedRadarPrs(hydratedMerged);
    store.getState().setRadarLastPollAt(new Date().toISOString());
    store.getState().setRadarPollError(null);

    return changes;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.getState().setRadarPollError(message);
    throw error;
  } finally {
    store.getState().setRadarPolling(false);
  }
}

export function startRadarPoller(options: RadarPollerOptions): () => void {
  const { intervalMs, radarConfig, onChanges, onError } = options;
  const safeIntervalMs = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 60_000;
  let inFlight = false;

  radarPollerTimer = resetRadarPollerState(radarPollerTimer, missingStreaks);

  async function tick(): Promise<void> {
    if (inFlight) return;
    inFlight = true;
    try {
      const changes = await pollRadar(radarConfig);
      if (changes.length > 0 && onChanges) {
        await onChanges(changes);
      }
    } catch (error) {
      onError?.(error);
    } finally {
      inFlight = false;
    }
  }

  void tick();
  radarPollerTimer = setInterval(() => void tick(), safeIntervalMs);

  return () => {
    radarPollerTimer = resetRadarPollerState(radarPollerTimer, missingStreaks);
  };
}

export const _internal = {
  mergePullRequestSnapshot,
  resetRadarPollerState,
  preserveSnapshotDetails,
  stabilizeCurrentSnapshot,
  makeChanges,
};
