/**
 * Rebase agent — previews and executes rebases for PR branches. Planning is
 * read-only so approval happens before any branch mutation.
 */

import type { SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { createSdkMcpServer, query } from '@anthropic-ai/claude-agent-sdk';

import { getKnowledgeAsContext } from '../learning/knowledge.js';
import { vigilStore } from '../store/index.js';
import type { AgentRun, ProposedAction } from '../types/agents.js';
import type { PrEvent } from '../types/events.js';
import type { PullRequest } from '../types/pr.js';
import { logAgentActivity, markAgentQuery } from './activity-log.js';
import { sanitizeUntrustedText, UNTRUSTED_INPUT_NOTICE } from './prompt-safety.js';
import { createFsTools } from './tools/fs.js';
import { createGitTools } from './tools/git.js';

type RebaseRunMode = 'plan' | 'execute';

const PLAN_SYSTEM_PROMPT = `You are Vigil's rebase planning agent. Inspect the branch state and describe the safest approved rebase plan.

Workflow:
- ${UNTRUSTED_INPUT_NOTICE}
1. Check git_status to understand the current state
2. Inspect the branch and likely rebase surface
3. Identify expected conflicts and how you would resolve them
4. Describe how you would verify the branch afterward

Safety rules:
- Do NOT run a rebase or mutate the worktree
- Do NOT stage files or create commits
- Call out anything that makes the rebase unsafe to automate
- If conflicts are likely too complex, say so clearly

Return a concise execution-ready summary for approval.`;

const EXECUTE_SYSTEM_PROMPT = `You are Vigil's rebase execution agent. This rebase has been approved and you should now perform it safely.

Workflow:
- ${UNTRUSTED_INPUT_NOTICE}
1. Check git_status to understand the current state
2. Fetch the latest target branch
3. Attempt the rebase
4. If conflicts occur:
   - For lock files (package-lock.json, bun.lock, yarn.lock): delete and regenerate
   - For code conflicts: read both sides, understand intent, resolve intelligently
   - Stage resolved files and continue rebase
5. After successful rebase, verify the build still works
6. Report what was done

Safety rules:
- NEVER force-push. Report that the rebase is ready and the push needs approval.
- If conflicts are too complex to resolve automatically, abort the rebase and explain
- Always check git_status after rebase to confirm clean state
- Create a summary of all conflict resolutions for review`;

function buildPrompt(pr: PullRequest, event: PrEvent): string {
  const knowledge = getKnowledgeAsContext();
  const knowledgeBlock = knowledge ? `\n<knowledge>\n${knowledge}\n</knowledge>\n` : '';

  return `Rebase the branch "${sanitizeUntrustedText(pr.headRefName, 120)}" onto "${sanitizeUntrustedText(pr.baseRefName, 120)}" for PR #${pr.number}: ${sanitizeUntrustedText(pr.title, 200)}

Repository: ${pr.repository.nameWithOwner}
PR state: ${pr.state} | Mergeable: ${pr.mergeable}
Event trigger: ${event.type}
Changed files: ${pr.changedFiles} (+${pr.additions} -${pr.deletions})
${knowledgeBlock}
Begin by checking git_status, then proceed with the rebase workflow.`;
}

function extractResultText(messages: SDKMessage[]): string {
  const result = messages.find((message): message is SDKResultMessage => message.type === 'result');
  if (!result) return 'Rebase agent completed without a result message.';
  return result.subtype === 'success' ? result.result : `Rebase failed: ${result.subtype}`;
}

function getResultMessage(messages: SDKMessage[]): SDKResultMessage | undefined {
  return messages.find((message): message is SDKResultMessage => message.type === 'result');
}

function createFailedRebaseAction(prKey: string, message: string): ProposedAction {
  return {
    id: crypto.randomUUID(),
    type: 'rebase',
    prKey,
    agent: 'rebase',
    description: message,
    requiresConfirmation: false,
    status: 'failed',
  };
}

function createPlannedRebaseAction(
  event: PrEvent,
  pr: PullRequest,
  worktreePath: string,
  summary: string
): ProposedAction {
  return {
    id: crypto.randomUUID(),
    type: 'rebase',
    prKey: pr.key,
    agent: 'rebase',
    description: `Rebase ${pr.headRefName} onto ${pr.baseRefName}`,
    detail: summary,
    context: {
      event,
      worktreePath,
    },
    requiresConfirmation: true,
    status: 'pending',
  };
}

function updateRebaseStream(
  message: SDKMessage,
  runId: string,
  prKey: string,
  mode: RebaseRunMode
): void {
  if (message.type !== 'assistant') {
    return;
  }

  const blocks = message.message.content;
  let text = '';
  for (const block of blocks) {
    if (block.type === 'text') {
      text += block.text;
    }
  }

  if (!text) {
    return;
  }

  const store = vigilStore.getState();
  const current = store.activeAgents.get(runId);
  store.updateAgentRun(runId, {
    streamingOutput: `${current?.streamingOutput ?? ''}${text}`,
  });
  logAgentActivity('rebase_stream_chunk', {
    agent: 'rebase',
    runId,
    prKey,
    data: { chars: text.length, mode },
  });
}

async function runRebaseSession(
  event: PrEvent,
  pr: PullRequest,
  worktreePath: string,
  mode: RebaseRunMode
): Promise<ProposedAction | string> {
  const store = vigilStore.getState();
  const runId = crypto.randomUUID();
  const agentRun: AgentRun = {
    id: runId,
    agent: 'rebase',
    prKey: pr.key,
    status: 'running',
    startedAt: new Date().toISOString(),
    streamingOutput: '',
  };
  store.startAgentRun(agentRun);
  logAgentActivity('rebase_run_start', {
    agent: 'rebase',
    runId,
    prKey: pr.key,
    data: { eventType: event.type, mode, worktreePath },
  });

  const prompt = buildPrompt(pr, event);
  const queryMark = markAgentQuery('rebase', pr.key, `${mode}\n${prompt}`, runId);
  if (queryMark.repeatedWithinWindow) {
    logAgentActivity('rebase_duplicate_query_detected', {
      agent: 'rebase',
      runId,
      prKey: pr.key,
      data: {
        duplicateCount: queryMark.duplicateCount,
        fingerprint: queryMark.fingerprint,
        mode,
      },
    });
  }
  const collected: SDKMessage[] = [];

  try {
    const rebaseMcpServer = createSdkMcpServer({
      name: 'vigil-rebase',
      version: '0.1.0',
      tools: [
        ...createGitTools(worktreePath, { allowWrite: mode === 'execute' }),
        ...createFsTools(worktreePath, { allowWrite: mode === 'execute' }),
      ],
    });

    const stream = query({
      prompt,
      options: {
        model: 'claude-sonnet-4-6',
        systemPrompt: mode === 'execute' ? EXECUTE_SYSTEM_PROMPT : PLAN_SYSTEM_PROMPT,
        cwd: worktreePath,
        mcpServers: { 'vigil-rebase': rebaseMcpServer },
        tools: [],
        persistSession: false,
        maxTurns: 20,
        maxBudgetUsd: 0.5,
      },
    });

    for await (const message of stream) {
      collected.push(message);
      updateRebaseStream(message, runId, pr.key, mode);
    }

    const resultMessage = getResultMessage(collected);
    const summary = extractResultText(collected);
    const isError = resultMessage?.subtype !== 'success' || resultMessage?.is_error === true;
    if (mode === 'execute') {
      if (isError) {
        throw new Error(summary);
      }

      store.completeAgentRun(runId, {
        success: true,
        summary,
        actions: [],
      });
      logAgentActivity('rebase_run_complete', {
        agent: 'rebase',
        runId,
        prKey: pr.key,
        data: { mode },
      });
      return summary;
    }

    if (isError) {
      return createFailedRebaseAction(pr.key, summary);
    }

    const action = createPlannedRebaseAction(event, pr, worktreePath, summary);

    store.completeAgentRun(runId, {
      success: true,
      summary,
      actions: [action],
    });
    logAgentActivity('rebase_run_complete', {
      agent: 'rebase',
      runId,
      prKey: pr.key,
      data: { actionId: action.id, mode },
    });

    return action;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    store.updateAgentRun(runId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      error: message,
    });
    logAgentActivity('rebase_run_failed', {
      agent: 'rebase',
      runId,
      prKey: pr.key,
      data: { error: message, mode },
    });

    if (mode === 'execute') {
      throw new Error(`Rebase agent failed: ${message}`, { cause: error });
    }

    return createFailedRebaseAction(pr.key, `Rebase failed: ${message}`);
  }
}

export async function runRebaseAgent(
  event: PrEvent,
  pr: PullRequest,
  worktreePath: string
): Promise<ProposedAction> {
  const result = await runRebaseSession(event, pr, worktreePath, 'plan');
  return result as ProposedAction;
}

export async function executeRebaseAction(action: ProposedAction): Promise<string> {
  if (action.type !== 'rebase') {
    throw new Error(`Expected rebase action, received "${action.type}".`);
  }

  const event = action.context?.event;
  const worktreePath = action.context?.worktreePath;
  if (!event || !worktreePath) {
    throw new Error(`Action "${action.type}" is missing execution context.`);
  }

  const pr = vigilStore.getState().prs.get(action.prKey) ?? event.pr;
  const result = await runRebaseSession(event, pr, worktreePath, 'execute');
  return result as string;
}
