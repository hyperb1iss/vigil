import { afterEach, describe, expect, test } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { paths, xdgCache, xdgConfig, xdgData } from './xdg.js';

// Save original env values so we can restore after each test
const origConfig = process.env.XDG_CONFIG_HOME;
const origData = process.env.XDG_DATA_HOME;
const origCache = process.env.XDG_CACHE_HOME;

afterEach(() => {
  // Restore original env
  if (origConfig !== undefined) process.env.XDG_CONFIG_HOME = origConfig;
  else delete process.env.XDG_CONFIG_HOME;
  if (origData !== undefined) process.env.XDG_DATA_HOME = origData;
  else delete process.env.XDG_DATA_HOME;
  if (origCache !== undefined) process.env.XDG_CACHE_HOME = origCache;
  else delete process.env.XDG_CACHE_HOME;
});

// ─── XDG Base Directories ──────────────────────────────────────────────

describe('xdgConfig', () => {
  test('uses XDG_CONFIG_HOME when set', () => {
    process.env.XDG_CONFIG_HOME = '/custom/config';
    expect(xdgConfig()).toBe('/custom/config');
  });

  test('falls back to ~/.config when not set', () => {
    delete process.env.XDG_CONFIG_HOME;
    expect(xdgConfig()).toBe(join(homedir(), '.config'));
  });
});

describe('xdgData', () => {
  test('uses XDG_DATA_HOME when set', () => {
    process.env.XDG_DATA_HOME = '/custom/data';
    expect(xdgData()).toBe('/custom/data');
  });

  test('falls back to ~/.local/share when not set', () => {
    delete process.env.XDG_DATA_HOME;
    expect(xdgData()).toBe(join(homedir(), '.local', 'share'));
  });
});

describe('xdgCache', () => {
  test('uses XDG_CACHE_HOME when set', () => {
    process.env.XDG_CACHE_HOME = '/custom/cache';
    expect(xdgCache()).toBe('/custom/cache');
  });

  test('falls back to ~/.cache when not set', () => {
    delete process.env.XDG_CACHE_HOME;
    expect(xdgCache()).toBe(join(homedir(), '.cache'));
  });
});

// ─── Vigil-Specific Paths ──────────────────────────────────────────────

describe('paths', () => {
  test('config() returns vigil config directory', () => {
    process.env.XDG_CONFIG_HOME = '/xdg';
    expect(paths.config()).toBe('/xdg/vigil');
  });

  test('configFile() returns config.json path', () => {
    process.env.XDG_CONFIG_HOME = '/xdg';
    expect(paths.configFile()).toBe('/xdg/vigil/config.json');
  });

  test('data() returns vigil data directory', () => {
    process.env.XDG_DATA_HOME = '/xdg';
    expect(paths.data()).toBe('/xdg/vigil');
  });

  test('knowledgeFile() returns knowledge.md path', () => {
    process.env.XDG_DATA_HOME = '/xdg';
    expect(paths.knowledgeFile()).toBe('/xdg/vigil/knowledge.md');
  });

  test('cache() returns vigil cache directory', () => {
    process.env.XDG_CACHE_HOME = '/xdg';
    expect(paths.cache()).toBe('/xdg/vigil');
  });

  test('snapshotDir() returns snapshots subdirectory', () => {
    process.env.XDG_CACHE_HOME = '/xdg';
    expect(paths.snapshotDir()).toBe('/xdg/vigil/snapshots');
  });
});
