import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { z } from 'zod';

import { paths } from '../config/xdg.js';
import type { VigilConfig } from '../types/config.js';
import type { DashboardFeedMode } from '../types/radar.js';
import type { SortMode, ViewMode } from '../types/store.js';

export interface UiPreferences {
  viewMode: ViewMode;
  sortMode: SortMode;
  dashboardFeedMode: DashboardFeedMode;
}

const uiPreferencesSchema = z
  .object({
    viewMode: z.enum(['cards', 'list']).optional(),
    sortMode: z.enum(['activity', 'state']).optional(),
    dashboardFeedMode: z.enum(['mine', 'incoming', 'both']).optional(),
  })
  .strict();

function defaultUiPreferences(config: VigilConfig): UiPreferences {
  return {
    viewMode: 'cards',
    sortMode: 'activity',
    dashboardFeedMode: config.display.dashboardFeedMode,
  };
}

export function loadUiPreferences(config: VigilConfig): UiPreferences {
  const defaults = defaultUiPreferences(config);
  const file = paths.uiStateFile();
  if (!existsSync(file)) {
    return defaults;
  }

  try {
    const raw = readFileSync(file, 'utf-8');
    const parsed = uiPreferencesSchema.parse(JSON.parse(raw) as unknown);
    return {
      viewMode: parsed.viewMode ?? defaults.viewMode,
      sortMode: parsed.sortMode ?? defaults.sortMode,
      dashboardFeedMode: parsed.dashboardFeedMode ?? defaults.dashboardFeedMode,
    };
  } catch {
    return defaults;
  }
}

export function saveUiPreferences(preferences: UiPreferences): void {
  try {
    const file = paths.uiStateFile();
    mkdirSync(dirname(file), { recursive: true });
    const tempFile = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    writeFileSync(tempFile, JSON.stringify(preferences, null, 2), 'utf-8');
    renameSync(tempFile, file);
  } catch {
    // UI preference persistence is best-effort.
  }
}
