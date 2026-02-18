import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RepoConfig, VigilConfig } from '../types/index.js';
import { defaultConfig } from './defaults.js';
import { paths } from './xdg.js';

/** Deep-merge user overrides onto defaults (single level of nesting). */
function mergeConfig(base: VigilConfig, overrides: Partial<VigilConfig>): VigilConfig {
  return {
    pollIntervalMs: overrides.pollIntervalMs ?? base.pollIntervalMs,
    defaultMode: overrides.defaultMode ?? base.defaultMode,
    notifications: { ...base.notifications, ...overrides.notifications },
    agent: { ...base.agent, ...overrides.agent },
    learning: { ...base.learning, ...overrides.learning },
    display: { ...base.display, ...overrides.display },
  };
}

/** Load global config from XDG config path, merged with defaults. */
export function loadGlobalConfig(): VigilConfig {
  const configPath = paths.configFile();

  if (!existsSync(configPath)) {
    return { ...defaultConfig };
  }

  const raw = readFileSync(configPath, 'utf-8');
  const overrides = JSON.parse(raw) as Partial<VigilConfig>;
  return mergeConfig(defaultConfig, overrides);
}

/** Ensure all XDG directories exist. */
export function ensureDirectories(): void {
  mkdirSync(paths.config(), { recursive: true });
  mkdirSync(paths.data(), { recursive: true });
  mkdirSync(paths.cache(), { recursive: true });
  mkdirSync(paths.snapshotDir(), { recursive: true });
}

/** Load per-repo config from `.vigilrc.ts` if it exists. */
export async function loadRepoConfig(repoDir: string): Promise<RepoConfig | null> {
  const rcPath = join(repoDir, '.vigilrc.ts');

  if (!existsSync(rcPath)) {
    return null;
  }

  const mod = (await import(rcPath)) as { default?: RepoConfig };
  return mod.default ?? null;
}
