/**
 * Follow flags store (follow-mode 01/02): the module-level home of "which
 * Decks are being followed". Lives outside React (like routingStore /
 * pairStore) because Follow belongs to the app-wide Decks, not to a view —
 * the FilterBar toggles it and the Library composes with it from either
 * the library view or the Performance view's embedded browse.
 *
 * All writes go through the pure reducer (model.ts: reduceFollow) — manual
 * toggles and the playback bridge dispatch the same events. Flags persist
 * as session state (alongside the loaded-decks key) and restore on boot:
 * nothing plays after boot, so restored paused-following is exactly the
 * sole-playing sticky state the invariant permits.
 */
import { useSyncExternalStore } from 'react';
import { reduceFollow } from './model';
import type { FollowEvent, FollowFlags } from './model';

export type { FollowFlags };

const STORAGE_KEY = 'manadj-follow-flags';

function loadFlags(): FollowFlags {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { A: false, B: false };
    const parsed = JSON.parse(raw) as Partial<Record<'A' | 'B', unknown>>;
    return { A: parsed.A === true, B: parsed.B === true };
  } catch {
    return { A: false, B: false };
  }
}

function saveFlags(flags: FollowFlags): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(flags));
  } catch {
    // persistence is best-effort; the session still follows
  }
}

let flags: FollowFlags = loadFlags();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeFollow(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Stable snapshot for useSyncExternalStore; replaced on every change. */
export function getFollowFlags(): FollowFlags {
  return flags;
}

/** Run an event through the reducer; persist + notify only on change. */
export function dispatchFollow(event: FollowEvent): void {
  const next = reduceFollow(flags, event);
  if (next.A === flags.A && next.B === flags.B) return;
  flags = next;
  saveFlags(next);
  notify();
}

export function useFollowFlags(): FollowFlags {
  return useSyncExternalStore(subscribeFollow, getFollowFlags);
}
