import { mergePr, postComment, runGh } from '../core/github.js';
import { vigilStore } from '../store/index.js';
import type { ProposedAction } from '../types/agents.js';

const EXECUTOR_INTERVAL_MS = 1_000;

interface PrRef {
  owner: string;
  repo: string;
  number: number;
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

export async function executeAction(action: ProposedAction): Promise<string> {
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

    case 'apply_fix':
    case 'rebase':
      return `No-op executor: ${action.type} is performed by the agent run.`;

    case 'dismiss':
      return 'Dismissed.';

    case 'push_commit':
    case 'create_worktree':
      throw new Error(`Action "${action.type}" is not implemented by the executor.`);
  }
}

export function startActionExecutor(intervalMs = EXECUTOR_INTERVAL_MS): () => void {
  let inFlight = false;

  async function tick(): Promise<void> {
    if (inFlight) return;
    inFlight = true;

    try {
      const approved = vigilStore
        .getState()
        .actionQueue.filter(action => action.status === 'approved');

      for (const action of approved) {
        try {
          const output = await executeAction(action);
          vigilStore.getState().markActionExecuted(action.id, output);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          vigilStore.getState().markActionFailed(action.id, message);
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
