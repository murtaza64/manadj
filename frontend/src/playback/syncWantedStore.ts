/**
 * Remembered SYNC membership (desktop port of Android's #399 persist
 * half): which Decks the performer wants in the Sync Group, across app
 * launches. Android also DEFAULTS every deck to wanted; desktop keeps its
 * own default (none wanted — #399's Port note leaves desktop defaults
 * alone), so the store only ever records deliberate toggles.
 *
 * The SyncGroup owns applying the preference: a wanted Deck joins the
 * group once per loaded Track when it is ready with a BPM; a refused join
 * (out of reach) keeps the preference and retries on the next Track.
 *
 * Module-level like quantizeStore; the SyncGroup is the only writer.
 */
import { writeSetting } from '../settings/persistedSettings';
import { CHANNEL_IDS, type ChannelId } from './mixer';

const STORAGE_KEY = 'manadj-sync-wanted';

function load(): Set<ChannelId> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((d): d is ChannelId => CHANNEL_IDS.includes(d as ChannelId)));
  } catch {
    return new Set();
  }
}

let wanted = load();
const listeners = new Set<() => void>();

export function subscribeSyncWanted(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isSyncWanted(deck: ChannelId): boolean {
  return wanted.has(deck);
}

/** Test reset (module-level singleton; the bufferCache/audibleSurface idiom). */
export function _resetSyncWantedForTests(): void {
  wanted = new Set();
}

export function setSyncWanted(deck: ChannelId, on: boolean): void {
  if (on === wanted.has(deck)) return;
  wanted = new Set(wanted);
  if (on) wanted.add(deck);
  else wanted.delete(deck);
  // Write-through (settings #176): DB + localStorage cache, best-effort.
  writeSetting(STORAGE_KEY, JSON.stringify([...wanted]));
  for (const listener of listeners) listener();
}
