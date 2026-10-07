/** Live-only Played state. Restart, silence split, or Clear played resets it. */
import { useSyncExternalStore } from 'react';
import type { CaptureEvent } from '../capture/events';
import { AudibleSecondsFold, playedTrackIds } from './playedTracks';

const EMPTY: ReadonlySet<number> = new Set();
let liveFold = new AudibleSecondsFold();
let snapshot: ReadonlySet<number> = EMPTY;
const listeners = new Set<() => void>();

function publish(next: ReadonlySet<number>): void {
  if (next.size === snapshot.size && [...next].every((id) => snapshot.has(id))) return;
  snapshot = next;
  for (const fn of listeners) fn();
}

export function notePlayedEvent(e: CaptureEvent): void {
  if (liveFold.note(e).length > 0) publish(playedTrackIds(liveFold.seconds));
}

/** Recorder restart / Session boundary: the recorder re-seeds deck state. */
export function resetPlayed(): void {
  liveFold = new AudibleSecondsFold();
  publish(EMPTY);
}

/** Manual reset keeps transport/mixer state and starts a new audible tally now. */
export function clearPlayed(t: number = performance.now() / 1000): void {
  liveFold.clear(t);
  publish(EMPTY);
}

export function playedTracks(): ReadonlySet<number> {
  return snapshot;
}

export function subscribePlayed(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function usePlayedTracks(): ReadonlySet<number> {
  return useSyncExternalStore(subscribePlayed, playedTracks);
}
