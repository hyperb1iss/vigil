import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

import { paths } from '../config/xdg.js';

const INITIAL_TEMPLATE = `# Vigil Knowledge

## Review Patterns

## CI Patterns

## Response Templates

## Workflow Patterns
`;

const KNOWLEDGE_LOCK_RETRY_MS = 25;
const KNOWLEDGE_LOCK_TIMEOUT_MS = 2_000;
const KNOWLEDGE_LOCK_STALE_MS = 30_000;

function knowledgeFile(): string {
  return paths.knowledgeFile();
}

function knowledgeLockFile(): string {
  return `${knowledgeFile()}.lock`;
}

function writeKnowledgeUnlocked(content: string): void {
  const file = knowledgeFile();
  mkdirSync(dirname(file), { recursive: true });
  const tempFile = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  writeFileSync(tempFile, content, 'utf-8');
  renameSync(tempFile, file);
}

function ensureKnowledgeFileUnlocked(): void {
  const file = knowledgeFile();
  if (existsSync(file)) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, INITIAL_TEMPLATE, 'utf-8');
}

function isLockBusyError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code === 'EEXIST'
  );
}

function clearStaleKnowledgeLock(lockFile: string): boolean {
  try {
    const ageMs = Date.now() - statSync(lockFile).mtimeMs;
    if (ageMs < KNOWLEDGE_LOCK_STALE_MS) {
      return false;
    }
    rmSync(lockFile, { force: true });
    return true;
  } catch {
    return false;
  }
}

function withKnowledgeLock<T>(fn: () => T): T {
  const file = knowledgeFile();
  const lockFile = knowledgeLockFile();
  mkdirSync(dirname(file), { recursive: true });
  const deadline = Date.now() + KNOWLEDGE_LOCK_TIMEOUT_MS;

  for (;;) {
    let fd: number | null = null;
    try {
      fd = openSync(lockFile, 'wx');
      return fn();
    } catch (error) {
      if (!isLockBusyError(error)) {
        throw error;
      }
      if (clearStaleKnowledgeLock(lockFile)) {
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for knowledge lock at ${lockFile}`, {
          cause: error,
        });
      }
      Bun.sleepSync(KNOWLEDGE_LOCK_RETRY_MS);
    } finally {
      if (fd !== null) {
        closeSync(fd);
        rmSync(lockFile, { force: true });
      }
    }
  }
}

/** Read the entire knowledge file. Returns empty string if it doesn't exist. */
export function readKnowledge(): string {
  const file = knowledgeFile();
  if (!existsSync(file)) return '';
  return readFileSync(file, 'utf-8');
}

/** Read knowledge formatted as agent system prompt context. */
export function getKnowledgeAsContext(): string {
  const content = readKnowledge();
  if (!content) return '';
  return content;
}

/** Overwrite the knowledge file with the given content. */
export function writeKnowledge(content: string): void {
  withKnowledgeLock(() => {
    writeKnowledgeUnlocked(content);
  });
}

/** Create the knowledge file with initial structure if it doesn't already exist. */
export function initKnowledgeFile(): void {
  withKnowledgeLock(() => {
    ensureKnowledgeFileUnlocked();
  });
}

/**
 * Append a bullet-point pattern under the given `## section` / `### subsection`.
 * Creates the section or subsection if they don't exist yet.
 */
export function appendPattern(section: string, subsection: string, pattern: string): void {
  withKnowledgeLock(() => {
    ensureKnowledgeFileUnlocked();
    let content = readKnowledge();

    const sectionHeader = `## ${section}`;
    const subsectionHeader = `### ${subsection}`;

    const sectionIdx = content.indexOf(sectionHeader);

    if (sectionIdx === -1) {
      content = `${content.trimEnd()}\n\n${sectionHeader}\n\n${subsectionHeader}\n\n- ${pattern}\n`;
      writeKnowledgeUnlocked(content);
      return;
    }

    const afterSection = sectionIdx + sectionHeader.length;
    const nextSectionMatch = content.slice(afterSection).search(/\n## /);
    const sectionEnd = nextSectionMatch === -1 ? content.length : afterSection + nextSectionMatch;

    const sectionSlice = content.slice(sectionIdx, sectionEnd);
    const subIdx = sectionSlice.indexOf(subsectionHeader);

    if (subIdx === -1) {
      const insertion = `\n${subsectionHeader}\n\n- ${pattern}\n`;
      content = content.slice(0, sectionEnd) + insertion + content.slice(sectionEnd);
      writeKnowledgeUnlocked(content);
      return;
    }

    const afterSub = subIdx + subsectionHeader.length;
    const nextSubMatch = sectionSlice.slice(afterSub).search(/\n#{2,3} /);
    const subEnd = nextSubMatch === -1 ? sectionEnd : sectionIdx + afterSub + nextSubMatch;

    const insertion = `- ${pattern}\n`;
    const insertAt = content.slice(0, subEnd).trimEnd().length;
    content = `${content.slice(0, insertAt)}\n${insertion}${content.slice(subEnd)}`;
    writeKnowledgeUnlocked(content);
  });
}

/**
 * Find a pattern matching `trigger` text, parse its `[confidence: X.XX]` tag,
 * increment by 0.1 (capped at 1.0), and rewrite.
 */
export function bumpConfidence(section: string, trigger: string): void {
  withKnowledgeLock(() => {
    let content = readKnowledge();
    if (!content) return;

    const sectionHeader = `## ${section}`;
    const sectionIdx = content.indexOf(sectionHeader);
    if (sectionIdx === -1) return;

    const afterSection = sectionIdx + sectionHeader.length;
    const nextSectionMatch = content.slice(afterSection).search(/\n## /);
    const sectionEnd = nextSectionMatch === -1 ? content.length : afterSection + nextSectionMatch;
    const sectionSlice = content.slice(sectionIdx, sectionEnd);

    const confidenceRe = /\[confidence:\s*([\d.]+)\]/;
    const lines = sectionSlice.split('\n');
    let modified = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;
      if (!line.includes(trigger)) continue;

      const match = confidenceRe.exec(line);
      if (!match?.[1]) continue;

      const current = parseFloat(match[1]);
      const bumped = Math.min(1.0, Math.round((current + 0.1) * 100) / 100);
      lines[i] = line.replace(confidenceRe, `[confidence: ${bumped.toFixed(2)}]`);
      modified = true;
      break;
    }

    if (modified) {
      const updatedSection = lines.join('\n');
      content = content.slice(0, sectionIdx) + updatedSection + content.slice(sectionEnd);
      writeKnowledgeUnlocked(content);
    }
  });
}

export const _internal = {
  clearStaleKnowledgeLock,
  isLockBusyError,
  knowledgeLockFile,
  withKnowledgeLock,
};
