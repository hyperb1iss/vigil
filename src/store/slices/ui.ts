import type { StateCreator } from 'zustand';
import { defaultConfig } from '../../config/defaults.js';
import type { VigilConfig } from '../../types/config.js';
import type { Notification, ViewMode, ViewName, VigilStore } from '../../types/store.js';

export interface UiSlice {
  mode: 'hitl' | 'yolo';
  view: ViewName;
  viewMode: ViewMode;
  focusedPr: string | null;
  selectedAction: number;
  scrollOffset: number;
  notifications: Notification[];
  config: VigilConfig;
  setView: (view: ViewName) => void;
  setViewMode: (viewMode: ViewMode) => void;
  setFocusedPr: (key: string | null) => void;
  setMode: (mode: 'hitl' | 'yolo') => void;
  scrollUp: () => void;
  scrollDown: (maxItems: number) => void;
  addNotification: (n: Notification) => void;
  markRead: (id: string) => void;
}

export const createUiSlice: StateCreator<VigilStore, [], [], UiSlice> = set => ({
  mode: 'hitl',
  view: 'dashboard',
  viewMode: 'cards',
  focusedPr: null,
  selectedAction: 0,
  scrollOffset: 0,
  notifications: [],
  config: defaultConfig,

  setView: view => set({ view, scrollOffset: 0 }),

  setViewMode: viewMode => set({ viewMode, scrollOffset: 0 }),

  setFocusedPr: key => set({ focusedPr: key }),

  setMode: mode => set({ mode }),

  scrollUp: () =>
    set(prev => ({
      scrollOffset: Math.max(0, prev.scrollOffset - 1),
    })),

  scrollDown: (maxItems: number) =>
    set(prev => ({
      scrollOffset: Math.min(Math.max(0, maxItems - 1), prev.scrollOffset + 1),
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
