import { describe, expect, test } from 'bun:test';

import { _internal } from './triage.js';

describe('parseTriageResult', () => {
  test('accepts valid triage output', () => {
    expect(
      _internal.parseTriageResult({
        classification: 'blocking',
        routing: 'fix',
        priority: 'immediate',
        reasoning: 'CI is failing on a non-draft PR.',
      })
    ).toEqual({
      classification: 'blocking',
      routing: 'fix',
      priority: 'immediate',
      reasoning: 'CI is failing on a non-draft PR.',
    });
  });

  test('rejects invalid routing values', () => {
    expect(() =>
      _internal.parseTriageResult({
        classification: 'blocking',
        routing: 'invent',
        priority: 'immediate',
        reasoning: 'bad output',
      })
    ).toThrow();
  });
});
