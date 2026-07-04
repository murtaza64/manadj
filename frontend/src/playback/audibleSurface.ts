/**
 * Audible-surface arbiter (ADR 0013): the owner of "one audible surface /
 * one running audio clock" (mix-editor issue 08's invariant, previously
 * enforced by scattered view effects).
 *
 * A surface registers { transport, silence, wake } and audibility is a
 * single-holder state machine with 'shared' (Decks+Mixer) as the permanent
 * default: claim silences the displaced holder and wakes the claimant;
 * release restores the default. Wake resumes a clock, never playback.
 *
 * App-wide inputs (MIDI dispatch) route transport-class gestures through
 * `audibleTransport()` and stay view-blind — hardware mirrors the keyboard
 * of the audible surface; gestures the surface has no handler for are
 * dropped. Module-level on purpose: the MIDI layer lives outside React.
 */
import type { ChannelId } from './mixer';

export type AudibleSurfaceId = 'shared' | 'editor';

/** Transport-class gestures (the ones that can start audio). Absent
 * handlers mean the gesture has no meaning on that surface — dropped. */
export interface SurfaceTransport {
  togglePlay(deck: ChannelId): void;
  cueDown?(deck: ChannelId): void;
  cueUp?(deck: ChannelId): void;
}

export interface AudibleSurface {
  transport: SurfaceTransport;
  /** Go quiet: pause playback AND suspend the surface's audio clock. */
  silence(): void;
  /** Resume the surface's audio clock only — never starts playback. */
  wake(): void;
}

const surfaces = new Map<AudibleSurfaceId, AudibleSurface>();
let holder: AudibleSurfaceId = 'shared';

type Listener = (audible: AudibleSurfaceId) => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const fn of listeners) fn(holder);
}

/** Make a surface known. Registering is not claiming — the default holder
 * ('shared') is audible until someone claims. Re-register overwrites (the
 * handle's closures go stale on remount otherwise). */
export function registerSurface(id: AudibleSurfaceId, surface: AudibleSurface): void {
  surfaces.set(id, surface);
}

/** Forget a surface. The holder implicitly releases first. */
export function unregisterSurface(id: AudibleSurfaceId): void {
  if (holder === id && id !== 'shared') releaseAudible(id);
  surfaces.delete(id);
}

/** Become the audible surface: silences the current holder, wakes the
 * claimant. Idempotent for the holder. Claim-over-claim (neither party is
 * 'shared') is last-wins — unreachable with two surfaces; a third surface
 * re-grills this (ADR 0013). */
export function claimAudible(id: AudibleSurfaceId): void {
  if (holder === id) return;
  const claimant = surfaces.get(id);
  if (!claimant) {
    console.warn(`[audibleSurface] claim by unregistered surface '${id}' ignored`);
    return;
  }
  if (holder !== 'shared') {
    console.warn(`[audibleSurface] '${id}' displaces '${holder}' (last claim wins)`);
  }
  surfaces.get(holder)?.silence();
  holder = id;
  claimant.wake();
  notify();
}

/** Give audibility back to the default. Only the holder may release. */
export function releaseAudible(id: AudibleSurfaceId): void {
  if (id === 'shared') return; // the default never releases
  if (holder !== id) {
    console.warn(`[audibleSurface] release by non-holder '${id}' ignored (holder: '${holder}')`);
    return;
  }
  surfaces.get(id)?.silence();
  holder = 'shared';
  surfaces.get('shared')?.wake();
  notify();
}

export function isAudible(id: AudibleSurfaceId): boolean {
  return holder === id;
}

/** The audible surface's transport — what app-wide inputs route through.
 * Null when the holder never registered (boot order edge). */
export function audibleTransport(): SurfaceTransport | null {
  return surfaces.get(holder)?.transport ?? null;
}

export function subscribeAudible(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Reset module state (tests only). */
export function _resetAudibleSurfacesForTests(): void {
  surfaces.clear();
  holder = 'shared';
  listeners.clear();
}
