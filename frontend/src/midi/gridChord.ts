import type { ChannelId } from '../playback/mixer';
import type { BeatgridResponse } from '../types';

/**
 * The grid-edit chord reducer (midi-performance-ops 06) — spin-to-nudge as
 * a pure state machine, modeled on playback/transport.ts. Dispatch (the
 * thin glue) folds it over the action stream: nudge-pad down/up edges and
 * jog ticks in, grid-edit commands out. This is the feature's one new
 * stateful seam; dispatch itself stays view-blind and otherwise stateless.
 *
 * Semantics (PRD decision; grow/shrink chord added in-session 2026-07-06):
 * - Holding a grid-nudge pad ARMS grid-nudge on that deck; holding a
 *   grow/shrink pad ARMS fine BPM adjust. While armed, jog ticks (rim and
 *   touch streams both) mean the chord's fine adjustment — sign from the
 *   spin direction — and never reach their normal surface-routed meanings
 *   (Nudge, seek; the deliberate ADR 0019 carve-out). Release restores
 *   plain jog.
 * - Nudge chord: ticks emit optimistic local nudges at
 *   GRID_SPIN_NUDGE_MS_PER_TICK (live against playing audio); the
 *   accumulated net offset persists in ONE commit on pad release.
 * - BPM chord: ticks accumulate GRID_SPIN_BPM_PER_TICK each (clockwise =
 *   BPM up = shrink direction); ONE commit on release carries the net
 *   delta. No per-tick command — re-tempo math is server-side, so there
 *   is no client-side optimistic apply (the readout updates on commit).
 * - Tap = release with ZERO ticks received → the pad's discrete step
 *   (issue 05's behavior: ±10ms nudge, ±0.03 grow/shrink). No timers, no
 *   thresholds: any tick received while held — even if the net cancels to
 *   zero — makes the gesture a hold (a zero-net hold commits nothing).
 * - Per-deck isolation: each deck chords independently; an unarmed deck's
 *   jog passes through untouched.
 * - One chord per deck: while armed, every other chordable pad on that
 *   deck is ignored (the arming pad owns the gesture); their stray
 *   releases are swallowed.
 */

/** Fine grid nudge per jog tick while nudge-armed (~1ms, PRD decision). */
export const GRID_SPIN_NUDGE_MS_PER_TICK = 1;

/** Fine BPM change per jog tick while grow/shrink-armed — a third of the
 * discrete ±0.03 step, so the jog is the finer instrument. */
export const GRID_SPIN_BPM_PER_TICK = 0.01;

type DeckChord =
  | {
      kind: 'nudge';
      /** The arming pad — decides the sign of a tap's discrete step. */
      direction: 'earlier' | 'later';
      /** Net accumulated offset in ms, signed by spin direction. */
      offsetMs: number;
      /** Any tick arrived (tap-vs-hold discriminator; zero-tick = tap). */
      moved: boolean;
    }
  | {
      kind: 'bpm';
      /** The arming pad — decides the sign of a tap's discrete step. */
      op: 'grow' | 'shrink';
      /** Net accumulated ticks, signed by spin direction (CW = BPM up).
       * Integer arithmetic — the ms/BPM conversion happens once at
       * release, so accumulation never drifts in floating point. */
      netTicks: number;
      moved: boolean;
    };

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
  | { type: 'bpm-pad-down'; deck: ChannelId; op: 'grow' | 'shrink' }
  | { type: 'bpm-pad-up'; deck: ChannelId; op: 'grow' | 'shrink' }
  | { type: 'jog-ticks'; deck: ChannelId; stream: JogStream; ticks: number };

export type GridChordCommand =
  /** Not armed: the tick keeps its normal surface-routed jog meaning. */
  | { type: 'pass-jog'; deck: ChannelId; stream: JogStream; ticks: number }
  /** Nudge-armed: apply this tick batch to the local grid, optimistically. */
  | { type: 'local-nudge'; deck: ChannelId; offsetMs: number }
  /** Zero-tick nudge release: the discrete ±10ms step (issue 05's tap). */
  | { type: 'tap-step'; deck: ChannelId; direction: 'earlier' | 'later' }
  /** Nudge hold release: persist the accumulated net offset in one call. */
  | { type: 'commit'; deck: ChannelId; offsetMs: number }
  /** Zero-tick grow/shrink release: the discrete ±0.03 step. */
  | { type: 'bpm-tap'; deck: ChannelId; op: 'grow' | 'shrink' }
  /** Grow/shrink hold release: apply the net BPM delta in one commit. */
  | { type: 'bpm-commit'; deck: ChannelId; deltaBpm: number };

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
      // The arming pad owns the gesture; any other chordable pad is ignored.
      if (chord) return [s, []];
      return [
        { ...s, [e.deck]: { kind: 'nudge', direction: e.direction, offsetMs: 0, moved: false } },
        [],
      ];
    }

    case 'bpm-pad-down': {
      if (chord) return [s, []];
      return [{ ...s, [e.deck]: { kind: 'bpm', op: e.op, netTicks: 0, moved: false } }, []];
    }

    case 'jog-ticks': {
      if (!chord) {
        return [s, [{ type: 'pass-jog', deck: e.deck, stream: e.stream, ticks: e.ticks }]];
      }
      if (chord.kind === 'nudge') {
        const offsetMs = e.ticks * GRID_SPIN_NUDGE_MS_PER_TICK;
        return [
          { ...s, [e.deck]: { ...chord, offsetMs: chord.offsetMs + offsetMs, moved: true } },
          [{ type: 'local-nudge', deck: e.deck, offsetMs }],
        ];
      }
      // BPM chord: accumulate only — no client-side re-tempo to apply.
      return [
        { ...s, [e.deck]: { ...chord, netTicks: chord.netTicks + e.ticks, moved: true } },
        [],
      ];
    }

    case 'pad-up': {
      // Stray release: unarmed, or a pad that didn't own the gesture.
      if (!chord || chord.kind !== 'nudge' || chord.direction !== e.direction) return [s, []];
      const next = { ...s, [e.deck]: null };
      if (!chord.moved) {
        return [next, [{ type: 'tap-step', deck: e.deck, direction: e.direction }]];
      }
      // A zero-net hold persists nothing — the local grid already sits
      // exactly where the stored grid is.
      if (chord.offsetMs === 0) return [next, []];
      return [next, [{ type: 'commit', deck: e.deck, offsetMs: chord.offsetMs }]];
    }

    case 'bpm-pad-up': {
      if (!chord || chord.kind !== 'bpm' || chord.op !== e.op) return [s, []];
      const next = { ...s, [e.deck]: null };
      if (!chord.moved) return [next, [{ type: 'bpm-tap', deck: e.deck, op: e.op }]];
      if (chord.netTicks === 0) return [next, []];
      return [
        next,
        [{ type: 'bpm-commit', deck: e.deck, deltaBpm: chord.netTicks * GRID_SPIN_BPM_PER_TICK }],
      ];
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
