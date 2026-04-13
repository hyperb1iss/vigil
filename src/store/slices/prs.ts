import type { StateCreator } from 'zustand';

import type { PrEvent } from '../../types/events.js';
import type { PrState, PullRequest } from '../../types/pr.js';
import type { VigilStore } from '../../types/store.js';

const MAX_EVENTS_PER_PR = 100;

export interface PrSlice {
  prs: Map<string, PullRequest>;
  prEvents: Map<string, PrEvent[]>;
  prStates: Map<string, PrState>;
  lastPollAt: string | null;
  isPolling: boolean;
  pollError: string | null;
  setPrs: (prs: Map<string, PullRequest>) => void;
  recordPrEvents: (events: PrEvent[]) => void;
  setPrState: (key: string, state: PrState) => void;
  updatePr: (key: string, update: Partial<PullRequest>) => void;
  setPolling: (isPolling: boolean) => void;
  setLastPollAt: (timestamp: string) => void;
  setPollError: (message: string | null) => void;
}

export const createPrSlice: StateCreator<VigilStore, [], [], PrSlice> = set => ({
  prs: new Map(),
  prEvents: new Map(),
  prStates: new Map(),
  lastPollAt: null,
  isPolling: false,
  pollError: null,

  setPrs: prs => set({ prs }),

  recordPrEvents: events =>
    set(prev => {
      if (events.length === 0) {
        return {};
      }

      const next = new Map(prev.prEvents);
      for (const event of events) {
        const existing = next.get(event.prKey) ?? [];
        next.set(event.prKey, [...existing, event].slice(-MAX_EVENTS_PER_PR));
      }
      return { prEvents: next };
    }),

  setPrState: (key, state) =>
    set(prev => {
      const next = new Map(prev.prStates);
      next.set(key, state);
      return { prStates: next };
    }),

  updatePr: (key, update) =>
    set(prev => {
      const existing = prev.prs.get(key);
      if (!existing) return {};
      const next = new Map(prev.prs);
      next.set(key, { ...existing, ...update });
      return { prs: next };
    }),

  setPolling: isPolling => set({ isPolling }),
  setLastPollAt: timestamp => set({ lastPollAt: timestamp }),
  setPollError: message => set({ pollError: message }),
});
