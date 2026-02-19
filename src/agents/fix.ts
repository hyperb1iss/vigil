/**
 * Fix agent — applies targeted code fixes for review feedback or CI failures.
 *
 * Uses Claude Agent SDK's query() to stream responses, with git/fs/github
 * tools available via an in-process MCP server scoped to the PR worktree.
 */

import type {
  SDKAssistantMessage,
  SDKMessage,
  SDKResultMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { createSdkMcpServer, query } from '@anthropic-ai/claude-agent-sdk';

import { getKnowledgeAsContext } from '../learning/knowledge.js';
import { vigilStore } from '../store/index.js';
import type { AgentResult, AgentRun, ProposedAction } from '../types/agents.js';
import type { ChecksChangedData, PrEvent, ReviewSubmittedData } from '../types/events.js';
import type { PullRequest } from '../types/pr.js';
import { fsTools } from './tools/fs.js';
import { gitTools } from './tools/git.js';
import { githubTools } from './tools/github.js';

// ─── System Prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Vigil's fix agent — a code surgeon. Your job is to apply targeted fixes for review feedback or CI failures on pull requests.

Workflow:
1. Read the PR context and identify what needs fixing
2. Check the knowledge base for known patterns matching this issue
3. Use git_status to understand the current worktree state
4. Read relevant files to understand the code
5. Apply the minimal fix needed
6. Run git_diff to verify your changes look correct
7. Stage and commit with a clear conventional commit message

Rules:
- Apply the MINIMAL fix. Don't refactor surrounding code.
- For CI failures: read the logs, identify the exact error, fix it
- For review feedback: address exactly what was requested, nothing more
- Always verify your changes with git_diff before committing
- Use conventional commit messages (fix:, style:, refactor:, etc.)
- Never force-push or modify git history
- If you can't fix the issue, explain why clearly

After fixing, summarize what you changed and why.`;

// ─── MCP Server ──────────────────────────────────────────────────────────────

const fixMcpServer = createSdkMcpServer({
  name: 'vigil-fix-tools',
  version: '0.1.0',
  tools: [...githubTools, ...gitTools, ...fsTools],
});

// ─── Prompt Builder ──────────────────────────────────────────────────────────

function buildPrompt(event: PrEvent, pr: PullRequest, worktreePath: string): string {
  const sections: string[] = [
    `# Fix Request for ${pr.repository.nameWithOwner}#${pr.number}`,
    '',
    `**Title:** ${pr.title}`,
    `**Branch:** ${pr.headRefName} → ${pr.baseRefName}`,
    `**Worktree:** ${worktreePath}`,
    `**Changed files:** ${pr.changedFiles} (+${pr.additions} / -${pr.deletions})`,
  ];

  // Event context
  sections.push('', `## Event: ${event.type}`);

  if (event.data?.type === 'review_submitted') {
    const review = (event.data as ReviewSubmittedData).review;
    sections.push(
      `**Reviewer:** ${review.author.login}`,
      `**State:** ${review.state}`,
      `**Body:**\n${review.body}`
    );
  }

  if (event.data?.type === 'checks_changed') {
    const { checks } = event.data as ChecksChangedData;
    const failed = checks.filter(c => c.conclusion === 'FAILURE');
    if (failed.length > 0) {
      sections.push('', '## Failed Checks');
      for (const check of failed) {
        sections.push(`- **${check.name}** (${check.workflowName ?? 'unknown workflow'})`);
        if (check.detailsUrl) {
          sections.push(`  Details: ${check.detailsUrl}`);
        }
      }
    }
  }

  // Review comments
  if (pr.reviews.length > 0) {
    sections.push('', '## Recent Reviews');
    for (const review of pr.reviews.slice(-5)) {
      sections.push(`- **${review.author.login}** (${review.state}): ${review.body.slice(0, 500)}`);
    }
  }

  // Comments
  if (pr.comments.length > 0) {
    sections.push('', '## Recent Comments');
    for (const comment of pr.comments.slice(-5)) {
      sections.push(`- **${comment.author.login}**: ${comment.body.slice(0, 500)}`);
    }
  }

  // Knowledge base
  const knowledge = getKnowledgeAsContext();
  if (knowledge) {
    sections.push('', '## Knowledge Base (known patterns)', knowledge);
  }

  return sections.join('\n');
}

// ─── Result Parser ───────────────────────────────────────────────────────────

function parseResult(resultText: string, prKey: string): ProposedAction[] {
  const action: ProposedAction = {
    id: crypto.randomUUID(),
    type: 'apply_fix',
    prKey,
    agent: 'fix',
    description: resultText.slice(0, 200),
    detail: resultText,
    requiresConfirmation: false,
    status: 'approved',
  };
  return [action];
}

// ─── Extract Text from Assistant Messages ────────────────────────────────────

function extractAssistantText(message: SDKAssistantMessage): string {
  const parts: string[] = [];
  for (const block of message.message.content) {
    if (block.type === 'text') {
      parts.push(block.text);
    }
  }
  return parts.join('');
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

export async function runFixAgent(
  event: PrEvent,
  pr: PullRequest,
  worktreePath: string
): Promise<AgentResult> {
  const store = vigilStore.getState();
  const runId = crypto.randomUUID();

  const agentRun: AgentRun = {
    id: runId,
    agent: 'fix',
    prKey: pr.key,
    status: 'running',
    startedAt: new Date().toISOString(),
    streamingOutput: '',
  };

  store.startAgentRun(agentRun);

  try {
    const prompt = buildPrompt(event, pr, worktreePath);

    const stream = query({
      prompt,
      options: {
        model: 'claude-sonnet-4-6',
        systemPrompt: SYSTEM_PROMPT,
        cwd: worktreePath,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        persistSession: false,
        maxTurns: 15,
        maxBudgetUsd: 0.5,
        tools: [],
        mcpServers: { 'vigil-fix': fixMcpServer },
      },
    });

    let resultMessage: SDKResultMessage | undefined;
    let output = '';

    for await (const message of stream as AsyncIterable<SDKMessage>) {
      if (message.type === 'assistant') {
        const text = extractAssistantText(message);
        output += text;
        store.updateAgentRun(runId, { streamingOutput: output });
      }

      if (message.type === 'result') {
        resultMessage = message;
      }
    }

    // Build the result
    const summary =
      resultMessage?.subtype === 'success'
        ? resultMessage.result
        : output.slice(0, 500) || 'Fix agent completed without explicit result.';

    const isError = resultMessage?.is_error ?? false;
    const actions = isError ? [] : parseResult(summary, pr.key);

    const result: AgentResult = {
      success: !isError,
      summary,
      actions,
    };

    store.completeAgentRun(runId, result);

    for (const action of actions) {
      store.enqueueAction(action);
    }

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    const result: AgentResult = {
      success: false,
      summary: `Fix agent failed: ${message}`,
      actions: [],
    };

    store.updateAgentRun(runId, {
      status: 'failed',
      error: message,
      completedAt: new Date().toISOString(),
      result,
    });

    return result;
  }
}
