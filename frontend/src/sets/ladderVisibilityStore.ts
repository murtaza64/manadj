/**
 * Set-timeline (overview ladder) visibility store (sets #161): the
 * ladder is hideable from the Set control bar to reclaim vertical space
 * for the entry list — the same layout-intent idiom as the Performance
 * section toggles (perfSectionsStore, gh#68). Global, persisted; NOT
 * per-Set (hiding the timeline is a working style, not Set state).
 *
 * Visibility is VIEW ONLY: the plan and the Conductor never read it —
 * the ladder is a pure projection, and playback runs identically with
 * it hidden (the playhead rAF lives inside the ladder and simply
 * unmounts with it).
 */
const STORAGE_KEY = 'manadj-set-ladder';

function load(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'hidden';
  } catch {
    return true;
  }
}

let shown = load();
const listeners = new Set<() => void>();

export function subscribeLadderShown(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isLadderShown(): boolean {
  return shown;
}

export function toggleLadderShown(): void {
  shown = !shown;
  try {
    localStorage.setItem(STORAGE_KEY, shown ? 'shown' : 'hidden');
  } catch {
    // best-effort persistence; the session keeps its setting
  }
  for (const listener of listeners) listener();
}
