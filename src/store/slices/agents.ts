import type { StateCreator } from 'zustand';

import { logAgentActivity } from '../../agents/activity-log.js';
import type { AgentRun, CompletedAction, ProposedAction } from '../../types/agents.js';
import type { VigilStore } from '../../types/store.js';

export interface AgentSlice {
  activeAgents: Map<string, AgentRun>;
  actionQueue: ProposedAction[];
  actionHistory: CompletedAction[];
  startAgentRun: (run: AgentRun) => void;
  updateAgentRun: (id: string, update: Partial<AgentRun>) => void;
  completeAgentRun: (id: string, result: AgentRun['result']) => void;
  enqueueAction: (action: ProposedAction) => void;
  approveAction: (id: string) => void;
  rejectAction: (id: string) => void;
  markActionExecuted: (id: string, output?: string) => void;
  markActionFailed: (id: string, output: string) => void;
}

export const createAgentSlice: StateCreator<VigilStore, [], [], AgentSlice> = set => ({
  activeAgents: new Map(),
  actionQueue: [],
  actionHistory: [],

  startAgentRun: run =>
    set(prev => {
      const next = new Map(prev.activeAgents);
      next.set(run.id, run);
      logAgentActivity('store_agent_run_started', {
        agent: run.agent,
        runId: run.id,
        prKey: run.prKey,
        data: { startedAt: run.startedAt },
      });
      return { activeAgents: next };
    }),

  updateAgentRun: (id, update) =>
    set(prev => {
      const existing = prev.activeAgents.get(id);
      if (!existing) return {};
      const next = new Map(prev.activeAgents);
      next.set(id, { ...existing, ...update });
      const hasStreamUpdate = typeof update.streamingOutput === 'string';
      logAgentActivity('store_agent_run_updated', {
        agent: existing.agent,
        runId: id,
        prKey: existing.prKey,
        data: hasStreamUpdate
          ? {
              streamChars: update.streamingOutput?.length ?? 0,
              status: update.status ?? existing.status,
            }
          : {
              status: update.status ?? existing.status,
              hasError: Boolean(update.error),
            },
      });
      return { activeAgents: next };
    }),

  completeAgentRun: (id, result) =>
    set(prev => {
      const existing = prev.activeAgents.get(id);
      if (!existing) return {};
      const next = new Map(prev.activeAgents);
      next.set(id, {
        ...existing,
        status: 'completed',
        completedAt: new Date().toISOString(),
        result,
      });
      logAgentActivity('store_agent_run_completed', {
        agent: existing.agent,
        runId: id,
        prKey: existing.prKey,
        data: {
          success: result?.success ?? false,
          summary: result?.summary?.slice(0, 220),
        },
      });
      return { activeAgents: next };
    }),

  enqueueAction: action =>
    set(prev => {
      const duplicate = prev.actionQueue.some(
        existing =>
          existing.prKey === action.prKey &&
          existing.type === action.type &&
          existing.agent === action.agent &&
          (existing.status === 'pending' || existing.status === 'approved')
      );

      if (duplicate) {
        logAgentActivity('store_action_enqueue_skipped_duplicate', {
          agent: action.agent,
          prKey: action.prKey,
          data: { id: action.id, type: action.type },
        });
        return {};
      }

      logAgentActivity('store_action_enqueued', {
        agent: action.agent,
        prKey: action.prKey,
        data: {
          id: action.id,
          type: action.type,
          status: action.status,
          requiresConfirmation: action.requiresConfirmation,
        },
      });
      return {
        actionQueue: [...prev.actionQueue, action],
      };
    }),

  approveAction: id =>
    set(prev => {
      const target = prev.actionQueue.find(a => a.id === id);
      if (target) {
        logAgentActivity('store_action_approved', {
          agent: target.agent,
          prKey: target.prKey,
          data: { id: target.id, type: target.type },
        });
      }

      return {
        actionQueue: prev.actionQueue.map(a =>
          a.id === id ? { ...a, status: 'approved' as const } : a
        ),
      };
    }),

  rejectAction: id =>
    set(prev => {
      const target = prev.actionQueue.find(a => a.id === id);
      if (target) {
        logAgentActivity('store_action_rejected', {
          agent: target.agent,
          prKey: target.prKey,
          data: { id: target.id, type: target.type },
        });
      }

      return {
        actionQueue: prev.actionQueue.map(a =>
          a.id === id ? { ...a, status: 'rejected' as const } : a
        ),
      };
    }),

  markActionExecuted: (id, output) =>
    set(prev => {
      const action = prev.actionQueue.find(a => a.id === id);
      if (!action) return {};

      const executedAt = new Date().toISOString();
      const completed: CompletedAction = {
        ...action,
        status: 'executed',
        executedAt,
        output,
      };

      logAgentActivity('store_action_executed', {
        agent: action.agent,
        prKey: action.prKey,
        data: {
          id: action.id,
          type: action.type,
          output: output?.slice(0, 200),
        },
      });

      return {
        actionQueue: prev.actionQueue.map(a => (a.id === id ? { ...a, status: 'executed' } : a)),
        actionHistory: [completed, ...prev.actionHistory].slice(0, 500),
      };
    }),

  markActionFailed: (id, output) =>
    set(prev => {
      const action = prev.actionQueue.find(a => a.id === id);
      if (!action) return {};

      const executedAt = new Date().toISOString();
      const completed: CompletedAction = {
        ...action,
        status: 'failed',
        executedAt,
        output,
      };

      logAgentActivity('store_action_failed', {
        agent: action.agent,
        prKey: action.prKey,
        data: {
          id: action.id,
          type: action.type,
          output: output.slice(0, 200),
        },
      });

      return {
        actionQueue: prev.actionQueue.map(a => (a.id === id ? { ...a, status: 'failed' } : a)),
        actionHistory: [completed, ...prev.actionHistory].slice(0, 500),
      };
    }),
});
