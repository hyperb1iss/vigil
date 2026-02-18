/**
 * Rebase agent — handles rebasing PR branches onto the target branch.
 *
 * Previews conflicts before executing, resolves lock file conflicts by
 * regeneration, merges code conflicts intelligently, and verifies the
 * build passes after rebase. Never force-pushes without explicit approval.
 */

import type { SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { createSdkMcpServer, query } from '@anthropic-ai/claude-agent-sdk';
import { getKnowledgeAsContext } from '../learning/knowledge.js';
import { vigilStore } from '../store/index.js';
import type { AgentRun, ProposedAction } from '../types/agents.js';
import type { PrEvent } from '../types/events.js';
import type { PullRequest } from '../types/pr.js';
import { fsTools } from './tools/fs.js';
import { gitTools } from './tools/git.js';

// ─── MCP Server ──────────────────────────────────────────────────────────────

const rebaseMcpServer = createSdkMcpServer({
  name: 'vigil-rebase',
  version: '0.1.0',
  tools: [...gitTools, ...fsTools],
});

// ─── System Prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Vigil's rebase agent. Handle rebasing PR branches onto the target branch safely.

Workflow:
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildPrompt(pr: PullRequest, event: PrEvent): string {
  const knowledge = getKnowledgeAsContext();
  const knowledgeBlock = knowledge ? `\n<knowledge>\n${knowledge}\n</knowledge>\n` : '';

  return `Rebase the branch "${pr.headRefName}" onto "${pr.baseRefName}" for PR #${pr.number}: ${pr.title}

Repository: ${pr.repository.nameWithOwner}
PR state: ${pr.state} | Mergeable: ${pr.mergeable}
Event trigger: ${event.type}
Changed files: ${pr.changedFiles} (+${pr.additions} -${pr.deletions})
${knowledgeBlock}
Begin by checking git_status, then proceed with the rebase workflow.`;
}

function extractResultText(messages: SDKMessage[]): string {
  const result = messages.find((m): m is SDKResultMessage => m.type === 'result');
  if (!result) return 'Rebase agent completed without a result message.';
  return result.subtype === 'success' ? result.result : `Rebase failed: ${result.subtype}`;
}

// ─── Agent Entry Point ───────────────────────────────────────────────────────

export async function runRebaseAgent(
  event: PrEvent,
  pr: PullRequest,
  worktreePath: string
): Promise<ProposedAction> {
  const store = vigilStore.getState();

  // Create and register the agent run
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

  const prompt = buildPrompt(pr, event);
  const collected: SDKMessage[] = [];

  try {
    const stream = query({
      prompt,
      options: {
        model: 'claude-sonnet-4-6',
        systemPrompt: SYSTEM_PROMPT,
        cwd: worktreePath,
        mcpServers: { 'vigil-rebase': rebaseMcpServer },
        tools: [],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        persistSession: false,
        maxTurns: 20,
        maxBudgetUsd: 0.5,
      },
    });

    for await (const message of stream) {
      collected.push(message);

      // Stream assistant text to the store for live UI updates
      if (message.type === 'assistant') {
        const blocks = message.message.content;
        let text = '';
        for (const block of blocks) {
          if (block.type === 'text') {
            text += block.text;
          }
        }

        if (text) {
          store.updateAgentRun(runId, {
            streamingOutput: `${agentRun.streamingOutput}${text}`,
          });
          agentRun.streamingOutput += text;
        }
      }
    }

    const summary = extractResultText(collected);

    const action: ProposedAction = {
      id: crypto.randomUUID(),
      type: 'rebase',
      prKey: pr.key,
      agent: 'rebase',
      description: `Rebase ${pr.headRefName} onto ${pr.baseRefName}`,
      detail: summary,
      requiresConfirmation: true,
      status: 'pending',
    };

    store.completeAgentRun(runId, {
      success: true,
      summary,
      actions: [action],
    });

    return action;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    store.updateAgentRun(runId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      error: message,
    });

    return {
      id: crypto.randomUUID(),
      type: 'rebase',
      prKey: pr.key,
      agent: 'rebase',
      description: `Rebase failed: ${message}`,
      requiresConfirmation: false,
      status: 'failed',
    };
  }
}
