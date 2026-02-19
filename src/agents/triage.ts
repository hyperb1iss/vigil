/**
 * Triage agent — classifies incoming PR events and routes them
 * to the appropriate action agent using lightweight LLM classification.
 *
 * Uses Haiku for fast, cheap inference since triage is pure classification.
 */

import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { runGh } from '../core/github.js';
import { getKnowledgeAsContext } from '../learning/knowledge.js';
import { vigilStore } from '../store/index.js';
import type { AgentRun, TriageResult } from '../types/agents.js';
import type { PrEvent } from '../types/events.js';
import type { PullRequest } from '../types/pr.js';

interface TextBlock {
  type: 'text';
  text: string;
}

// ─── MCP Tools (read-only context gathering) ────────────────────────────────

const getPrContext = tool(
  'get_pr_context',
  'Fetch full PR context including diff stats, review comments, and CI status.',
  {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    number: z.number().describe('PR number'),
  },
  async ({ owner, repo, number }) => {
    const output = await runGh([
      'pr',
      'view',
      String(number),
      `--repo=${owner}/${repo}`,
      '--json=title,body,state,isDraft,mergeable,reviewDecision,reviews,comments,statusCheckRollup,labels,additions,deletions,changedFiles',
    ]);
    return { content: [{ type: 'text' as const, text: output }] };
  }
);

const getKnowledge = tool(
  'get_knowledge',
  'Retrieve learned patterns and knowledge from previous triage decisions.',
  {},
  async () => {
    const knowledge = getKnowledgeAsContext();
    return {
      content: [
        {
          type: 'text' as const,
          text: knowledge || 'No learned patterns yet.',
        },
      ],
    };
  }
);

const getCiLogs = tool(
  'get_ci_logs',
  'Fetch recent CI check run logs for a PR to understand failures.',
  {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    number: z.number().describe('PR number'),
  },
  async ({ owner, repo, number }) => {
    const output = await runGh(['pr', 'checks', String(number), `--repo=${owner}/${repo}`]);
    return { content: [{ type: 'text' as const, text: output }] };
  }
);

// ─── MCP Server ──────────────────────────────────────────────────────────────

const triageMcpServer = createSdkMcpServer({
  name: 'vigil-triage',
  version: '0.1.0',
  tools: [getPrContext, getKnowledge, getCiLogs],
});

// ─── System Prompt ───────────────────────────────────────────────────────────

const TRIAGE_SYSTEM_PROMPT = `You are Vigil's triage agent. Your job is to classify incoming PR events and route them to the right action.

Given a PR event and its context, return a JSON classification:
- classification: blocking | suggestion | nice-to-have | scope-creep | noise
- routing: fix | respond | rebase | evidence | dismiss
- priority: immediate | can-wait | informational
- reasoning: Brief explanation of your classification

Rules:
- CI failures on non-draft PRs are always "blocking" + "fix" + "immediate"
- Merge conflicts are "blocking" + "rebase" + "immediate"
- Bot reviews (from users with [bot] suffix or known bot accounts) are usually "noise" unless they block merge
- "Changes requested" reviews are "blocking" + "fix" + "immediate"
- New comments asking questions are "suggestion" + "respond" + "can-wait"
- PRs becoming ready to merge are "nice-to-have" + "respond" + "can-wait"
- Use the knowledge base to recognize learned patterns

Use the available tools to gather context before classifying.`;

// ─── Structured Output Schema ────────────────────────────────────────────────

const TRIAGE_OUTPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    classification: {
      type: 'string' as const,
      enum: ['blocking', 'suggestion', 'nice-to-have', 'scope-creep', 'noise'],
    },
    routing: {
      type: 'string' as const,
      enum: ['fix', 'respond', 'rebase', 'evidence', 'dismiss'],
    },
    priority: {
      type: 'string' as const,
      enum: ['immediate', 'can-wait', 'informational'],
    },
    reasoning: { type: 'string' as const },
  },
  required: ['classification', 'routing', 'priority', 'reasoning'],
  additionalProperties: false,
} as const;

// ─── Prompt Builder ──────────────────────────────────────────────────────────

function buildTriagePrompt(event: PrEvent, pr: PullRequest): string {
  const checksJson =
    pr.checks.length > 0
      ? pr.checks.map(c => `  - ${c.name}: ${c.status} / ${c.conclusion ?? 'pending'}`).join('\n')
      : '  (none)';

  const reviewsJson =
    pr.reviews.length > 0
      ? pr.reviews
          .map(
            r =>
              `  - ${r.author.login}${r.author.isBot ? ' [bot]' : ''}: ${r.state} — ${r.body.slice(0, 200)}`
          )
          .join('\n')
      : '  (none)';

  return `Classify this PR event:

## Event
- Type: ${event.type}
- Timestamp: ${event.timestamp}
- Event data: ${event.data ? JSON.stringify(event.data, null, 2) : 'none'}

## PR: ${pr.key}
- Title: ${pr.title}
- State: ${pr.state}
- Draft: ${pr.isDraft}
- Mergeable: ${pr.mergeable}
- Review decision: ${pr.reviewDecision || 'none'}
- Branch: ${pr.headRefName} -> ${pr.baseRefName}
- Changes: +${pr.additions} -${pr.deletions} (${pr.changedFiles} files)
- Author: ${pr.author.login}${pr.author.isBot ? ' [bot]' : ''}

## Checks
${checksJson}

## Reviews
${reviewsJson}

## Labels
${pr.labels.map(l => l.name).join(', ') || '(none)'}

Classify and route this event.`;
}

// ─── Agent Runner ────────────────────────────────────────────────────────────

export async function runTriageAgent(event: PrEvent, pr: PullRequest): Promise<TriageResult> {
  const store = vigilStore.getState();
  const runId = crypto.randomUUID();

  const agentRun: AgentRun = {
    id: runId,
    agent: 'triage',
    prKey: pr.key,
    status: 'running',
    startedAt: new Date().toISOString(),
    streamingOutput: '',
  };

  store.startAgentRun(agentRun);

  try {
    const prompt = buildTriagePrompt(event, pr);

    const stream = query({
      prompt,
      options: {
        model: 'claude-haiku-4-5-20251001',
        systemPrompt: TRIAGE_SYSTEM_PROMPT,
        maxTurns: 3,
        maxBudgetUsd: 0.05,
        persistSession: false,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        tools: [],
        mcpServers: { 'vigil-triage': triageMcpServer },
        outputFormat: {
          type: 'json_schema',
          schema: TRIAGE_OUTPUT_SCHEMA,
        },
      },
    });

    let resultPayload: TriageResult | undefined;

    for await (const message of stream) {
      // Accumulate assistant text for streaming display
      if (message.type === 'assistant') {
        const textBlocks = message.message.content.filter(
          (b: { type: string }): b is TextBlock => b.type === 'text'
        );
        if (textBlocks.length > 0) {
          const text = textBlocks.map((b: TextBlock) => b.text).join('');
          const current = vigilStore.getState().activeAgents.get(runId);
          store.updateAgentRun(runId, {
            streamingOutput: (current?.streamingOutput ?? '') + text,
          });
        }
      }

      // Extract structured output from result
      if (message.type === 'result' && message.subtype === 'success' && message.structured_output) {
        resultPayload = message.structured_output as TriageResult;
      }
    }

    // Fallback: parse from the result text if structured_output wasn't populated
    if (!resultPayload) {
      const currentRun = vigilStore.getState().activeAgents.get(runId);
      const output = currentRun?.streamingOutput ?? '';
      try {
        resultPayload = JSON.parse(output) as TriageResult;
      } catch {
        // If we still can't parse, return a safe default
        resultPayload = {
          classification: 'noise',
          routing: 'dismiss',
          priority: 'informational',
          reasoning: 'Triage agent could not produce a valid classification.',
        };
      }
    }

    store.completeAgentRun(runId, {
      success: true,
      summary: resultPayload.reasoning,
      actions: [],
    });

    return resultPayload;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.updateAgentRun(runId, {
      status: 'failed',
      error: message,
      completedAt: new Date().toISOString(),
    });

    // Return a safe fallback on error so callers always get a result
    return {
      classification: 'noise',
      routing: 'dismiss',
      priority: 'informational',
      reasoning: `Triage failed: ${message}`,
    };
  }
}
