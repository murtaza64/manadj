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
import {
  bContentSegments,
  bTrackTimeAt,
  laneValuesAt,
  tempoMatchPitch,
} from '../editor/mixModel';
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

interface PlannedAdjacencyBase {
  /** Incoming deck rate during the window (1 unless tempo-matched). */
  rateIncoming: number;
  /** Incoming pitch percent during the window (0 after — Tempo v1). */
  pitchIncomingPercent: number;
  /** Window span on the mix axis. mixStart === mixEnd for hard cuts. */
  mixStartSec: number;
  mixEndSec: number;
}

/** hardcut covers no pin, dangling pins, failed Take vectorization; the
 * windowed variants carry the executed Transition (idealized for Takes). */
export type PlannedAdjacency =
  | (PlannedAdjacencyBase & { kind: 'hardcut'; transition?: undefined })
  | (PlannedAdjacencyBase & { kind: 'transition' | 'take'; transition: Transition });

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

// ── Plan evaluation (sets 04) ────────────────────────────────────────────
// The Conductor's per-tick read (and, later, seek — issue 05): the full
// deck/mixer picture at a mix instant. Pure — the runtime driver only
// reconciles the shared machinery against this.

export interface PlanDeckState {
  /** Index into plan.entries of this deck's occupant (the playing entry,
   * else the next upcoming one — the Conductor's load target — else the
   * last finished one). Null when no entry uses this deck. */
  entryIndex: number | null;
  trackId: number | null;
  /** Where the deck should sit, in its track's own seconds. Parked at the
   * planned entry before playing and at the exit after. */
  trackTime: number;
  playing: boolean;
  /** Varispeed percent: the window's tempo-match while the entry window
   * runs, 0 (native) everywhere else — Tempo v1. */
  pitchPercent: number;
}

/** Mixer automation per physical deck, in the Mixer's domain (fader/EQ
 * 0..1, filter −1..1) — role lanes already mapped onto decks. */
export interface PlanAutomation {
  fader: number;
  eq: { low: number; mid: number; high: number };
  filter: number;
}

export interface PlanState {
  decks: Record<'A' | 'B', PlanDeckState>;
  lanes: Record<'A' | 'B', PlanAutomation>;
  /** The latest entry whose audible span has begun (row highlight). */
  activeEntryIndex: number;
  /** Past the last exit: everything stopped. */
  done: boolean;
}

const IDLE_DECK: PlanDeckState = {
  entryIndex: null,
  trackId: null,
  trackTime: 0,
  playing: false,
  pitchPercent: 0,
};

const soloLanes = (fader: number): PlanAutomation => ({
  fader,
  eq: { low: 0.5, mid: 0.5, high: 0.5 },
  filter: 0,
});

/** The adjacency whose window contains t (zero-width hard cuts never
 * match); the LATEST wins if a degenerate plan overlaps windows. */
function windowAt(plan: SetPlan, t: number): number | null {
  let found: number | null = null;
  plan.adjacencies.forEach((adj, i) => {
    if (adj.kind !== 'hardcut' && t >= adj.mixStartSec && t < adj.mixEndSec) found = i;
  });
  return found;
}

function isWindowed(adj: PlannedAdjacency): adj is WindowedAdjacency {
  return adj.kind !== 'hardcut';
}

/** A planned adjacency that executes a window (not a hard cut). */
type WindowedAdjacency = Extract<PlannedAdjacency, { transition: Transition }>;

/** The outgoing track's mix anchor, recovered from its window placement
 * (mixStart = anchor + transition.startSec). */
function outgoingAnchor(adj: WindowedAdjacency): number {
  return adj.mixStartSec - adj.transition.startSec;
}

export function planStateAt(plan: SetPlan, mixTime: number): PlanState {
  const state: PlanState = {
    decks: { A: { ...IDLE_DECK }, B: { ...IDLE_DECK } },
    lanes: { A: soloLanes(0), B: soloLanes(0) },
    activeEntryIndex: 0,
    done: plan.entries.length === 0 || mixTime >= plan.totalSec,
  };
  if (plan.entries.length === 0) return state;

  for (const deck of ['A', 'B'] as const) {
    // Occupant: the active entry on this deck, else the next upcoming one,
    // else the last finished one.
    let active: number | null = null;
    let upcoming: number | null = null;
    let past: number | null = null;
    plan.entries.forEach((e, i) => {
      if (e.deck !== deck) return;
      if (mixTime >= e.entryMixSec && mixTime < e.exitMixSec) active = i;
      else if (e.entryMixSec > mixTime) upcoming = upcoming ?? i;
      else past = i;
    });
    const idx = active ?? upcoming ?? past;
    if (idx === null) continue;
    const entry = plan.entries[idx];
    const playing = !state.done && idx === active;

    // Inside the entry's own ENTRY window the incoming rides the window's
    // rate and jump deltas (bTrackTimeAt on the outgoing's local mix axis);
    // everywhere else the native-rate anchor rules (Tempo v1 snap).
    const entryAdj = idx > 0 ? plan.adjacencies[idx - 1] : undefined;
    const entryWindow =
      playing && entryAdj && entryAdj.kind !== 'hardcut' && mixTime < entryAdj.mixEndSec
        ? entryAdj
        : null;
    let trackTime: number;
    let pitchPercent = 0;
    if (entryWindow) {
      trackTime = Math.max(
        0,
        bTrackTimeAt(entryWindow.transition, mixTime - outgoingAnchor(entryWindow), entryWindow.rateIncoming)
      );
      pitchPercent = entryWindow.pitchIncomingPercent;
    } else if (playing) {
      trackTime = mixTime - entry.mixOffsetSec;
    } else {
      // Parked: at the planned entry before playing, at the exit after.
      trackTime = idx === active || idx === upcoming ? entry.entrySec : entry.exitSec;
    }
    state.decks[deck] = { entryIndex: idx, trackId: entry.trackId, trackTime, playing, pitchPercent };
  }

  // activeEntryIndex: the latest entry whose audible span has begun.
  for (let i = 0; i < plan.entries.length; i++) {
    if (plan.entries[i].entryMixSec <= mixTime) state.activeEntryIndex = i;
  }

  // Lanes: the containing window's role lanes mapped onto physical decks;
  // outside any window, solo the playing deck.
  const windowIdx = state.done ? null : windowAt(plan, mixTime);
  const windowAdj = windowIdx !== null ? plan.adjacencies[windowIdx] : null;
  if (windowIdx !== null && windowAdj && isWindowed(windowAdj)) {
    const v = laneValuesAt(windowAdj.transition, mixTime - outgoingAnchor(windowAdj));
    const outDeck = plan.entries[windowIdx].deck;
    const inDeck = plan.entries[windowIdx + 1].deck;
    state.lanes[outDeck] = {
      fader: v.faderA,
      eq: { low: v.eqLowA, mid: v.eqMidA, high: v.eqHighA },
      filter: v.filterA * 2 - 1,
    };
    state.lanes[inDeck] = {
      fader: v.faderB,
      eq: { low: v.eqLowB, mid: v.eqMidB, high: v.eqHighB },
      filter: v.filterB * 2 - 1,
    };
  } else {
    for (const deck of ['A', 'B'] as const) {
      if (state.decks[deck].playing) state.lanes[deck] = soloLanes(1);
    }
  }
  return state;
}

/** Jump instants of the window containing [t0, t1), on the GLOBAL mix
 * axis — the Conductor hard-syncs decks when a tick crosses one (the
 * model applies jump deltas discontinuously; drift correction alone would
 * miss sub-tolerance jumps). */
export function jumpCrossed(plan: SetPlan, t0: number, t1: number): boolean {
  for (const adj of plan.adjacencies) {
    if (!isWindowed(adj) || !adj.transition.jumps) continue;
    const anchor = outgoingAnchor(adj);
    for (const j of adj.transition.jumps) {
      const tj = anchor + adj.transition.startSec + j.x * adj.transition.durationSec;
      if (tj > t0 && tj <= t1) return true;
    }
  }
  return false;
}
