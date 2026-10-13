/**
 * Per-playlist filter enablement (playlist-editing 09): a playlist is a
 * curated order, so the GLOBAL filter params (FilterContext) apply to it
 * only while its own toggle is on — off by default. Only the ENABLEMENT
 * is per-playlist; the params stay one global set. Module-level (like
 * followStore) so every Library instance shares it, persisted so the
 * choice survives restarts.
 */
import { useSyncExternalStore } from 'react';
import { writeSetting } from '../settings/persistedSettings';

const STORAGE_KEY = 'manadj-playlist-filter-enabled';

function load(): ReadonlySet<number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is number => typeof id === 'number'));
  } catch {
    return new Set();
  }
}

function save(ids: ReadonlySet<number>): void {
  // Write-through (settings #176): DB + localStorage cache, best-effort.
  writeSetting(STORAGE_KEY, JSON.stringify([...ids]));
}

let enabledIds: ReadonlySet<number> = load();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribePlaylistFilter(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isPlaylistFilterEnabled(playlistId: number): boolean {
  return enabledIds.has(playlistId);
}

export function togglePlaylistFilter(playlistId: number): void {
  const next = new Set(enabledIds);
  if (next.has(playlistId)) next.delete(playlistId);
  else next.add(playlistId);
  enabledIds = next;
  save(next);
  notify();
}

/** Whether the given playlist filters; null (no playlist) never does. */
export function usePlaylistFilterEnabled(playlistId: number | null): boolean {
  return useSyncExternalStore(
    subscribePlaylistFilter,
    () => playlistId !== null && enabledIds.has(playlistId)
  );
}
