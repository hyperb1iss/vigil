import type { StateCreator } from 'zustand';

import { defaultConfig } from '../../config/defaults.js';
import type { VigilConfig } from '../../types/config.js';
import type { DashboardFeedMode } from '../../types/radar.js';
import type { Notification, SortMode, ViewMode, ViewName, VigilStore } from '../../types/store.js';
import { loadUiPreferences, saveUiPreferences } from '../ui-preferences.js';

const defaultScrollOffsets: Record<ViewName, number> = {
  dashboard: 0,
  detail: 0,
  action: 0,
  activity: 0,
};

export interface UiSlice {
  mode: 'hitl' | 'yolo';
  view: ViewName;
  viewMode: ViewMode;
  sortMode: SortMode;
  dashboardFeedMode: DashboardFeedMode;
  focusedPr: string | null;
  selectedAction: number;
  scrollOffsets: Record<ViewName, number>;
  searchQuery: string | null;
  showVerboseLogs: boolean;
  notifications: Notification[];
  config: VigilConfig;
  setView: (view: ViewName) => void;
  setViewMode: (viewMode: ViewMode) => void;
  setSortMode: (sortMode: SortMode) => void;
  setDashboardFeedMode: (mode: DashboardFeedMode) => void;
  cycleDashboardFeedMode: () => void;
  setFocusedPr: (key: string | null) => void;
  setMode: (mode: 'hitl' | 'yolo') => void;
  setConfig: (config: VigilConfig) => void;
  setSearchQuery: (query: string | null) => void;
  scrollView: (view: ViewName, delta: number, max: number, visible?: number) => void;
  resetScroll: (view: ViewName) => void;
  toggleVerboseLogs: () => void;
  addNotification: (n: Notification) => void;
  markRead: (id: string) => void;
}

export const createUiSlice: StateCreator<VigilStore, [], [], UiSlice> = set => ({
  mode: 'hitl',
  view: 'dashboard',
  viewMode: 'cards',
  sortMode: 'activity',
  dashboardFeedMode: defaultConfig.display.dashboardFeedMode,
  focusedPr: null,
  selectedAction: 0,
  scrollOffsets: { ...defaultScrollOffsets },
  searchQuery: null,
  showVerboseLogs: false,
  notifications: [],
  config: defaultConfig,

  setView: view => set({ view }),

  setViewMode: viewMode =>
    set(prev => {
      saveUiPreferences({
        viewMode,
        sortMode: prev.sortMode,
        dashboardFeedMode: prev.dashboardFeedMode,
      });
      return {
        viewMode,
        scrollOffsets: { ...prev.scrollOffsets, dashboard: 0 },
      };
    }),

  setSortMode: sortMode =>
    set(prev => {
      saveUiPreferences({
        viewMode: prev.viewMode,
        sortMode,
        dashboardFeedMode: prev.dashboardFeedMode,
      });
      return {
        sortMode,
        scrollOffsets: { ...prev.scrollOffsets, dashboard: 0 },
      };
    }),

  setDashboardFeedMode: mode =>
    set(prev => {
      saveUiPreferences({
        viewMode: prev.viewMode,
        sortMode: prev.sortMode,
        dashboardFeedMode: mode,
      });
      return {
        dashboardFeedMode: mode,
        focusedPr: null,
        scrollOffsets: { ...prev.scrollOffsets, dashboard: 0 },
      };
    }),

  cycleDashboardFeedMode: () =>
    set(prev => {
      const next: DashboardFeedMode =
        prev.dashboardFeedMode === 'mine'
          ? 'both'
          : prev.dashboardFeedMode === 'both'
            ? 'incoming'
            : 'mine';
      saveUiPreferences({
        viewMode: prev.viewMode,
        sortMode: prev.sortMode,
        dashboardFeedMode: next,
      });
      return {
        dashboardFeedMode: next,
        focusedPr: null,
        scrollOffsets: { ...prev.scrollOffsets, dashboard: 0 },
      };
    }),

  setFocusedPr: key => set({ focusedPr: key }),

  setMode: mode => set({ mode }),

  setConfig: config =>
    set(prev => {
      const preferences = loadUiPreferences(config);
      return {
        config,
        viewMode: preferences.viewMode,
        sortMode: preferences.sortMode,
        dashboardFeedMode: preferences.dashboardFeedMode,
        mode: config.defaultMode,
        scrollOffsets: { ...prev.scrollOffsets, dashboard: 0 },
      };
    }),

  setSearchQuery: query =>
    set(prev => ({
      searchQuery: query,
      scrollOffsets:
        query !== prev.searchQuery ? { ...prev.scrollOffsets, dashboard: 0 } : prev.scrollOffsets,
    })),

  scrollView: (view, delta, max, visible = 1) =>
    set(prev => {
      const current = prev.scrollOffsets[view] ?? 0;
      const maxOffset = Math.max(0, max - visible);
      const next = Math.max(0, Math.min(maxOffset, current + delta));
      return { scrollOffsets: { ...prev.scrollOffsets, [view]: next } };
    }),

  resetScroll: view =>
    set(prev => ({
      scrollOffsets: { ...prev.scrollOffsets, [view]: 0 },
    })),

  toggleVerboseLogs: () => set(prev => ({ showVerboseLogs: !prev.showVerboseLogs })),

  addNotification: n =>
    set(prev => ({
      notifications: [n, ...prev.notifications].slice(0, 100),
    })),

  markRead: id =>
    set(prev => ({
      notifications: prev.notifications.map(n => (n.id === id ? { ...n, read: true } : n)),
    })),
});
