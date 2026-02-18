/**
 * Learning agent — runs post-merge/close to extract patterns from the PR lifecycle.
 * Updates the knowledge base with new patterns and reinforces existing ones.
 */

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { appendPattern, bumpConfidence, getKnowledgeAsContext } from '../learning/knowledge.js';
import { summarizeForLearning } from '../learning/patterns.js';
import { vigilStore } from '../store/index.js';
import type { AgentRun } from '../types/agents.js';
import type { PrEvent } from '../types/events.js';
import type { PullRequest } from '../types/pr.js';

// ─── Knowledge MCP Tools ─────────────────────────────────────────────────────

const knowledgeRead = tool(
  'knowledge_read',
  'Returns the current knowledge base content',
  {},
  async () => {
    const content = getKnowledgeAsContext();
    return {
      content: [{ type: 'text' as const, text: content || '(empty — no patterns yet)' }],
    };
  }
);

const knowledgeAddPattern = tool(
  'knowledge_add_pattern',
  'Appends a new pattern to a section/subsection of the knowledge base',
  {
    section: z.string().describe('Top-level section name (e.g. "Review Patterns")'),
    subsection: z.string().describe('Subsection name (e.g. "Type Annotations")'),
    pattern: z.string().describe('Pattern text including [confidence: X.XX] tag'),
  },
  async (args: { section: string; subsection: string; pattern: string }) => {
    appendPattern(args.section, args.subsection, args.pattern);
    return {
      content: [
        { type: 'text' as const, text: `Added pattern to ${args.section} > ${args.subsection}` },
      ],
    };
  }
);

const knowledgeBumpConfidence = tool(
  'knowledge_bump_confidence',
  'Bumps the confidence score (+0.10, capped at 1.0) on an existing pattern',
  {
    section: z.string().describe('Section containing the pattern (e.g. "CI Patterns")'),
    trigger: z.string().describe('Unique text fragment that identifies the pattern'),
  },
  async (args: { section: string; trigger: string }) => {
    bumpConfidence(args.section, args.trigger);
    return {
      content: [
        { type: 'text' as const, text: `Bumped confidence for pattern matching "${args.trigger}"` },
      ],
    };
  }
);

const knowledgeServer = createSdkMcpServer({
  name: 'vigil-knowledge',
  version: '0.1.0',
  tools: [knowledgeRead, knowledgeAddPattern, knowledgeBumpConfidence],
});

// ─── System Prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Vigil's learning agent. After a PR is merged or closed, you extract patterns and learnings.

Workflow:
1. Read the current knowledge base using knowledge_read
2. Analyze the PR lifecycle:
   - What review feedback was given?
   - How was it resolved? (fix applied, pushed back, deferred)
   - Were there CI failures? What caused them?
   - Was any feedback scope creep?
   - What patterns emerged?
3. For each new insight:
   - If it's a new pattern: use knowledge_add_pattern with section, subsection, and pattern text
   - Include a [confidence: 0.50] tag for new patterns
   - If it confirms an existing pattern: use knowledge_bump_confidence
4. Patterns should be specific and actionable, e.g.:
   - "Reviewer X often requests type annotations on public APIs [confidence: 0.70]"
   - "CI flake: test_auth_flow intermittently fails on Redis timeout [confidence: 0.60]"
   - "Lock file conflicts after dependency updates should be resolved by regeneration [confidence: 0.90]"

Focus on patterns that will help future triage and fix decisions.`;

// ─── Agent Entry Point ───────────────────────────────────────────────────────

/** Collect all events for this PR from the store (if available). */
function collectPrEvents(prKey: string): PrEvent[] {
  // The store doesn't persist events yet — return empty for now.
  // When event storage lands, this will pull the full timeline.
  void prKey;
  return [];
}

/** Build the user prompt describing the PR lifecycle. */
function buildPrompt(event: PrEvent, pr: PullRequest): string {
  const events = collectPrEvents(pr.key);
  const summary = summarizeForLearning(pr, events.length > 0 ? events : [event]);

  return `A PR has been ${pr.state === 'MERGED' ? 'merged' : 'closed'}. Analyze the lifecycle and extract learnings.

${summary}

Review the knowledge base and update it with any new or confirmed patterns.`;
}

/**
 * Run the learning agent for a completed PR.
 * Extracts patterns from the PR lifecycle and updates the knowledge base.
 */
export async function runLearningAgent(event: PrEvent, pr: PullRequest): Promise<void> {
  const store = vigilStore.getState();
  const runId = crypto.randomUUID();

  const agentRun: AgentRun = {
    id: runId,
    agent: 'learning',
    prKey: pr.key,
    status: 'running',
    startedAt: new Date().toISOString(),
    streamingOutput: '',
  };

  store.startAgentRun(agentRun);

  try {
    const prompt = buildPrompt(event, pr);

    const conversation = query({
      prompt,
      options: {
        model: 'claude-haiku-4-5-20251001',
        systemPrompt: SYSTEM_PROMPT,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        persistSession: false,
        maxTurns: 5,
        maxBudgetUsd: 0.05,
        tools: [],
        mcpServers: { 'vigil-knowledge': knowledgeServer },
      },
    });

    let output = '';

    for await (const message of conversation as AsyncIterable<SDKMessage>) {
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'text') {
            output += block.text;
            store.updateAgentRun(runId, { streamingOutput: output });
          }
        }
      }
    }

    store.completeAgentRun(runId, {
      success: true,
      summary: 'Knowledge base updated with patterns from PR lifecycle.',
      actions: [],
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    store.updateAgentRun(runId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      error: errorMessage,
    });
  }
}
