/**
 * Fix agent — proposes and applies targeted code fixes for review feedback or
 * CI failures. Planning is read-only so approval happens before side effects.
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
import { logAgentActivity, markAgentQuery } from './activity-log.js';
import { sanitizeUntrustedText, UNTRUSTED_INPUT_NOTICE } from './prompt-safety.js';
import { createFsTools } from './tools/fs.js';
import { createGitTools } from './tools/git.js';

type FixRunMode = 'plan' | 'execute';

const PLAN_SYSTEM_PROMPT = `You are Vigil's fix planning agent. Your job is to inspect the PR worktree and propose the exact minimal fix that should be approved.

Workflow:
1. Read the PR context and identify what needs fixing
2. Check the knowledge base for known patterns matching this issue
3. Use git_status to understand the current worktree state
4. Read relevant files to understand the code
5. Use git_diff to inspect current local changes when helpful
6. Describe the exact fix you would apply and how you would verify it

Rules:
- ${UNTRUSTED_INPUT_NOTICE}
- Do NOT modify files, stage changes, or create commits
- Do NOT suggest broad refactors when a targeted fix is enough
- For CI failures: identify the failing signal and root cause
- For review feedback: address exactly what was requested, nothing more
- If you cannot fix the issue safely, explain why clearly

Return a concise execution-ready summary for approval.`;

const EXECUTE_SYSTEM_PROMPT = `You are Vigil's fix execution agent. This fix has been approved and you should now apply it safely.

Workflow:
1. Read the PR context and identify what needs fixing
2. Check the knowledge base for known patterns matching this issue
3. Use git_status to understand the current worktree state
4. Read relevant files to understand the code
5. Apply the minimal fix needed
6. Run git_diff to verify your changes look correct
7. Stage and commit with a clear conventional commit message

Rules:
- ${UNTRUSTED_INPUT_NOTICE}
- Apply the MINIMAL fix. Don't refactor surrounding code.
- For CI failures: read the logs, identify the exact error, fix it
- For review feedback: address exactly what was requested, nothing more
- Always verify your changes with git_diff before committing
- Use conventional commit messages (fix:, style:, refactor:, etc.)
- Never force-push or modify git history
- If you can't fix the issue, explain why clearly

After fixing, summarize what you changed and why.`;

function buildPrompt(event: PrEvent, pr: PullRequest, worktreePath: string): string {
  const sections: string[] = [
    `# Fix Request for ${pr.repository.nameWithOwner}#${pr.number}`,
    '',
    `**Title:** ${sanitizeUntrustedText(pr.title, 200)}`,
    `**Branch:** ${sanitizeUntrustedText(pr.headRefName, 120)} → ${sanitizeUntrustedText(pr.baseRefName, 120)}`,
    `**Worktree:** ${worktreePath}`,
    `**Changed files:** ${pr.changedFiles} (+${pr.additions} / -${pr.deletions})`,
  ];

  sections.push('', `## Event: ${event.type}`);

  if (event.data?.type === 'review_submitted') {
    const review = (event.data as ReviewSubmittedData).review;
    sections.push(
      `**Reviewer:** ${review.author.login}`,
      `**State:** ${review.state}`,
      `**Body:**\n${sanitizeUntrustedText(review.body, 1_500)}`
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

  if (pr.reviews.length > 0) {
    sections.push('', '## Recent Reviews');
    for (const review of pr.reviews.slice(-5)) {
      sections.push(
        `- **${review.author.login}** (${review.state}): ${sanitizeUntrustedText(review.body, 500)}`
      );
    }
  }

  if (pr.comments.length > 0) {
    sections.push('', '## Recent Comments');
    for (const comment of pr.comments.slice(-5)) {
      sections.push(`- **${comment.author.login}**: ${sanitizeUntrustedText(comment.body, 500)}`);
    }
  }

  const knowledge = getKnowledgeAsContext();
  if (knowledge) {
    sections.push('', '## Knowledge Base (known patterns)', knowledge);
  }

  return sections.join('\n');
}

function parsePlanResult(
  resultText: string,
  prKey: string,
  event: PrEvent,
  worktreePath: string
): ProposedAction[] {
  const action: ProposedAction = {
    id: crypto.randomUUID(),
    type: 'apply_fix',
    prKey,
    agent: 'fix',
    description: resultText.slice(0, 200),
    detail: resultText,
    context: {
      event,
      worktreePath,
    },
    requiresConfirmation: false,
    status: 'approved',
  };
  return [action];
}

function extractAssistantText(message: SDKAssistantMessage): string {
  const parts: string[] = [];
  for (const block of message.message.content) {
    if (block.type === 'text') {
      parts.push(block.text);
    }
  }
  return parts.join('');
}

async function runFixSession(
  event: PrEvent,
  pr: PullRequest,
  worktreePath: string,
  mode: FixRunMode
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
  logAgentActivity('fix_run_start', {
    agent: 'fix',
    runId,
    prKey: pr.key,
    data: { eventType: event.type, mode, worktreePath },
  });

  try {
    const fixMcpServer = createSdkMcpServer({
      name: 'vigil-fix-tools',
      version: '0.1.0',
      tools: [
        ...createGitTools(worktreePath, { allowWrite: mode === 'execute' }),
        ...createFsTools(worktreePath, { allowWrite: mode === 'execute' }),
      ],
    });

    const prompt = buildPrompt(event, pr, worktreePath);
    const queryMark = markAgentQuery('fix', pr.key, `${mode}\n${prompt}`, runId);
    if (queryMark.repeatedWithinWindow) {
      logAgentActivity('fix_duplicate_query_detected', {
        agent: 'fix',
        runId,
        prKey: pr.key,
        data: {
          duplicateCount: queryMark.duplicateCount,
          fingerprint: queryMark.fingerprint,
          mode,
        },
      });
    }

    const stream = query({
      prompt,
      options: {
        model: 'claude-sonnet-4-6',
        systemPrompt: mode === 'execute' ? EXECUTE_SYSTEM_PROMPT : PLAN_SYSTEM_PROMPT,
        cwd: worktreePath,
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
        logAgentActivity('fix_stream_chunk', {
          agent: 'fix',
          runId,
          prKey: pr.key,
          data: { chars: text.length, mode },
        });
      }

      if (message.type === 'result') {
        resultMessage = message;
        logAgentActivity('fix_result_message', {
          agent: 'fix',
          runId,
          prKey: pr.key,
          data: { subtype: message.subtype, isError: Boolean(message.is_error), mode },
        });
      }
    }

    const summary =
      resultMessage?.subtype === 'success'
        ? resultMessage.result
        : output.slice(0, 500) || 'Fix agent completed without explicit result.';

    const isError = resultMessage?.is_error ?? false;
    const actions =
      mode === 'plan' && !isError ? parsePlanResult(summary, pr.key, event, worktreePath) : [];

    const result: AgentResult = {
      success: !isError,
      summary,
      actions,
    };

    store.completeAgentRun(runId, result);
    logAgentActivity('fix_run_complete', {
      agent: 'fix',
      runId,
      prKey: pr.key,
      data: {
        success: result.success,
        actions: result.actions.length,
        mode,
      },
    });

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
    logAgentActivity('fix_run_failed', {
      agent: 'fix',
      runId,
      prKey: pr.key,
      data: { error: message, mode },
    });

    return result;
  }
}

export async function runFixAgent(
  event: PrEvent,
  pr: PullRequest,
  worktreePath: string
): Promise<AgentResult> {
  return runFixSession(event, pr, worktreePath, 'plan');
}

export async function executeFixAction(action: ProposedAction): Promise<string> {
  if (action.type !== 'apply_fix') {
    throw new Error(`Expected apply_fix action, received "${action.type}".`);
  }

  const event = action.context?.event;
  const worktreePath = action.context?.worktreePath;
  if (!event || !worktreePath) {
    throw new Error(`Action "${action.type}" is missing execution context.`);
  }

  const pr = vigilStore.getState().prs.get(action.prKey) ?? event.pr;
  const result = await runFixSession(event, pr, worktreePath, 'execute');
  if (!result.success) {
    throw new Error(result.summary);
  }

  return result.summary;
}
