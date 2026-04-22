#!/usr/bin/env bun

import { render } from 'ink';
import React from 'react';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { getAgentLogPath, logAgentActivity } from './agents/activity-log.js';
import { startActionExecutor } from './agents/executor.js';
import { handleEvents } from './agents/orchestrator.js';
import { App } from './app.js';
import { runInit } from './config/init.js';
import { ensureDirectories, loadGlobalConfig } from './config/loader.js';
import { loadRuntimeRepoContexts } from './config/runtime.js';
import { seedMockData } from './core/mock-data.js';
import { startPoller } from './core/poller.js';
import { type RadarChange, startRadarPoller } from './core/radar-poller.js';
import { initKnowledgeFile } from './learning/knowledge.js';
import {
  sendDesktopNotification,
  shouldNotifyDesktop,
  shouldPlaySound,
} from './notifications/notify.js';
import { vigilStore } from './store/index.js';
import type { ActionType, ProposedAction } from './types/agents.js';
import type { PrEvent } from './types/events.js';
import type { Notification } from './types/store.js';

const MIN_POLL_INTERVAL_MS = 5_000;
const MAX_POLL_INTERVAL_MS = 15 * 60_000;
const SKIP_STARTUP_EVENTS = process.env.VIGIL_SKIP_STARTUP_EVENTS === '1';
const NOTIFICATION_COOLDOWN_MS = 5 * 60_000;
const recentNotificationKeys = new Map<string, number>();

function clampPollInterval(ms: number): number {
  if (!Number.isFinite(ms)) return MIN_POLL_INTERVAL_MS;
  return Math.max(MIN_POLL_INTERVAL_MS, Math.min(MAX_POLL_INTERVAL_MS, Math.floor(ms)));
}

// ─── Event → Notification mapping ────────────────────────────────────

function eventToNotification(event: PrEvent): Notification | null {
  const base = {
    id: crypto.randomUUID(),
    prKey: event.prKey,
    timestamp: event.timestamp,
    read: false,
  };

  switch (event.type) {
    case 'checks_changed':
      return isFailedChecksEvent(event)
        ? { ...base, message: `CI failed on ${event.prKey}`, priority: 'high' }
        : null;
    case 'review_submitted':
      return isChangesRequestedEvent(event)
        ? { ...base, message: `Changes requested on ${event.prKey}`, priority: 'high' }
        : null;
    case 'conflict_detected':
      return { ...base, message: `Conflict on ${event.prKey}`, priority: 'high' };
    case 'ready_to_merge':
      return { ...base, message: `${event.prKey} is ready to merge`, priority: 'medium' };
    case 'comment_added':
      return { ...base, message: `New comment on ${event.prKey}`, priority: 'low' };
    default:
      return null;
  }
}

function radarChangeToNotification(change: RadarChange): Notification | null {
  const prKey = change.key;
  const base = {
    id: crypto.randomUUID(),
    prKey,
    timestamp: change.timestamp,
    read: false,
  };

  switch (change.kind) {
    case 'review_requested':
      return {
        ...base,
        message: `Review requested: ${prKey}`,
        priority: 'high',
      };
    case 'domain_pr_opened':
      return {
        ...base,
        message: `New domain PR: ${prKey}`,
        priority: 'medium',
      };
    case 'domain_pr_merged':
      return {
        ...base,
        message: `Domain PR merged: ${prKey}`,
        priority: 'low',
      };
    default:
      return null;
  }
}

function isFailedChecksEvent(event: PrEvent): boolean {
  return (
    event.data?.type === 'checks_changed' &&
    event.data.checks.some(c => c.conclusion === 'FAILURE' || c.conclusion === 'CANCELLED')
  );
}

function isChangesRequestedEvent(event: PrEvent): boolean {
  return event.data?.type === 'review_submitted' && event.data.review.state === 'CHANGES_REQUESTED';
}

// ─── Action → Notification mapping ───────────────────────────────────

/**
 * Only the impactful action types raise a desktop ping. Drafting a comment or
 * prepping a worktree stays quiet so the badge in the status bar does the work.
 */
const HIGH_PRIORITY_ACTION_TYPES: ReadonlySet<ActionType> = new Set([
  'apply_fix',
  'rebase',
  'merge',
  'close',
]);

function actionToNotification(action: ProposedAction): Notification {
  const isHighPriority = HIGH_PRIORITY_ACTION_TYPES.has(action.type);
  return {
    id: crypto.randomUUID(),
    prKey: action.prKey,
    message: `Action needed: ${action.type} on ${action.prKey}`,
    priority: isHighPriority ? 'high' : 'medium',
    timestamp: new Date().toISOString(),
    read: false,
  };
}

/** Check notification config flags for a given event type. */
function isEventNotificationEnabled(
  eventType: string,
  notifConfig: {
    onCiFailure: boolean;
    onBlockingReview: boolean;
    onReadyToMerge: boolean;
    onNewComment: boolean;
  }
): boolean {
  switch (eventType) {
    case 'checks_changed':
      return notifConfig.onCiFailure;
    case 'review_submitted':
      return notifConfig.onBlockingReview;
    case 'ready_to_merge':
      return notifConfig.onReadyToMerge;
    case 'comment_added':
      return notifConfig.onNewComment;
    default:
      return true;
  }
}

/** Build a dedup key for a notification based on its event type and PR. */
function notificationDedupeKey(event: PrEvent): string {
  // For checks, include the set of failed check names so genuinely new failures
  // still produce a notification while the same ongoing failure is suppressed.
  if (event.data?.type === 'checks_changed') {
    const failed = event.data.checks
      .filter(c => c.conclusion === 'FAILURE' || c.conclusion === 'CANCELLED')
      .map(c => c.name)
      .sort()
      .join(',');
    return `notif:${event.type}:${event.prKey}:${failed}`;
  }

  // For reviews, include the review ID so different reviewers still notify.
  if (event.data?.type === 'review_submitted') {
    return `notif:${event.type}:${event.prKey}:${event.data.review.id}`;
  }

  // For comments, include the comment ID.
  if (event.data?.type === 'comment_added') {
    return `notif:${event.type}:${event.prKey}:${event.data.comment.id}`;
  }

  return `notif:${event.type}:${event.prKey}`;
}

/** Returns true if a notification with this key was already sent recently. */
function isRecentlySentNotification(key: string, now = Date.now()): boolean {
  // Prune stale entries
  for (const [k, ts] of recentNotificationKeys) {
    if (now - ts > NOTIFICATION_COOLDOWN_MS) {
      recentNotificationKeys.delete(k);
    }
  }

  const prev = recentNotificationKeys.get(key);
  recentNotificationKeys.set(key, now);
  return prev !== undefined && now - prev <= NOTIFICATION_COOLDOWN_MS;
}

/** Process events and dispatch desktop notifications. */
function dispatchNotifications(
  events: PrEvent[],
  store: ReturnType<typeof vigilStore.getState>,
  notifConfig: {
    onCiFailure: boolean;
    onBlockingReview: boolean;
    onReadyToMerge: boolean;
    onNewComment: boolean;
  }
): void {
  for (const event of events) {
    const notification = eventToNotification(event);
    if (!notification) continue;
    if (!isEventNotificationEnabled(event.type, notifConfig)) continue;
    if (isRecentlySentNotification(notificationDedupeKey(event))) continue;

    store.addNotification(notification);

    if (shouldNotifyDesktop(notification)) {
      void sendDesktopNotification(
        'Vigil',
        notification.message,
        event.prKey,
        shouldPlaySound(notification),
        event.pr.url
      );
    }
  }
}

function shouldNotifyForRadarChange(
  change: RadarChange,
  notifications: {
    onDirectReviewRequest: boolean;
    onNewDomainPr: boolean;
    onMergedDomainPr: boolean;
  }
): boolean {
  switch (change.kind) {
    case 'review_requested':
      return notifications.onDirectReviewRequest;
    case 'domain_pr_opened':
      return notifications.onNewDomainPr;
    case 'domain_pr_merged':
      return notifications.onMergedDomainPr;
    default:
      return false;
  }
}

function dispatchRadarNotifications(
  changes: RadarChange[],
  store: ReturnType<typeof vigilStore.getState>,
  notifications: {
    onDirectReviewRequest: boolean;
    onNewDomainPr: boolean;
    onMergedDomainPr: boolean;
  }
): void {
  for (const change of changes) {
    if (!shouldNotifyForRadarChange(change, notifications)) continue;
    const notification = radarChangeToNotification(change);
    if (!notification) continue;

    store.addNotification(notification);

    if (shouldNotifyDesktop(notification)) {
      void sendDesktopNotification(
        'Vigil',
        notification.message,
        notification.prKey,
        shouldPlaySound(notification),
        change.radarPr.pr.url
      );
    }
  }
}

/**
 * Subscribe to the store and raise a notification the first time we see each
 * pending action that requires confirmation. Returns an unsubscribe fn.
 */
function watchPendingActions(notificationsEnabled: boolean): () => void {
  const seenActionIds = new Set<string>();

  return vigilStore.subscribe(state => {
    if (!notificationsEnabled) return;

    for (const action of state.actionQueue) {
      if (action.status !== 'pending') continue;
      if (!action.requiresConfirmation) continue;
      if (seenActionIds.has(action.id)) continue;

      seenActionIds.add(action.id);

      const notification = actionToNotification(action);
      state.addNotification(notification);

      if (shouldNotifyDesktop(notification)) {
        const pr = state.prs.get(action.prKey) ?? state.radarPrs.get(action.prKey)?.pr;
        void sendDesktopNotification(
          'Vigil · Action needed',
          `${action.type} on ${action.prKey}`,
          action.prKey,
          shouldPlaySound(notification),
          pr?.url
        );
      }
    }
  });
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = hideBin(process.argv);
  if (args[0] === 'init') {
    const argv = await yargs(args.slice(1))
      .scriptName('vigil init')
      .usage('$0 [options]')
      .option('force', {
        type: 'boolean',
        default: false,
        describe: 'Overwrite .vigilrc.json if it already exists',
      })
      .option('register-local', {
        type: 'boolean',
        default: true,
        describe: 'Register this repo in global localRepos for worktree support',
      })
      .option('watch-all', {
        type: 'boolean',
        default: false,
        describe: 'Add this repo to radar.repos with watchAll enabled',
      })
      .help()
      .version(false)
      .parse();

    ensureDirectories();
    const result = await runInit({
      cwd: process.cwd(),
      force: argv.force,
      registerLocal: argv.registerLocal,
      watchAll: argv.watchAll,
    });

    console.log(`[vigil] initialized ${result.repo}`);
    console.log(
      `[vigil] repo config: ${result.repoConfigWritten ? 'wrote' : 'kept'} ${result.repoConfigPath}`
    );
    console.log(
      `[vigil] global config: ${result.globalConfigWritten ? 'updated' : 'unchanged'} ${result.globalConfigPath}`
    );
    if (result.localRepoRegistered) {
      console.log('[vigil] registered local repo path for worktree actions');
    }
    if (result.radarRepoAdded) {
      console.log('[vigil] enabled watchAll radar for this repo');
    }
    return;
  }

  const argv = await yargs(args)
    .scriptName('vigil')
    .usage('$0 [options]')
    .option('repo', {
      alias: 'r',
      type: 'array',
      string: true,
      describe: 'Focus on specific repos (owner/repo)',
    })
    .option('mode', {
      alias: 'm',
      choices: ['hitl', 'yolo'] as const,
      describe: 'Start in HITL or YOLO mode',
    })
    .option('poll-interval', {
      alias: 'p',
      type: 'number',
      describe: 'Poll interval in milliseconds',
    })
    .option('no-agents', {
      type: 'boolean',
      default: false,
      describe: 'Dashboard only, no agent processing',
    })
    .option('demo', {
      type: 'boolean',
      default: false,
      describe: 'Seed with mock data for visual testing',
    })
    .help()
    .version()
    .parse();

  // Load config
  const config = loadGlobalConfig();
  const repoContexts = await loadRuntimeRepoContexts(process.cwd(), config.localRepos);

  // Apply CLI overrides
  if (argv.mode) {
    config.defaultMode = argv.mode;
  }
  if (argv.pollInterval !== undefined) {
    const clamped = clampPollInterval(argv.pollInterval);
    if (clamped !== argv.pollInterval) {
      console.error(
        `[vigil] poll interval clamped to ${clamped}ms (allowed range: ${MIN_POLL_INTERVAL_MS}-${MAX_POLL_INTERVAL_MS}ms)`
      );
    }
    config.pollIntervalMs = clamped;
  }

  config.pollIntervalMs = clampPollInterval(config.pollIntervalMs);
  config.radar.pollIntervalMs = clampPollInterval(config.radar.pollIntervalMs);

  // Bootstrap
  ensureDirectories();
  initKnowledgeFile();

  const agentLogPath = getAgentLogPath();
  logAgentActivity('vigil_startup', {
    data: {
      pollIntervalMs: config.pollIntervalMs,
      radarEnabled: config.radar.enabled,
      radarPollIntervalMs: config.radar.pollIntervalMs,
      mode: config.defaultMode,
      agentLogPath,
      localRepoContexts: repoContexts.size,
    },
  });
  console.error(`[vigil] agent activity log: ${agentLogPath}`);

  // Initialize store with config
  const store = vigilStore.getState();
  store.setConfig(config);

  // Demo mode — seed mock data
  if (argv.demo) {
    seedMockData(vigilStore);
  }

  // Wire up events — skip notifications on the first poll (initial load)
  let isFirstPoll = true;
  const onEvents = async (events: PrEvent[]): Promise<void> => {
    logAgentActivity('poller_events_received', {
      data: { count: events.length, isFirstPoll },
    });
    const isStartupPoll = isFirstPoll;
    const skipNotifs = isStartupPoll;
    const skipAgents = isStartupPoll && SKIP_STARTUP_EVENTS;
    isFirstPoll = false;

    // Send desktop notifications (skip initial load to avoid blast)
    const notifConfig = config.notifications;
    if (notifConfig.enabled && !skipNotifs) {
      dispatchNotifications(events, store, notifConfig);
    }

    // Route to agent orchestrator (unless --no-agents)
    if (!argv.noAgents && !skipAgents) {
      logAgentActivity('orchestrator_dispatch', {
        data: { count: events.length },
      });
      await handleEvents(events, repoContexts);
      logAgentActivity('orchestrator_dispatch_complete', {
        data: {
          queueSize: store.actionQueue.length,
          historySize: store.actionHistory.length,
        },
      });
    }
  };

  // Start polling
  const repos = argv.repo as string[] | undefined;
  const cleanup = startPoller({
    intervalMs: config.pollIntervalMs,
    repos,
    repoContexts,
    onEvents,
    onError: error => {
      // Silently handle poll errors — the TUI will show stale data indicator
      if (process.env.VIGIL_DEBUG) {
        console.error('[vigil] poll error:', error);
      }
    },
  });

  let isFirstRadarChangeBatch = true;
  const stopRadar = config.radar.enabled
    ? startRadarPoller({
        intervalMs: config.radar.pollIntervalMs,
        radarConfig: config.radar,
        onChanges: async changes => {
          const skipStartupRadarBatch = isFirstRadarChangeBatch;
          isFirstRadarChangeBatch = false;
          const shouldNotifyRadar = config.notifications.enabled && !skipStartupRadarBatch;
          if (shouldNotifyRadar) {
            dispatchRadarNotifications(changes, store, config.radar.notifications);
          }
        },
        onError: error => {
          if (process.env.VIGIL_DEBUG) {
            console.error('[vigil] radar poll error:', error);
          }
        },
      })
    : undefined;

  const stopExecutor = startActionExecutor(undefined, { repoContexts });

  const stopActionWatcher = watchPendingActions(config.notifications.enabled);

  // Render TUI
  const { waitUntilExit } = render(React.createElement(App));

  try {
    await waitUntilExit();
  } finally {
    cleanup();
    stopRadar?.();
    stopExecutor();
    stopActionWatcher();
  }
}

main().catch(error => {
  console.error('Fatal:', error);
  process.exit(1);
});
