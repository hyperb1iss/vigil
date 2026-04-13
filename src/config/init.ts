import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import type { RepoConfig } from '../types/config.js';
import type { RadarRepoConfig } from '../types/radar.js';
import { findGitRepoRoot } from './runtime.js';
import type { GlobalConfigOverrides } from './schema.js';
import { globalConfigOverridesSchema, repoConfigSchema } from './schema.js';
import { paths } from './xdg.js';

const execFileAsync = promisify(execFile);

export interface InitOptions {
  cwd?: string;
  force?: boolean;
  registerLocal?: boolean;
  watchAll?: boolean;
}

export interface InitResult {
  repo: string;
  repoDir: string;
  baseBranch: string;
  repoConfigPath: string;
  repoConfigWritten: boolean;
  globalConfigPath: string;
  globalConfigWritten: boolean;
  localRepoRegistered: boolean;
  radarRepoAdded: boolean;
}

async function runGit(repoDir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd: repoDir });
  return stdout.trim();
}

function parseGitHubRemote(remoteUrl: string): { owner: string; repo: string } | null {
  const normalized = remoteUrl.trim().replace(/\.git$/, '');
  const match =
    /^(?:https?:\/\/github\.com\/|(?:ssh:\/\/)?git@github\.com[:/])([^/]+)\/([^/]+)$/.exec(
      normalized
    );
  if (!match?.[1] || !match[2]) {
    return null;
  }

  return {
    owner: match[1],
    repo: match[2],
  };
}

async function detectBaseBranch(repoDir: string): Promise<string> {
  try {
    const ref = await runGit(repoDir, [
      'symbolic-ref',
      '--quiet',
      '--short',
      'refs/remotes/origin/HEAD',
    ]);
    return ref.startsWith('origin/') ? ref.slice('origin/'.length) : ref;
  } catch {
    return 'main';
  }
}

function readGlobalConfigOverrides(): GlobalConfigOverrides {
  const configPath = paths.configFile();
  if (!existsSync(configPath)) {
    return {};
  }

  const raw = readFileSync(configPath, 'utf-8');
  return globalConfigOverridesSchema.parse(JSON.parse(raw) as unknown);
}

function writeJsonFile(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function upsertLocalRepo(
  overrides: GlobalConfigOverrides,
  repo: string,
  repoDir: string
): { overrides: GlobalConfigOverrides; changed: boolean } {
  const current = overrides.localRepos ?? [];
  const existing = current.find(entry => entry.repo === repo);
  if (existing?.path === repoDir) {
    return { overrides, changed: false };
  }

  const nextLocalRepos = existing
    ? current.map(entry => (entry.repo === repo ? { ...entry, path: repoDir } : entry))
    : [...current, { repo, path: repoDir }];

  return {
    overrides: {
      ...overrides,
      localRepos: nextLocalRepos,
    },
    changed: true,
  };
}

function upsertWatchAllRadarRepo(
  overrides: GlobalConfigOverrides,
  repo: string
): { overrides: GlobalConfigOverrides; changed: boolean } {
  const current = overrides.radar?.repos ?? [];
  const existing = current.find(entry => entry.repo === repo);

  if (existing?.watchAll) {
    return { overrides, changed: false };
  }

  const nextRepo: RadarRepoConfig = existing
    ? { ...existing, watchAll: true }
    : {
        repo,
        domainRules: [],
        watchAll: true,
      };

  return {
    overrides: {
      ...overrides,
      radar: {
        ...overrides.radar,
        repos: existing
          ? current.map(entry => (entry.repo === repo ? nextRepo : entry))
          : [...current, nextRepo],
      },
    },
    changed: true,
  };
}

export async function runInit(options: InitOptions = {}): Promise<InitResult> {
  const repoDir = await findGitRepoRoot(options.cwd ?? process.cwd());
  if (!repoDir) {
    throw new Error('`vigil init` must run inside a git repository.');
  }

  const remoteUrl = await runGit(repoDir, ['remote', 'get-url', 'origin']);
  const remote = parseGitHubRemote(remoteUrl);
  if (!remote) {
    throw new Error(`Could not parse a GitHub owner/repo from origin remote: ${remoteUrl}`);
  }

  const repo = `${remote.owner}/${remote.repo}`;
  const baseBranch = await detectBaseBranch(repoDir);
  const repoConfigPath = join(repoDir, '.vigilrc.json');
  const repoConfig = repoConfigSchema.parse({
    owner: remote.owner,
    repo: remote.repo,
    baseBranch,
  } satisfies RepoConfig);

  let repoConfigWritten = false;
  if (!existsSync(repoConfigPath) || options.force) {
    writeJsonFile(repoConfigPath, repoConfig);
    repoConfigWritten = true;
  }

  let overrides = readGlobalConfigOverrides();
  let globalConfigWritten = false;
  let localRepoRegistered = false;
  let radarRepoAdded = false;

  if (options.registerLocal !== false) {
    const result = upsertLocalRepo(overrides, repo, repoDir);
    overrides = result.overrides;
    localRepoRegistered = result.changed;
    globalConfigWritten ||= result.changed;
  }

  if (options.watchAll) {
    const result = upsertWatchAllRadarRepo(overrides, repo);
    overrides = result.overrides;
    radarRepoAdded = result.changed;
    globalConfigWritten ||= result.changed;
  }

  const globalConfigPath = paths.configFile();
  if (globalConfigWritten) {
    writeJsonFile(globalConfigPath, overrides);
  }

  return {
    repo,
    repoDir,
    baseBranch,
    repoConfigPath,
    repoConfigWritten,
    globalConfigPath,
    globalConfigWritten,
    localRepoRegistered,
    radarRepoAdded,
  };
}

export const _internal = {
  parseGitHubRemote,
  upsertLocalRepo,
  upsertWatchAllRadarRepo,
};
