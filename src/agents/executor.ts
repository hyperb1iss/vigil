import { mergePr, postComment, runGh } from '../core/github.js';
import { createWorktree, getWorktreeStatus, resolveWorktreeTargetDir } from '../core/worktrees.js';
import { vigilStore } from '../store/index.js';
import type { ProposedAction } from '../types/agents.js';
import type { RepoRuntimeContext } from '../types/config.js';
import { logAgentActivity } from './activity-log.js';
import { executeFixAction } from './fix.js';
import { executeRebaseAction } from './rebase.js';

const EXECUTOR_INTERVAL_MS = 1_000;

interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

interface ExecutorOptions {
  repoContexts?: Map<string, RepoRuntimeContext> | undefined;
  createWorktreeFn?: typeof createWorktree;
  executeFixActionFn?: typeof executeFixAction;
  executeRebaseActionFn?: typeof executeRebaseAction;
  getWorktreeStatusFn?: typeof getWorktreeStatus;
}

function parsePrKey(prKey: string): PrRef {
  const match = /^([^/]+)\/([^#]+)#(\d+)$/.exec(prKey);
  if (!match?.[1] || !match[2] || !match[3]) {
    throw new Error(`Invalid PR key "${prKey}" (expected "owner/repo#number").`);
  }

  return {
    owner: match[1],
    repo: match[2],
    number: Number.parseInt(match[3], 10),
  };
}

function requireDetail(action: ProposedAction): string {
  const text = action.detail?.trim();
  if (!text) {
    throw new Error(`Action "${action.type}" is missing detail text.`);
  }
  return text;
}

export async function executeAction(
  action: ProposedAction,
  options?: ExecutorOptions
): Promise<string> {
  logAgentActivity('executor_action_start', {
    agent: action.agent,
    prKey: action.prKey,
    data: { id: action.id, type: action.type },
  });

  switch (action.type) {
    case 'post_comment': {
      const ref = parsePrKey(action.prKey);
      const body = requireDetail(action);
      await postComment(ref.owner, ref.repo, ref.number, body);
      return `Posted comment on ${action.prKey}.`;
    }

    case 'edit_comment': {
      const ref = parsePrKey(action.prKey);
      const body = requireDetail(action);
      // We do not track stable comment IDs yet; post as a follow-up.
      await postComment(ref.owner, ref.repo, ref.number, body);
      return `Posted evidence follow-up on ${action.prKey}.`;
    }

    case 'merge': {
      const ref = parsePrKey(action.prKey);
      await mergePr(ref.owner, ref.repo, ref.number, 'squash');
      return `Merged ${action.prKey} with squash strategy.`;
    }

    case 'close': {
      const ref = parsePrKey(action.prKey);
      await runGh(['pr', 'close', String(ref.number), `--repo=${ref.owner}/${ref.repo}`]);
      return `Closed ${action.prKey}.`;
    }

    case 'apply_fix': {
      const executeFixActionFn = options?.executeFixActionFn ?? executeFixAction;
      return executeFixActionFn(action);
    }

    case 'rebase': {
      const executeRebaseActionFn = options?.executeRebaseActionFn ?? executeRebaseAction;
      return executeRebaseActionFn(action);
    }

    case 'dismiss':
      return 'Dismissed.';

    case 'create_worktree': {
      const ref = parsePrKey(action.prKey);
      const repoContext = options?.repoContexts?.get(`${ref.owner}/${ref.repo}`);
      if (!repoContext) {
        throw new Error(`No local repo context is registered for ${ref.owner}/${ref.repo}.`);
      }

      const pr = vigilStore.getState().prs.get(action.prKey);
      if (!pr?.headRefName) {
        throw new Error(`PR ${action.prKey} is missing branch metadata for worktree creation.`);
      }

      const targetDir = resolveWorktreeTargetDir(repoContext.repoDir, pr.headRefName, repoContext);
      const createWorktreeFn = options?.createWorktreeFn ?? createWorktree;
      const getWorktreeStatusFn = options?.getWorktreeStatusFn ?? getWorktreeStatus;
      const worktreePath = await createWorktreeFn(repoContext.repoDir, pr.headRefName, targetDir);
      const worktree = await getWorktreeStatusFn(worktreePath);
      vigilStore.getState().updatePr(action.prKey, { worktree });
      return `Created worktree for ${action.prKey} at ${worktreePath}.`;
    }

    case 'push_commit':
      throw new Error(`Action "${action.type}" is not implemented by the executor.`);
  }
}

export function startActionExecutor(
  intervalMs = EXECUTOR_INTERVAL_MS,
  options?: ExecutorOptions
): () => void {
  let inFlight = false;

  async function tick(): Promise<void> {
    if (inFlight) return;
    inFlight = true;

    try {
      const approved = vigilStore
        .getState()
        .actionQueue.filter(action => action.status === 'approved');

      logAgentActivity('executor_tick', {
        data: {
          approvedCount: approved.length,
        },
      });

      for (const action of approved) {
        try {
          const output = await executeAction(action, options);
          vigilStore.getState().markActionExecuted(action.id, output);
          logAgentActivity('executor_action_success', {
            agent: action.agent,
            prKey: action.prKey,
            data: {
              id: action.id,
              type: action.type,
              output: output.slice(0, 200),
            },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          vigilStore.getState().markActionFailed(action.id, message);
          logAgentActivity('executor_action_failed', {
            agent: action.agent,
            prKey: action.prKey,
            data: {
              id: action.id,
              type: action.type,
              error: message,
            },
          });
        }
      }
    } finally {
      inFlight = false;
    }
  }

  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  return () => clearInterval(timer);
}
