/**
 * Set planner (sets 03) — pure functions under vitest.
 *
 * `planSet(input) → deterministic playback plan`: THE seam where every
 * Set-playback semantic lives (PRD Implementation Decisions). The runtime
 * Conductor and the overview ladder both consume the plan; neither adds
 * playback semantics of its own.
 *
 * - Ping-pong parity: entry i plays on deck A when i is even, B when odd
 *   — until a rolling junction (sets #143): an incoming whose default
 *   deck is still audibly occupied at its window start allocates the
 *   first free deck A→B→C→D instead (as performed, all tracks briefly
 *   audible); the LATER window owns the shared track's lanes from its
 *   window start (map #114). Grace fades remain for load-headroom
 *   pressure and true deck exhaustion only.
 * - Playback structure is fully derived from pins (no new anchors): a
 *   pinned Transition's window sits in the OUTGOING track's own time
 *   (Sketch origin invariant), so each solo stretch and every handover
 *   instant follow from the pins alone.
 * - Unresolved adjacency = hard cut: outgoing to its end, incoming from
 *   its Hot Cue 1, else its start (revised 2026-07-05: the Main cue moves
 *   freely during performance — CDJ memory-cue behavior — so no plan
 *   anchors to it; cue slot 1 is the conventional "first buildup", the
 *   stable entry anchor. The Main cue participates in Set planning
 *   nowhere.) The FIRST track starts at its beginning (review verdict
 *   2026-07-05 — a set opens with the whole opening track); playback
 *   stops after the last track. Dangling pins degrade to hard cuts here
 *   too (library cleanup never corrupts a Set).
 * - Take pins plan through the existing vectorizer at plan time — the
 *   idealized Transition promotion would produce, never snapshotted.
 * - Tempo policy (sets 06), one per Set. RIDING: the incoming tempo-
 *   matches during the window (when the Transition says so), then eases
 *   back to native over a Tempo return ramp — a tunable-heuristic ramp
 *   that must complete before the next window (insufficient runway clamps
 *   the ramp faster and flags the adjacency). FIXED: an explicit Set
 *   tempo (defaulted from the first track's BPM); every track pitched to
 *   it, windows play rate-scaled as a whole (the tempo-match flag is
 *   moot — both decks are already locked to the Set tempo).
 */
import type { VectorizeInput } from '../capture/vectorize';
import { vectorizeTake } from '../capture/vectorize';
import type { Transition } from '../editor/mixModel';
import {
  aEndMixTime,
  aTrackTimeAt,
  bContentSegments,
  bTrackTimeAt,
  laneValuesAt,
  tempoMatchPitch,
} from '../editor/mixModel';
import { TRIM_NEUTRAL } from '../playback/mixerMath';
import { MAX_PITCH_RANGE_PERCENT } from '../playback/tempo';
import type { Track } from '../types';
import type { AdjacencyPin } from './adjacency';
import {
  buildPlannedRoutine,
  routineSlotStateAt,
  slotLanesAt,
  traceStateAt,
  type PlannedRoutine,
  type RoutinePlanInput,
} from './routinePlan';

/** Physical decks a plan may drive. Ping-pong entries live on A/B; a
 * Routine's cast slots allocate across all four (routines 159). */
export type PlanDeck = 'A' | 'B' | 'C' | 'D';
export const PLAN_DECKS: readonly PlanDeck[] = ['A', 'B', 'C', 'D'];

export interface PlannerTrackFacts {
  durationSec: number;
  bpm: number | null;
  /** Hot Cue 1 in track seconds (the stable entry anchor — cue-slot
   * convention: slot 1 = first buildup), null when slot 1 is unset. */
  hotCue1Sec: number | null;
}

/** A Track's effective tempo. Served `bpm` IS the grid-first projection
 * now (ADR 0027 — one served BPM); this seam remains so every plan tempo
 * input flows through one place (the Kambi→Raskal 2× incident). */
export function trackEffectiveBpm(t: Track): number | null {
  return t.bpm ?? null;
}

/** Assemble one entry's planner facts from its Track row (+ Hot Cue 1) —
 * THE seam where Track rows become plan tempo inputs. */
export function plannerTrackFacts(t: Track, hotCue1Sec: number | null): PlannerTrackFacts {
  return {
    durationSec: t.duration_secs ?? 0,
    bpm: trackEffectiveBpm(t),
    hotCue1Sec,
  };
}

/** The Set's Tempo policy (sets 06). Riding's ramp speed is a tunable
 * heuristic (a setting, not model — PRD); Fixed's null Set tempo falls
 * back to the first track's native BPM. */
export type TempoPolicyInput =
  | { policy: 'riding'; returnSecPerPercent?: number }
  | { policy: 'fixed'; setTempoBpm: number | null };

/** Default Tempo return speed: seconds of ramp per percent of pitch
 * ridden (a 4% ride eases back over ~8s). */
export const DEFAULT_TEMPO_RETURN_SEC_PER_PERCENT = 2;

/** Grace fade defaults (sets 14): free a colliding deck this long before
 * the window that needs it (load headroom), fading the dying track out
 * over the last `FADE` seconds. Both tunable settings. */
export const DEFAULT_GRACE_HEADROOM_SEC = 5;
export const DEFAULT_GRACE_FADE_SEC = 2;

export interface PlanInput {
  /** Trim (sets #164) is an OFFSET from neutral in mixer-knob units
   * (0/absent = neutral) — offset, never absolute, so track Autogain
   * composes when it lands (ADR 0034). */
  entries: { trackId: number; pin: AdjacencyPin | null; trim?: number }[];
  /** Facts per track id. Every entry's track must be present. */
  tracks: Record<number, PlannerTrackFacts>;
  /** Full Transition payloads per uuid (the pair store's `data`). */
  transitionsByUuid: Record<string, Transition>;
  /** Raw material per pinned Take uuid — vectorized at plan time. */
  takesByUuid: Record<string, VectorizeInput>;
  /** Tempo policy; absent = Riding at the default return speed. */
  tempo?: TempoPolicyInput;
  /** Grace fade tunables (sets 14); absent = the defaults above. */
  grace?: { headroomSec?: number; fadeSec?: number };
  /** Pinned Routines, resolved upstream (routines 159): each plays its
   * promoted recording over the n cast entries starting at
   * `startEntryIndex`, covering the n−1 adjacencies between them. THE
   * RoutinePlanInput seam — #160's pin plumbing feeds it at the e2e
   * merge; tests feed it directly. */
  routines?: { startEntryIndex: number; routine: RoutinePlanInput }[];
}

interface PlannedAdjacencyBase {
  /** B's track-seconds per AUTHORED window second — bTrackTimeAt's rateB.
   * Riding: the window's tempo-match rate (also the incoming's deck
   * rate). Fixed: rateIn/rateOut (the flag is moot). Hard cuts have no
   * window: fixed at 1 (meaningless — nothing reads it). */
  rateIncoming: number;
  /** Incoming DECK pitch percent during the window (Fixed: its constant
   * Set-tempo pitch; Riding: the tempo-match ride, ramped off after).
   * Hard cuts: 0 (no window; solo pitch comes from the entry's rate). */
  pitchIncomingPercent: number;
  /** Authored window seconds per mix second — the outgoing's deck rate
   * (1 under Riding; the outgoing's Set-tempo rate under Fixed). Maps
   * global mix time onto the authored window axis. */
  rateOutgoing: number;
  /** Window span on the mix axis. mixStart === mixEnd for hard cuts. */
  mixStartSec: number;
  mixEndSec: number;
  /** The pin this adjacency resolved from (sets 24: live re-plan matches
   * the sounding window across plan recomputes by it). Absent for hard
   * cuts (nothing pinned, or the pin dangled). */
  pinUuid?: string;
  /** Tempo return (Riding): the incoming eases from the window rate back
   * to native, completing here. === mixEndSec when there is no ramp
   * (hard cuts, native windows, Fixed policy, zero runway). */
  tempoReturnEndSec: number;
  /** The incoming's track position at mixEndSec, for adjacencies with no
   * authored window to derive it from (routine adjacencies only): the
   * Tempo return quadratic eases from here (routines 159). */
  incomingTrackSecAtWindowEnd?: number;
}

/** hardcut covers no applicable Transition: nothing to resolve, an
 * explicit Hard-cut pin (sets 26), dangling pins, failed Take
 * vectorization; the windowed variants carry the executed Transition
 * (idealized for Takes). */
export type PlannedAdjacency =
  | (PlannedAdjacencyBase & { kind: 'hardcut'; transition?: undefined })
  | (PlannedAdjacencyBase & { kind: 'transition' | 'take'; transition: Transition })
  /** Covered by a pinned Routine (routines 159): the recording plays this
   * handover; plan.routines[routineIndex] carries the replay. The LAST
   * covered adjacency spans to the Routine's end and carries the exit
   * slot's Tempo return. */
  | (PlannedAdjacencyBase & { kind: 'routine'; transition?: undefined; routineIndex: number });

/** A planner-synthesized early exit (sets 14): the entry's tail was
 * truncated to free its deck for a colliding window, with a fade-out
 * ramp replacing the authored tail (which is unreachable and dropped). */
export interface GraceFade {
  /** The synthesized fade begins here, reaching silence at exitMixSec. */
  fadeStartMixSec: number;
  /** The role-fader's authored value at the fade start — the ramp runs
   * from here to 0, REPLACING the authored tail. */
  fadeStartValue: number;
  /** Where the tail would have played to, as authored (ladder renders
   * the clipped region distinctly). */
  authoredExitSec: number;
  authoredExitMixSec: number;
}

export interface PlannedEntry {
  trackId: number;
  deck: PlanDeck;
  /** Mix time where this track's time 0 sits at its solo `rate` — its
   * solo-stretch anchor (valid after its entry window and Tempo return
   * end): trackTime = (mix − mixOffsetSec) · rate. */
  mixOffsetSec: number;
  /** Solo playback rate (1 under Riding; setTempo/bpm under Fixed). */
  rate: number;
  /** Track time first / last audible. */
  entrySec: number;
  exitSec: number;
  /** The audible span on the mix axis. */
  entryMixSec: number;
  exitMixSec: number;
  /** Per-entry trim offset from neutral, knob units (sets #164; 0 =
   * neutral). Applied to the deck's lanes for this entry's tenure —
   * artifact-recorded trim wins during its window (withEntryTrim). */
  trim: number;
  /** Present when the planner truncated this entry's tail (sets 14). */
  graceFade?: GraceFade;
}

/** A plan degeneracy, keyed to the adjacency (or entry) it afflicts —
 * the Set view renders these on the affected row (sets 06). */
export interface PlanWarning {
  severity: 'warning' | 'error';
  kind:
    | 'window-past-end'
    | 'window-overlap'
    | 'incoming-ends-inside-window'
    | 'insufficient-runway'
    | 'no-bpm'
    | 'pitch-clamped'
    | 'grace-fade'
    | 'grace-floor'
    | 'entry-after-exit'
    | 'routine-invalid'
    | 'routine-window-collision'
    | 'routine-deck-overflow'
    | 'routine-global-controls-dropped';
  message: string;
  adjacencyIndex?: number;
  entryIndex?: number;
}

export interface SetPlan {
  entries: PlannedEntry[];
  adjacencies: PlannedAdjacency[];
  /** Pinned Routine replays (routines 159), in mix order. Covered
   * adjacencies point in by routineIndex. */
  routines: PlannedRoutine[];
  /** Mix length: the last track's exit instant. */
  totalSec: number;
  /** Non-fatal degeneracies (overlapping windows, insufficient Tempo
   * return runway, …): the plan stays playable; the UI surfaces these. */
  warnings: PlanWarning[];
}

/** Plan durations as "m:ss" (per-row played time, toolbar set length). */
export function fmtSec(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.max(0, Math.round(s - m * 60));
  return `${m}:${String(r).padStart(2, '0')}`;
}

/** Resolve an adjacency's pin to the Transition it executes (idealizing
 * Take pins through the vectorizer), or null → hard cut. Entries arrive
 * already library-resolved (sets 26, `resolvePlanPins` upstream): a null
 * pin here means a genuinely evidence-less adjacency, and an explicit
 * Hard-cut pin falls through to null — both cut. A Routine pin ALSO
 * falls through to null here: its replay rides `input.routines` (the
 * head index builds the 'routine' adjacency before pin resolution runs,
 * sets #159/#161), so reaching this switch with a routine pin means the
 * artifact is dangling or invalid — the head degrades to a hard cut
 * (resolvePlanPins already hard-cut the covered interior adjacencies). */
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
  const routines: PlannedRoutine[] = [];
  const warnings: PlanWarning[] = [];
  if (input.entries.length === 0) {
    return { entries, adjacencies, routines, totalSec: 0, warnings };
  }

  const tempo: TempoPolicyInput = input.tempo ?? { policy: 'riding' };
  const factsOf = (trackId: number): PlannerTrackFacts =>
    input.tracks[trackId] ?? { durationSec: 0, bpm: null, hotCue1Sec: null };

  // Fixed policy: the Set tempo (explicit, else the first track's native
  // BPM) fixes every entry's deck rate up front, clamped to the decks'
  // varispeed range. Riding: everything solos at native rate.
  const setTempo =
    tempo.policy === 'fixed'
      ? (tempo.setTempoBpm ?? factsOf(input.entries[0].trackId).bpm)
      : null;
  if (tempo.policy === 'fixed' && setTempo === null) {
    warnings.push({
      severity: 'warning',
      kind: 'no-bpm',
      entryIndex: 0,
      message: 'no Set tempo — the first track has no BPM; the set plays at native tempo',
    });
  }
  const rates = input.entries.map(({ trackId }, i) => {
    if (setTempo === null) return 1;
    const bpm = factsOf(trackId).bpm;
    if (!bpm) {
      warnings.push({
        severity: 'warning',
        kind: 'no-bpm',
        entryIndex: i,
        message: `track ${i + 1} has no BPM — it plays at native tempo, off the Set tempo`,
      });
      return 1;
    }
    const pitch = (setTempo / bpm - 1) * 100;
    const clamped = Math.max(-MAX_PITCH_RANGE_PERCENT, Math.min(MAX_PITCH_RANGE_PERCENT, pitch));
    if (clamped !== pitch) {
      warnings.push({
        severity: 'warning',
        kind: 'pitch-clamped',
        entryIndex: i,
        message: `track ${i + 1} needs ${pitch.toFixed(1)}% to hold the Set tempo — clamped to ±${MAX_PITCH_RANGE_PERCENT}%`,
      });
    }
    return 1 + clamped / 100;
  });

  // Pre-resolve every adjacency's pin: the Riding runway constraint looks
  // one adjacency ahead (the ramp must complete before the NEXT window).
  const resolvedPins = input.entries.map((e, i) => {
    const next = input.entries[i + 1];
    if (!next) return null;
    return resolvePin(e.pin, input, factsOf(e.trackId).bpm, factsOf(next.trackId).bpm);
  });

  // Pinned Routines (routines 159), validated: the cast must be the next
  // n entries by BOUNDARIES + MEMBERSHIP (offerability's rule, sets 160 /
  // ADR 0035 — interior Set order is presentational; the recorded
  // choreography defines interior play order), with every cast track
  // carrying a BPM (the beat-domain clock needs a target rate). Invalid
  // ones plan as if unpinned — library/beatgrid decay never corrupts a
  // Set, same doctrine as dangling pins.
  const routineByStart = new Map<number, RoutinePlanInput>();
  for (const { startEntryIndex, routine } of input.routines ?? []) {
    const n = routine.cast.length;
    const invalid = (msg: string) =>
      warnings.push({
        severity: 'warning',
        kind: 'routine-invalid',
        adjacencyIndex: startEntryIndex,
        message: `routine pin skipped: ${msg}`,
      });
    if (n < 3) {
      invalid('n ≥ 3 — a 2-cast routine is a Transition (ADR 0035)');
      continue;
    }
    if (
      routine.entryOffsetsBeats.length !== n ||
      routine.entryPositions.length !== n ||
      startEntryIndex < 0 ||
      startEntryIndex + n > input.entries.length
    ) {
      invalid('cast does not fit the Set at its pinned position');
      continue;
    }
    // Same rule as routineOfferable (adjacency.ts): both boundaries in
    // place, membership exact — interior reorder never degrades replay
    // (#160's dormancy lets the pin ride it; the plan must too, #161).
    const span = input.entries
      .slice(startEntryIndex, startEntryIndex + n)
      .map((e) => e.trackId);
    const members = new Set(routine.cast);
    const castMatches =
      span[0] === routine.cast[0] &&
      span[n - 1] === routine.cast[n - 1] &&
      members.size === n &&
      span.every((tid) => members.has(tid));
    if (!castMatches) {
      invalid('cast no longer matches the next entries (boundaries + membership)');
      continue;
    }
    if (routine.cast.some((tid) => !factsOf(tid).bpm)) {
      invalid('a cast track has no BPM — the beat-domain clock cannot scale');
      continue;
    }
    const overlaps = [...routineByStart.entries()].some(
      ([start, r]) => startEntryIndex > start && startEntryIndex < start + r.cast.length - 1
    );
    if (overlaps) {
      invalid('overlaps another pinned routine mid-span');
      continue;
    }
    routineByStart.set(startEntryIndex, routine);
  }

  /** The incoming entry's next boundary in ITS OWN track time — where a
   * Tempo return ramp must complete by: its next window start, a routine
   * window start when a Routine pins there, else its end. */
  const nextBoundaryTrackSec = (entryIdx: number): number => {
    const routine = routineByStart.get(entryIdx);
    if (routine) return Math.max(0, routine.entryPositions[0]);
    return (
      resolvedPins[entryIdx]?.transition.startSec ??
      factsOf(input.entries[entryIdx].trackId).durationSec
    );
  };

  // Walk the chain accumulating each track's mix anchor (time 0's mix
  // instant at its solo rate). The first track opens the set from its
  // very beginning (cues are performance markers, not set boundaries):
  // time 0 at mix 0.
  let mixOffset = 0;
  let entrySec = 0;
  let entryMixSec = 0;
  // Deck assignment: alternate within A/B ("the first of A→B not equal
  // to the previous entry's deck" — exactly ping-pong parity when no
  // Routine intervenes). A Routine allocates its interior slots across
  // A→B→C→D and forces its exit slot's deck onto the exit entry.
  let prevDeck: PlanDeck = 'B';
  let forcedDeck: PlanDeck | null = null;

  for (let i = 0; i < input.entries.length; i++) {
    const { trackId } = input.entries[i];
    const facts = factsOf(trackId);
    const rate = rates[i];
    /** Entry i's track time → global mix time (solo-rate mapping). */
    const toMix = (t: number) => mixOffset + t / rate;
    const deck: PlanDeck = forcedDeck ?? (prevDeck === 'A' ? 'B' : 'A');
    forcedDeck = null;
    prevDeck = deck;
    const next = input.entries[i + 1];

    // ── Routine span (routines 159) ─────────────────────────────────────
    const pinnedRoutine = routineByStart.get(i);
    if (pinnedRoutine && next) {
      const n = pinnedRoutine.cast.length;
      // The window opens where the recording's slot-0 entry mark sits on
      // this entry's own timeline: the sounding deck is ADOPTED there.
      const mixStartSec = toMix(Math.max(0, pinnedRoutine.entryPositions[0]));
      const prevAdj = adjacencies[adjacencies.length - 1];
      if (mixStartSec < entryMixSec || (prevAdj && mixStartSec < prevAdj.tempoReturnEndSec)) {
        warnings.push({
          severity: 'warning',
          kind: 'routine-window-collision',
          adjacencyIndex: i,
          message:
            'routine window opens before the entry track settles (inside its own entry window or Tempo return) — replay timing is approximate there',
        });
      }
      // Replay tempo: the Set tempo under Fixed; slot 0's native BPM
      // under Riding (the entry track solos at native rate — adopting it
      // IS the pitch anchor).
      const targetBpm = setTempo ?? factsOf(pinnedRoutine.cast[0]).bpm!;
      const { routine: planned, warnings: buildWarnings } = buildPlannedRoutine(pinnedRoutine, {
        startEntryIndex: i,
        mixStartSec,
        targetBpm,
        adoptedDeck: deck,
        // Every pushed entry is a potential external occupant — a rolling
        // junction (sets #143) may leave a THIRD deck sounding into the
        // span, not just the previous entry.
        busy: entries.map((e) => ({ deck: e.deck, untilMixSec: e.exitMixSec })),
        trackBpms: pinnedRoutine.cast.map((tid) => factsOf(tid).bpm!),
      });
      routines.push(planned);
      const routineIndex = routines.length - 1;
      for (const w of buildWarnings) {
        warnings.push({ ...w, adjacencyIndex: i });
      }

      // Slot 0 = this entry, adopted: audible until the Routine end (its
      // recorded fade lives in the replay lanes).
      const slot0End = traceStateAt(planned.slots[0].trace, pinnedRoutine.durationBeats);
      entries.push({
        trackId,
        deck,
        mixOffsetSec: mixOffset,
        rate,
        entrySec,
        exitSec: Math.max(0, slot0End.pos),
        entryMixSec,
        exitMixSec: planned.mixEndSec,
        trim: input.entries[i].trim ?? 0,
      });

      // Covered adjacencies + interior entries. The last covered
      // adjacency spans to the Routine end and carries the exit slot's
      // Tempo return (Riding eases the pitched exit back to native).
      const exitIdx = i + n - 1;
      const exit = planned.exit;
      const exitRate = 1 + exit.pitchPercent / 100;
      let exitTempoReturnEndSec = planned.mixEndSec;
      let exitMixOffset: number;
      if (tempo.policy === 'riding' && exit.pitchPercent !== 0) {
        const secPerPercent = tempo.returnSecPerPercent ?? DEFAULT_TEMPO_RETURN_SEC_PER_PERCENT;
        const desired = Math.abs(exit.pitchPercent) * secPerPercent;
        const boundary =
          exitIdx + 1 < input.entries.length
            ? nextBoundaryTrackSec(exitIdx)
            : factsOf(input.entries[exitIdx].trackId).durationSec;
        const dMax = Math.max(0, (2 * (boundary - exit.trackSecAtEnd)) / (1 + exitRate));
        const d = Math.min(desired, dMax);
        if (d < desired) {
          warnings.push({
            severity: 'warning',
            kind: 'insufficient-runway',
            adjacencyIndex: exitIdx - 1,
            message: `solo stretch too short for the Tempo return — ramp clamped from ${desired.toFixed(1)}s to ${d.toFixed(1)}s`,
          });
        }
        exitTempoReturnEndSec = planned.mixEndSec + d;
        exitMixOffset = exitTempoReturnEndSec - (exit.trackSecAtEnd + (d * (exitRate + 1)) / 2);
      } else {
        exitMixOffset = planned.mixEndSec - exit.trackSecAtEnd / rates[exitIdx];
      }

      for (let k = 0; k < n - 1; k++) {
        const incoming = planned.slots[k + 1];
        const isLast = k === n - 2;
        adjacencies.push({
          kind: 'routine',
          routineIndex,
          rateIncoming: 1 + incoming.basePitchPercent / 100,
          pitchIncomingPercent: incoming.basePitchPercent,
          rateOutgoing: 1,
          mixStartSec: incoming.entryMixSec,
          mixEndSec: isLast ? planned.mixEndSec : incoming.entryMixSec,
          tempoReturnEndSec: isLast ? exitTempoReturnEndSec : incoming.entryMixSec,
          incomingTrackSecAtWindowEnd: isLast ? exit.trackSecAtEnd : undefined,
        });
        if (!isLast) {
          const slotRate = 1 + incoming.basePitchPercent / 100;
          const interiorEnd = traceStateAt(incoming.trace, pinnedRoutine.durationBeats);
          entries.push({
            trackId: incoming.trackId,
            deck: incoming.deck ?? 'A',
            mixOffsetSec: incoming.entryMixSec - Math.max(0, incoming.entryTrackSec) / slotRate,
            rate: slotRate,
            entrySec: Math.max(0, incoming.entryTrackSec),
            exitSec: Math.max(0, interiorEnd.pos),
            entryMixSec: incoming.entryMixSec,
            exitMixSec: planned.mixEndSec,
            // The slot's track finds its own covered entry (interior Set
            // order may differ from slot order — presentational only).
            trim:
              input.entries
                .slice(i, i + n)
                .find((e) => e.trackId === incoming.trackId)?.trim ?? 0,
          });
        }
      }

      // Continue the walk AT the exit entry: it keeps sounding on the
      // exit slot's deck, anchored so its track time continues seamlessly
      // from the recording's final position.
      mixOffset = exitMixOffset;
      entrySec = Math.max(0, pinnedRoutine.entryPositions[n - 1]);
      entryMixSec = planned.slots[n - 1].entryMixSec;
      forcedDeck = exit.deck;
      prevDeck = exit.deck;
      i = exitIdx - 1; // the for-increment lands on the exit entry
      continue;
    }

    if (!next) {
      // Last track: plays to its end; the set stops there.
      entries.push({
        trackId,
        deck,
        mixOffsetSec: mixOffset,
        rate,
        entrySec,
        exitSec: facts.durationSec,
        entryMixSec,
        exitMixSec: toMix(facts.durationSec),
        trim: input.entries[i].trim ?? 0,
      });
      break;
    }

    const nextFacts = factsOf(next.trackId);
    const rateIn = rates[i + 1];
    const resolved = resolvedPins[i];

    if (!resolved) {
      // Hard cut: outgoing to its end, incoming from its Hot Cue 1
      // (track start when slot 1 is unset — never the Main cue).
      const cutMix = toMix(facts.durationSec);
      entries.push({
        trackId,
        deck,
        mixOffsetSec: mixOffset,
        rate,
        entrySec,
        exitSec: facts.durationSec,
        entryMixSec,
        exitMixSec: cutMix,
        trim: input.entries[i].trim ?? 0,
      });
      adjacencies.push({
        kind: 'hardcut',
        rateIncoming: 1,
        pitchIncomingPercent: 0,
        rateOutgoing: rate,
        mixStartSec: cutMix,
        mixEndSec: cutMix,
        tempoReturnEndSec: cutMix,
      });
      const entryIn = nextFacts.hotCue1Sec ?? 0;
      mixOffset = cutMix - entryIn / rateIn;
      entrySec = entryIn;
      entryMixSec = cutMix;
      continue;
    }

    const { kind, transition } = resolved;
    // B's advance per AUTHORED window second, and the incoming's deck
    // pitch during the window. Riding: the tempo-match ride (rate ≡ deck
    // rate). Fixed: both decks hold their Set-tempo rates; the window
    // stretches by 1/rateOut, so B advances at rateIn/rateOut per
    // authored second — tempo-matched by construction (the flag is moot).
    let rateB: number;
    let pitchIncoming: number;
    if (setTempo !== null) {
      rateB = rateIn / rate;
      pitchIncoming = (rateIn - 1) * 100;
    } else {
      pitchIncoming = transition.tempoMatch ? tempoMatchPitch(facts.bpm, nextFacts.bpm) : 0;
      rateB = 1 + pitchIncoming / 100;
    }

    // Window on the mix axis: the Transition's start/duration live in the
    // outgoing track's own time (Sketch origin), which IS this stretch of
    // the mix axis shifted by the outgoing's anchor and scaled by its rate.
    const windowEndLocal = transition.startSec + transition.durationSec;
    const mixStartSec = toMix(transition.startSec);
    const mixEndSec = toMix(windowEndLocal);
    if (transition.startSec > facts.durationSec) {
      warnings.push({
        severity: 'warning',
        kind: 'window-past-end',
        adjacencyIndex: i,
        message: `window starts past the outgoing track's end (silent gap)`,
      });
    }
    const prev = adjacencies[adjacencies.length - 1];
    if (prev && mixStartSec < prev.mixEndSec) {
      warnings.push({
        severity: 'warning',
        kind: 'window-overlap',
        adjacencyIndex: i,
        message: `window overlaps the previous handover`,
      });
    }

    // Rolling junction (sets #143): when this window opens while the
    // incoming's default deck still carries an audible occupant (an
    // overlapping previous window, or a hard-cut tail running long), the
    // incoming takes the first FREE deck in A→B→C→D order (#159's
    // allocation preference) instead of colliding into the grace fade —
    // the junction plays as performed, every track briefly audible. The
    // grace machinery remains for load-headroom pressure (occupant exits
    // before the window but inside the headroom) and TRUE deck
    // exhaustion (nothing free: fall through to ping-pong; the fade or
    // floor rules there).
    const defaultIn: PlanDeck = deck === 'A' ? 'B' : 'A';
    const busyAt = (d: PlanDeck): boolean =>
      d === deck || entries.some((e) => e.deck === d && e.exitMixSec > mixStartSec);
    if (busyAt(defaultIn)) {
      const free = PLAN_DECKS.find((d) => !busyAt(d));
      if (free) {
        forcedDeck = free;
        // A junction the decks absorb is a performance, not a
        // degeneracy: drop the overlap chip (the grace transform's
        // subsume rule, same doctrine).
        const overlapIdx = warnings.findIndex(
          (w) => w.kind === 'window-overlap' && w.adjacencyIndex === i
        );
        if (overlapIdx >= 0) warnings.splice(overlapIdx, 1);
      }
    }

    const bAtWindowEnd = bTrackTimeAt(transition, windowEndLocal, rateB);
    if (bAtWindowEnd > nextFacts.durationSec) {
      warnings.push({
        severity: 'warning',
        kind: 'incoming-ends-inside-window',
        adjacencyIndex: i,
        message: `incoming track ends inside the window`,
      });
    }

    // Tempo return (Riding): ease the incoming from the window rate back
    // to native after the window. The ramp must complete before the
    // incoming's NEXT boundary (its next window start, else its end) —
    // in its own track time that boundary is `nextBoundary`, the ramp
    // covers d·(rateB+1)/2 of track time, hence dMax. Clamp faster
    // rather than stay incomplete; flag the clamp.
    let tempoReturnEndSec = mixEndSec;
    let nextMixOffset: number;
    if (tempo.policy === 'riding' && pitchIncoming !== 0) {
      const secPerPercent = tempo.returnSecPerPercent ?? DEFAULT_TEMPO_RETURN_SEC_PER_PERCENT;
      const desired = Math.abs(pitchIncoming) * secPerPercent;
      const nextBoundary = nextBoundaryTrackSec(i + 1);
      const dMax = Math.max(0, (2 * (nextBoundary - bAtWindowEnd)) / (1 + rateB));
      const d = Math.min(desired, dMax);
      if (d < desired) {
        warnings.push({
          severity: 'warning',
          kind: 'insufficient-runway',
          adjacencyIndex: i,
          message: `solo stretch too short for the Tempo return — ramp clamped from ${desired.toFixed(1)}s to ${d.toFixed(1)}s`,
        });
      }
      tempoReturnEndSec = mixEndSec + d;
      nextMixOffset = tempoReturnEndSec - (bAtWindowEnd + (d * (rateB + 1)) / 2);
    } else {
      nextMixOffset = mixEndSec - bAtWindowEnd / rateIn;
    }

    // Outgoing exits at the window end — SIMULATED THROUGH ITS JUMPS
    // (issue 177): the exit instant on the authored (elapsed-play) axis is
    // the window end or A's first track-end crossing on the jumped path,
    // whichever is first; the exit TRACK position applies the passed jump
    // deltas. Without jumpsA this is the old min(windowEnd, durA) pair.
    const exitLocal = aEndMixTime(transition, facts.durationSec);
    const exitSec = Math.min(
      facts.durationSec,
      Math.max(0, aTrackTimeAt(transition, exitLocal))
    );
    entries.push({
      trackId,
      deck,
      mixOffsetSec: mixOffset,
      rate,
      entrySec,
      exitSec,
      entryMixSec,
      exitMixSec: toMix(exitLocal),
      trim: input.entries[i].trim ?? 0,
    });
    adjacencies.push({
      kind,
      transition,
      pinUuid: input.entries[i].pin?.uuid,
      rateIncoming: rateB,
      pitchIncomingPercent: pitchIncoming,
      rateOutgoing: rate,
      mixStartSec,
      mixEndSec,
      tempoReturnEndSec,
    });

    // Incoming: audible entry from the model's piecewise walk (defers past
    // lead gaps / below-zero jumps), converted from the authored window
    // axis onto the mix axis via the outgoing's rate.
    const segments = bContentSegments(transition, nextFacts.durationSec, rateB);
    if (segments.length > 0) {
      entrySec = segments[0].bStartSec;
      entryMixSec = mixStartSec + (segments[0].mixStartSec - transition.startSec) / rate;
    } else {
      entrySec = Math.max(0, Math.min(bAtWindowEnd, nextFacts.durationSec));
      entryMixSec = mixEndSec;
    }
    mixOffset = nextMixOffset;
  }

  applyGraceFades(entries, adjacencies, warnings, input.grace);
  flagEntriesAfterExit(entries, adjacencies, warnings);

  const last = entries[entries.length - 1];
  return { entries, adjacencies, routines, totalSec: Math.max(0, last.exitMixSec), warnings };
}

/** True when a planned entry never becomes audible: it enters at/after
 * its own exit. THE never-audible condition — the `entry-after-exit`
 * warning and the Set view's NEVER AUDIBLE badge both read it. */
export function isNeverAudible(e: Pick<PlannedEntry, 'entrySec' | 'exitSec'>): boolean {
  return e.entrySec > 0 && e.exitSec <= e.entrySec;
}

/**
 * Entry-after-exit (sets 19): an entry planned to enter at/after its own
 * exit never becomes audible ("plays 0:00"). Distinct from window overlap
 * — the classic case is a hard-cut entry (Hot Cue 1) sitting after the
 * entry's own pinned mix-out. Named with the real numbers; the Set view
 * additionally badges the row NEVER AUDIBLE.
 */
function flagEntriesAfterExit(
  entries: PlannedEntry[],
  adjacencies: PlannedAdjacency[],
  warnings: PlanWarning[]
): void {
  entries.forEach((e, i) => {
    if (!isNeverAudible(e)) return;
    // The entry exits through adjacency i (windowed → its pinned mix-out;
    // hard cut or last entry → its own track end).
    const exitAdj = adjacencies[i];
    const exitName =
      exitAdj && exitAdj.kind !== 'hardcut' ? 'pinned mix-out' : 'track end';
    warnings.push({
      severity: 'error',
      kind: 'entry-after-exit',
      entryIndex: i,
      message: `track ${i + 1} is never audible: planned entry ${fmtSec(e.entrySec)} is after the ${exitName} ${fmtSec(e.exitSec)}`,
    });
  });
}

/**
 * Grace fade (sets 14) — a planner TRANSFORM, not runtime improvisation.
 * When adjacency j's window opens, its incoming (entry j+1) needs the
 * deck entry j−1 occupies (ping-pong parity). If entry j−1 is still
 * audible within `headroom` of that instant, truncate it early — exit at
 * mixStart − headroom with a synthesized fade-out replacing the authored
 * tail — so the deck frees in time to load. Authored windows NEVER shift
 * (pins play the exact move intended; hard-cut instants stay derived
 * from the authored end — the price of a truncated hard-cut tail is up
 * to `headroom` of planned silence). Degenerate floor: truncation that
 * would cut into entry j−1's own entry window plans as-authored with an
 * error flag instead. See docs/adr on the grace fade for the rationale.
 */
function applyGraceFades(
  entries: PlannedEntry[],
  adjacencies: PlannedAdjacency[],
  warnings: PlanWarning[],
  grace: PlanInput['grace']
): void {
  const headroom = grace?.headroomSec ?? DEFAULT_GRACE_HEADROOM_SEC;
  const fadeLen = grace?.fadeSec ?? DEFAULT_GRACE_FADE_SEC;

  for (let j = 1; j < adjacencies.length; j++) {
    const incoming = entries[j + 1];
    // Routine spans manage their own decks (allocation, routines 159):
    // never truncate into one.
    if (!incoming || adjacencies[j].kind === 'routine') continue;
    // The victim is the LATEST earlier entry holding the incoming's deck
    // — ping-pong parity's j−1 when no rolling junction re-allocated
    // decks (sets #143), else whoever the exhausted allocation fell back
    // onto. Only a REAL deck collision fades; a victim inside a Routine
    // span is the span's business (never truncate out of one).
    let v = -1;
    for (let k = j; k >= 0; k--) {
      if (entries[k].deck === incoming.deck) {
        v = k;
        break;
      }
    }
    if (v < 0 || adjacencies[v]?.kind === 'routine') continue;
    const victim = entries[v];
    const needMix = adjacencies[j].mixStartSec - headroom;
    if (victim.exitMixSec <= needMix) continue;

    // This transform (or its floor flag) subsumes the raw window-overlap
    // warning — one chip per collision.
    const overlapIdx = warnings.findIndex(
      (w) => w.kind === 'window-overlap' && w.adjacencyIndex === j
    );
    if (overlapIdx >= 0) warnings.splice(overlapIdx, 1);

    // Floor: never cut into the victim's own entry window (nor before it
    // entered at all) — plan as-authored and flag the pileup.
    const entryAdj = v >= 1 ? adjacencies[v - 1] : undefined;
    const floorMix =
      entryAdj && entryAdj.kind !== 'hardcut' ? entryAdj.mixEndSec : victim.entryMixSec;
    if (needMix <= floorMix) {
      warnings.push({
        severity: 'error',
        kind: 'grace-floor',
        adjacencyIndex: j,
        message: `overlap pileup: freeing the deck ${headroom.toFixed(0)}s before this window would cut into the previous track's own entry — plays as authored (expect a jump-cut)`,
      });
      continue;
    }

    // The victim exits through its own adjacency (index v). The fade
    // rides its role-fader: the authored outgoing fader if the fade sits
    // inside that window, else the solo fader (1).
    const exitAdj = adjacencies[v];
    const fadeStartMixSec = Math.max(needMix - fadeLen, floorMix);
    const fadeStartValue =
      exitAdj && isWindowed(exitAdj) && fadeStartMixSec >= exitAdj.mixStartSec
        ? laneValuesAt(exitAdj.transition, authoredLocalAt(exitAdj, fadeStartMixSec)).faderA
        : 1;
    entries[v] = {
      ...victim,
      exitSec: Math.max(0, playingTrackTimeAt(entries, adjacencies, v, needMix).trackTime),
      exitMixSec: needMix,
      graceFade: {
        fadeStartMixSec,
        fadeStartValue,
        authoredExitSec: victim.exitSec,
        authoredExitMixSec: victim.exitMixSec,
      },
    };
    warnings.push({
      severity: 'warning',
      kind: 'grace-fade',
      adjacencyIndex: j,
      message: `overlap: the previous track fades out ${(victim.exitMixSec - needMix).toFixed(1)}s early to free its deck for this handover`,
    });
  }
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
  /** Varispeed percent: the window's ride while the entry window runs,
   * easing off through the Tempo return (Riding); the entry's constant
   * Set-tempo pitch under Fixed. */
  pitchPercent: number;
}

/** Mixer automation per physical deck, in the Mixer's domain (fader/EQ
 * 0..1, filter −1..1) — role lanes already mapped onto decks. */
export interface PlanAutomation {
  fader: number;
  eq: { low: number; mid: number; high: number };
  filter: number;
  /** Absolute trim knob position (0..1); ABSENT = the live user's trim
   * rules (the mixer overlay's optional-trim contract, sessions 15).
   * Carried when the deck's entry holds a non-neutral trim offset
   * (sets #164), or by future artifact-recorded trim lanes — which win
   * during their window (withEntryTrim). */
  trim?: number;
}

export interface PlanState {
  decks: Record<PlanDeck, PlanDeckState>;
  lanes: Record<PlanDeck, PlanAutomation>;
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

/**
 * Overlay an entry's trim offset (sets #164) onto a deck's lanes: a lane
 * ALREADY carrying trim is artifact-recorded (vectorized trim lanes,
 * future Routine spans) and wins during its window untouched; the entry
 * offset is the baseline everywhere else — applied as neutral + offset,
 * clamped to the knob. Offset-from-neutral on purpose: track Autogain
 * (ADR 0034) will replace the neutral term, not fight the offset.
 */
export function withEntryTrim(lane: PlanAutomation, trimOffset: number): PlanAutomation {
  if (trimOffset === 0 || lane.trim !== undefined) return lane;
  return { ...lane, trim: Math.max(0, Math.min(1, TRIM_NEUTRAL + trimOffset)) };
}

function isWindowed(adj: PlannedAdjacency): adj is WindowedAdjacency {
  return adj.kind === 'transition' || adj.kind === 'take';
}

/** A planned adjacency that executes a window (not a hard cut). */
type WindowedAdjacency = Extract<PlannedAdjacency, { transition: Transition }>;

/** Global mix time → the AUTHORED window axis (the outgoing track's own
 * time as sketched in the editor): the window sits at mixStartSec and
 * runs at rateOutgoing authored seconds per mix second. */
function authoredLocalAt(adj: WindowedAdjacency, mixTime: number): number {
  return adj.transition.startSec + (mixTime - adj.mixStartSec) * adj.rateOutgoing;
}

/** Entry `idx`'s track time + deck pitch at a mix instant WHILE PLAYING:
 * riding its entry window, easing through the Tempo return, else on its
 * solo anchor. Shared by planStateAt and the grace-fade transform. */
function playingTrackTimeAt(
  entries: PlannedEntry[],
  adjacencies: PlannedAdjacency[],
  idx: number,
  mixTime: number
): { trackTime: number; pitchPercent: number } {
  const entry = entries[idx];
  const entryAdj = idx > 0 ? adjacencies[idx - 1] : undefined;
  // A Routine exit entry (routines 159): past the Routine end it may
  // still be easing back to native (Riding) — the same quadratic as a
  // window's Tempo return, anchored on the recording's final position.
  if (
    entryAdj &&
    entryAdj.kind === 'routine' &&
    entryAdj.incomingTrackSecAtWindowEnd !== undefined &&
    mixTime < entryAdj.tempoReturnEndSec &&
    entryAdj.tempoReturnEndSec > entryAdj.mixEndSec
  ) {
    const d = entryAdj.tempoReturnEndSec - entryAdj.mixEndSec;
    const tau = mixTime - entryAdj.mixEndSec;
    const r = entryAdj.rateIncoming;
    const b = entryAdj.incomingTrackSecAtWindowEnd;
    return {
      trackTime: b + r * tau + ((1 - r) * tau * tau) / (2 * d),
      pitchPercent: entryAdj.pitchIncomingPercent * (1 - tau / d),
    };
  }
  const windowed = entryAdj && isWindowed(entryAdj) ? entryAdj : null;
  if (windowed && mixTime < windowed.mixEndSec) {
    // NOT clamped at 0: a negative position is the window's silent lead
    // (alignment or a Jump puts the incoming before its track start) —
    // planStateAt parks the deck on it (#161; the adjacency sibling of
    // the Routine negative-lead rule). Clamping while "playing" made the
    // Conductor re-seek the incoming to 0 for the whole lead.
    return {
      trackTime: bTrackTimeAt(
        windowed.transition,
        authoredLocalAt(windowed, mixTime),
        windowed.rateIncoming
      ),
      pitchPercent: windowed.pitchIncomingPercent,
    };
  }
  if (windowed && mixTime < windowed.tempoReturnEndSec) {
    // Tempo return (Riding): rate eases linearly from the window rate r
    // to 1 over the ramp, so track time advances quadratically.
    const d = windowed.tempoReturnEndSec - windowed.mixEndSec;
    const tau = mixTime - windowed.mixEndSec;
    const r = windowed.rateIncoming;
    const b = bTrackTimeAt(
      windowed.transition,
      windowed.transition.startSec + windowed.transition.durationSec,
      r
    );
    return {
      trackTime: b + r * tau + ((1 - r) * tau * tau) / (2 * d),
      pitchPercent: windowed.pitchIncomingPercent * (1 - tau / d),
    };
  }
  // Inside the entry's own EXIT window the OUTGOING may Jump (issue 177):
  // the solo anchor stays valid for the elapsed-play axis (mix time keeps
  // advancing linearly at the entry's rate — the doctrine), and the deck's
  // TRACK position adds the deltas of every passed outgoing jump. Before
  // the window no jump has passed (window-scoped), so this is the plain
  // solo anchor there too.
  const exitAdj = adjacencies[idx];
  if (exitAdj && isWindowed(exitAdj) && exitAdj.transition.jumpsA?.length) {
    return {
      trackTime: Math.max(
        0,
        aTrackTimeAt(exitAdj.transition, authoredLocalAt(exitAdj, mixTime))
      ),
      pitchPercent: (entry.rate - 1) * 100,
    };
  }
  return {
    trackTime: (mixTime - entry.mixOffsetSec) * entry.rate,
    pitchPercent: (entry.rate - 1) * 100,
  };
}

export function planStateAt(plan: SetPlan, mixTime: number): PlanState {
  const state: PlanState = {
    decks: { A: { ...IDLE_DECK }, B: { ...IDLE_DECK }, C: { ...IDLE_DECK }, D: { ...IDLE_DECK } },
    lanes: { A: soloLanes(0), B: soloLanes(0), C: soloLanes(0), D: soloLanes(0) },
    activeEntryIndex: 0,
    done: plan.entries.length === 0 || mixTime >= plan.totalSec,
  };
  if (plan.entries.length === 0) return state;

  for (const deck of PLAN_DECKS) {
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
    // rate and jump deltas (bTrackTimeAt on the authored window axis);
    // through the Tempo return it eases back to native (Riding);
    // everywhere else the solo-rate anchor rules.
    let trackTime: number;
    let pitchPercent: number;
    let audible = playing;
    if (playing) {
      ({ trackTime, pitchPercent } = playingTrackTimeAt(plan.entries, plan.adjacencies, idx, mixTime));
      // Silent lead (#161, adjacency sibling of the Routine rule): a
      // window whose alignment or Jumps put the incoming BEFORE its track
      // start parks the deck at 0 until the plan crosses 0 — a "playing"
      // target pinned at 0 would make the Conductor re-seek it every tick
      // for the whole lead.
      if (trackTime < 0) {
        trackTime = 0;
        audible = false;
      }
    } else {
      // Parked: at the planned entry before playing, at the exit after.
      trackTime = Math.max(0, idx === active || idx === upcoming ? entry.entrySec : entry.exitSec);
      pitchPercent = (entry.rate - 1) * 100;
    }
    state.decks[deck] = {
      entryIndex: idx,
      trackId: entry.trackId,
      trackTime,
      playing: audible,
      pitchPercent,
    };
  }

  // activeEntryIndex: the latest entry whose audible span has begun.
  for (let i = 0; i < plan.entries.length; i++) {
    if (plan.entries[i].entryMixSec <= mixTime) state.activeEntryIndex = i;
  }

  // Lanes: every containing window's role lanes mapped onto physical
  // decks, applied in adjacency order — at a rolling junction (sets
  // #143, overlapping windows) the LATER window owns the shared track's
  // lanes from its window start (map #114's authority rule: its writes
  // to the shared deck land last; the earlier window keeps governing
  // only its own outgoing). Playing decks no active window touches solo
  // at full fader (e.g. a hard-cut tail running through someone else's
  // junction).
  const covered = new Set<PlanDeck>();
  if (!state.done) {
    plan.adjacencies.forEach((windowAdj, windowIdx) => {
      if (!isWindowed(windowAdj) || mixTime < windowAdj.mixStartSec || mixTime >= windowAdj.mixEndSec) {
        return;
      }
      const v = laneValuesAt(windowAdj.transition, authoredLocalAt(windowAdj, mixTime));
      const outDeck = plan.entries[windowIdx].deck;
      const inDeck = plan.entries[windowIdx + 1].deck;
      // A grace-truncated outgoing is gone: its authored tail is dropped —
      // the deck (now parking/loading the NEXT entry) reads silent, not the
      // authored outgoing-role fader (sets 14).
      state.lanes[outDeck] =
        mixTime < plan.entries[windowIdx].exitMixSec
          ? {
              fader: v.faderA,
              eq: { low: v.eqLowA, mid: v.eqMidA, high: v.eqHighA },
              filter: v.filterA * 2 - 1,
            }
          : soloLanes(0);
      state.lanes[inDeck] = {
        fader: v.faderB,
        eq: { low: v.eqLowB, mid: v.eqMidB, high: v.eqHighB },
        filter: v.filterB * 2 - 1,
      };
      covered.add(outDeck);
      covered.add(inDeck);
    });
  }
  for (const deck of PLAN_DECKS) {
    if (!covered.has(deck) && state.decks[deck].playing) state.lanes[deck] = soloLanes(1);
  }

  // Entry trim (sets #164): the deck OCCUPANT's trim offset rides its
  // lanes for the whole tenure — occupancy starts at the upcoming entry,
  // so the trim is in place from the Conductor's Deck load, before the
  // entry's window begins. Artifact-recorded trim (a window lane already
  // carrying trim) wins during its span (withEntryTrim). All four decks:
  // a Routine's exit entry may keep sounding on C/D (routines 159).
  for (const deck of PLAN_DECKS) {
    const idx = state.decks[deck].entryIndex;
    if (idx === null) continue;
    state.lanes[deck] = withEntryTrim(state.lanes[deck], plan.entries[idx].trim);
  }

  // Grace fade (sets 14): inside the synthesized fade, the dying entry's
  // fader ramps from its authored value at the fade start to 0 at the
  // truncated exit — REPLACING the authored tail on that deck.
  for (const deck of PLAN_DECKS) {
    const d = state.decks[deck];
    if (!d.playing || d.entryIndex === null) continue;
    const entry = plan.entries[d.entryIndex];
    const g = entry.graceFade;
    if (!g || mixTime < g.fadeStartMixSec) continue;
    const span = Math.max(entry.exitMixSec - g.fadeStartMixSec, 1e-6);
    state.lanes[deck] = {
      ...state.lanes[deck],
      fader: g.fadeStartValue * Math.max(0, 1 - (mixTime - g.fadeStartMixSec) / span),
    };
  }

  // Routine replay override (routines 159): inside a Routine's mix span
  // the recording is THE authority for its slots' decks — positions from
  // the beat-domain playhead traces, pitch re-anchored to the target
  // tempo, mixer lanes from the recorded slot events. Other decks (and
  // everything outside the span) keep the generic verdicts above.
  if (!state.done) {
    const routine = plan.routines.find((r) => mixTime >= r.mixStartSec && mixTime < r.mixEndSec);
    if (routine) {
      const beat = (mixTime - routine.mixStartSec) / routine.secPerBeat;
      for (const slot of routine.slots) {
        if (slot.deck === null) continue;
        const s = routineSlotStateAt(routine, slot, mixTime);
        const entryIndex = routine.startEntryIndex + slot.slot;
        // A slot's deck may still carry an EXTERNAL occupant early in the
        // span (allocation reuses a deck that frees before the slot's
        // entry — routines 159). Until that occupant's audible exit the
        // deck is upstream's business: the head's entry blend fades the
        // outgoing per its own window automation, never a hard stop
        // (#161 finding 1). The override claims the deck at its release.
        const cur = state.decks[slot.deck];
        if (cur.playing && cur.entryIndex !== null && cur.entryIndex !== entryIndex) continue;
        state.decks[slot.deck] = {
          entryIndex,
          trackId: slot.trackId,
          trackTime: s.trackTime,
          playing: s.playing,
          pitchPercent: s.pitchPercent,
        };
        // Recorded slot lanes are the authority, but they never carry
        // trim (fader/EQ/filter only) — the covered entry's trim offset
        // stays the baseline during the span (sets #164 precedence).
        state.lanes[slot.deck] = withEntryTrim(
          slotLanesAt(slot, beat),
          plan.entries[entryIndex]?.trim ?? 0
        );
      }
    }
  }
  return state;
}

/** Jump instants of the window containing [t0, t1), on the GLOBAL mix
 * axis — the Conductor hard-syncs decks when a tick crosses one (the
 * model applies jump deltas discontinuously; drift correction alone would
 * miss sub-tolerance jumps). */
export function jumpCrossed(plan: SetPlan, t0: number, t1: number): boolean {
  return jumpCrossedDecks(plan, t0, t1).length > 0;
}

/** The decks whose plan target jumped in (t0, t1] — the Conductor
 * hard-syncs EXACTLY these (#161): an authored window jump is a single
 * deck's gesture — an incoming jump the incoming deck's, an outgoing jump
 * (jumpsA, issue 177) the outgoing deck's — and a Routine trace
 * discontinuity belongs to its slot's deck. Seeking the other decks too
 * snapped their (legitimately nudging) playheads — an audible hiccup on
 * every recorded jump, worst mid-blend at a routine boundary. */
export function jumpCrossedDecks(plan: SetPlan, t0: number, t1: number): PlanDeck[] {
  const decks = new Set<PlanDeck>();
  plan.adjacencies.forEach((adj, i) => {
    if (!isWindowed(adj)) return;
    const roles = [
      { jumps: adj.transition.jumps, deck: plan.entries[i + 1]?.deck },
      { jumps: adj.transition.jumpsA, deck: plan.entries[i]?.deck },
    ];
    for (const { jumps, deck } of roles) {
      if (!jumps || deck === undefined) continue;
      for (const j of jumps) {
        // Authored instant startSec + x·duration, mapped onto the mix axis.
        const tj = adj.mixStartSec + (j.x * adj.transition.durationSec) / adj.rateOutgoing;
        if (tj > t0 && tj <= t1) decks.add(deck);
      }
    }
  });
  // Routine trace discontinuities (recorded seeks/beat jumps/loop wraps)
  // apply position deltas discontinuously, exactly like authored jumps.
  for (const r of plan.routines) {
    for (const slot of r.slots) {
      if (slot.deck === null) continue;
      for (const tj of slot.jumpMixSecs) {
        if (tj > t0 && tj <= t1) decks.add(slot.deck);
      }
    }
  }
  return [...decks];
}
