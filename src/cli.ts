#!/usr/bin/env bun

import { render } from 'ink';
import React from 'react';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { startActionExecutor } from './agents/executor.js';
import { handleEvents } from './agents/orchestrator.js';
import { App } from './app.js';
import { ensureDirectories, loadGlobalConfig } from './config/loader.js';
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
import type { PrEvent } from './types/events.js';
import type { Notification } from './types/store.js';

const MIN_POLL_INTERVAL_MS = 5_000;
const MAX_POLL_INTERVAL_MS = 15 * 60_000;
const SKIP_STARTUP_EVENTS = process.env.VIGIL_SKIP_STARTUP_EVENTS === '1';

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

// ─── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = await yargs(hideBin(process.argv))
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
      await handleEvents(events);
    }
  };

  // Start polling
  const repos = argv.repo as string[] | undefined;
  const cleanup = startPoller({
    intervalMs: config.pollIntervalMs,
    repos,
    onEvents,
    onError: error => {
      // Silently handle poll errors — the TUI will show stale data indicator
      if (process.env.VIGIL_DEBUG) {
        console.error('[vigil] poll error:', error);
      }
    },
  });

  let isFirstRadarChangeBatch = true;
  const stopRadar =
    config.radar.enabled && config.radar.repos.length > 0
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

  const stopExecutor = startActionExecutor();

  // Render TUI
  const { waitUntilExit } = render(React.createElement(App));

  try {
    await waitUntilExit();
  } finally {
    cleanup();
    stopRadar?.();
    stopExecutor();
  }
}

main().catch(error => {
  console.error('Fatal:', error);
  process.exit(1);
});
