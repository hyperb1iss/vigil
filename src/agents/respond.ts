/**
 * Respond agent — drafts contextual, constructive replies to PR review feedback.
 *
 * Handles scope creep pushback, acknowledged fixes, deferred items,
 * and general review Q&A. Matches team communication style from the knowledge base.
 */

import type { SDKAssistantMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { createSdkMcpServer, query } from '@anthropic-ai/claude-agent-sdk';

import { getKnowledgeAsContext } from '../learning/knowledge.js';
import { vigilStore } from '../store/index.js';
import type { AgentRun, ProposedAction } from '../types/agents.js';
import type { PrEvent } from '../types/events.js';
import type { PullRequest } from '../types/pr.js';
import { githubTools } from './tools/github.js';

// ─── MCP Server ──────────────────────────────────────────────────────────────

const respondMcp = createSdkMcpServer({
  name: 'vigil-respond',
  version: '0.1.0',
  tools: githubTools,
});

// ─── System Prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Vigil's respond agent. Draft contextual, constructive replies to PR review feedback.

Approach:
- Read all review comments and the PR description to understand full context
- For blocking feedback: acknowledge the issue and describe the fix plan
- For scope creep suggestions: politely push back, citing the PR's original intent
- For style/nit feedback: acknowledge and note it will be addressed
- For questions: provide clear, helpful answers with code references

Tone rules:
- Never defensive or dismissive
- Always constructive and collaborative
- Match the team's communication style from the knowledge base
- Keep responses concise but thorough
- Use code blocks when referencing specific changes

Return the draft comment text. The orchestrator will handle posting it.`;

// ─── Prompt Builder ──────────────────────────────────────────────────────────

function buildPrompt(event: PrEvent, pr: PullRequest): string {
  const knowledge = getKnowledgeAsContext();
  const knowledgeSection = knowledge ? `\n<knowledge-base>\n${knowledge}\n</knowledge-base>\n` : '';

  const reviews = pr.reviews.map(r => `- ${r.author.login} (${r.state}): ${r.body}`).join('\n');

  const comments = pr.comments.map(c => `- ${c.author.login}: ${c.body}`).join('\n');

  const triggerData = formatTrigger(event);

  return `Draft a reply to the review feedback on this PR.
${knowledgeSection}
<pr>
  <title>${pr.title}</title>
  <description>${pr.body}</description>
  <branch>${pr.headRefName} -> ${pr.baseRefName}</branch>
  <stats>+${pr.additions} -${pr.deletions} across ${pr.changedFiles} files</stats>
</pr>

<reviews>
${reviews || '(none)'}
</reviews>

<comments>
${comments || '(none)'}
</comments>

<trigger>
${triggerData}
</trigger>

Respond with ONLY the draft comment text — no meta-commentary, no wrapping.`;
}

function formatTrigger(event: PrEvent): string {
  const { data } = event;
  if (!data) return `Event: ${event.type}`;

  switch (data.type) {
    case 'review_submitted':
      return `New review from ${data.review.author.login} (${data.review.state}): ${data.review.body}`;
    case 'comment_added':
      return `New comment from ${data.comment.author.login}: ${data.comment.body}`;
    default:
      return `Event: ${event.type}`;
  }
}

// ─── Agent Runner ────────────────────────────────────────────────────────────

export async function runRespondAgent(event: PrEvent, pr: PullRequest): Promise<ProposedAction> {
  const store = vigilStore.getState();
  const runId = crypto.randomUUID();

  const agentRun: AgentRun = {
    id: runId,
    agent: 'respond',
    prKey: pr.key,
    status: 'running',
    startedAt: new Date().toISOString(),
    streamingOutput: '',
  };

  store.startAgentRun(agentRun);

  try {
    const prompt = buildPrompt(event, pr);
    let resultText = '';

    const conversation = query({
      prompt,
      options: {
        model: 'claude-sonnet-4-6',
        systemPrompt: SYSTEM_PROMPT,
        maxTurns: 5,
        maxBudgetUsd: 0.15,
        persistSession: false,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        mcpServers: { 'vigil-respond': respondMcp },
        tools: [],
      },
    });

    for await (const message of conversation) {
      if (message.type === 'assistant') {
        const assistantMsg = message as SDKAssistantMessage;
        const blocks = assistantMsg.message.content;
        let text = '';
        for (const block of blocks) {
          if (block.type === 'text') {
            text += block.text;
          }
        }
        store.updateAgentRun(runId, { streamingOutput: text });
        resultText = text;
      }

      if (message.type === 'result') {
        const resultMsg = message as SDKResultMessage;
        if (resultMsg.subtype === 'success') {
          resultText = resultMsg.result || resultText;
        }
      }
    }

    const action: ProposedAction = {
      id: crypto.randomUUID(),
      type: 'post_comment',
      prKey: pr.key,
      agent: 'respond',
      description: `Draft reply to ${event.type} on ${pr.key}`,
      detail: resultText,
      requiresConfirmation: true,
      status: 'pending',
    };

    store.completeAgentRun(runId, {
      success: true,
      summary: `Drafted response for ${pr.key}`,
      actions: [action],
    });

    return action;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.completeAgentRun(runId, {
      success: false,
      summary: `Respond agent failed: ${message}`,
      actions: [],
    });
    store.updateAgentRun(runId, { status: 'failed', error: message });

    return {
      id: crypto.randomUUID(),
      type: 'dismiss',
      prKey: pr.key,
      agent: 'respond',
      description: `Respond agent failed: ${message}`,
      requiresConfirmation: false,
      status: 'failed',
    };
  }
}
