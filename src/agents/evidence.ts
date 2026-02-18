/**
 * Evidence agent — gathers verification and regression evidence for PRs.
 *
 * Parses bot comment templates, runs relevant tests when a worktree is
 * available, and synthesizes results into structured evidence sections.
 *
 * Uses Haiku for lightweight, fast inference.
 */

import { createSdkMcpServer, query } from '@anthropic-ai/claude-agent-sdk';
import { getKnowledgeAsContext } from '../learning/knowledge.js';
import { vigilStore } from '../store/index.js';
import type { AgentRun, ProposedAction } from '../types/agents.js';
import type { PrEvent } from '../types/events.js';
import type { PullRequest } from '../types/pr.js';
import { fsTools } from './tools/fs.js';
import { gitTools } from './tools/git.js';
import { githubTools } from './tools/github.js';

interface TextBlock {
  type: 'text';
  text: string;
}

// ─── MCP Server ──────────────────────────────────────────────────────────────

const evidenceMcpServer = createSdkMcpServer({
  name: 'vigil-evidence',
  version: '0.1.0',
  tools: [...githubTools, ...gitTools, ...fsTools],
});

// ─── System Prompt ───────────────────────────────────────────────────────────

const EVIDENCE_SYSTEM_PROMPT = `You are Vigil's evidence agent. Your job is to gather and present verification evidence for pull requests.

Workflow:
1. Read the PR description and existing comments to find evidence/verification sections
2. Identify what tests or checks are relevant to this PR's changes
3. If a worktree is available, run the relevant tests and capture results
4. Synthesize the evidence into a clear, structured format
5. Return the evidence text for posting as a comment update

Evidence format:
### Verification
- [ ] Test X passes: [result]
- [ ] Manual check Y: [result]

### Regression
- [ ] No new test failures
- [ ] Build succeeds
- [ ] Related feature Z still works

Keep evidence factual and concise. Include actual test output snippets when relevant.`;

// ─── Prompt Builder ──────────────────────────────────────────────────────────

function buildEvidencePrompt(
  event: PrEvent,
  pr: PullRequest,
  worktreePath: string | undefined
): string {
  const checksJson =
    pr.checks.length > 0
      ? pr.checks.map(c => `  - ${c.name}: ${c.status} / ${c.conclusion ?? 'pending'}`).join('\n')
      : '  (none)';

  const commentsJson =
    pr.comments.length > 0
      ? pr.comments
          .map(
            c => `  - ${c.author.login}${c.author.isBot ? ' [bot]' : ''}: ${c.body.slice(0, 300)}`
          )
          .join('\n')
      : '  (none)';

  const knowledge = getKnowledgeAsContext();
  const knowledgeBlock = knowledge ? `\n## Knowledge Base\n${knowledge}` : '';

  return `Gather verification and regression evidence for this PR.

## Event
- Type: ${event.type}
- Timestamp: ${event.timestamp}

## PR: ${pr.key}
- Title: ${pr.title}
- Body: ${pr.body.slice(0, 1000)}
- State: ${pr.state}
- Branch: ${pr.headRefName} -> ${pr.baseRefName}
- Changes: +${pr.additions} -${pr.deletions} (${pr.changedFiles} files)
- Repository: ${pr.repository.nameWithOwner}

## Checks
${checksJson}

## Existing Comments
${commentsJson}

## Worktree
${worktreePath ? `Available at: ${worktreePath}` : 'Not available — use GitHub API only.'}
${knowledgeBlock}

Gather evidence and return the formatted verification + regression sections.`;
}

// ─── Agent Runner ────────────────────────────────────────────────────────────

export async function runEvidenceAgent(
  event: PrEvent,
  pr: PullRequest,
  worktreePath: string | undefined
): Promise<ProposedAction> {
  const store = vigilStore.getState();
  const runId = crypto.randomUUID();

  const agentRun: AgentRun = {
    id: runId,
    agent: 'evidence',
    prKey: pr.key,
    status: 'running',
    startedAt: new Date().toISOString(),
    streamingOutput: '',
  };

  store.startAgentRun(agentRun);

  try {
    const prompt = buildEvidencePrompt(event, pr, worktreePath);

    const stream = query({
      prompt,
      options: {
        model: 'claude-haiku-4-5-20251001',
        systemPrompt: EVIDENCE_SYSTEM_PROMPT,
        ...(worktreePath ? { cwd: worktreePath } : {}),
        maxTurns: 10,
        maxBudgetUsd: 0.1,
        persistSession: false,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        tools: [],
        mcpServers: { 'vigil-evidence': evidenceMcpServer },
      },
    });

    let evidenceText = '';

    for await (const message of stream) {
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

      if (message.type === 'result' && message.subtype === 'success') {
        evidenceText = message.result;
      }
    }

    // Fallback to accumulated streaming output if result was empty
    if (!evidenceText) {
      const currentRun = vigilStore.getState().activeAgents.get(runId);
      evidenceText = currentRun?.streamingOutput ?? '';
    }

    const action: ProposedAction = {
      id: crypto.randomUUID(),
      type: 'edit_comment',
      prKey: pr.key,
      agent: 'evidence',
      description: 'Update PR comment with verification and regression evidence.',
      detail: evidenceText,
      requiresConfirmation: false,
      status: 'approved',
    };

    store.completeAgentRun(runId, {
      success: true,
      summary: 'Evidence gathered successfully.',
      actions: [action],
    });

    return action;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.updateAgentRun(runId, {
      status: 'failed',
      error: message,
      completedAt: new Date().toISOString(),
    });

    return {
      id: crypto.randomUUID(),
      type: 'post_comment',
      prKey: pr.key,
      agent: 'evidence',
      description: `Evidence gathering failed: ${message}`,
      requiresConfirmation: false,
      status: 'failed',
    };
  }
}
