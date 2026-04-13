import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { _internal, runInit } from './init.js';
import { paths } from './xdg.js';

const tempDirs: string[] = [];
let originalConfigHome: string | undefined;

async function runGit(args: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(['git', ...args], {
    cwd,
    stdout: 'ignore',
    stderr: 'pipe',
  });
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(stderr || `git ${args.join(' ')} failed`);
  }
}

afterEach(() => {
  if (originalConfigHome === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = originalConfigHome;
  }

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('init helpers', () => {
  test('parseGitHubRemote handles https and ssh remotes', () => {
    expect(_internal.parseGitHubRemote('https://github.com/acme/webapp.git')).toEqual({
      owner: 'acme',
      repo: 'webapp',
    });
    expect(_internal.parseGitHubRemote('git@github.com:acme/webapp.git')).toEqual({
      owner: 'acme',
      repo: 'webapp',
    });
    expect(_internal.parseGitHubRemote('git@example.com:acme/webapp.git')).toBeNull();
  });

  test('upsertWatchAllRadarRepo preserves existing rules while enabling watchAll', () => {
    const result = _internal.upsertWatchAllRadarRepo(
      {
        radar: {
          repos: [
            {
              repo: 'acme/webapp',
              domainRules: [
                {
                  name: 'frontend',
                  pathPatterns: ['src/**'],
                  tier: 'domain',
                },
              ],
            },
          ],
        },
      },
      'acme/webapp'
    );

    expect(result.changed).toBe(true);
    expect(result.overrides.radar?.repos[0]).toEqual({
      repo: 'acme/webapp',
      domainRules: [
        {
          name: 'frontend',
          pathPatterns: ['src/**'],
          tier: 'domain',
        },
      ],
      watchAll: true,
    });
  });
});

describe('runInit', () => {
  test('writes repo config and registers the local repo globally', async () => {
    originalConfigHome = process.env.XDG_CONFIG_HOME;
    const configHome = mkdtempSync(join(tmpdir(), 'vigil-init-config-'));
    const repoDir = mkdtempSync(join(tmpdir(), 'vigil-init-repo-'));
    tempDirs.push(configHome, repoDir);
    process.env.XDG_CONFIG_HOME = configHome;

    await runGit(['init'], repoDir);
    await runGit(['remote', 'add', 'origin', 'git@github.com:acme/webapp.git'], repoDir);

    const result = await runInit({
      cwd: repoDir,
      watchAll: true,
    });

    expect(result.repo).toBe('acme/webapp');
    expect(result.repoConfigWritten).toBe(true);
    expect(result.globalConfigWritten).toBe(true);
    expect(result.localRepoRegistered).toBe(true);
    expect(result.radarRepoAdded).toBe(true);

    const repoConfig = JSON.parse(readFileSync(join(repoDir, '.vigilrc.json'), 'utf-8')) as {
      owner: string;
      repo: string;
      baseBranch: string;
    };
    expect(repoConfig).toEqual({
      owner: 'acme',
      repo: 'webapp',
      baseBranch: 'main',
    });

    const globalConfig = JSON.parse(readFileSync(paths.configFile(), 'utf-8')) as {
      localRepos?: Array<{ repo: string; path: string }>;
      radar?: { repos?: Array<{ repo: string; watchAll?: boolean }> };
    };
    expect(globalConfig.localRepos).toEqual([
      {
        repo: 'acme/webapp',
        path: result.repoDir,
      },
    ]);
    expect(globalConfig.radar?.repos).toEqual([
      {
        repo: 'acme/webapp',
        domainRules: [],
        watchAll: true,
      },
    ]);
  });
});
