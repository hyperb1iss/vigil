import type { StateCreator } from 'zustand';
import { defaultConfig } from '../../config/defaults.js';
import type { VigilConfig } from '../../types/config.js';
import type { Notification, ViewMode, ViewName, VigilStore } from '../../types/store.js';

const defaultScrollOffsets: Record<ViewName, number> = {
  dashboard: 0,
  detail: 0,
  action: 0,
};

export interface UiSlice {
  mode: 'hitl' | 'yolo';
  view: ViewName;
  viewMode: ViewMode;
  focusedPr: string | null;
  selectedAction: number;
  scrollOffsets: Record<ViewName, number>;
  notifications: Notification[];
  config: VigilConfig;
  setView: (view: ViewName) => void;
  setViewMode: (viewMode: ViewMode) => void;
  setFocusedPr: (key: string | null) => void;
  setMode: (mode: 'hitl' | 'yolo') => void;
  scrollView: (view: ViewName, delta: number, max: number) => void;
  resetScroll: (view: ViewName) => void;
  addNotification: (n: Notification) => void;
  markRead: (id: string) => void;
}

export const createUiSlice: StateCreator<VigilStore, [], [], UiSlice> = set => ({
  mode: 'hitl',
  view: 'dashboard',
  viewMode: 'cards',
  focusedPr: null,
  selectedAction: 0,
  scrollOffsets: { ...defaultScrollOffsets },
  notifications: [],
  config: defaultConfig,

  setView: view => set({ view }),

  setViewMode: viewMode =>
    set(prev => ({
      viewMode,
      scrollOffsets: { ...prev.scrollOffsets, dashboard: 0 },
    })),

  setFocusedPr: key => set({ focusedPr: key }),

  setMode: mode => set({ mode }),

  scrollView: (view, delta, max) =>
    set(prev => {
      const current = prev.scrollOffsets[view] ?? 0;
      const next = Math.max(0, Math.min(Math.max(0, max - 1), current + delta));
      return { scrollOffsets: { ...prev.scrollOffsets, [view]: next } };
    }),

  resetScroll: view =>
    set(prev => ({
      scrollOffsets: { ...prev.scrollOffsets, [view]: 0 },
    })),

  addNotification: n =>
    set(prev => ({
      notifications: [n, ...prev.notifications].slice(0, 100),
    })),

  markRead: id =>
    set(prev => ({
      notifications: prev.notifications.map(n => (n.id === id ? { ...n, read: true } : n)),
    })),
});
