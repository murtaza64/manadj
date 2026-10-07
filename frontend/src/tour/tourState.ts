/**
 * Tour progress + activity stores (feature-tour #282).
 *
 * Progress — which sections' coach marks the user has seen, plus the
 * "skip all tours" flag — persists in the `manadj-tour-state` setting
 * (persistedSettings write-through; key inventoried there), so a reset
 * from Settings or a fresh DB replays everything.
 *
 * Activity — which tour area the user is currently in — is session
 * state: App publishes the mode-level area, Library publishes its
 * sub-view (Sets / Sessions live inside the Library). TourController
 * derives the active section and auto-starts unseen tours.
 */

import { removeSetting, writeSetting } from '../settings/persistedSettings';

export const TOUR_STATE_KEY = 'manadj-tour-state';

export type TourSectionId =
  | 'library'
  | 'performance'
  | 'edit'
  | 'sync'
  | 'sets'
  | 'sessions'
  | 'history';

interface TourProgress {
  seen: Partial<Record<TourSectionId, boolean>>;
  skippedAll: boolean;
}

function readProgress(): TourProgress {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(TOUR_STATE_KEY) ?? '');
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as { seen?: unknown; skippedAll?: unknown };
      return {
        seen: obj.seen && typeof obj.seen === 'object' ? (obj.seen as TourProgress['seen']) : {},
        skippedAll: obj.skippedAll === true,
      };
    }
  } catch {
    // missing/corrupt state means "never toured"
  }
  return { seen: {}, skippedAll: false };
}

let progress: TourProgress = readProgress();

type Listener = () => void;
const listeners = new Set<Listener>();
let version = 0;
function notify() {
  version++;
  for (const fn of listeners) fn();
}

/** Monotonic change counter — the useSyncExternalStore snapshot; consumers
 * read the stores imperatively after a change. */
export function tourVersion(): number {
  return version;
}

export function subscribeTour(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function isSectionSeen(section: TourSectionId): boolean {
  return progress.seen[section] === true;
}

export function allToursSkipped(): boolean {
  return progress.skippedAll;
}

function persist() {
  writeSetting(TOUR_STATE_KEY, JSON.stringify(progress));
  notify();
}

export function markSectionSeen(section: TourSectionId): void {
  if (progress.seen[section] === true) return;
  progress = { ...progress, seen: { ...progress.seen, [section]: true } };
  persist();
}

/** "Skip all tours": nothing auto-fires again; replay from ? still works. */
export function skipAllTours(): void {
  progress = { ...progress, skippedAll: true };
  persist();
}

/** Settings reset (story 7, also the demo hook): forget everything. */
export function resetTourProgress(): void {
  progress = { seen: {}, skippedAll: false };
  removeSetting(TOUR_STATE_KEY);
  notify();
}

// ── Activity: where is the user? ─────────────────────────────────────────

export type TourArea = 'library' | 'performance' | 'edit' | 'sync' | 'history' | 'settings';
/** The Library's inner panes that are tour sections of their own. */
export type LibrarySubview = 'sets' | 'sessions' | null;

let baseArea: TourArea = 'library';
let librarySubview: LibrarySubview = null;

export function setTourArea(area: TourArea): void {
  if (area === baseArea) return;
  baseArea = area;
  notify();
}

export function setLibrarySubview(subview: LibrarySubview): void {
  if (subview === librarySubview) return;
  librarySubview = subview;
  notify();
}

/** The section whose tour should fire for the current screen; null where
 * no tour runs (Settings has none — #324). */
export function activeTourSection(): TourSectionId | null {
  if (baseArea === 'settings') return null;
  if (baseArea === 'library' && librarySubview) return librarySubview;
  return baseArea;
}

// ── Replay requests (TopBar ? menu) ──────────────────────────────────────

let requested: TourSectionId | null = null;

/** Explicit replay: runs even if seen/skipped. Consumed by TourController. */
export function requestTour(section: TourSectionId): void {
  requested = section;
  notify();
}

export function pendingTourRequest(): TourSectionId | null {
  return requested;
}

export function consumeTourRequest(): void {
  requested = null;
}

export function _resetTourStoresForTests(): void {
  progress = readProgress();
  baseArea = 'library';
  librarySubview = null;
  requested = null;
}
