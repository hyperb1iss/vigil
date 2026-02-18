import { homedir } from 'node:os';
import { join } from 'node:path';

function env(key: string): string | undefined {
  return process.env[key];
}

export function xdgConfig(): string {
  return env('XDG_CONFIG_HOME') ?? join(homedir(), '.config');
}

export function xdgData(): string {
  return env('XDG_DATA_HOME') ?? join(homedir(), '.local', 'share');
}

export function xdgCache(): string {
  return env('XDG_CACHE_HOME') ?? join(homedir(), '.cache');
}

export const paths = {
  config: () => join(xdgConfig(), 'vigil'),
  configFile: () => join(xdgConfig(), 'vigil', 'config.json'),
  data: () => join(xdgData(), 'vigil'),
  knowledgeFile: () => join(xdgData(), 'vigil', 'knowledge.md'),
  cache: () => join(xdgCache(), 'vigil'),
  snapshotDir: () => join(xdgCache(), 'vigil', 'snapshots'),
} as const;
