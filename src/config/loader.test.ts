import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defaultConfig } from './defaults.js';
import { loadGlobalConfig, loadRepoConfig } from './loader.js';

let tempDir = '';
let originalConfigHome: string | undefined;

beforeEach(() => {
  originalConfigHome = process.env.XDG_CONFIG_HOME;
  tempDir = mkdtempSync(join(tmpdir(), 'vigil-loader-'));
  process.env.XDG_CONFIG_HOME = tempDir;
});

afterEach(() => {
  if (originalConfigHome === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = originalConfigHome;
  }

  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }

  mock.restore();
});

describe('loadGlobalConfig', () => {
  test('returns an isolated deep clone when no config file exists', () => {
    const first = loadGlobalConfig();
    first.radar.pollIntervalMs = 1234;
    first.notifications.onCiFailure = false;

    const second = loadGlobalConfig();
    expect(second.radar.pollIntervalMs).toBe(defaultConfig.radar.pollIntervalMs);
    expect(second.notifications.onCiFailure).toBe(defaultConfig.notifications.onCiFailure);
  });

  test('warns and falls back to defaults for invalid config shape', () => {
    const configDir = join(tempDir, 'vigil');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({ notifications: 'loud' }));

    const errorSpy = mock(() => undefined);
    console.error = errorSpy;

    const config = loadGlobalConfig();
    expect(config).toEqual(defaultConfig);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  test('parses configured local repo directories', () => {
    const configDir = join(tempDir, 'vigil');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({
        localRepos: [
          {
            repo: 'acme/webapp',
            path: '~/dev/webapp',
          },
        ],
      })
    );

    const config = loadGlobalConfig();
    expect(config.localRepos).toEqual([
      {
        repo: 'acme/webapp',
        path: '~/dev/webapp',
      },
    ]);
  });
});

describe('loadRepoConfig', () => {
  test('loads valid json repo config', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'vigil-repo-'));
    try {
      writeFileSync(
        join(repoDir, '.vigilrc.json'),
        JSON.stringify({
          owner: 'acme',
          repo: 'webapp',
          baseBranch: 'main',
          alwaysConfirm: ['merge'],
        })
      );

      const config = await loadRepoConfig(repoDir);
      expect(config?.owner).toBe('acme');
      expect(config?.alwaysConfirm).toEqual(['merge']);
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test('rejects unsupported alwaysConfirm action types', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'vigil-repo-invalid-'));
    try {
      writeFileSync(
        join(repoDir, '.vigilrc.json'),
        JSON.stringify({
          owner: 'acme',
          repo: 'webapp',
          baseBranch: 'main',
          alwaysConfirm: ['push_commit'],
        })
      );

      const errorSpy = mock(() => undefined);
      console.error = errorSpy;

      const config = await loadRepoConfig(repoDir);
      expect(config).toBeNull();
      expect(errorSpy).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test('ignores TypeScript repo config files', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'vigil-repo-ts-'));
    try {
      writeFileSync(
        join(repoDir, '.vigilrc.ts'),
        'export default { owner: "acme", repo: "webapp", baseBranch: "main" };'
      );

      const errorSpy = mock(() => undefined);
      console.error = errorSpy;

      const config = await loadRepoConfig(repoDir);
      expect(config).toBeNull();
      expect(errorSpy).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });
});
