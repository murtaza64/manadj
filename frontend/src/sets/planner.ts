/**
 * Set planner (sets 03) — pure functions under vitest.
 *
 * `planSet(input) → deterministic playback plan`: THE seam where every
 * Set-playback semantic lives (PRD Implementation Decisions). The runtime
 * Conductor and the overview ladder both consume the plan; neither adds
 * playback semantics of its own.
 *
 * - Ping-pong parity: entry i plays on deck A when i is even, B when odd.
 * - Playback structure is fully derived from pins (no new anchors): a
 *   pinned Transition's window sits in the OUTGOING track's own time
 *   (Sketch origin invariant), so each solo stretch and every handover
 *   instant follow from the pins alone.
 * - Unresolved adjacency = hard cut: outgoing to its end, incoming from
 *   its Main cue. The FIRST track starts at its beginning (review verdict
 *   2026-07-05, revising the PRD's Main-cue start — a set opens with the
 *   whole opening track); playback stops after the last track. Dangling
 *   pins degrade to hard cuts here too (library cleanup never corrupts a
 *   Set).
 * - Take pins plan through the existing vectorizer at plan time — the
 *   idealized Transition promotion would produce, never snapshotted.
 * - Tempo v1: tempo-match during windows (the incoming rides at the
 *   outgoing's BPM), snap to native after. Riding ramps / Fixed policy
 *   are issue 06.
 */
import type { VectorizeInput } from '../capture/vectorize';
import { vectorizeTake } from '../capture/vectorize';
import type { Transition } from '../editor/mixModel';
import { bContentSegments, bTrackTimeAt, tempoMatchPitch } from '../editor/mixModel';
import type { AdjacencyPin } from './adjacency';

export interface PlannerTrackFacts {
  durationSec: number;
  bpm: number | null;
  /** Main cue in track seconds (Track.cue_point_time, 0 when unset). */
  mainCueSec: number;
}

export interface PlanInput {
  entries: { trackId: number; pin: AdjacencyPin | null }[];
  /** Facts per track id. Every entry's track must be present. */
  tracks: Record<number, PlannerTrackFacts>;
  /** Full Transition payloads per uuid (the pair store's `data`). */
  transitionsByUuid: Record<string, Transition>;
  /** Raw material per pinned Take uuid — vectorized at plan time. */
  takesByUuid: Record<string, VectorizeInput>;
}

export interface PlannedAdjacency {
  /** hardcut covers no pin, dangling pins, failed Take vectorization. */
  kind: 'transition' | 'take' | 'hardcut';
  /** The executed window (idealized for Takes). Absent on hard cuts. */
  transition?: Transition;
  /** Incoming deck rate during the window (1 unless tempo-matched). */
  rateIncoming: number;
  /** Incoming pitch percent during the window (0 after — Tempo v1). */
  pitchIncomingPercent: number;
  /** Window span on the mix axis. mixStart === mixEnd for hard cuts. */
  mixStartSec: number;
  mixEndSec: number;
}

export interface PlannedEntry {
  trackId: number;
  deck: 'A' | 'B';
  /** Mix time where this track's time 0 sits at NATIVE rate — its solo-
   * stretch anchor (valid after its entry window ends). */
  mixOffsetSec: number;
  /** Track time first / last audible. */
  entrySec: number;
  exitSec: number;
  /** The audible span on the mix axis. */
  entryMixSec: number;
  exitMixSec: number;
}

export interface SetPlan {
  entries: PlannedEntry[];
  adjacencies: PlannedAdjacency[];
  /** Mix length: the last track's exit instant. */
  totalSec: number;
  /** Non-fatal degeneracies (overlapping windows, windows past track
   * ends): the plan stays playable; the UI may surface these. */
  warnings: string[];
}

/** Plan durations as "m:ss" (per-row played time, toolbar set length). */
export function fmtSec(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.max(0, Math.round(s - m * 60));
  return `${m}:${String(r).padStart(2, '0')}`;
}

/** Resolve an adjacency's pin to the Transition it executes (idealizing
 * Take pins through the vectorizer), or null → hard cut. */
function resolvePin(
  pin: AdjacencyPin | null,
  input: PlanInput,
  bpmOut: number | null,
  bpmIn: number | null
): { kind: 'transition' | 'take'; transition: Transition } | null {
  if (pin?.kind === 'transition') {
    const transition = input.transitionsByUuid[pin.uuid];
    return transition ? { kind: 'transition', transition } : null;
  }
  if (pin?.kind === 'take') {
    const source = input.takesByUuid[pin.uuid];
    if (!source) return null;
    const draft = vectorizeTake(source, { bpmA: bpmOut, bpmB: bpmIn });
    return draft ? { kind: 'take', transition: draft.transition } : null;
  }
  return null;
}

export function planSet(input: PlanInput): SetPlan {
  const entries: PlannedEntry[] = [];
  const adjacencies: PlannedAdjacency[] = [];
  const warnings: string[] = [];
  if (input.entries.length === 0) {
    return { entries, adjacencies, totalSec: 0, warnings };
  }

  const factsOf = (trackId: number): PlannerTrackFacts =>
    input.tracks[trackId] ?? { durationSec: 0, bpm: null, mainCueSec: 0 };

  // Walk the chain accumulating each track's native-rate mix anchor.
  // The first track opens the set from its very beginning (its Main cue is
  // a performance marker, not a set boundary): time 0 at mix 0.
  let mixOffset = 0;
  let entrySec = 0;
  let entryMixSec = 0;

  for (let i = 0; i < input.entries.length; i++) {
    const { trackId } = input.entries[i];
    const facts = factsOf(trackId);
    const deck: 'A' | 'B' = i % 2 === 0 ? 'A' : 'B';
    const next = input.entries[i + 1];

    if (!next) {
      // Last track: plays to its end; the set stops there.
      entries.push({
        trackId,
        deck,
        mixOffsetSec: mixOffset,
        entrySec,
        exitSec: facts.durationSec,
        entryMixSec,
        exitMixSec: mixOffset + facts.durationSec,
      });
      break;
    }

    const nextFacts = factsOf(next.trackId);
    const resolved = resolvePin(input.entries[i].pin, input, facts.bpm, nextFacts.bpm);

    if (!resolved) {
      // Hard cut: outgoing to its end, incoming from its Main cue.
      const cutMix = mixOffset + facts.durationSec;
      entries.push({
        trackId,
        deck,
        mixOffsetSec: mixOffset,
        entrySec,
        exitSec: facts.durationSec,
        entryMixSec,
        exitMixSec: cutMix,
      });
      adjacencies.push({
        kind: 'hardcut',
        rateIncoming: 1,
        pitchIncomingPercent: 0,
        mixStartSec: cutMix,
        mixEndSec: cutMix,
      });
      mixOffset = cutMix - nextFacts.mainCueSec;
      entrySec = nextFacts.mainCueSec;
      entryMixSec = cutMix;
      continue;
    }

    const { kind, transition } = resolved;
    const pitch = transition.tempoMatch ? tempoMatchPitch(facts.bpm, nextFacts.bpm) : 0;
    const rate = 1 + pitch / 100;

    // Window on the mix axis: the Transition's start/duration live in the
    // outgoing track's own time (Sketch origin), which IS this stretch of
    // the mix axis shifted by the outgoing's anchor.
    const windowEndLocal = transition.startSec + transition.durationSec;
    const mixStartSec = mixOffset + transition.startSec;
    const mixEndSec = mixOffset + windowEndLocal;
    if (transition.startSec > facts.durationSec) {
      warnings.push(
        `adjacency ${i}: window starts past the outgoing track's end (silent gap)`
      );
    }
    const prev = adjacencies[adjacencies.length - 1];
    if (prev && mixStartSec < prev.mixEndSec) {
      warnings.push(`adjacency ${i}: window overlaps the previous handover`);
    }

    // Outgoing exits at the window end, clamped to its own end.
    const exitSec = Math.min(windowEndLocal, facts.durationSec);
    entries.push({
      trackId,
      deck,
      mixOffsetSec: mixOffset,
      entrySec,
      exitSec,
      entryMixSec,
      exitMixSec: mixOffset + exitSec,
    });
    adjacencies.push({
      kind,
      transition,
      rateIncoming: rate,
      pitchIncomingPercent: pitch,
      mixStartSec,
      mixEndSec,
    });

    // Incoming: audible entry from the model's piecewise walk (defers past
    // lead gaps / below-zero jumps); the post-window native anchor pins its
    // track time at the window end (Tempo v1 snap-to-native).
    const segments = bContentSegments(transition, nextFacts.durationSec, rate);
    const bAtWindowEnd = bTrackTimeAt(transition, windowEndLocal, rate);
    if (bAtWindowEnd > nextFacts.durationSec) {
      warnings.push(`adjacency ${i}: incoming track ends inside the window`);
    }
    if (segments.length > 0) {
      entrySec = segments[0].bStartSec;
      entryMixSec = mixOffset + segments[0].mixStartSec;
    } else {
      entrySec = Math.max(0, Math.min(bAtWindowEnd, nextFacts.durationSec));
      entryMixSec = mixEndSec;
    }
    mixOffset = mixEndSec - bAtWindowEnd;
  }

  const last = entries[entries.length - 1];
  return { entries, adjacencies, totalSec: Math.max(0, last.exitMixSec), warnings };
}
