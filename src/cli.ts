#!/usr/bin/env bun

import { render } from 'ink';
import React from 'react';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { handleEvents } from './agents/orchestrator.js';
import { App } from './app.js';
import { ensureDirectories, loadGlobalConfig } from './config/loader.js';
import { seedMockData } from './core/mock-data.js';
import { startPoller } from './core/poller.js';
import { initKnowledgeFile } from './learning/knowledge.js';
import {
  sendDesktopNotification,
  shouldNotifyDesktop,
  shouldPlaySound,
} from './notifications/notify.js';
import { vigilStore } from './store/index.js';
import type { PrEvent } from './types/events.js';
import type { Notification } from './types/store.js';

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
      if (
        event.data?.type === 'checks_changed' &&
        event.data.checks.some(c => c.conclusion === 'FAILURE' || c.conclusion === 'CANCELLED')
      ) {
        return { ...base, message: `CI failed on ${event.prKey}`, priority: 'high' };
      }
      return null;
    case 'review_submitted':
      if (
        event.data?.type === 'review_submitted' &&
        event.data.review.state === 'CHANGES_REQUESTED'
      ) {
        return {
          ...base,
          message: `Changes requested on ${event.prKey}`,
          priority: 'high',
        };
      }
      return null;
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
  if (argv.pollInterval) {
    config.pollIntervalMs = argv.pollInterval;
  }

  // Bootstrap
  ensureDirectories();
  initKnowledgeFile();

  // Initialize store with config
  const store = vigilStore.getState();
  store.setMode(config.defaultMode);

  // Demo mode — seed mock data
  if (argv.demo) {
    seedMockData(vigilStore);
  }

  // Wire up events
  const onEvents = async (events: PrEvent[]): Promise<void> => {
    // Send desktop notifications
    const notifConfig = config.notifications;
    if (notifConfig.enabled) {
      for (const event of events) {
        const notification = eventToNotification(event);
        if (!notification) continue;

        // Check config flags
        if (event.type === 'checks_changed' && !notifConfig.onCiFailure) continue;
        if (event.type === 'review_submitted' && !notifConfig.onBlockingReview) continue;
        if (event.type === 'ready_to_merge' && !notifConfig.onReadyToMerge) continue;
        if (event.type === 'comment_added' && !notifConfig.onNewComment) continue;

        store.addNotification(notification);

        if (shouldNotifyDesktop(notification)) {
          void sendDesktopNotification(
            'Vigil',
            notification.message,
            event.prKey,
            shouldPlaySound(notification)
          );
        }
      }
    }

    // Route to agent orchestrator (unless --no-agents)
    if (!argv.noAgents) {
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

  // Render TUI
  const { waitUntilExit } = render(React.createElement(App));

  try {
    await waitUntilExit();
  } finally {
    cleanup();
  }
}

main().catch(error => {
  console.error('Fatal:', error);
  process.exit(1);
});
