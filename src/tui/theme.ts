/**
 * SilkCircuit Neon — Vigil's terminal color system.
 *
 * Electric meets elegant. Every hex, every glyph, every semantic role
 * wired into a single source of truth for the TUI layer.
 */

import type { PrState } from '../types/index.js';

// ─── Palette ────────────────────────────────────────────────────────

export const palette = {
  electricPurple: '#e135ff',
  neonCyan: '#80ffea',
  coral: '#ff6ac1',
  electricYellow: '#f1fa8c',
  successGreen: '#50fa7b',
  errorRed: '#ff6363',
  fg: '#f8f8f2',
  muted: '#8b85a0',
  dimmed: '#5a5475',
  bgHighlight: '#1a162a',
} as const;

// ─── PR State → Color ──────────────────────────────────────────────

export const prStateColors: Record<PrState, string> = {
  hot: palette.errorRed,
  waiting: palette.electricYellow,
  ready: palette.successGreen,
  dormant: palette.muted,
  blocked: palette.electricPurple,
};

// ─── PR State → Indicator ──────────────────────────────────────────

export const stateIndicators: Record<PrState, string> = {
  hot: '\uF06D', //  (nf-fa-fire)
  waiting: '\uF017', //  (nf-fa-clock_o)
  ready: '\uF058', //  (nf-fa-check_circle)
  dormant: '\uF186', //  (nf-fa-moon_o)
  blocked: '\uF05E', //  (nf-fa-ban)
};

// ─── PR State → Label ──────────────────────────────────────────────

export const stateLabels: Record<PrState, string> = {
  hot: 'HOT',
  waiting: 'WAITING',
  ready: 'READY',
  dormant: 'DORMANT',
  blocked: 'BLOCKED',
};

// ─── Semantic Color Map ─────────────────────────────────────────────

export const semantic = {
  branch: palette.neonCyan,
  path: palette.neonCyan,
  hash: palette.coral,
  number: palette.coral,
  timestamp: palette.electricYellow,
  marker: palette.electricPurple,
  keyword: palette.electricPurple,
  success: palette.successGreen,
  confirm: palette.successGreen,
  error: palette.errorRed,
  danger: palette.errorRed,
  warning: palette.electricYellow,
  info: palette.neonCyan,
  muted: palette.muted,
  dim: palette.dimmed,
  fg: palette.fg,
  text: palette.fg,
} as const;

// ─── CI Check Indicators ────────────────────────────────────────────

export const checkIndicators = {
  passing: { symbol: '\uF00C', color: palette.successGreen }, //  (nf-fa-check)
  failing: { symbol: '\uF00D', color: palette.errorRed }, //  (nf-fa-times)
  pending: { symbol: '\uF10C', color: palette.electricYellow }, //  (nf-fa-circle_o)
  skipped: { symbol: '\uF068', color: palette.muted }, //  (nf-fa-minus)
} as const;

// ─── Progress Bar Characters ────────────────────────────────────────

export const progressChars = {
  filled: '\u2588', // █
  medium: '\u2593', // ▓
  light: '\u2591', // ░
  empty: '\u2500', // ─
  blockFilled: '\u25B0', // ▰
  blockEmpty: '\u25B1', // ▱
} as const;

// ─── UI Icons ───────────────────────────────────────────────────────

export const icons = {
  // Git
  branch: '\uE0A0', //  (pl-branch)
  pr: '\uF407', //  (nf-oct-git_pull_request)
  merge: '\uE727', //  (nf-dev-git_merge)

  // Navigation
  arrow: '\uF054', //  (nf-fa-chevron_right)
  arrowLeft: '\uF053', //  (nf-fa-chevron_left)
  arrowUp: '\uF077', //  (nf-fa-chevron_up)
  arrowDown: '\uF078', //  (nf-fa-chevron_down)

  // Punctuation
  dot: '\u2022', // •
  middleDot: '\u00B7', // ·
  ellipsis: '\u2026', // …

  // Status
  bolt: '\uF0E7', //  (nf-fa-bolt)
  check: '\uF00C', //  (nf-fa-check)
  cross: '\uF00D', //  (nf-fa-times)
  conflict: '\uF071', //  (nf-fa-warning)
  shield: '\uF132', //  (nf-fa-shield)

  // Objects
  eye: '\uF06E', //  (nf-fa-eye)
  folder: '\uF07B', //  (nf-fa-folder)
  comment: '\uF075', //  (nf-fa-comment)
  draft: '\uF040', //  (nf-fa-pencil)
  tag: '\uF02B', //  (nf-fa-tag)
  code: '\uF121', //  (nf-fa-code)

  // Actions
  search: '\uF002', //  (nf-fa-search)
  refresh: '\uF021', //  (nf-fa-refresh)
  plus: '+',
  minus: '\u2212', // −

  // Views & modes
  grid: '\uF009', //  (nf-fa-th_large)
  list: '\uF00B', //  (nf-fa-th_list)
  sort: '\uF0DC', //  (nf-fa-sort)
  dashboard: '\uF0E4', //  (nf-fa-tachometer)

  // Agents & activity
  cogs: '\uF085', //  (nf-fa-cogs)
  pulse: '\uF21E', //  (nf-fa-heartbeat)
  rocket: '\uF135', //  (nf-fa-rocket)

  // People & services
  user: '\uF007', //  (nf-fa-user)
  telescope: '\uF519', //  (nf-oct-telescope)

  // Sections
  compass: '\uF14E', //  (nf-fa-compass)
  terminal: '\uF120', //  (nf-fa-terminal)
} as const;

// ─── Divider ────────────────────────────────────────────────────────

export function divider(width: number): string {
  return '\u2500'.repeat(width);
}

// ─── Truncation ─────────────────────────────────────────────────────

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return `${str.slice(0, maxLen - 1)}\u2026`;
}

// ─── Time Formatting ────────────────────────────────────────────────

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
