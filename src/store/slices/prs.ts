import type { StateCreator } from 'zustand';

import type { PrState, PullRequest } from '../../types/pr.js';
import type { VigilStore } from '../../types/store.js';

export interface PrSlice {
  prs: Map<string, PullRequest>;
  prStates: Map<string, PrState>;
  lastPollAt: string | null;
  isPolling: boolean;
  setPrs: (prs: Map<string, PullRequest>) => void;
  setPrState: (key: string, state: PrState) => void;
  updatePr: (key: string, update: Partial<PullRequest>) => void;
  setPolling: (isPolling: boolean) => void;
  setLastPollAt: (timestamp: string) => void;
}

export const createPrSlice: StateCreator<VigilStore, [], [], PrSlice> = set => ({
  prs: new Map(),
  prStates: new Map(),
  lastPollAt: null,
  isPolling: false,

  setPrs: prs => set({ prs }),

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
});
