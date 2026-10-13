// REQUEST: show a track in the Library (gh#342 task worklist → subject).
// The Library has no row-reveal; the closest honest gesture is its text
// search set to the track's title. FilterProvider applies the pending
// search; App switches the mode.
export const OPEN_LIBRARY_TRACK_EVENT = 'manadj:open-library-track';

let pendingSearch: string | null = null;

export function requestLibraryTrack(search: string): void {
  pendingSearch = search;
  window.dispatchEvent(new CustomEvent(OPEN_LIBRARY_TRACK_EVENT));
}

/** Take (and clear) the pending search. */
export function takePendingLibrarySearch(): string | null {
  const s = pendingSearch;
  pendingSearch = null;
  return s;
}
