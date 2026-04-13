import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ZodError } from 'zod';

import type { RepoConfig, VigilConfig } from '../types/index.js';
import { defaultConfig } from './defaults.js';
import type { GlobalConfigOverrides } from './schema.js';
import { formatZodError, globalConfigOverridesSchema, repoConfigSchema } from './schema.js';
import { paths } from './xdg.js';

/** Deep-merge user overrides onto defaults (single level of nesting). */
function mergeConfig(base: VigilConfig, overrides: GlobalConfigOverrides): VigilConfig {
  return {
    pollIntervalMs: overrides.pollIntervalMs ?? base.pollIntervalMs,
    defaultMode: overrides.defaultMode ?? base.defaultMode,
    localRepos: overrides.localRepos ?? base.localRepos,
    notifications: mergeNotifications(base, overrides),
    agent: mergeAgentConfig(base, overrides),
    learning: mergeLearningConfig(base, overrides),
    display: mergeDisplayConfig(base, overrides),
    radar: mergeRadarConfig(base, overrides),
  };
}

/** Load global config from XDG config path, merged with defaults. */
export function loadGlobalConfig(): VigilConfig {
  const configPath = paths.configFile();

  if (!existsSync(configPath)) {
    return structuredClone(defaultConfig);
  }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    const overrides = globalConfigOverridesSchema.parse(parsed);
    return mergeConfig(structuredClone(defaultConfig), overrides);
  } catch (error) {
    const formattedReason = formatLoaderError(error);
    console.error(`[vigil] ignoring invalid config at ${configPath}: ${formattedReason}`);
    return structuredClone(defaultConfig);
  }
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
  const jsonPath = join(repoDir, '.vigilrc.json');
  if (existsSync(jsonPath)) {
    try {
      const raw = readFileSync(jsonPath, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      return repoConfigSchema.parse(parsed);
    } catch (error) {
      const formattedReason = formatLoaderError(error);
      console.error(`[vigil] ignoring invalid repo config at ${jsonPath}: ${formattedReason}`);
      return null;
    }
  }

  const rcPath = join(repoDir, '.vigilrc.ts');

  if (existsSync(rcPath)) {
    console.error(
      `[vigil] ignoring ${rcPath}: TypeScript repo config loading is disabled until a trusted loader exists`
    );
  }

  return null;
}

function formatLoaderError(error: unknown): string {
  if (error instanceof ZodError) {
    return formatZodError(error);
  }

  return error instanceof Error ? error.message : String(error);
}

function mergeNotifications(base: VigilConfig, overrides: GlobalConfigOverrides) {
  return {
    enabled: overrides.notifications?.enabled ?? base.notifications.enabled,
    onCiFailure: overrides.notifications?.onCiFailure ?? base.notifications.onCiFailure,
    onBlockingReview:
      overrides.notifications?.onBlockingReview ?? base.notifications.onBlockingReview,
    onReadyToMerge: overrides.notifications?.onReadyToMerge ?? base.notifications.onReadyToMerge,
    onNewComment: overrides.notifications?.onNewComment ?? base.notifications.onNewComment,
  };
}

function mergeAgentConfig(base: VigilConfig, overrides: GlobalConfigOverrides) {
  return {
    model: overrides.agent?.model ?? base.agent.model,
    maxAutoFixesPerPr: overrides.agent?.maxAutoFixesPerPr ?? base.agent.maxAutoFixesPerPr,
    autoRespondToScopeCreep:
      overrides.agent?.autoRespondToScopeCreep ?? base.agent.autoRespondToScopeCreep,
  };
}

function mergeLearningConfig(base: VigilConfig, overrides: GlobalConfigOverrides) {
  return {
    enabled: overrides.learning?.enabled ?? base.learning.enabled,
    backend: overrides.learning?.backend ?? base.learning.backend,
    captureAfterMerge: overrides.learning?.captureAfterMerge ?? base.learning.captureAfterMerge,
  };
}

function mergeDisplayConfig(base: VigilConfig, overrides: GlobalConfigOverrides) {
  return {
    dormantThresholdHours:
      overrides.display?.dormantThresholdHours ?? base.display.dormantThresholdHours,
    maxPrsOnDashboard: overrides.display?.maxPrsOnDashboard ?? base.display.maxPrsOnDashboard,
    colorScheme: overrides.display?.colorScheme ?? base.display.colorScheme,
    dashboardFeedMode: overrides.display?.dashboardFeedMode ?? base.display.dashboardFeedMode,
  };
}

function mergeRadarConfig(base: VigilConfig, overrides: GlobalConfigOverrides) {
  return {
    enabled: overrides.radar?.enabled ?? base.radar.enabled,
    repos: overrides.radar?.repos ?? base.radar.repos,
    teams: overrides.radar?.teams ?? base.radar.teams,
    pollIntervalMs: overrides.radar?.pollIntervalMs ?? base.radar.pollIntervalMs,
    merged: {
      limit: overrides.radar?.merged?.limit ?? base.radar.merged.limit,
      maxAgeHours: overrides.radar?.merged?.maxAgeHours ?? base.radar.merged.maxAgeHours,
      domainOnly: overrides.radar?.merged?.domainOnly ?? base.radar.merged.domainOnly,
    },
    notifications: {
      onDirectReviewRequest:
        overrides.radar?.notifications?.onDirectReviewRequest ??
        base.radar.notifications.onDirectReviewRequest,
      onNewDomainPr:
        overrides.radar?.notifications?.onNewDomainPr ?? base.radar.notifications.onNewDomainPr,
      onMergedDomainPr:
        overrides.radar?.notifications?.onMergedDomainPr ??
        base.radar.notifications.onMergedDomainPr,
    },
    excludeBotDrafts: overrides.radar?.excludeBotDrafts ?? base.radar.excludeBotDrafts,
    excludeOwnPrs: overrides.radar?.excludeOwnPrs ?? base.radar.excludeOwnPrs,
    staleCutoffDays: overrides.radar?.staleCutoffDays ?? base.radar.staleCutoffDays,
  };
}
