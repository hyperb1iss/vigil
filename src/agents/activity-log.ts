import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { paths } from '../config/xdg.js';
import type { AgentName } from '../types/agents.js';

const DEFAULT_MAX_LOG_BYTES = 5 * 1024 * 1024;
const QUERY_REPEAT_WINDOW_MS = 5 * 60_000;

const queryHistory = new Map<string, { count: number; lastSeenAt: number }>();

function pruneQueryHistory(now = Date.now()): void {
  for (const [key, value] of queryHistory) {
    if (now - value.lastSeenAt > QUERY_REPEAT_WINDOW_MS * 2) {
      queryHistory.delete(key);
    }
  }
}

export interface AgentLogEntry {
  ts: string;
  event: string;
  agent?: AgentName | undefined;
  runId?: string | undefined;
  prKey?: string | undefined;
  data?: Record<string, unknown> | undefined;
}

function nowIso(): string {
  return new Date().toISOString();
}

function sanitizeFilenameTimestamp(input: string): string {
  return input.replaceAll(':', '-').replaceAll('.', '-');
}

function maxLogBytes(): number {
  const raw = Number(process.env.VIGIL_AGENT_LOG_MAX_BYTES);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_MAX_LOG_BYTES;
  return Math.floor(raw);
}

export function getAgentLogPath(): string {
  return process.env.VIGIL_AGENT_LOG_FILE ?? join(paths.data(), 'agent-activity.log');
}

function ensureLogDirectory(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function rotateIfNeeded(path: string): void {
  if (!existsSync(path)) return;
  const limit = maxLogBytes();
  let size = 0;
  try {
    size = statSync(path).size;
  } catch {
    return;
  }
  if (size < limit) return;

  const rotated = `${path}.${sanitizeFilenameTimestamp(nowIso())}`;
  try {
    renameSync(path, rotated);
  } catch {
    // best effort rotation — logging should not crash runtime
  }
}

function writeLine(line: string): void {
  const logPath = getAgentLogPath();
  try {
    ensureLogDirectory(logPath);
    rotateIfNeeded(logPath);
    appendFileSync(logPath, `${line}\n`, 'utf8');
  } catch {
    // best effort logging only
  }
}

function parseLogEntry(line: string): AgentLogEntry | null {
  if (!line.trim()) return null;
  try {
    const parsed = JSON.parse(line) as AgentLogEntry;
    if (!parsed || typeof parsed.event !== 'string' || typeof parsed.ts !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Read the most recent activity log entries from disk (best-effort).
 * Invalid JSON lines are ignored.
 */
export function readAgentActivityTail(limit = 200): AgentLogEntry[] {
  const safeLimit = Math.max(1, Math.floor(limit));
  const logPath = getAgentLogPath();
  if (!existsSync(logPath)) return [];

  try {
    const text = readFileSync(logPath, 'utf8');
    if (!text) return [];

    const lines = text.split('\n');
    const tail = lines.slice(-safeLimit * 2);
    const out: AgentLogEntry[] = [];
    for (let i = tail.length - 1; i >= 0 && out.length < safeLimit; i--) {
      const line = tail[i];
      if (!line) continue;
      const entry = parseLogEntry(line);
      if (entry) {
        out.push(entry);
      }
    }
    return out.reverse();
  } catch {
    return [];
  }
}

export function logAgentActivity(
  event: string,
  options: {
    agent?: AgentName | undefined;
    runId?: string | undefined;
    prKey?: string | undefined;
    data?: Record<string, unknown> | undefined;
  } = {}
): void {
  const entry: AgentLogEntry = {
    ts: nowIso(),
    event,
    ...options,
  };
  writeLine(JSON.stringify(entry));
}

export function fingerprintText(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 12);
}

export interface QueryMark {
  fingerprint: string;
  duplicateCount: number;
  repeatedWithinWindow: boolean;
}

export function markAgentQuery(
  agent: AgentName,
  prKey: string,
  prompt: string,
  runId?: string
): QueryMark {
  const fingerprint = fingerprintText(prompt);
  const key = `${agent}:${prKey}:${fingerprint}`;
  const now = Date.now();
  pruneQueryHistory(now);
  const previous = queryHistory.get(key);
  const repeatedWithinWindow =
    previous !== undefined && now - previous.lastSeenAt <= QUERY_REPEAT_WINDOW_MS;
  const duplicateCount = repeatedWithinWindow ? previous.count + 1 : 0;

  queryHistory.set(key, {
    count: duplicateCount,
    lastSeenAt: now,
  });

  logAgentActivity('agent_query', {
    agent,
    runId,
    prKey,
    data: {
      fingerprint,
      duplicateCount,
      repeatedWithinWindow,
    },
  });

  return { fingerprint, duplicateCount, repeatedWithinWindow };
}
