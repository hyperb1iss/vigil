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
  AgentName,
  AgentRun,
  ProposedAction,
  TriageClassification,
  TriagePriority,
  TriageResult,
  TriageRouting,
} from '../types/agents.js';
import type { RepoConfig } from '../types/config.js';
import type { EventType, PrEvent } from '../types/events.js';

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
    branch_behind: { classification: 'suggestion', routing: 'rebase', priority: 'can-wait' },
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

// ─── Routing → ActionType ───────────────────────────────────────────────────

function routingToActionType(routing: TriageRouting): ActionType {
  const actionMap: Record<TriageRouting, ActionType> = {
    fix: 'apply_fix',
    respond: 'post_comment',
    rebase: 'rebase',
    evidence: 'post_comment',
    dismiss: 'dismiss',
  };
  return actionMap[routing];
}

function routingToAgent(routing: TriageRouting): AgentName {
  const agentMap: Record<TriageRouting, AgentName> = {
    fix: 'fix',
    respond: 'respond',
    rebase: 'rebase',
    evidence: 'evidence',
    dismiss: 'triage',
  };
  return agentMap[routing];
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
  const store = vigilStore.getState();

  for (const event of events) {
    const triage = triageEvent(event);

    // Dismissed events need no action
    if (triage.routing === 'dismiss') continue;

    const agentName = routingToAgent(triage.routing);
    const actionType = routingToActionType(triage.routing);

    // Create the agent run
    const runId = crypto.randomUUID();
    const agentRun: AgentRun = {
      id: runId,
      agent: agentName,
      prKey: event.prKey,
      status: 'running',
      startedAt: new Date().toISOString(),
      streamingOutput: '',
    };

    store.startAgentRun(agentRun);

    // Build proposed action
    const needsConfirmation = store.mode === 'hitl' || requiresConfirmation(actionType, repoConfig);

    const action: ProposedAction = {
      id: crypto.randomUUID(),
      type: actionType,
      prKey: event.prKey,
      agent: agentName,
      description: `${triage.routing}: ${triage.reasoning}`,
      requiresConfirmation: needsConfirmation,
      status: needsConfirmation ? 'pending' : 'approved',
    };

    // Enqueue the action (both modes go through the queue;
    // the UI / executor will pick up approved ones automatically)
    store.enqueueAction(action);

    // Mark run as completed with the proposed action
    store.completeAgentRun(runId, {
      success: true,
      summary: triage.reasoning,
      actions: [action],
    });
  }
}
