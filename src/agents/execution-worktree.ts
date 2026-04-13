import type { ProposedAction } from '../types/agents.js';
import type { PullRequest } from '../types/pr.js';

export function resolveExecutionWorktreePath(action: ProposedAction, pr: PullRequest): string {
  const attachedPath =
    pr.worktree?.path?.trim() || action.context?.event?.pr.worktree?.path?.trim();
  const contextPath = action.context?.worktreePath?.trim();

  if (!attachedPath) {
    throw new Error(`Action "${action.type}" has no attached worktree for ${action.prKey}.`);
  }

  if (contextPath && contextPath !== attachedPath) {
    throw new Error(
      `Action "${action.type}" references stale worktree path "${contextPath}" for ${action.prKey}; expected "${attachedPath}".`
    );
  }

  return attachedPath;
}

export const _internal = {
  resolveExecutionWorktreePath,
};
