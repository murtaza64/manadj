/**
 * Client-side mirror of the server's track filters (backend
 * crud.get_tracks) for lists the server returns whole. The playlist view
 * (playlist-editing 09) fetches a playlist as its full curated order, so
 * the per-playlist filter toggle thins it HERE, with the same semantics
 * browsing gets server-side. Sort stays out: the playlist keeps its own
 * view-only sort (trackSort.ts).
 */
import type { Track } from '../types';
import type { FilterState } from '../contexts/FilterContext';
import { openKeyToEngineId } from '../utils/keyUtils';

export function trackMatchesFilters(track: Track, filters: FilterState): boolean {
  // Text search: filename, title, or artist (case-insensitive substring).
  if (filters.search) {
    const needle = filters.search.toLowerCase();
    const hit = [track.filename, track.title, track.artist].some(
      (field) => field != null && field.toLowerCase().includes(needle)
    );
    if (!hit) return false;
  }

  // Energy: the full 1–5 range admits null-energy tracks; any narrower
  // range requires a value inside it (server parity).
  if (!(filters.energyMin === 1 && filters.energyMax === 5)) {
    if (track.energy == null) return false;
    if (track.energy < filters.energyMin || track.energy > filters.energyMax) return false;
  }

  // Tags: ANY = at least one selected tag present; ALL = every one.
  if (filters.selectedTagIds.length > 0) {
    const tagIds = new Set(track.tags.map((t) => t.id));
    const present = filters.selectedTagIds.filter((id) => tagIds.has(id));
    const pass =
      filters.tagMatchMode === 'ALL'
        ? present.length === filters.selectedTagIds.length
        : present.length > 0;
    if (!pass) return false;
  }

  // BPM: a window around the center, folded at half/double time; null
  // BPM never passes an active gate (server parity).
  if (filters.bpmCenter !== null) {
    const bpm = track.bpm;
    if (bpm == null) return false;
    const inAnyFold = [filters.bpmCenter, filters.bpmCenter * 2, filters.bpmCenter / 2].some(
      (fold) => {
        const threshold = fold * (filters.bpmThresholdPercent / 100);
        return bpm >= fold - threshold && bpm <= fold + threshold;
      }
    );
    if (!inAnyFold) return false;
  }

  // Keys (ANY match): selected OpenKey ids → Engine ids; a track with no
  // key never passes an active key filter.
  if (filters.selectedKeyCamelotIds.length > 0) {
    if (track.key == null) return false;
    const engineIds = filters.selectedKeyCamelotIds
      .map((openkey) => openKeyToEngineId(openkey))
      .filter((id): id is number => id !== null);
    if (!engineIds.includes(track.key)) return false;
  }

  return true;
}
