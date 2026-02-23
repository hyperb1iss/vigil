import { describe, expect, test } from 'bun:test';

import type { ProposedAction } from '../types/agents.js';
import { executeAction } from './executor.js';

function makeAction(overrides: Partial<ProposedAction> = {}): ProposedAction {
  return {
    id: 'a1',
    type: 'dismiss',
    prKey: 'owner/repo#1',
    agent: 'triage',
    description: 'Test action',
    requiresConfirmation: false,
    status: 'approved',
    ...overrides,
  };
}

describe('executeAction', () => {
  test('returns a no-op summary for dismiss', async () => {
    const output = await executeAction(makeAction({ type: 'dismiss' }));
    expect(output).toBe('Dismissed.');
  });

  test('returns a no-op summary for apply_fix', async () => {
    const output = await executeAction(makeAction({ type: 'apply_fix' }));
    expect(output).toContain('No-op executor');
  });

  test('throws for unsupported create_worktree', async () => {
    await expect(executeAction(makeAction({ type: 'create_worktree' }))).rejects.toThrow(
      'not implemented'
    );
  });

  test('throws for post_comment without detail text', async () => {
    await expect(executeAction(makeAction({ type: 'post_comment', detail: '' }))).rejects.toThrow(
      'missing detail text'
    );
  });

  test('throws for invalid PR key before network operations', async () => {
    await expect(
      executeAction(makeAction({ type: 'post_comment', prKey: 'bad-key', detail: 'hello' }))
    ).rejects.toThrow('Invalid PR key');
  });
});
