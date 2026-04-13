import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defaultConfig } from '../config/defaults.js';
import { paths } from '../config/xdg.js';
import { loadUiPreferences, saveUiPreferences } from './ui-preferences.js';

let tempDir = '';
let originalDataHome: string | undefined;

beforeEach(() => {
  originalDataHome = process.env.XDG_DATA_HOME;
  tempDir = mkdtempSync(join(tmpdir(), 'vigil-ui-prefs-'));
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
});

describe('ui preferences', () => {
  test('falls back to config defaults when no state file exists', () => {
    expect(loadUiPreferences(defaultConfig)).toEqual({
      viewMode: 'cards',
      sortMode: 'activity',
      dashboardFeedMode: defaultConfig.display.dashboardFeedMode,
    });
  });

  test('round-trips persisted preferences', () => {
    saveUiPreferences({
      viewMode: 'list',
      sortMode: 'state',
      dashboardFeedMode: 'both',
    });

    expect(loadUiPreferences(defaultConfig)).toEqual({
      viewMode: 'list',
      sortMode: 'state',
      dashboardFeedMode: 'both',
    });
  });

  test('ignores invalid persisted state', () => {
    mkdirSync(join(tempDir, 'vigil'), { recursive: true });
    writeFileSync(paths.uiStateFile(), JSON.stringify({ sortMode: 'loud' }));

    expect(loadUiPreferences(defaultConfig)).toEqual({
      viewMode: 'cards',
      sortMode: 'activity',
      dashboardFeedMode: defaultConfig.display.dashboardFeedMode,
    });
  });
});
