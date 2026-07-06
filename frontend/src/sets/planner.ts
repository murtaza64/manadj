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
  bContentSegments,
  bTrackTimeAt,
  laneValuesAt,
  tempoMatchPitch,
} from '../editor/mixModel';
import { MAX_PITCH_RANGE_PERCENT } from '../playback/tempo';
import type { Track } from '../types';
import type { AdjacencyPin } from './adjacency';

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
  entries: { trackId: number; pin: AdjacencyPin | null }[];
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
}

/** hardcut covers no applicable Transition: nothing to resolve, an
 * explicit Hard-cut pin (sets 26), dangling pins, failed Take
 * vectorization; the windowed variants carry the executed Transition
 * (idealized for Takes). */
export type PlannedAdjacency =
  | (PlannedAdjacencyBase & { kind: 'hardcut'; transition?: undefined })
  | (PlannedAdjacencyBase & { kind: 'transition' | 'take'; transition: Transition });

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
  deck: 'A' | 'B';
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
    | 'entry-after-exit';
  message: string;
  adjacencyIndex?: number;
  entryIndex?: number;
}

export interface SetPlan {
  entries: PlannedEntry[];
  adjacencies: PlannedAdjacency[];
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
 * Hard-cut pin falls through to null — both cut. */
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
  const warnings: PlanWarning[] = [];
  if (input.entries.length === 0) {
    return { entries, adjacencies, totalSec: 0, warnings };
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

  // Walk the chain accumulating each track's mix anchor (time 0's mix
  // instant at its solo rate). The first track opens the set from its
  // very beginning (cues are performance markers, not set boundaries):
  // time 0 at mix 0.
  let mixOffset = 0;
  let entrySec = 0;
  let entryMixSec = 0;

  for (let i = 0; i < input.entries.length; i++) {
    const { trackId } = input.entries[i];
    const facts = factsOf(trackId);
    const rate = rates[i];
    /** Entry i's track time → global mix time (solo-rate mapping). */
    const toMix = (t: number) => mixOffset + t / rate;
    const deck: 'A' | 'B' = i % 2 === 0 ? 'A' : 'B';
    const next = input.entries[i + 1];

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
      const nextBoundary =
        resolvedPins[i + 1]?.transition.startSec ?? nextFacts.durationSec;
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

    // Outgoing exits at the window end, clamped to its own end.
    const exitSec = Math.min(windowEndLocal, facts.durationSec);
    entries.push({
      trackId,
      deck,
      mixOffsetSec: mixOffset,
      rate,
      entrySec,
      exitSec,
      entryMixSec,
      exitMixSec: toMix(exitSec),
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
  return { entries, adjacencies, totalSec: Math.max(0, last.exitMixSec), warnings };
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
    const victim = entries[j - 1];
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
    const entryAdj = j >= 2 ? adjacencies[j - 2] : undefined;
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

    // The victim exits through its own adjacency (index j−1). The fade
    // rides its role-fader: the authored outgoing fader if the fade sits
    // inside that window, else the solo fader (1).
    const exitAdj = adjacencies[j - 1];
    const fadeStartMixSec = Math.max(needMix - fadeLen, floorMix);
    const fadeStartValue =
      isWindowed(exitAdj) && fadeStartMixSec >= exitAdj.mixStartSec
        ? laneValuesAt(exitAdj.transition, authoredLocalAt(exitAdj, fadeStartMixSec)).faderA
        : 1;
    entries[j - 1] = {
      ...victim,
      exitSec: playingTrackTimeAt(entries, adjacencies, j - 1, needMix).trackTime,
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
  const windowed = entryAdj && entryAdj.kind !== 'hardcut' ? entryAdj : null;
  if (windowed && mixTime < windowed.mixEndSec) {
    return {
      trackTime: Math.max(
        0,
        bTrackTimeAt(windowed.transition, authoredLocalAt(windowed, mixTime), windowed.rateIncoming)
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
  return {
    trackTime: (mixTime - entry.mixOffsetSec) * entry.rate,
    pitchPercent: (entry.rate - 1) * 100,
  };
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
    // rate and jump deltas (bTrackTimeAt on the authored window axis);
    // through the Tempo return it eases back to native (Riding);
    // everywhere else the solo-rate anchor rules.
    let trackTime: number;
    let pitchPercent: number;
    if (playing) {
      ({ trackTime, pitchPercent } = playingTrackTimeAt(plan.entries, plan.adjacencies, idx, mixTime));
    } else {
      // Parked: at the planned entry before playing, at the exit after.
      trackTime = idx === active || idx === upcoming ? entry.entrySec : entry.exitSec;
      pitchPercent = (entry.rate - 1) * 100;
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
  } else {
    for (const deck of ['A', 'B'] as const) {
      if (state.decks[deck].playing) state.lanes[deck] = soloLanes(1);
    }
  }

  // Grace fade (sets 14): inside the synthesized fade, the dying entry's
  // fader ramps from its authored value at the fade start to 0 at the
  // truncated exit — REPLACING the authored tail on that deck.
  for (const deck of ['A', 'B'] as const) {
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
  return state;
}

/** Jump instants of the window containing [t0, t1), on the GLOBAL mix
 * axis — the Conductor hard-syncs decks when a tick crosses one (the
 * model applies jump deltas discontinuously; drift correction alone would
 * miss sub-tolerance jumps). */
export function jumpCrossed(plan: SetPlan, t0: number, t1: number): boolean {
  for (const adj of plan.adjacencies) {
    if (!isWindowed(adj) || !adj.transition.jumps) continue;
    for (const j of adj.transition.jumps) {
      // Authored instant startSec + x·duration, mapped onto the mix axis.
      const tj = adj.mixStartSec + (j.x * adj.transition.durationSec) / adj.rateOutgoing;
      if (tj > t0 && tj <= t1) return true;
    }
  }
  return false;
}
