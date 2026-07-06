/**
 * Audible-surface arbiter (ADR 0013, shrunk by ADR 0022): the owner of
 * "one audible surface at a time" — which playback mode's semantics own
 * the shared Decks+Mixer.
 *
 * A surface registers { transport, …gesture classes…, silence } and
 * audibility is a single-holder state machine with 'shared' (plain deck
 * transport) as the permanent default: claim silences (pauses) the
 * displaced holder; release silences the releaser and restores the
 * default. Since ADR 0022 every surface plays through the one shared
 * AudioContext, so there are no clocks to suspend or wake — the old
 * silence-suspends/wake-resumes machinery and the engine-level `mayStart`
 * tripwire are gone (a second clock no longer exists to resurrect).
 *
 * App-wide inputs (MIDI dispatch) route transport-class gestures through
 * `audibleTransport()` and stay view-blind — hardware mirrors the keyboard
 * of the audible surface; gestures the surface has no handler for are
 * dropped. Module-level on purpose: the MIDI layer lives outside React.
 */
import type { ChannelId } from './mixer';

export type AudibleSurfaceId = 'shared' | 'editor' | 'conductor';

/** Transport-class gestures (the ones that can start audio). Absent
 * handlers mean the gesture has no meaning on that surface — dropped. */
export interface SurfaceTransport {
  togglePlay(deck: ChannelId): void;
  cueDown?(deck: ChannelId): void;
  cueUp?(deck: ChannelId): void;
}

/** Pad gesture class (ADR 0019): hot cue down/up/clear. What a press MEANS
 * is the surface's business (the shared surface delegates to the deck
 * behavior; the editor's pads jump the mix / Slide the pair). Release is
 * optional — surfaces whose pad gestures are taps simply omit it. */
export interface SurfacePads {
  hotCueDown(deck: ChannelId, pad: number): void;
  hotCueUp?(deck: ChannelId, pad: number): void;
  hotCueClear(deck: ChannelId, pad: number): void;
}

/** Jump gesture class (ADR 0019): beatjump. The shared surface jumps the
 * deck by its size; the editor jumps the mix by A's beats (A) or Slides B
 * by its own beats (B). Beatjump-size is deliberately NOT here — it
 * mutates the shared per-deck size and stays registry-direct. */
export interface SurfaceJumps {
  beatjump(deck: ChannelId, direction: 'back' | 'forward'): void;
}

/** Loop gesture class (ADR 0019, looping 03, midi-performance-ops 02/03):
 * auto-loop engage/release, LOOP-pad presets, and running-loop resize.
 * Registered by the shared surface (Performance and library views); the
 * editor does not register it — loop gestures there are dropped like any
 * unregistered class. */
export interface SurfaceLoops {
  toggleLoop(deck: ChannelId): void;
  /** LOOP pad press carrying the pad's preset size in beats: no loop →
   * engage at the playhead; same size → release; different → resize. */
  loopPreset(deck: ChannelId, beats: number): void;
  /** Resize the RUNNING loop; returns false (nothing consumed) when no
   * loop is active, letting the SHIFT+IN/OUT overload fall back to its
   * idle beatjump-size meaning (midi-performance-ops 03). */
  resizeActiveLoop(deck: ChannelId, change: 'halve' | 'double'): boolean;
}

/** Jog gesture class (ADR 0019): the wheel's three tick streams. The
 * shared surface delegates to the deck jog controller (bend/seek/fine/
 * fast); the editor scrubs the mix (A) or Slides continuously (B) — the
 * mix transport has no bend, so rim ticks there always scrub. */
export interface SurfaceJog {
  /** Bare rim (CC #9): bend when playing / gentle seek when paused on the
   * shared decks; always a scrub/Slide in the editor. */
  rimTicks(deck: ChannelId, ticks: number): void;
  /** Touch surface (CC #10): the fine tier. */
  touchTicks(deck: ChannelId, ticks: number): void;
  /** SHIFT+rim: the deliberate velocity-accelerated fast tier. */
  shiftRimTicks(deck: ChannelId, ticks: number): void;
}

/** Minimal observable transport state (ADR 0019): lets LED Feedback
 * mirror whichever surface is audible instead of lying while the shared
 * decks are silenced. The editor reports its one mix transport for both
 * decks. The shared surface deliberately registers none — its truth
 * already flows to the bridge through the richer deck snapshots. */
export interface SurfaceTransportState {
  playing(deck: ChannelId): boolean;
  subscribe(fn: () => void): () => void;
}

export interface AudibleSurface {
  transport: SurfaceTransport;
  /** Optional gesture-class sections (ADR 0019): a class the surface
   * doesn't register is dropped by dispatch, exactly like CUE on the
   * editor. */
  pads?: SurfacePads;
  jumps?: SurfaceJumps;
  loops?: SurfaceLoops;
  jog?: SurfaceJog;
  transportState?: SurfaceTransportState;
  /** Go quiet: pause this surface's playback (ADR 0022 — nothing else;
   * the one shared clock keeps running). */
  silence(): void;
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

/** Become the audible surface: silences (pauses) the current holder.
 * Idempotent for the holder. Claim-over-claim (neither party is 'shared')
 * is last-wins: the Conductor yields to an editor claim by halting and
 * leaving the claimant in charge (sets 04 ADR — it subscribes and stands
 * down instead of releasing, since only the holder may release).
 *
 * `silencePrevious: false` is the Pickup claim (sets 16): the claimant
 * ADOPTS the holder's running playback instead of displacing it — the
 * mirror of takeover's suppressed release-silence. Everything else
 * (holder flip, capture gating, transport routing) is unchanged. */
export function claimAudible(
  id: AudibleSurfaceId,
  opts: { silencePrevious?: boolean } = {}
): void {
  if (holder === id) return;
  const claimant = surfaces.get(id);
  if (!claimant) {
    console.warn(`[audibleSurface] claim by unregistered surface '${id}' ignored`);
    return;
  }
  if (holder !== 'shared') {
    console.warn(`[audibleSurface] '${id}' displaces '${holder}' (last claim wins)`);
  }
  if (opts.silencePrevious !== false) surfaces.get(holder)?.silence();
  holder = id;
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
  notify();
}

export function isAudible(id: AudibleSurfaceId): boolean {
  return holder === id;
}

/** The current holder's id (for subscribers that key behavior on it). */
export function audibleHolder(): AudibleSurfaceId {
  return holder;
}

/** The audible surface's transport — what app-wide inputs route through.
 * Null when the holder never registered (boot order edge). */
export function audibleTransport(): SurfaceTransport | null {
  return surfaces.get(holder)?.transport ?? null;
}

/** The audible surface's pads section — null when the holder never
 * registered one (the class drops, ADR 0019). */
export function audiblePads(): SurfacePads | null {
  return surfaces.get(holder)?.pads ?? null;
}

/** The audible surface's jumps section — null when unregistered. */
export function audibleJumps(): SurfaceJumps | null {
  return surfaces.get(holder)?.jumps ?? null;
}

/** The audible surface's loops section — null when unregistered. */
export function audibleLoops(): SurfaceLoops | null {
  return surfaces.get(holder)?.loops ?? null;
}

/** The audible surface's jog section — null when unregistered. */
export function audibleJog(): SurfaceJog | null {
  return surfaces.get(holder)?.jog ?? null;
}

/** The audible surface's observable transport state — null when the
 * holder registered none (LED Feedback then reads the deck snapshots). */
export function audibleTransportState(): SurfaceTransportState | null {
  return surfaces.get(holder)?.transportState ?? null;
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
