/**
 * Event orchestrator — routes incoming PR events through triage,
 * then queues or auto-executes proposed actions based on the current mode.
 *
 * HITL mode: all actions are enqueued for human approval.
 * YOLO mode: actions auto-execute unless their type is in the repo's alwaysConfirm list.
 */

import { vigilStore } from '../store/index.js';
import type {
  ActionType,
  ProposedAction,
  TriageClassification,
  TriagePriority,
  TriageResult,
  TriageRouting,
} from '../types/agents.js';
import type { RepoConfig } from '../types/config.js';
import type { EventType, PrEvent } from '../types/events.js';
import { runEvidenceAgent } from './evidence.js';
import { runFixAgent } from './fix.js';
import { runLearningAgent } from './learning.js';
import { runRebaseAgent } from './rebase.js';
import { runRespondAgent } from './respond.js';
import { runTriageAgent } from './triage.js';

const STALE_TRIAGE_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;

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

function makeNoWorktreeAction(event: PrEvent, triage: TriageResult): ProposedAction {
  return {
    id: crypto.randomUUID(),
    type: 'create_worktree',
    prKey: event.prKey,
    agent: 'triage',
    description: `Missing worktree for ${event.prKey}; cannot run ${triage.routing} agent automatically.`,
    detail: triage.reasoning,
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
  repoConfig?: RepoConfig | null | undefined
): Promise<ProposedAction | null> {
  switch (triage.routing) {
    case 'dismiss':
      return null;

    case 'respond': {
      const action = await runRespondAgent(event, event.pr);
      return applyModePolicy(action, mode, repoConfig);
    }

    case 'fix': {
      const worktreePath = event.pr.worktree?.path;
      if (!worktreePath) {
        return applyModePolicy(makeNoWorktreeAction(event, triage), mode, repoConfig);
      }

      const result = await runFixAgent(event, event.pr, worktreePath);
      const action = result.actions[0];
      if (!action) {
        return makeFailedAction(event, 'apply_fix', result.summary);
      }
      return applyModePolicy(action, mode, repoConfig);
    }

    case 'rebase': {
      const worktreePath = event.pr.worktree?.path;
      if (!worktreePath) {
        return applyModePolicy(makeNoWorktreeAction(event, triage), mode, repoConfig);
      }

      const action = await runRebaseAgent(event, event.pr, worktreePath);
      return applyModePolicy(action, mode, repoConfig);
    }

    case 'evidence': {
      const action = await runEvidenceAgent(event, event.pr, event.pr.worktree?.path);
      return applyModePolicy(action, mode, repoConfig);
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
  repoConfig?: RepoConfig | null | undefined
): Promise<void> {
  for (const event of events) {
    if (shouldSkipTriageForStalePr(event)) {
      continue;
    }

    // Learning is side-effect only; do not block event routing on it.
    // We intentionally do not run learning on pr_closed because disappearance
    // events can be transient when upstream data is incomplete.
    if (event.type === 'pr_merged') {
      void runLearningAgent(event, event.pr);
    }

    let triage: TriageResult;
    try {
      triage = await runTriageAgent(event, event.pr);
      if (triage.routing === 'dismiss' && triage.reasoning.startsWith('Triage failed:')) {
        triage = triageEvent(event);
      }
    } catch {
      triage = triageEvent(event);
    }

    const action = await buildAction(event, triage, vigilStore.getState().mode, repoConfig);
    if (action) {
      vigilStore.getState().enqueueAction(action);
    }
  }
}
