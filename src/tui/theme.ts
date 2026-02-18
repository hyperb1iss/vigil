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
  hot: 'Hot',
  waiting: 'Waiting',
  ready: 'Ready',
  dormant: 'Dormant',
  blocked: 'Blocked',
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
  dim: palette.muted,
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

// ─── UI Icons ───────────────────────────────────────────────────────

export const icons = {
  branch: '\u{E0A0}', //  (Powerline branch)
  pr: '\u{2387}', // ⎇  (alternative)
  folder: '\u{1F4C1}', // 📁
  arrow: '\u2192', // →
  dot: '\u2022', // •
} as const;
