import { vigilStore } from '../store/index.js';
import type { PrEvent } from '../types/events.js';
import type { PullRequest } from '../types/pr.js';
import { diffPrs } from './differ.js';
import { fetchMyOpenPrs } from './github.js';
import { classifyPr } from './state-machine.js';

export interface PollerOptions {
  intervalMs: number;
  repos?: string[] | undefined;
  onEvents?: ((events: PrEvent[]) => Promise<void>) | undefined;
  onError?: ((error: unknown) => void) | undefined;
}

let pollerTimer: ReturnType<typeof setInterval> | null = null;
const DISAPPEARANCE_CONFIRM_POLLS = 2;
const missingStreaks = new Map<string, number>();

/**
 * Stabilize transient "PR disappeared" snapshots by requiring consecutive misses
 * before treating a PR as closed/merged externally.
 */
function stabilizeCurrentSnapshot(
  previous: Map<string, PullRequest>,
  fetchedCurrent: Map<string, PullRequest>,
  streaks: Map<string, number>,
  confirmAfterPolls = DISAPPEARANCE_CONFIRM_POLLS
): Map<string, PullRequest> {
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
    if (fetchedCurrent.has(key)) {
      continue;
    }

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

/**
 * Execute a single poll cycle:
 *  1. Fetch all open PRs
 *  2. Diff against previous snapshot
 *  3. Classify PR states
 *  4. Update store
 *  5. Return events for agent orchestration
 */
export async function poll(repos?: string[]): Promise<PrEvent[]> {
  const store = vigilStore;
  const state = store.getState();

  store.getState().setPolling(true);

  try {
    const prs = await fetchMyOpenPrs(repos, state.prs);

    // Build current snapshot
    const currentMap = new Map<string, PullRequest>();
    for (const pr of prs) {
      currentMap.set(pr.key, pr);
    }

    // Stabilize transient disappearance glitches before diffing.
    const stabilizedCurrentMap = stabilizeCurrentSnapshot(state.prs, currentMap, missingStreaks);

    // Diff against previous
    const events = diffPrs(state.prs, stabilizedCurrentMap);

    // Classify states
    const dormantThreshold = state.config.display.dormantThresholdHours;
    for (const [key, pr] of stabilizedCurrentMap) {
      const prState = classifyPr(pr, dormantThreshold);
      store.getState().setPrState(key, prState);
    }

    // Update store
    store.getState().setPrs(stabilizedCurrentMap);
    store.getState().setLastPollAt(new Date().toISOString());
    store.getState().setPollError(null);

    return events;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.getState().setPollError(message);
    throw error;
  } finally {
    store.getState().setPolling(false);
  }
}

/**
 * Start the polling loop. Returns a cleanup function.
 */
export function startPoller(options: PollerOptions): () => void {
  const { intervalMs, repos, onEvents, onError } = options;
  const safeIntervalMs = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 30_000;
  let inFlight = false;

  async function tick(): Promise<void> {
    if (inFlight) return;
    inFlight = true;

    try {
      const events = await poll(repos);
      if (events.length > 0 && onEvents) {
        await onEvents(events);
      }
    } catch (error) {
      onError?.(error);
    } finally {
      inFlight = false;
    }
  }

  // Run immediately, then on interval
  void tick();
  pollerTimer = setInterval(() => void tick(), safeIntervalMs);

  return () => {
    if (pollerTimer) {
      clearInterval(pollerTimer);
      pollerTimer = null;
    }
  };
}

/** Exposed for unit testing only. */
export const _internal = {
  stabilizeCurrentSnapshot,
};
