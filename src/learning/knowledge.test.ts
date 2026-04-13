import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { paths } from '../config/xdg.js';
import { _internal, appendPattern } from './knowledge.js';

let tempDir = '';
let originalDataHome: string | undefined;

beforeEach(() => {
  originalDataHome = process.env.XDG_DATA_HOME;
  tempDir = mkdtempSync(join(tmpdir(), 'vigil-knowledge-'));
  process.env.XDG_DATA_HOME = tempDir;
});

afterEach(() => {
  if (originalDataHome === undefined) {
    delete process.env.XDG_DATA_HOME;
  } else {
    process.env.XDG_DATA_HOME = originalDataHome;
  }

  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }

  mock.restore();
});

describe('knowledge locking', () => {
  test('withKnowledgeLock releases the lock file after the callback', () => {
    const lockFile = _internal.knowledgeLockFile();

    _internal.withKnowledgeLock(() => {
      expect(existsSync(lockFile)).toBe(true);
    });

    expect(existsSync(lockFile)).toBe(false);
  });

  test('appendPattern clears a stale lock before updating knowledge', () => {
    const lockFile = _internal.knowledgeLockFile();
    mkdirSync(dirname(lockFile), { recursive: true });
    writeFileSync(lockFile, 'stale');
    const staleSeconds = (Date.now() - 60_000) / 1000;
    utimesSync(lockFile, staleSeconds, staleSeconds);

    appendPattern('Review Patterns', 'Type Safety', 'Prefer explicit types [confidence: 0.50]');

    const content = readFileSync(paths.knowledgeFile(), 'utf-8');
    expect(content).toContain('## Review Patterns');
    expect(content).toContain('### Type Safety');
    expect(content).toContain('Prefer explicit types [confidence: 0.50]');
    expect(existsSync(lockFile)).toBe(false);
  });
});
