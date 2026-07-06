import type { ChannelId } from '../playback/mixer';
import type { BeatgridResponse } from '../types';

/**
 * The grid-edit chord reducer (midi-performance-ops 06) — spin-to-nudge as
 * a pure state machine, modeled on playback/transport.ts. Dispatch (the
 * thin glue) folds it over the action stream: nudge-pad down/up edges and
 * jog ticks in, grid-edit commands out. This is the feature's one new
 * stateful seam; dispatch itself stays view-blind and otherwise stateless.
 *
 * Semantics (PRD decision):
 * - Holding either grid-nudge pad ARMS grid-nudge on that deck. While
 *   armed, jog ticks (rim and touch streams both) mean fine grid nudge —
 *   GRID_SPIN_NUDGE_MS_PER_TICK per tick, sign from the spin direction —
 *   and never reach their normal surface-routed meanings (Nudge, seek;
 *   the deliberate ADR 0019 carve-out). Release restores plain jog.
 * - Ticks emit optimistic local nudges (live against playing audio); the
 *   accumulated net offset persists in ONE commit on pad release.
 * - Tap = release with ZERO ticks received → the discrete ±10ms step
 *   (issue 05's behavior). No timers, no thresholds: any tick received
 *   while held — even if the net cancels to zero — makes the gesture a
 *   hold (a zero-net hold commits nothing: the grid is where it started).
 * - Per-deck isolation: each deck chords independently; an unarmed deck's
 *   jog passes through untouched.
 * - While armed, the OTHER nudge pad is ignored (the arming pad owns the
 *   gesture); its stray release is swallowed.
 */

/** Fine grid nudge per jog tick while armed (~1ms, PRD decision). */
export const GRID_SPIN_NUDGE_MS_PER_TICK = 1;

interface DeckChord {
  /** The arming pad — decides the sign of a tap's discrete step. */
  direction: 'earlier' | 'later';
  /** Net accumulated offset in ms, signed by spin direction. */
  offsetMs: number;
  /** Any tick arrived (tap-vs-hold discriminator; zero-tick = tap). */
  moved: boolean;
}

export interface GridChordState {
  A: DeckChord | null;
  B: DeckChord | null;
}

/** The jog stream a tick arrived on — preserved so pass-through keeps its
 * surface-routed meaning (rim = bend/seek, touch = fine paused seek). */
export type JogStream = 'rim' | 'touch';

export type GridChordEvent =
  | { type: 'pad-down'; deck: ChannelId; direction: 'earlier' | 'later' }
  | { type: 'pad-up'; deck: ChannelId; direction: 'earlier' | 'later' }
  | { type: 'jog-ticks'; deck: ChannelId; stream: JogStream; ticks: number };

export type GridChordCommand =
  /** Not armed: the tick keeps its normal surface-routed jog meaning. */
  | { type: 'pass-jog'; deck: ChannelId; stream: JogStream; ticks: number }
  /** Armed: apply this tick batch to the local grid, optimistically. */
  | { type: 'local-nudge'; deck: ChannelId; offsetMs: number }
  /** Zero-tick release: the discrete ±10ms step (issue 05's tap). */
  | { type: 'tap-step'; deck: ChannelId; direction: 'earlier' | 'later' }
  /** Hold release: persist the accumulated net offset in one call. */
  | { type: 'commit'; deck: ChannelId; offsetMs: number };

export function initialGridChordState(): GridChordState {
  return { A: null, B: null };
}

export function reduceGridChord(
  s: GridChordState,
  e: GridChordEvent
): [GridChordState, GridChordCommand[]] {
  const chord = s[e.deck];
  switch (e.type) {
    case 'pad-down': {
      // The arming pad owns the gesture; a second nudge pad is ignored.
      if (chord) return [s, []];
      return [{ ...s, [e.deck]: { direction: e.direction, offsetMs: 0, moved: false } }, []];
    }

    case 'jog-ticks': {
      if (!chord) {
        return [s, [{ type: 'pass-jog', deck: e.deck, stream: e.stream, ticks: e.ticks }]];
      }
      const offsetMs = e.ticks * GRID_SPIN_NUDGE_MS_PER_TICK;
      return [
        { ...s, [e.deck]: { ...chord, offsetMs: chord.offsetMs + offsetMs, moved: true } },
        [{ type: 'local-nudge', deck: e.deck, offsetMs }],
      ];
    }

    case 'pad-up': {
      // Stray release: unarmed, or the ignored second pad letting go.
      if (!chord || chord.direction !== e.direction) return [s, []];
      const next = { ...s, [e.deck]: null };
      if (!chord.moved) {
        return [next, [{ type: 'tap-step', deck: e.deck, direction: e.direction }]];
      }
      // A zero-net hold persists nothing — the local grid already sits
      // exactly where the stored grid is.
      if (chord.offsetMs === 0) return [next, []];
      return [next, [{ type: 'commit', deck: e.deck, offsetMs: chord.offsetMs }]];
    }
  }
}

/**
 * Rigid local translate of a cached beatgrid response (the optimistic
 * apply behind `local-nudge`): every tempo change, beat and downbeat moves
 * by the same amount, mirroring the backend's nudge (sans its start-clamp
 * — the commit's server truth settles any divergence on refetch).
 */
export function shiftBeatgrid(response: BeatgridResponse, offsetMs: number): BeatgridResponse {
  const offsetS = offsetMs / 1000;
  return {
    ...response,
    data: {
      ...response.data,
      tempo_changes: response.data.tempo_changes.map((tc) => ({
        ...tc,
        start_time: tc.start_time + offsetS,
      })),
      beat_times: response.data.beat_times.map((t) => t + offsetS),
      downbeat_times: response.data.downbeat_times.map((t) => t + offsetS),
    },
  };
}
