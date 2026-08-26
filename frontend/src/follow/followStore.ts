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
import { CHANNEL_IDS } from '../playback/mixer';
import type { ChannelId } from '../playback/mixer';
import { writeSetting } from '../settings/persistedSettings';

export type { FollowFlags };

const STORAGE_KEY = 'manadj-follow-flags';

function loadFlags(): FollowFlags {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { A: false, B: false, C: false, D: false };
    const parsed = JSON.parse(raw) as Partial<Record<ChannelId, unknown>>;
    return {
      A: parsed.A === true,
      B: parsed.B === true,
      C: parsed.C === true,
      D: parsed.D === true,
    };
  } catch {
    return { A: false, B: false, C: false, D: false };
  }
}

function saveFlags(flags: FollowFlags): void {
  // Write-through (settings #176): DB + localStorage cache, best-effort.
  writeSetting(STORAGE_KEY, JSON.stringify(flags));
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
  if (CHANNEL_IDS.every((deck) => next[deck] === flags[deck])) return;
  flags = next;
  saveFlags(next);
  notify();
}

export function useFollowFlags(): FollowFlags {
  return useSyncExternalStore(subscribeFollow, getFollowFlags);
}
