import type { StateCreator } from 'zustand';
import type { Notification, ViewName, VigilStore } from '../../types/store.js';
import type { VigilConfig } from '../../types/config.js';
import { defaultConfig } from '../../config/defaults.js';

export interface UiSlice {
  mode: 'hitl' | 'yolo';
  view: ViewName;
  focusedPr: string | null;
  selectedAction: number;
  scrollOffset: number;
  notifications: Notification[];
  config: VigilConfig;
  setView: (view: ViewName) => void;
  setFocusedPr: (key: string | null) => void;
  setMode: (mode: 'hitl' | 'yolo') => void;
  scrollUp: () => void;
  scrollDown: () => void;
  addNotification: (n: Notification) => void;
  markRead: (id: string) => void;
}

export const createUiSlice: StateCreator<VigilStore, [], [], UiSlice> = (set) => ({
  mode: 'hitl',
  view: 'dashboard',
  focusedPr: null,
  selectedAction: 0,
  scrollOffset: 0,
  notifications: [],
  config: defaultConfig,

  setView: (view) => set({ view, scrollOffset: 0 }),

  setFocusedPr: (key) => set({ focusedPr: key }),

  setMode: (mode) => set({ mode }),

  scrollUp: () =>
    set((prev) => ({
      scrollOffset: Math.max(0, prev.scrollOffset - 1),
    })),

  scrollDown: () =>
    set((prev) => ({
      scrollOffset: prev.scrollOffset + 1,
    })),

  addNotification: (n) =>
    set((prev) => ({
      notifications: [n, ...prev.notifications],
    })),

  markRead: (id) =>
    set((prev) => ({
      notifications: prev.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n,
      ),
    })),
});
