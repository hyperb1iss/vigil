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

    // Diff against previous
    const events = diffPrs(state.prs, currentMap);

    // Classify states
    const dormantThreshold = state.config.display.dormantThresholdHours;
    for (const [key, pr] of currentMap) {
      const prState = classifyPr(pr, dormantThreshold);
      store.getState().setPrState(key, prState);
    }

    // Update store
    store.getState().setPrs(currentMap);
    store.getState().setLastPollAt(new Date().toISOString());

    return events;
  } finally {
    store.getState().setPolling(false);
  }
}

/**
 * Start the polling loop. Returns a cleanup function.
 */
export function startPoller(options: PollerOptions): () => void {
  const { intervalMs, repos, onEvents, onError } = options;

  async function tick(): Promise<void> {
    try {
      const events = await poll(repos);
      if (events.length > 0 && onEvents) {
        await onEvents(events);
      }
    } catch (error) {
      onError?.(error);
    }
  }

  // Run immediately, then on interval
  void tick();
  pollerTimer = setInterval(() => void tick(), intervalMs);

  return () => {
    if (pollerTimer) {
      clearInterval(pollerTimer);
      pollerTimer = null;
    }
  };
}
