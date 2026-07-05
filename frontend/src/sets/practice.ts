/**
 * Practice cue positioning (sets 13) — pure math under vitest.
 *
 * The rehearsal affordance's one decision: where each deck parks when an
 * adjacency is practiced (outgoing→A, incoming→B — editor convention;
 * Conductor parity is irrelevant here).
 *
 * - Pinned/planned adjacency: A a runway before the planned window start
 *   (converted from the mix axis to the outgoing's track time via its
 *   native-rate anchor), B at its planned entry.
 * - Unresolved (hard cut, dangling pin, or no plan yet): A at its LAST
 *   hot cue — the cue-slot convention puts it near the mix-out region —
 *   else a runway before its end; B at its Main cue.
 */

/** Rehearsal runway before the moment of interest (tunable heuristic). */
export const PRACTICE_RUNWAY_SEC = 30;

/** Structural slices of the set plan (sets/planner.ts types satisfy
 * these) — undefined when no plan is available for the adjacency. */
export interface PracticeCueInput {
  adjacency?: { kind: 'hardcut' | 'transition' | 'take'; mixStartSec: number };
  outgoingEntry?: { mixOffsetSec: number };
  incomingEntry?: { entrySec: number };
  outgoingDurationSec: number;
  /** The outgoing track's hot cue times (any order). */
  outgoingHotCueSecs: number[];
  /** The incoming track's Main cue (Track.cue_point_time, 0 when unset). */
  incomingMainCueSec: number;
  runwaySec?: number;
}

export interface PracticeCuePositions {
  /** Deck A park position, in the outgoing track's own seconds. */
  outgoingSec: number;
  /** Deck B park position, in the incoming track's own seconds. */
  incomingSec: number;
}

export function practiceCuePositions(input: PracticeCueInput): PracticeCuePositions {
  const runway = input.runwaySec ?? PRACTICE_RUNWAY_SEC;
  const { adjacency, outgoingEntry, incomingEntry } = input;

  if (adjacency && adjacency.kind !== 'hardcut' && outgoingEntry && incomingEntry) {
    // Window start lives on the mix axis; the outgoing plays at native
    // rate, so its anchor converts it to track time.
    const windowStartTrackSec = adjacency.mixStartSec - outgoingEntry.mixOffsetSec;
    return {
      outgoingSec: Math.max(0, windowStartTrackSec - runway),
      incomingSec: incomingEntry.entrySec,
    };
  }

  const lastHotCue =
    input.outgoingHotCueSecs.length > 0 ? Math.max(...input.outgoingHotCueSecs) : null;
  return {
    outgoingSec: lastHotCue ?? Math.max(0, input.outgoingDurationSec - runway),
    incomingSec: input.incomingMainCueSec,
  };
}
