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
  hot: '\u{1F534}', // 🔴
  waiting: '\u{1F7E1}', // 🟡
  ready: '\u{1F7E2}', // 🟢
  dormant: '\u26AB', // ⚫
  blocked: '\u{1F7E3}', // 🟣
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
  passing: { symbol: '\u2714', color: palette.successGreen }, // ✔
  failing: { symbol: '\u2718', color: palette.errorRed }, // ✘
  pending: { symbol: '\u25CF', color: palette.electricYellow }, // ●
  skipped: { symbol: '\u2500', color: palette.muted }, // ─
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
  branch: '\uE0A0', //  (Powerline branch)
  pr: '\u2387', // ⎇
  folder: '\uF07B', //
  arrow: '\u2192', // →
  arrowLeft: '\u2190', // ←
  dot: '\u2022', // •
  middleDot: '\u00B7', // ·
  ellipsis: '\u2026', // …
  bolt: '\u26A1', // ⚡
  eye: '\uF06E', //
  refresh: '\u21BB', // ↻
  check: '\u2714', // ✔
  cross: '\u2718', // ✘
  merge: '\uE727', //
  draft: '\uF040', //
  conflict: '\u26A0', // ⚠
  comment: '\uF075', //
  plus: '+',
  minus: '\u2212', // −
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
