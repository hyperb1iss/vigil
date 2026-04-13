/**
 * Event orchestrator — routes incoming PR events through triage,
 * then queues or auto-executes proposed actions based on the current mode.
 *
 * HITL mode: all actions are enqueued for human approval.
 * YOLO mode: actions auto-execute unless their type is in the repo's alwaysConfirm list.
 */

import { resolveWorktreeTargetDir } from '../core/worktrees.js';
import { vigilStore } from '../store/index.js';
import type {
  ActionType,
  AgentName,
  ProposedAction,
  TriageClassification,
  TriagePriority,
  TriageResult,
  TriageRouting,
} from '../types/agents.js';
import type { RepoConfig, RepoRuntimeContext } from '../types/config.js';
import type { EventType, PrEvent } from '../types/events.js';
import { logAgentActivity } from './activity-log.js';
import { runEvidenceAgent } from './evidence.js';
import { runFixAgent } from './fix.js';
import { runLearningAgent } from './learning.js';
import { runRebaseAgent } from './rebase.js';
import { runRespondAgent } from './respond.js';
import { runTriageAgent } from './triage.js';

const STALE_TRIAGE_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;
const DUPLICATE_EVENT_WINDOW_MS = 5 * 60 * 1_000;
const EVENT_TYPE_COOLDOWN_MS = 45_000;
const COOLDOWN_EVENT_TYPES: ReadonlySet<EventType> = new Set([
  'pr_opened',
  'review_submitted',
  'comment_added',
  'checks_changed',
]);
const recentEventKeys = new Map<string, number>();
const recentTypeKeys = new Map<string, number>();

function pruneRecentEvents(now = Date.now(), windowMs = DUPLICATE_EVENT_WINDOW_MS): void {
  for (const [key, ts] of recentEventKeys) {
    if (now - ts > windowMs) {
      recentEventKeys.delete(key);
    }
  }

  for (const [key, ts] of recentTypeKeys) {
    if (now - ts > EVENT_TYPE_COOLDOWN_MS) {
      recentTypeKeys.delete(key);
    }
  }
}

function batchCoarseKey(event: PrEvent): string {
  if (
    event.data?.type === 'review_submitted' ||
    event.data?.type === 'comment_added' ||
    event.data?.type === 'checks_changed' ||
    event.data?.type === 'labels_changed'
  ) {
    return `batch:${eventKey(event)}`;
  }

  return `batch:${event.type}:${event.prKey}:${event.timestamp}`;
}

function typeCooldownKey(event: PrEvent): string {
  return `cooldown:${event.type}:${event.prKey}`;
}

function eventKey(event: PrEvent): string {
  if (event.data?.type === 'review_submitted') {
    const review = event.data.review;
    return `review_submitted:${event.prKey}:${review.id}:${review.state}:${review.submittedAt}`;
  }

  if (event.data?.type === 'comment_added') {
    const comment = event.data.comment;
    return `comment_added:${event.prKey}:${comment.id}:${comment.createdAt}`;
  }

  if (event.data?.type === 'checks_changed') {
    const checks = event.data.checks
      .map(check => `${check.name}:${check.status}:${check.conclusion ?? 'pending'}`)
      .sort()
      .join('|');
    return `checks_changed:${event.prKey}:${checks}`;
  }

  if (event.data?.type === 'labels_changed') {
    const added = [...event.data.added].sort().join(',');
    const removed = [...event.data.removed].sort().join(',');
    return `labels_changed:${event.prKey}:${added}:${removed}`;
  }

  return `${event.type}:${event.prKey}:${event.pr.updatedAt}:${event.pr.state}:${event.pr.isDraft}`;
}

interface DuplicateResult {
  isDuplicate: boolean;
  reason?: 'identity' | 'batch' | 'cooldown' | undefined;
}

function isDuplicateRecentEvent(event: PrEvent, now = Date.now()): DuplicateResult {
  pruneRecentEvents(now);
  const identityKey = eventKey(event);
  const batchKey = batchCoarseKey(event);
  const prevIdentity = recentEventKeys.get(identityKey);
  const prevBatch = recentEventKeys.get(batchKey);

  recentEventKeys.set(identityKey, now);
  recentEventKeys.set(batchKey, now);

  if (prevIdentity !== undefined && now - prevIdentity <= DUPLICATE_EVENT_WINDOW_MS) {
    return { isDuplicate: true, reason: 'identity' };
  }
  if (prevBatch !== undefined && now - prevBatch <= DUPLICATE_EVENT_WINDOW_MS) {
    return { isDuplicate: true, reason: 'batch' };
  }

  if (COOLDOWN_EVENT_TYPES.has(event.type)) {
    const cooldownKey = typeCooldownKey(event);
    const prevCooldown = recentTypeKeys.get(cooldownKey);
    recentTypeKeys.set(cooldownKey, now);
    if (prevCooldown !== undefined && now - prevCooldown <= EVENT_TYPE_COOLDOWN_MS) {
      return { isDuplicate: true, reason: 'cooldown' };
    }
  }

  return { isDuplicate: false };
}

function dedupeBatchEvents(events: PrEvent[]): PrEvent[] {
  const seen = new Set<string>();
  const deduped: PrEvent[] = [];
  for (const event of events) {
    const key = batchCoarseKey(event);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(event);
  }
  return deduped;
}

function resetEventDedupeState(): void {
  recentEventKeys.clear();
  recentTypeKeys.clear();
}

function routingToAgent(routing: TriageRouting): AgentName | null {
  switch (routing) {
    case 'respond':
      return 'respond';
    case 'fix':
      return 'fix';
    case 'rebase':
      return 'rebase';
    case 'evidence':
      return 'evidence';
    case 'dismiss':
      return null;
  }
}

function hasRunningAgent(prKey: string, agent: AgentName): boolean {
  const active = vigilStore.getState().activeAgents;
  for (const run of active.values()) {
    if (run.prKey === prKey && run.agent === agent && run.status === 'running') {
      return true;
    }
  }
  return false;
}

// ─── Triage (placeholder) ───────────────────────────────────────────────────

/**
 * Classify an event into a triage result.
 * This is a rule-based placeholder — the real implementation will use
 * an LLM-backed triage agent.
 */
function triageEvent(event: PrEvent): TriageResult {
  const map: Record<
    EventType,
    { classification: TriageClassification; routing: TriageRouting; priority: TriagePriority }
  > = {
    pr_opened: { classification: 'suggestion', routing: 'respond', priority: 'informational' },
    pr_closed: { classification: 'noise', routing: 'dismiss', priority: 'informational' },
    pr_merged: { classification: 'noise', routing: 'dismiss', priority: 'informational' },
    review_submitted: { classification: 'blocking', routing: 'fix', priority: 'immediate' },
    comment_added: { classification: 'suggestion', routing: 'respond', priority: 'can-wait' },
    checks_changed: { classification: 'blocking', routing: 'fix', priority: 'immediate' },
    conflict_detected: { classification: 'blocking', routing: 'rebase', priority: 'immediate' },
    conflict_resolved: {
      classification: 'nice-to-have',
      routing: 'dismiss',
      priority: 'informational',
    },
    labels_changed: { classification: 'noise', routing: 'dismiss', priority: 'informational' },
    ready_to_merge: { classification: 'nice-to-have', routing: 'respond', priority: 'can-wait' },
    became_draft: { classification: 'noise', routing: 'dismiss', priority: 'informational' },
    undrafted: { classification: 'suggestion', routing: 'respond', priority: 'informational' },
  };

  const entry = map[event.type];
  return {
    ...entry,
    reasoning: `Rule-based triage for event type "${event.type}".`,
  };
}

// ─── Confirmation Logic ─────────────────────────────────────────────────────

/**
 * Check whether an action type requires explicit human confirmation,
 * based on the repo's `alwaysConfirm` list.
 */
export function requiresConfirmation(
  actionType: ActionType,
  repoConfig?: RepoConfig | null | undefined
): boolean {
  const list = repoConfig?.alwaysConfirm;
  if (!list || list.length === 0) return false;
  return list.includes(actionType);
}

/**
 * Skip triage for PRs that have not been touched recently to avoid
 * startup noise on long-dormant queues.
 */
export function shouldSkipTriageForStalePr(
  event: PrEvent,
  maxAgeMs = STALE_TRIAGE_WINDOW_MS
): boolean {
  const updatedMs = Date.parse(event.pr.updatedAt);
  const eventMs = Date.parse(event.timestamp);
  if (!Number.isFinite(updatedMs) || !Number.isFinite(eventMs)) {
    return false;
  }
  return eventMs - updatedMs > maxAgeMs;
}

function applyModePolicy(
  action: ProposedAction,
  mode: 'hitl' | 'yolo',
  repoConfig?: RepoConfig | null | undefined
): ProposedAction {
  if (action.status === 'failed' || action.status === 'executed' || action.status === 'rejected') {
    return action;
  }

  const needsConfirmation =
    mode === 'hitl' || action.requiresConfirmation || requiresConfirmation(action.type, repoConfig);

  return {
    ...action,
    requiresConfirmation: needsConfirmation,
    status: needsConfirmation ? 'pending' : 'approved',
  };
}

function makeCreateWorktreeAction(
  event: PrEvent,
  triage: TriageResult,
  repoContext: RepoRuntimeContext
): ProposedAction {
  const targetDir = resolveWorktreeTargetDir(
    repoContext.repoDir,
    event.pr.headRefName,
    repoContext
  );
  return {
    id: crypto.randomUUID(),
    type: 'create_worktree',
    prKey: event.prKey,
    agent: 'triage',
    description: `Create a local worktree for ${event.pr.headRefName} before running ${triage.routing}.`,
    detail: `${triage.reasoning}\n\nTarget path: ${targetDir}`,
    requiresConfirmation: true,
    status: 'pending',
  };
}

function makeFailedAction(event: PrEvent, actionType: ActionType, message: string): ProposedAction {
  return {
    id: crypto.randomUUID(),
    type: actionType,
    prKey: event.prKey,
    agent: 'triage',
    description: message,
    requiresConfirmation: false,
    status: 'failed',
  };
}

async function buildAction(
  event: PrEvent,
  triage: TriageResult,
  mode: 'hitl' | 'yolo',
  repoContext?: RepoRuntimeContext | null | undefined
): Promise<ProposedAction | null> {
  switch (triage.routing) {
    case 'dismiss':
      return null;

    case 'respond': {
      const action = await runRespondAgent(event, event.pr);
      return applyModePolicy(action, mode, repoContext?.config);
    }

    case 'fix': {
      const worktreePath = event.pr.worktree?.path;
      if (!worktreePath) {
        if (!repoContext) {
          return makeFailedAction(
            event,
            'create_worktree',
            `Missing local repo context for ${event.pr.repository.nameWithOwner}; cannot create a worktree automatically.`
          );
        }
        if (!event.pr.headRefName) {
          return makeFailedAction(
            event,
            'create_worktree',
            `Missing branch metadata for ${event.prKey}; cannot create a worktree yet.`
          );
        }
        return applyModePolicy(
          makeCreateWorktreeAction(event, triage, repoContext),
          mode,
          repoContext.config
        );
      }

      const result = await runFixAgent(event, event.pr, worktreePath);
      const action = result.actions[0];
      if (!action) {
        return makeFailedAction(event, 'apply_fix', result.summary);
      }
      return applyModePolicy(action, mode, repoContext?.config);
    }

    case 'rebase': {
      const worktreePath = event.pr.worktree?.path;
      if (!worktreePath) {
        if (!repoContext) {
          return makeFailedAction(
            event,
            'create_worktree',
            `Missing local repo context for ${event.pr.repository.nameWithOwner}; cannot create a worktree automatically.`
          );
        }
        if (!event.pr.headRefName) {
          return makeFailedAction(
            event,
            'create_worktree',
            `Missing branch metadata for ${event.prKey}; cannot create a worktree yet.`
          );
        }
        return applyModePolicy(
          makeCreateWorktreeAction(event, triage, repoContext),
          mode,
          repoContext.config
        );
      }

      const action = await runRebaseAgent(event, event.pr, worktreePath);
      return applyModePolicy(action, mode, repoContext?.config);
    }

    case 'evidence': {
      const action = await runEvidenceAgent(event, event.pr, event.pr.worktree?.path);
      return applyModePolicy(action, mode, repoContext?.config);
    }
  }
}

// ─── Core Event Handler ─────────────────────────────────────────────────────

/**
 * Process a batch of PR events.
 *
 * For each event:
 *  1. Run triage to classify and route
 *  2. Build a ProposedAction
 *  3. Depending on mode (HITL/YOLO), enqueue or auto-execute
 */
export async function handleEvents(
  events: PrEvent[],
  repoContexts?: Map<string, RepoRuntimeContext>
): Promise<void> {
  const dedupedEvents = dedupeBatchEvents(events);
  logAgentActivity('orchestrator_batch_start', {
    data: {
      eventCount: events.length,
      dedupedEventCount: dedupedEvents.length,
      mode: vigilStore.getState().mode,
    },
  });

  for (const event of dedupedEvents) {
    logAgentActivity('orchestrator_event_received', {
      prKey: event.prKey,
      data: { type: event.type, timestamp: event.timestamp },
    });

    if (shouldSkipTriageForStalePr(event)) {
      logAgentActivity('orchestrator_event_skipped_stale', {
        prKey: event.prKey,
        data: { type: event.type, updatedAt: event.pr.updatedAt, timestamp: event.timestamp },
      });
      continue;
    }

    const duplicate = isDuplicateRecentEvent(event);
    if (duplicate.isDuplicate) {
      logAgentActivity('orchestrator_event_skipped_duplicate', {
        prKey: event.prKey,
        data: { type: event.type, reason: duplicate.reason },
      });
      continue;
    }

    // Learning is side-effect only; do not block event routing on it.
    // We intentionally do not run learning on pr_closed because disappearance
    // events can be transient when upstream data is incomplete.
    if (event.type === 'pr_merged') {
      logAgentActivity('orchestrator_learning_spawned', {
        prKey: event.prKey,
        data: { type: event.type },
      });
      void runLearningAgent(event, event.pr);
    }

    let triage: TriageResult;
    try {
      logAgentActivity('orchestrator_triage_start', {
        prKey: event.prKey,
        data: { type: event.type },
      });
      triage = await runTriageAgent(event, event.pr);
      if (triage.routing === 'dismiss' && triage.reasoning.startsWith('Triage failed:')) {
        logAgentActivity('orchestrator_triage_fallback_rule_based', {
          prKey: event.prKey,
          data: { reason: triage.reasoning },
        });
        triage = triageEvent(event);
      }
    } catch (error) {
      logAgentActivity('orchestrator_triage_error', {
        prKey: event.prKey,
        data: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
      triage = triageEvent(event);
    }

    logAgentActivity('orchestrator_triage_result', {
      prKey: event.prKey,
      data: {
        classification: triage.classification,
        routing: triage.routing,
        priority: triage.priority,
      },
    });

    const routedAgent = routingToAgent(triage.routing);
    if (routedAgent && hasRunningAgent(event.prKey, routedAgent)) {
      logAgentActivity('orchestrator_routing_skipped_agent_running', {
        prKey: event.prKey,
        data: { routing: triage.routing, agent: routedAgent },
      });
      continue;
    }

    const repoContext = repoContexts?.get(event.pr.repository.nameWithOwner);
    const action = await buildAction(event, triage, vigilStore.getState().mode, repoContext);
    if (action) {
      logAgentActivity('orchestrator_action_built', {
        prKey: action.prKey,
        data: {
          id: action.id,
          type: action.type,
          status: action.status,
          requiresConfirmation: action.requiresConfirmation,
        },
      });
      vigilStore.getState().enqueueAction(action);
      continue;
    }

    logAgentActivity('orchestrator_action_none', {
      prKey: event.prKey,
      data: { routing: triage.routing },
    });
  }

  logAgentActivity('orchestrator_batch_complete', {
    data: {
      queueSize: vigilStore.getState().actionQueue.length,
    },
  });
}

export const _internal = {
  dedupeBatchEvents,
  isDuplicateRecentEvent,
  resetEventDedupeState,
};
