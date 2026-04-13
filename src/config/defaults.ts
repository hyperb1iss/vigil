import type { VigilConfig } from '../types/index.js';

export const defaultConfig: VigilConfig = {
  pollIntervalMs: 30_000,
  defaultMode: 'hitl',
  notifications: {
    enabled: true,
    onCiFailure: true,
    onBlockingReview: true,
    onReadyToMerge: true,
    onNewComment: false,
  },
  agent: {
    model: 'claude-sonnet-4-6',
    maxAutoFixesPerPr: 5,
    autoRespondToScopeCreep: false,
  },
  learning: {
    enabled: true,
    backend: 'markdown',
    captureAfterMerge: true,
  },
  display: {
    dormantThresholdHours: 48,
    maxPrsOnDashboard: 20,
    colorScheme: 'silkcircuit',
    dashboardFeedMode: 'mine',
  },
  radar: {
    enabled: true,
    repos: [],
    teams: [],
    pollIntervalMs: 60_000,
    merged: {
      limit: 10,
      maxAgeHours: 48,
      domainOnly: true,
    },
    notifications: {
      onDirectReviewRequest: true,
      onNewDomainPr: true,
      onMergedDomainPr: false,
    },
    excludeBotDrafts: true,
    excludeOwnPrs: true,
    staleCutoffDays: 30,
  },
};
