/**
 * Follow flags store (follow-mode 01): the module-level home of "which
 * Decks are being followed". Lives outside React (like routingStore /
 * pairStore) because Follow belongs to the app-wide Decks, not to a view —
 * the FilterBar toggles it and the Library composes with it from either
 * the library view or the Performance view's embedded browse.
 *
 * Deliberately dumb in this slice: manual set only. The playback rules
 * (spread-on-play, drop-on-pause-unless-sole, sticky expiry) arrive as a
 * reducer dispatching into this store in follow-mode 02, along with
 * session-state persistence.
 */
import { useSyncExternalStore } from 'react';
import type { ChannelId } from '../playback/mixer';

export type FollowFlags = Readonly<Record<ChannelId, boolean>>;

let flags: FollowFlags = { A: false, B: false };
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

export function setDeckFollow(deck: ChannelId, on: boolean): void {
  if (flags[deck] === on) return;
  flags = { ...flags, [deck]: on };
  notify();
}

export function useFollowFlags(): FollowFlags {
  return useSyncExternalStore(subscribeFollow, getFollowFlags);
}
