import { z } from 'zod';

const notificationOverridesSchema = z
  .object({
    enabled: z.boolean().optional(),
    onCiFailure: z.boolean().optional(),
    onBlockingReview: z.boolean().optional(),
    onReadyToMerge: z.boolean().optional(),
    onNewComment: z.boolean().optional(),
  })
  .strict();

const agentOverridesSchema = z
  .object({
    model: z.string().min(1).optional(),
    maxAutoFixesPerPr: z.number().int().nonnegative().optional(),
    autoRespondToScopeCreep: z.boolean().optional(),
  })
  .strict();

const learningOverridesSchema = z
  .object({
    enabled: z.boolean().optional(),
    backend: z.enum(['markdown']).optional(),
    captureAfterMerge: z.boolean().optional(),
  })
  .strict();

const displayOverridesSchema = z
  .object({
    dormantThresholdHours: z.number().nonnegative().optional(),
    maxPrsOnDashboard: z.number().int().positive().optional(),
    colorScheme: z.enum(['silkcircuit', 'monochrome']).optional(),
    dashboardFeedMode: z.enum(['mine', 'incoming', 'both']).optional(),
  })
  .strict();

const radarRepoSchema = z
  .object({
    repo: z.string().min(1),
    domainRules: z.array(
      z
        .object({
          name: z.string().min(1),
          pathPatterns: z.array(z.string().min(1)),
          minFiles: z.number().int().positive().optional(),
          tier: z.enum(['direct', 'domain', 'watch']),
        })
        .strict()
    ),
    watchAll: z.boolean().optional(),
    relevantLabels: z.array(z.string().min(1)).optional(),
    watchAuthors: z.array(z.string().min(1)).optional(),
    excludeAuthors: z.array(z.string().min(1)).optional(),
  })
  .strict();

const radarOverridesSchema = z
  .object({
    enabled: z.boolean().optional(),
    repos: z.array(radarRepoSchema).optional(),
    teams: z
      .array(
        z
          .object({
            slug: z.string().min(1),
            name: z.string().min(1),
          })
          .strict()
      )
      .optional(),
    pollIntervalMs: z.number().int().positive().optional(),
    merged: z
      .object({
        limit: z.number().int().positive().optional(),
        maxAgeHours: z.number().nonnegative().optional(),
        domainOnly: z.boolean().optional(),
      })
      .strict()
      .optional(),
    notifications: z
      .object({
        onDirectReviewRequest: z.boolean().optional(),
        onNewDomainPr: z.boolean().optional(),
        onMergedDomainPr: z.boolean().optional(),
      })
      .strict()
      .optional(),
    excludeBotDrafts: z.boolean().optional(),
    excludeOwnPrs: z.boolean().optional(),
    staleCutoffDays: z.number().nonnegative().optional(),
  })
  .strict();

export const globalConfigOverridesSchema = z
  .object({
    pollIntervalMs: z.number().int().positive().optional(),
    defaultMode: z.enum(['hitl', 'yolo']).optional(),
    notifications: notificationOverridesSchema.optional(),
    agent: agentOverridesSchema.optional(),
    learning: learningOverridesSchema.optional(),
    display: displayOverridesSchema.optional(),
    radar: radarOverridesSchema.optional(),
  })
  .strict();

export type GlobalConfigOverrides = z.infer<typeof globalConfigOverridesSchema>;

const botConfigSchema = z
  .object({
    role: z.enum(['code-reviewer', 'pr-template', 'issue-tracker']),
    trustLevel: z.enum(['advisory', 'authoritative']).optional(),
    parseBlocking: z.boolean().optional(),
    parseSuggestions: z.boolean().optional(),
    templates: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const repoConfigSchema = z
  .object({
    owner: z.string().min(1),
    repo: z.string().min(1),
    baseBranch: z.string().min(1),
    titleFormat: z.string().min(1).optional(),
    bots: z.record(z.string(), botConfigSchema).optional(),
    monorepo: z
      .object({
        tool: z.string().min(1),
        packageDirs: z.array(z.string().min(1)),
        buildCommand: z.string().min(1),
        typecheckCommand: z.string().min(1),
        lintCommand: z.string().min(1),
      })
      .strict()
      .optional(),
    reviewPatterns: z
      .array(
        z
          .object({
            trigger: z.string().min(1),
            action: z.enum(['auto-fix', 'respond', 'dismiss']),
            fix: z.string().min(1).optional(),
            template: z.string().min(1).optional(),
            confidence: z.number().min(0).max(1),
          })
          .strict()
      )
      .optional(),
    alwaysConfirm: z.array(z.string().min(1)).optional(),
    worktrees: z
      .object({
        autoDiscover: z.boolean(),
        searchPaths: z.array(z.string().min(1)),
        displayFormat: z.enum(['branch', 'path', 'both']),
      })
      .strict()
      .optional(),
  })
  .strict();

export type RepoConfigFile = z.infer<typeof repoConfigSchema>;

export function formatZodError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) {
    return 'Unknown validation error';
  }

  const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
  return `${path}: ${issue.message}`;
}
