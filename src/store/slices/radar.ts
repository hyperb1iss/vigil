import type { StateCreator } from 'zustand';

import type { PullRequest } from '../../types/pr.js';
import type { RadarFilter, RadarPr } from '../../types/radar.js';
import type { VigilStore } from '../../types/store.js';

export interface RadarSlice {
  radarPrs: Map<string, RadarPr>;
  mergedRadarPrs: Map<string, RadarPr>;
  radarLastPollAt: string | null;
  radarIsPolling: boolean;
  radarPollError: string | null;
  radarFilter: RadarFilter | null;
  setRadarPrs: (prs: Map<string, RadarPr>) => void;
  setMergedRadarPrs: (prs: Map<string, RadarPr>) => void;
  updateRadarPr: (key: string, update: Partial<PullRequest>) => void;
  updateMergedRadarPr: (key: string, update: Partial<PullRequest>) => void;
  setRadarPolling: (isPolling: boolean) => void;
  setRadarLastPollAt: (timestamp: string) => void;
  setRadarPollError: (message: string | null) => void;
  setRadarFilter: (filter: RadarFilter | null) => void;
}

function updateRadarEntry(entry: RadarPr, update: Partial<PullRequest>): RadarPr {
  return {
    ...entry,
    pr: {
      ...entry.pr,
      ...update,
    },
  };
}

export const createRadarSlice: StateCreator<VigilStore, [], [], RadarSlice> = set => ({
  radarPrs: new Map(),
  mergedRadarPrs: new Map(),
  radarLastPollAt: null,
  radarIsPolling: false,
  radarPollError: null,
  radarFilter: null,

  setRadarPrs: prs => set({ radarPrs: prs }),

  setMergedRadarPrs: prs => set({ mergedRadarPrs: prs }),

  updateRadarPr: (key, update) =>
    set(prev => {
      const existing = prev.radarPrs.get(key);
      if (!existing) return {};
      const next = new Map(prev.radarPrs);
      next.set(key, updateRadarEntry(existing, update));
      return { radarPrs: next };
    }),

  updateMergedRadarPr: (key, update) =>
    set(prev => {
      const existing = prev.mergedRadarPrs.get(key);
      if (!existing) return {};
      const next = new Map(prev.mergedRadarPrs);
      next.set(key, updateRadarEntry(existing, update));
      return { mergedRadarPrs: next };
    }),

  setRadarPolling: radarIsPolling => set({ radarIsPolling }),
  setRadarLastPollAt: radarLastPollAt => set({ radarLastPollAt }),
  setRadarPollError: radarPollError => set({ radarPollError }),
  setRadarFilter: radarFilter => set({ radarFilter }),
});
