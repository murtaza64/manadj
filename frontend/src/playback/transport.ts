/**
 * Pure transport/cue state machine for a Deck.
 *
 * No Web Audio, no DOM, no timers. The engine feeds events in (with the
 * playhead freshly synced from its clock) and interprets the returned
 * AudioEffects against the audio graph. Keeping this pure is the designated
 * testing seam if the Practice-view spike graduates (see PRD / ADR 0007).
 *
 * Semantics mirror the library player's cue behaviors
 * (frontend/src/contexts/AudioContext.tsx), reimplemented here per the
 * parallel-stack decision.
 */

import { addBeats, phasePreservingJumpTarget, snapToNearestBeat } from './quantize';
import { clampLoopBeats, LOOP_DEFAULT_BEATS, resizeLoopBeats } from './loop';
import type { LoopRegion, LoopResize } from './loop';

export interface TransportState {
  /** Deck play state ("the deck is running"), distinct from audio audibly playing. */
  playing: boolean;
  /** Main-cue hold-to-preview in progress. */
  previewing: boolean;
  /** Hot cue slot currently held in preview, or null. */
  hotCuePreviewSlot: number | null;
  /** Main cue point in seconds, or null if unset. */
  cuePoint: number | null;
  /** Playhead in seconds. Authoritative while audio is stopped; the engine
   * syncs it from its clock before dispatching events. */
  playhead: number;
  /** Active loop (looping 03): the region the playhead wraps in, or null.
   * Deck state — survives pause and view switches; Load clears it. */
  loop: LoopRegion | null;
  /** Pending auto-loop size in beats — remembered per Deck across
   * engagements (and Loads, at the engine layer). */
  pendingLoopBeats: number;
}

export type TransportEvent =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'toggle-play' }
  /** Absolute relocation (waveform seek, scrub): cancels an active loop. */
  | { type: 'seek'; time: number }
  /** Relative displacement (beat jump, looping 04): translates an active
   * loop with the playhead — position-in-loop is preserved. */
  | { type: 'jump'; time: number }
  | { type: 'cue-down' }
  | { type: 'cue-up' }
  | { type: 'hot-cue-down'; slot: number; time: number | null }
  | { type: 'hot-cue-up'; slot: number; time: number | null }
  /** Auto-loop engage/release (looping 03). Inert on gridless Tracks. */
  | { type: 'loop-toggle' }
  /** Resize (looping 04, midi-performance-ops 01): halve/double or an
   * absolute set-length. Pending size when idle, live region resize when
   * looping — start-edge anchored, phase-mod re-entry on shrink. */
  | { type: 'loop-resize'; change: LoopResize }
  /** LOOP pad preset (midi-performance-ops 02): no loop → engage at the
   * playhead at this size (and remember it as pending); same size →
   * release; different size → set-length resize in place. */
  | { type: 'loop-preset'; beats: number }
  /** Audio reached the end of the buffer on its own. */
  | { type: 'ended' };

export type AudioEffect =
  /** (Re)start audio from `at` seconds. Restart-while-running implies a declicked stop+start. */
  | { type: 'start'; at: number }
  /** Stop audio; playhead rests at `at` seconds. Idempotent if audio already stopped. */
  | { type: 'stop'; at: number };

/**
 * Ambient facts the reducer needs for Quantize (looping 01): the app-wide
 * toggle at gesture time and the loaded Track's Beatgrid. Not transport
 * state — the engine assembles this per dispatch. Omitting it (the default)
 * degrades to unquantized behavior, exactly like a gridless Track.
 */
export interface TransportContext {
  /** App-wide Quantize toggle, read at gesture time. */
  quantize: boolean;
  /** The Beatgrid's beat times in seconds, or null for gridless Tracks. */
  beatTimes: readonly number[] | null;
}

const UNQUANTIZED: TransportContext = { quantize: false, beatTimes: null };

/** Nearest-beat snap when Quantize governs the gesture; exact otherwise. */
function placementTime(time: number, ctx: TransportContext): number {
  return ctx.quantize ? snapToNearestBeat(time, ctx.beatTimes) : time;
}

/** Tolerance for "playhead is at the cue point" (matches library player). */
const AT_CUE_EPSILON = 0.01;

export function initialTransportState(): TransportState {
  return {
    playing: false,
    previewing: false,
    hotCuePreviewSlot: null,
    cuePoint: null,
    playhead: 0,
    loop: null,
    pendingLoopBeats: LOOP_DEFAULT_BEATS,
  };
}

/** Audio should be audible iff any of these hold. */
export function isAudioRunning(s: TransportState): boolean {
  return s.playing || s.previewing || s.hotCuePreviewSlot !== null;
}

export function reduceTransport(
  s: TransportState,
  e: TransportEvent,
  ctx: TransportContext = UNQUANTIZED
): [TransportState, AudioEffect[]] {
  switch (e.type) {
    case 'play': {
      if (s.playing) return [s, []];
      const next = { ...s, playing: true };
      // If a preview already has audio running, the deck simply takes over
      // seamlessly; otherwise start from the playhead.
      return [next, isAudioRunning(s) ? [] : [{ type: 'start', at: s.playhead }]];
    }

    case 'pause': {
      if (!isAudioRunning(s) && !s.playing) return [s, []];
      return [
        { ...s, playing: false, previewing: false, hotCuePreviewSlot: null },
        [{ type: 'stop', at: s.playhead }],
      ];
    }

    case 'toggle-play':
      return reduceTransport(s, { type: s.playing ? 'pause' : 'play' }, ctx);

    case 'seek': {
      // Absolute relocation cancels the loop — even to a point inside the
      // region; there is no "armed but playhead elsewhere" state.
      const next = { ...s, playhead: e.time, loop: null };
      return [next, isAudioRunning(s) ? [{ type: 'start', at: e.time }] : []];
    }

    case 'jump': {
      // Relative displacement: the region translates with the playhead —
      // you cannot beat-jump out of a loop. Clamp so a jump at the track
      // head can't push the region before 0 (length preserved).
      let loop = s.loop;
      if (loop) {
        const start = Math.max(0, loop.start + (e.time - s.playhead));
        loop = { ...loop, start, end: start + (loop.end - loop.start) };
      }
      const next = { ...s, playhead: e.time, loop };
      return [next, isAudioRunning(s) ? [{ type: 'start', at: e.time }] : []];
    }

    case 'cue-down': {
      if (s.playing) {
        // Return to cue and pause the deck (absolute relocation: the loop
        // cancels — looping 04).
        if (s.cuePoint === null) return [s, []];
        return [
          {
            ...s,
            playing: false,
            previewing: false,
            hotCuePreviewSlot: null,
            playhead: s.cuePoint,
            loop: null,
          },
          [{ type: 'stop', at: s.cuePoint }],
        ];
      }
      if (s.cuePoint !== null && Math.abs(s.playhead - s.cuePoint) < AT_CUE_EPSILON) {
        // Hold-to-preview from the cue point.
        return [{ ...s, previewing: true }, [{ type: 'start', at: s.cuePoint }]];
      }
      // Set the cue point at the current position — a placement gesture, so
      // Quantize governs it. The parked playhead moves with the snapped cue,
      // preserving the at-cue invariant (set, then hold-to-preview).
      const at = placementTime(s.playhead, ctx);
      return [{ ...s, cuePoint: at, playhead: at }, []];
    }

    case 'cue-up': {
      if (!s.previewing) return [s, []];
      if (s.playing) {
        // Play was pressed during the preview: deck keeps running.
        return [{ ...s, previewing: false }, []];
      }
      // Preview return is a cue return (absolute relocation): loop cancels.
      const at = s.cuePoint ?? s.playhead;
      return [
        { ...s, previewing: false, playhead: at, loop: null },
        [{ type: 'stop', at }],
      ];
    }

    case 'hot-cue-down': {
      if (e.time === null) return [s, []];
      // A Hot Cue trigger is an absolute relocation: the loop cancels
      // (looping 04) — jumping to the drop never traps you in a leftover
      // region.
      if (s.playing) {
        // Jump and keep playing. Quantize governs the trigger: the jump is
        // immediate but lands at cue + intra-beat phase (a whole-beat
        // displacement — looping 02). Paused triggers below are seeks and
        // land exactly, regardless of the toggle.
        const at = ctx.quantize
          ? phasePreservingJumpTarget(e.time, s.playhead, ctx.beatTimes)
          : e.time;
        return [{ ...s, playhead: at, loop: null }, [{ type: 'start', at }]];
      }
      // Hold-to-preview from the hot cue.
      return [
        { ...s, hotCuePreviewSlot: e.slot, playhead: e.time, loop: null },
        [{ type: 'start', at: e.time }],
      ];
    }

    case 'hot-cue-up': {
      if (e.time === null || s.hotCuePreviewSlot !== e.slot) return [s, []];
      if (s.playing) {
        // Play was pressed during the preview: deck keeps running.
        return [{ ...s, hotCuePreviewSlot: null }, []];
      }
      return [
        { ...s, hotCuePreviewSlot: null, playhead: e.time },
        [{ type: 'stop', at: e.time }],
      ];
    }

    case 'loop-toggle': {
      // Release: playback simply flows past the end edge — no relocation.
      if (s.loop) return [{ ...s, loop: null }, []];
      // Engage: anchor at the playhead, snapped per Quantize (possibly
      // slightly ahead — the playhead plays into the region and NEVER
      // moves on engage). Gridless Tracks: inert — never guess.
      const grid = ctx.beatTimes;
      if (!grid || grid.length < 2) return [s, []];
      const start = ctx.quantize ? snapToNearestBeat(s.playhead, grid) : s.playhead;
      const end = addBeats(start, s.pendingLoopBeats, grid);
      if (end <= start) return [s, []];
      return [
        { ...s, loop: { start, end, lengthBeats: s.pendingLoopBeats } },
        [],
      ];
    }

    case 'loop-resize': {
      // Idle: resize adjusts the per-Deck pending size.
      if (!s.loop) {
        const pending = resizeLoopBeats(s.pendingLoopBeats, e.change);
        if (pending === s.pendingLoopBeats) return [s, []];
        return [{ ...s, pendingLoopBeats: pending }, []];
      }
      // Looping: resize the active region live, anchored at the START edge
      // (never the playhead). The pending size tracks it, so the next
      // engagement remembers.
      const lengthBeats = resizeLoopBeats(s.loop.lengthBeats, e.change);
      if (lengthBeats === s.loop.lengthBeats) return [s, []];
      // Pure seconds (ADR 0027 §6): loops are seconds-identity — a resize
      // scales the audible region, never re-derives it from the current
      // grid (which may have re-tempo'd since engage and would
      // discontinuously re-size it). lengthBeats is the nominal ladder
      // position, not stored truth; the display projects the live grid.
      const end =
        s.loop.start + (s.loop.end - s.loop.start) * (lengthBeats / s.loop.lengthBeats);
      const loop = { start: s.loop.start, end, lengthBeats };
      // A shrink that strands the playhead pulls it back in at its phase
      // modulo the new length — rapid halve-halve-halve stays in the groove.
      const length = loop.end - loop.start;
      const offset = s.playhead - loop.start;
      if (length > 0 && offset >= length && s.playhead < s.loop.end) {
        const at = loop.start + (offset % length);
        return [
          { ...s, loop, pendingLoopBeats: lengthBeats, playhead: at },
          isAudioRunning(s) ? [{ type: 'start', at }] : [],
        ];
      }
      return [{ ...s, loop, pendingLoopBeats: lengthBeats }, []];
    }

    case 'loop-preset': {
      const beats = clampLoopBeats(e.beats);
      // The lit pad releases: engage/release is one location.
      if (s.loop && s.loop.lengthBeats === beats) {
        return reduceTransport(s, { type: 'loop-toggle' }, ctx);
      }
      // A different size while looping: set-length resize in place.
      if (s.loop) {
        return reduceTransport(s, { type: 'loop-resize', change: { beats } }, ctx);
      }
      // Idle: remember the size (the on-screen LOOP row agrees) and engage
      // at the playhead. Engage stays inert on gridless Tracks; the pending
      // update does not (idle-resize semantics).
      const withPending =
        s.pendingLoopBeats === beats ? s : { ...s, pendingLoopBeats: beats };
      return reduceTransport(withPending, { type: 'loop-toggle' }, ctx);
    }

    case 'ended': {
      // Audio ran off the end of the buffer.
      if (s.previewing && s.cuePoint !== null) {
        return [
          { ...s, playing: false, previewing: false, hotCuePreviewSlot: null, playhead: s.cuePoint },
          [{ type: 'stop', at: s.cuePoint }],
        ];
      }
      return [
        { ...s, playing: false, previewing: false, hotCuePreviewSlot: null },
        [{ type: 'stop', at: s.playhead }],
      ];
    }
  }
}
