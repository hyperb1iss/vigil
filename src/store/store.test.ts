import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createStore } from 'zustand/vanilla';

import { defaultConfig } from '../config/defaults.js';
import type { AgentRun, ProposedAction } from '../types/agents.js';
import type { PrEvent } from '../types/events.js';
import type { PullRequest } from '../types/pr.js';
import type { Notification, VigilStore } from '../types/store.js';
import { createAgentSlice } from './slices/agents.js';
import { createPrSlice } from './slices/prs.js';
import { createRadarSlice } from './slices/radar.js';
import { createUiSlice } from './slices/ui.js';
import { saveUiPreferences } from './ui-preferences.js';

let tempDir = '';
let originalDataHome: string | undefined;

beforeEach(() => {
  originalDataHome = process.env.XDG_DATA_HOME;
  tempDir = mkdtempSync(join(tmpdir(), 'vigil-store-'));
  process.env.XDG_DATA_HOME = tempDir;
});

afterEach(() => {
  if (originalDataHome === undefined) {
    delete process.env.XDG_DATA_HOME;
  } else {
    process.env.XDG_DATA_HOME = originalDataHome;
  }

  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// ─── Test Store Factory ────────────────────────────────────────────────

function createTestStore() {
  return createStore<VigilStore>()((...a) => ({
    ...createPrSlice(...a),
    ...createRadarSlice(...a),
    ...createAgentSlice(...a),
    ...createUiSlice(...a),
  }));
}

function makePr(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    key: 'owner/repo#1',
    number: 1,
    title: 'Test PR',
    body: '',
    url: 'https://github.com/owner/repo/pull/1',
    repository: { name: 'repo', nameWithOwner: 'owner/repo' },
    author: { login: 'dev', isBot: false },
    headRefName: 'feat/test',
    baseRefName: 'main',
    isDraft: false,
    state: 'OPEN',
    mergeable: 'MERGEABLE',
    reviewDecision: '',
    reviews: [],
    comments: [],
    checks: [],
    labels: [],
    additions: 10,
    deletions: 5,
    changedFiles: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── PR Slice ──────────────────────────────────────────────────────────

describe('PrSlice', () => {
  test('initial state has empty maps', () => {
    const store = createTestStore();
    const state = store.getState();
    expect(state.prs.size).toBe(0);
    expect(state.prEvents.size).toBe(0);
    expect(state.prStates.size).toBe(0);
    expect(state.lastPollAt).toBeNull();
    expect(state.isPolling).toBe(false);
    expect(state.pollError).toBeNull();
  });

  test('setPrs replaces the entire PR map', () => {
    const store = createTestStore();
    const pr = makePr();
    const prMap = new Map([[pr.key, pr]]);
    store.getState().setPrs(prMap);

    expect(store.getState().prs.size).toBe(1);
    expect(store.getState().prs.get('owner/repo#1')).toBeDefined();
  });

  test('recordPrEvents stores a bounded timeline per PR', () => {
    const store = createTestStore();
    const makeEvent = (index: number): PrEvent => ({
      type: 'comment_added',
      prKey: 'owner/repo#1',
      pr: makePr(),
      timestamp: `2026-02-18T12:00:${String(index).padStart(2, '0')}Z`,
      data: {
        type: 'comment_added',
        comment: {
          id: `c${index}`,
          author: { login: 'reviewer', isBot: false },
          body: 'nit',
          createdAt: `2026-02-18T12:00:${String(index).padStart(2, '0')}Z`,
          url: `https://github.com/owner/repo/pull/1#issuecomment-${index}`,
        },
      },
    });

    store.getState().recordPrEvents(Array.from({ length: 105 }, (_, index) => makeEvent(index)));

    const events = store.getState().prEvents.get('owner/repo#1');
    expect(events).toHaveLength(100);
    expect(events?.[0]?.data?.type === 'comment_added' && events[0].data.comment.id).toBe('c5');
    expect(events?.at(-1)?.data?.type === 'comment_added' && events.at(-1)?.data.comment.id).toBe(
      'c104'
    );
  });

  test('setPrState sets state for a single PR', () => {
    const store = createTestStore();
    store.getState().setPrState('owner/repo#1', 'hot');

    expect(store.getState().prStates.get('owner/repo#1')).toBe('hot');
  });

  test('setPrState is additive (does not clear others)', () => {
    const store = createTestStore();
    store.getState().setPrState('a/b#1', 'hot');
    store.getState().setPrState('a/b#2', 'ready');

    expect(store.getState().prStates.get('a/b#1')).toBe('hot');
    expect(store.getState().prStates.get('a/b#2')).toBe('ready');
  });

  test('updatePr merges fields into existing PR', () => {
    const store = createTestStore();
    const pr = makePr({ title: 'Original' });
    store.getState().setPrs(new Map([[pr.key, pr]]));
    store.getState().updatePr('owner/repo#1', { title: 'Updated' });

    expect(store.getState().prs.get('owner/repo#1')?.title).toBe('Updated');
  });

  test('updatePr on missing key does nothing', () => {
    const store = createTestStore();
    store.getState().updatePr('nonexistent#1', { title: 'Nope' });

    expect(store.getState().prs.size).toBe(0);
  });

  test('setPolling updates polling flag', () => {
    const store = createTestStore();
    store.getState().setPolling(true);
    expect(store.getState().isPolling).toBe(true);

    store.getState().setPolling(false);
    expect(store.getState().isPolling).toBe(false);
  });

  test('setLastPollAt stores timestamp', () => {
    const store = createTestStore();
    const ts = '2026-02-18T12:00:00Z';
    store.getState().setLastPollAt(ts);
    expect(store.getState().lastPollAt).toBe(ts);
  });

  test('setPollError stores and clears polling error message', () => {
    const store = createTestStore();
    store.getState().setPollError('auth failed');
    expect(store.getState().pollError).toBe('auth failed');

    store.getState().setPollError(null);
    expect(store.getState().pollError).toBeNull();
  });
});

// ─── Agent Slice ───────────────────────────────────────────────────────

describe('AgentSlice', () => {
  const makeRun = (overrides: Partial<AgentRun> = {}): AgentRun => ({
    id: 'run-1',
    agent: 'triage',
    prKey: 'owner/repo#1',
    status: 'running',
    startedAt: new Date().toISOString(),
    streamingOutput: '',
    ...overrides,
  });

  const makeAction = (overrides: Partial<ProposedAction> = {}): ProposedAction => ({
    id: 'action-1',
    type: 'apply_fix',
    prKey: 'owner/repo#1',
    agent: 'fix',
    description: 'Fix lint errors',
    requiresConfirmation: true,
    status: 'pending',
    ...overrides,
  });

  test('initial state has empty agent data', () => {
    const store = createTestStore();
    expect(store.getState().activeAgents.size).toBe(0);
    expect(store.getState().actionQueue).toHaveLength(0);
    expect(store.getState().actionHistory).toHaveLength(0);
  });

  test('startAgentRun adds to activeAgents', () => {
    const store = createTestStore();
    const run = makeRun();
    store.getState().startAgentRun(run);

    expect(store.getState().activeAgents.size).toBe(1);
    expect(store.getState().activeAgents.get('run-1')?.status).toBe('running');
  });

  test('updateAgentRun merges fields', () => {
    const store = createTestStore();
    store.getState().startAgentRun(makeRun());
    store.getState().updateAgentRun('run-1', { streamingOutput: 'Analyzing...' });

    expect(store.getState().activeAgents.get('run-1')?.streamingOutput).toBe('Analyzing...');
  });

  test('updateAgentRun on missing run does nothing', () => {
    const store = createTestStore();
    store.getState().updateAgentRun('nonexistent', { streamingOutput: 'X' });
    expect(store.getState().activeAgents.size).toBe(0);
  });

  test('completeAgentRun sets completed status + result', () => {
    const store = createTestStore();
    store.getState().startAgentRun(makeRun());
    store.getState().completeAgentRun('run-1', { success: true, summary: 'Done', actions: [] });

    const run = store.getState().activeAgents.get('run-1');
    expect(run?.status).toBe('completed');
    expect(run?.result?.success).toBe(true);
    expect(run?.completedAt).toBeDefined();
  });

  test('enqueueAction adds to queue', () => {
    const store = createTestStore();
    store.getState().enqueueAction(makeAction());

    expect(store.getState().actionQueue).toHaveLength(1);
    expect(store.getState().actionQueue[0]?.status).toBe('pending');
  });

  test('enqueueAction skips duplicates that are still pending/approved', () => {
    const store = createTestStore();
    const action = makeAction({ id: 'dup-1', type: 'post_comment', agent: 'respond' });
    store.getState().enqueueAction(action);
    store.getState().enqueueAction({ ...action, id: 'dup-2' });

    expect(store.getState().actionQueue).toHaveLength(1);
    expect(store.getState().actionQueue[0]?.id).toBe('dup-1');
  });

  test('approveAction sets approved status', () => {
    const store = createTestStore();
    store.getState().enqueueAction(makeAction());
    store.getState().approveAction('action-1');

    expect(store.getState().actionQueue[0]?.status).toBe('approved');
  });

  test('rejectAction sets rejected status', () => {
    const store = createTestStore();
    store.getState().enqueueAction(makeAction());
    store.getState().rejectAction('action-1');

    expect(store.getState().actionQueue[0]?.status).toBe('rejected');
  });

  test('approve/reject only affects target action', () => {
    const store = createTestStore();
    store.getState().enqueueAction(makeAction({ id: 'a1' }));
    store
      .getState()
      .enqueueAction(makeAction({ id: 'a2', type: 'post_comment', agent: 'respond' }));
    store.getState().approveAction('a1');

    expect(store.getState().actionQueue[0]?.status).toBe('approved');
    expect(store.getState().actionQueue[1]?.status).toBe('pending');
  });

  test('markActionExecuted updates queue status and records history', () => {
    const store = createTestStore();
    store.getState().enqueueAction(makeAction());
    store.getState().approveAction('action-1');
    store.getState().markActionExecuted('action-1', 'Posted comment');

    expect(store.getState().actionQueue[0]?.status).toBe('executed');
    expect(store.getState().actionHistory).toHaveLength(1);
    expect(store.getState().actionHistory[0]?.status).toBe('executed');
    expect(store.getState().actionHistory[0]?.output).toBe('Posted comment');
    expect(store.getState().actionHistory[0]?.executedAt).toBeDefined();
  });

  test('markActionFailed updates queue status and records history', () => {
    const store = createTestStore();
    store.getState().enqueueAction(makeAction());
    store.getState().approveAction('action-1');
    store.getState().markActionFailed('action-1', 'Network timeout');

    expect(store.getState().actionQueue[0]?.status).toBe('failed');
    expect(store.getState().actionHistory).toHaveLength(1);
    expect(store.getState().actionHistory[0]?.status).toBe('failed');
    expect(store.getState().actionHistory[0]?.output).toBe('Network timeout');
    expect(store.getState().actionHistory[0]?.executedAt).toBeDefined();
  });
});

// ─── UI Slice ──────────────────────────────────────────────────────────

describe('UiSlice', () => {
  test('initial state has sensible defaults', () => {
    const store = createTestStore();
    const state = store.getState();

    expect(state.mode).toBe('hitl');
    expect(state.view).toBe('dashboard');
    expect(state.viewMode).toBe('cards');
    expect(state.sortMode).toBe('activity');
    expect(state.dashboardFeedMode).toBe('mine');
    expect(state.focusedPr).toBeNull();
    expect(state.detailFocus).toBe('navigator');
    expect(state.detailSelection).toBe(0);
    expect(state.selectedAction).toBe(0);
    expect(state.searchQuery).toBeNull();
    expect(state.notifications).toHaveLength(0);
  });

  test('setView changes the active view', () => {
    const store = createTestStore();
    store.getState().setView('detail');
    expect(store.getState().view).toBe('detail');
  });

  test('setViewMode resets dashboard scroll', () => {
    const store = createTestStore();
    // First scroll the dashboard
    store.getState().scrollView('dashboard', 5, 100);
    expect(store.getState().scrollOffsets.dashboard).toBe(5);

    // Changing view mode resets it
    store.getState().setViewMode('list');
    expect(store.getState().viewMode).toBe('list');
    expect(store.getState().scrollOffsets.dashboard).toBe(0);
  });

  test('setSortMode resets dashboard scroll', () => {
    const store = createTestStore();
    store.getState().scrollView('dashboard', 3, 100);
    store.getState().setSortMode('state');

    expect(store.getState().sortMode).toBe('state');
    expect(store.getState().scrollOffsets.dashboard).toBe(0);
  });

  test('setFocusedPr updates focused PR key', () => {
    const store = createTestStore();
    store.getState().setFocusedPr('owner/repo#42');
    expect(store.getState().focusedPr).toBe('owner/repo#42');
  });

  test('setFocusedPr resets detail interaction state', () => {
    const store = createTestStore();
    store.getState().setDetailFocus('inspector');
    store.getState().setDetailSelection(3);
    store.getState().scrollView('detail', 9, 100);

    store.getState().setFocusedPr('owner/repo#42');

    expect(store.getState().detailFocus).toBe('navigator');
    expect(store.getState().detailSelection).toBe(0);
    expect(store.getState().scrollOffsets.detail).toBe(0);
  });

  test('setFocusedPr can be cleared with null', () => {
    const store = createTestStore();
    store.getState().setFocusedPr('owner/repo#42');
    store.getState().setFocusedPr(null);
    expect(store.getState().focusedPr).toBeNull();
  });

  test('detail focus can be updated and cycled', () => {
    const store = createTestStore();
    store.getState().setDetailFocus('inspector');
    expect(store.getState().detailFocus).toBe('inspector');

    store.getState().cycleDetailFocus();
    expect(store.getState().detailFocus).toBe('navigator');

    store.getState().cycleDetailFocus(true);
    expect(store.getState().detailFocus).toBe('inspector');
  });

  test('detail selection resets inspector scroll and clamps movement', () => {
    const store = createTestStore();
    store.getState().scrollView('detail', 4, 100);
    store.getState().setDetailSelection(2);

    expect(store.getState().detailSelection).toBe(2);
    expect(store.getState().scrollOffsets.detail).toBe(0);

    store.getState().moveDetailSelection(10, 4);
    expect(store.getState().detailSelection).toBe(3);

    store.getState().moveDetailSelection(-99, 4);
    expect(store.getState().detailSelection).toBe(0);
  });

  test('setMode toggles between hitl and yolo', () => {
    const store = createTestStore();
    store.getState().setMode('yolo');
    expect(store.getState().mode).toBe('yolo');

    store.getState().setMode('hitl');
    expect(store.getState().mode).toBe('hitl');
  });

  test('setConfig hydrates config-dependent UI defaults', () => {
    const store = createTestStore();
    store.getState().setConfig({
      ...defaultConfig,
      defaultMode: 'yolo',
      display: {
        ...defaultConfig.display,
        dashboardFeedMode: 'both',
      },
    });

    expect(store.getState().mode).toBe('yolo');
    expect(store.getState().dashboardFeedMode).toBe('both');
  });

  test('setConfig hydrates persisted dashboard preferences over config defaults', () => {
    saveUiPreferences({
      viewMode: 'list',
      sortMode: 'state',
      dashboardFeedMode: 'incoming',
    });

    const store = createTestStore();
    store.getState().setConfig({
      ...defaultConfig,
      display: {
        ...defaultConfig.display,
        dashboardFeedMode: 'mine',
      },
    });

    expect(store.getState().viewMode).toBe('list');
    expect(store.getState().sortMode).toBe('state');
    expect(store.getState().dashboardFeedMode).toBe('incoming');
  });

  test('setSearchQuery resets dashboard scroll on change', () => {
    const store = createTestStore();
    store.getState().scrollView('dashboard', 10, 100);
    store.getState().setSearchQuery('test');

    expect(store.getState().searchQuery).toBe('test');
    expect(store.getState().scrollOffsets.dashboard).toBe(0);
  });

  test('setSearchQuery to null clears search', () => {
    const store = createTestStore();
    store.getState().setSearchQuery('query');
    store.getState().setSearchQuery(null);
    expect(store.getState().searchQuery).toBeNull();
  });
});

// ─── Scroll Management ─────────────────────────────────────────────────

describe('scroll management', () => {
  test('scrollView increases offset', () => {
    const store = createTestStore();
    store.getState().scrollView('dashboard', 3, 100);
    expect(store.getState().scrollOffsets.dashboard).toBe(3);
  });

  test('scrollView clamps to max', () => {
    const store = createTestStore();
    store.getState().scrollView('dashboard', 999, 10, 5);
    // max offset = max(0, 10 - 5) = 5
    expect(store.getState().scrollOffsets.dashboard).toBe(5);
  });

  test('scrollView clamps to zero (no negative)', () => {
    const store = createTestStore();
    store.getState().scrollView('dashboard', -10, 100);
    expect(store.getState().scrollOffsets.dashboard).toBe(0);
  });

  test('scrollView works independently per view', () => {
    const store = createTestStore();
    store.getState().scrollView('dashboard', 5, 100);
    store.getState().scrollView('detail', 10, 100);
    store.getState().scrollView('action', 2, 100);

    expect(store.getState().scrollOffsets.dashboard).toBe(5);
    expect(store.getState().scrollOffsets.detail).toBe(10);
    expect(store.getState().scrollOffsets.action).toBe(2);
  });

  test('resetScroll zeroes a specific view', () => {
    const store = createTestStore();
    store.getState().scrollView('detail', 15, 100);
    store.getState().scrollView('dashboard', 5, 100);
    store.getState().resetScroll('detail');

    expect(store.getState().scrollOffsets.detail).toBe(0);
    expect(store.getState().scrollOffsets.dashboard).toBe(5); // untouched
  });

  test('scrollView accumulates with delta', () => {
    const store = createTestStore();
    store.getState().scrollView('detail', 5, 100);
    store.getState().scrollView('detail', 3, 100);
    expect(store.getState().scrollOffsets.detail).toBe(8);
  });
});

// ─── Notifications ─────────────────────────────────────────────────────

describe('notifications', () => {
  const makeNotification = (overrides: Partial<Notification> = {}): Notification => ({
    id: 'n1',
    prKey: 'owner/repo#1',
    message: 'PR ready to merge',
    priority: 'medium',
    timestamp: new Date().toISOString(),
    read: false,
    ...overrides,
  });

  test('addNotification prepends to list', () => {
    const store = createTestStore();
    store.getState().addNotification(makeNotification({ id: 'n1' }));
    store.getState().addNotification(makeNotification({ id: 'n2' }));

    expect(store.getState().notifications).toHaveLength(2);
    expect(store.getState().notifications[0]?.id).toBe('n2'); // most recent first
  });

  test('addNotification caps at 100 items', () => {
    const store = createTestStore();
    for (let i = 0; i < 105; i++) {
      store.getState().addNotification(makeNotification({ id: `n${i}` }));
    }
    expect(store.getState().notifications).toHaveLength(100);
  });

  test('markRead sets read flag on target notification', () => {
    const store = createTestStore();
    store.getState().addNotification(makeNotification({ id: 'n1' }));
    store.getState().markRead('n1');

    expect(store.getState().notifications[0]?.read).toBe(true);
  });

  test('markRead does not affect other notifications', () => {
    const store = createTestStore();
    store.getState().addNotification(makeNotification({ id: 'n1' }));
    store.getState().addNotification(makeNotification({ id: 'n2' }));
    store.getState().markRead('n1');

    const n2 = store.getState().notifications.find(n => n.id === 'n2');
    expect(n2?.read).toBe(false);
  });
});

describe('RadarSlice', () => {
  test('initial radar state is empty and idle', () => {
    const store = createTestStore();
    const state = store.getState();
    expect(state.radarPrs.size).toBe(0);
    expect(state.mergedRadarPrs.size).toBe(0);
    expect(state.radarIsPolling).toBe(false);
    expect(state.radarLastPollAt).toBeNull();
    expect(state.radarPollError).toBeNull();
  });

  test('setRadarPrs and setMergedRadarPrs replace maps', () => {
    const store = createTestStore();
    const pr = makePr();
    const radarEntry = {
      pr,
      relevance: [{ tier: 'domain' as const, reason: 'Domain', matchedBy: 'infra' }],
      topTier: 'domain' as const,
      isMerged: false,
    };
    const mergedEntry = { ...radarEntry, isMerged: true };

    store.getState().setRadarPrs(new Map([[pr.key, radarEntry]]));
    store.getState().setMergedRadarPrs(new Map([[pr.key, mergedEntry]]));

    expect(store.getState().radarPrs.size).toBe(1);
    expect(store.getState().mergedRadarPrs.size).toBe(1);
  });

  test('updateRadarPr mutates nested PR payload', () => {
    const store = createTestStore();
    const pr = makePr({ title: 'Before' });
    const radarEntry = {
      pr,
      relevance: [{ tier: 'watch' as const, reason: 'Watch', matchedBy: 'watch' }],
      topTier: 'watch' as const,
      isMerged: false,
    };
    store.getState().setRadarPrs(new Map([[pr.key, radarEntry]]));
    store.getState().updateRadarPr(pr.key, { title: 'After' });
    expect(store.getState().radarPrs.get(pr.key)?.pr.title).toBe('After');
  });
});
