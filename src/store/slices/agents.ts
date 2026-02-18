import type { StateCreator } from 'zustand';
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
}

export const createAgentSlice: StateCreator<VigilStore, [], [], AgentSlice> = (set) => ({
  activeAgents: new Map(),
  actionQueue: [],
  actionHistory: [],

  startAgentRun: (run) =>
    set((prev) => {
      const next = new Map(prev.activeAgents);
      next.set(run.id, run);
      return { activeAgents: next };
    }),

  updateAgentRun: (id, update) =>
    set((prev) => {
      const existing = prev.activeAgents.get(id);
      if (!existing) return {};
      const next = new Map(prev.activeAgents);
      next.set(id, { ...existing, ...update });
      return { activeAgents: next };
    }),

  completeAgentRun: (id, result) =>
    set((prev) => {
      const existing = prev.activeAgents.get(id);
      if (!existing) return {};
      const next = new Map(prev.activeAgents);
      next.set(id, { ...existing, status: 'completed', completedAt: new Date().toISOString(), result });
      return { activeAgents: next };
    }),

  enqueueAction: (action) =>
    set((prev) => ({
      actionQueue: [...prev.actionQueue, action],
    })),

  approveAction: (id) =>
    set((prev) => ({
      actionQueue: prev.actionQueue.map((a) =>
        a.id === id ? { ...a, status: 'approved' as const } : a,
      ),
    })),

  rejectAction: (id) =>
    set((prev) => ({
      actionQueue: prev.actionQueue.map((a) =>
        a.id === id ? { ...a, status: 'rejected' as const } : a,
      ),
    })),
});
