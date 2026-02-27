import type { PrState, PullRequest } from '../types/pr.js';
import type { RadarFilter, RadarPr, RelevanceTier } from '../types/radar.js';
import type { SortMode } from '../types/store.js';
import { statePriority } from './pr-row.js';

export type DashboardItemSource = 'mine' | 'incoming' | 'merged';

export interface DashboardItem {
  pr: PullRequest;
  key: string;
  source: DashboardItemSource;
  state: PrState;
  radar?: RadarPr | undefined;
}

function tierToState(tier: RelevanceTier): PrState {
  switch (tier) {
    case 'direct':
      return 'hot';
    case 'domain':
      return 'waiting';
    case 'watch':
      return 'dormant';
  }
}

function toEpoch(iso: string | undefined): number {
  if (!iso) return 0;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sourcePriority(item: DashboardItem): number {
  if (item.source === 'incoming') {
    if (item.radar?.topTier === 'direct') return 0;
    if (item.radar?.topTier === 'domain') return 2;
    return 3;
  }
  if (item.source === 'mine') return 1;
  return 4;
}

function stateRank(item: DashboardItem): number {
  if (item.source === 'incoming') {
    if (item.radar?.topTier === 'direct') return 0;
    if (item.radar?.topTier === 'domain') return 1;
    return 3;
  }
  if (item.source === 'merged') return 6;
  return statePriority(item.state) + 1;
}

function filterByRadar(item: DashboardItem, state: DashboardFeedState): boolean {
  const filter = state.radarFilter;
  if (!filter) return true;
  if (!item.radar) return false;

  if (filter.tier && item.radar.topTier !== filter.tier) return false;
  if (filter.repo && item.pr.repository.nameWithOwner !== filter.repo) return false;
  if (filter.domain) {
    const hasDomainMatch = item.radar.relevance.some(reason => reason.matchedBy === filter.domain);
    if (!hasDomainMatch) return false;
  }

  return true;
}

export interface DashboardFeedState {
  prs: Map<string, PullRequest>;
  prStates: Map<string, PrState>;
  radarPrs: Map<string, RadarPr>;
  mergedRadarPrs: Map<string, RadarPr>;
  dashboardFeedMode: 'mine' | 'incoming' | 'both';
  radarFilter: RadarFilter | null;
  sortMode: SortMode;
}

export function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

export function matchesPr(pr: PullRequest, query: string): boolean {
  if (query.length === 0) return true;
  return (
    fuzzyMatch(query, pr.title) ||
    fuzzyMatch(query, `#${pr.number}`) ||
    fuzzyMatch(query, pr.repository.nameWithOwner) ||
    fuzzyMatch(query, pr.headRefName) ||
    fuzzyMatch(query, pr.author.login)
  );
}

function sortItems(items: DashboardItem[], sortMode: SortMode): DashboardItem[] {
  return items.sort((a, b) => {
    if (sortMode === 'state') {
      const rank = stateRank(a) - stateRank(b);
      if (rank !== 0) return rank;
    } else {
      const pri = sourcePriority(a) - sourcePriority(b);
      if (pri !== 0) return pri;
    }

    const aTs = toEpoch(a.source === 'merged' ? (a.pr.mergedAt ?? a.pr.updatedAt) : a.pr.updatedAt);
    const bTs = toEpoch(b.source === 'merged' ? (b.pr.mergedAt ?? b.pr.updatedAt) : b.pr.updatedAt);
    return bTs - aTs;
  });
}

export function buildDashboardItems(state: DashboardFeedState): DashboardItem[] {
  const items: DashboardItem[] = [];
  const includeMine = state.dashboardFeedMode === 'mine' || state.dashboardFeedMode === 'both';
  const includeIncoming =
    state.dashboardFeedMode === 'incoming' || state.dashboardFeedMode === 'both';

  if (includeMine) {
    for (const pr of state.prs.values()) {
      items.push({
        key: pr.key,
        pr,
        source: 'mine',
        state: state.prStates.get(pr.key) ?? 'dormant',
      });
    }
  }

  if (includeIncoming) {
    for (const radar of state.radarPrs.values()) {
      const item: DashboardItem = {
        key: radar.pr.key,
        pr: radar.pr,
        source: 'incoming',
        state: tierToState(radar.topTier),
        radar,
      };
      if (filterByRadar(item, state)) {
        items.push(item);
      }
    }

    for (const radar of state.mergedRadarPrs.values()) {
      const item: DashboardItem = {
        key: radar.pr.key,
        pr: radar.pr,
        source: 'merged',
        state: 'dormant',
        radar,
      };
      if (filterByRadar(item, state)) {
        items.push(item);
      }
    }
  }

  const sorted = sortItems(items, state.sortMode);
  const deduped: DashboardItem[] = [];
  const seen = new Set<string>();
  for (const item of sorted) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    deduped.push(item);
  }
  return deduped;
}
