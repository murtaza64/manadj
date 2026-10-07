// Sort + text filter shared by the Acquisition tables (gh#342): Source Items
// (SoundCloud likes) and Spotify feed rows present the same columns.
import { useMemo, useState } from 'react';

export type SortKey = 'added' | 'title' | 'artist' | 'length' | 'status';
export type SortDir = 'asc' | 'desc';

export interface SortState {
  key: SortKey;
  dir: SortDir;
}

export const DEFAULT_SORT: SortState = { key: 'added', dir: 'desc' };

/** A row of either table, projected onto the sortable columns. */
export interface Sortable {
  title: string;
  artist: string;
  durationMs: number;
  /** ISO timestamp of like/add; null sorts last */
  addedAt: string | null;
  /** lifecycle rank: lower = needs attention sooner */
  statusRank: number;
}

export function useSortFilter() {
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [filter, setFilter] = useState('');
  const toggleSort = (key: SortKey) =>
    setSort(s => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'added' ? 'desc' : 'asc' }));
  return { sort, setSort, toggleSort, filter, setFilter };
}

function norm(s: string) {
  return s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

/** Every whitespace-separated term must appear in title or artist. */
export function matchesFilter(row: Sortable, filter: string): boolean {
  const terms = norm(filter).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const hay = norm(`${row.artist} ${row.title}`);
  return terms.every(t => hay.includes(t));
}

export function compareRows(a: Sortable, b: Sortable, sort: SortState): number {
  const dir = sort.dir === 'asc' ? 1 : -1;
  switch (sort.key) {
    case 'title':
      return dir * a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    case 'artist':
      return dir * (a.artist.localeCompare(b.artist, undefined, { sensitivity: 'base' }) || a.title.localeCompare(b.title));
    case 'length':
      return dir * (a.durationMs - b.durationMs);
    case 'status':
      return dir * (a.statusRank - b.statusRank) || (b.addedAt ?? '').localeCompare(a.addedAt ?? '');
    case 'added':
    default: {
      if (a.addedAt == null && b.addedAt == null) return 0;
      if (a.addedAt == null) return 1;
      if (b.addedAt == null) return -1;
      return dir * a.addedAt.localeCompare(b.addedAt);
    }
  }
}

export function useSortedFiltered<T>(rows: T[], project: (row: T) => Sortable, sort: SortState, filter: string): T[] {
  return useMemo(() => {
    const projected = rows.map(r => [r, project(r)] as const);
    return projected
      .filter(([, s]) => matchesFilter(s, filter))
      .sort(([, a], [, b]) => compareRows(a, b, sort))
      .map(([r]) => r);
  }, [rows, project, sort, filter]);
}

export function sortGlyph(sort: SortState, key: SortKey): string {
  if (sort.key !== key) return '';
  return sort.dir === 'asc' ? ' ▴' : ' ▾';
}

/** The server-side sort for a Spotify feed page: `status` has no server
 * meaning (feed rows are mostly wantable), so it falls back to added-desc. */
export function serverSort(sort: SortState): { key: 'feed' | 'added' | 'title' | 'artist' | 'length'; dir: SortDir } {
  if (sort.key === 'status') return { key: 'added', dir: 'desc' };
  return { key: sort.key, dir: sort.dir };
}
