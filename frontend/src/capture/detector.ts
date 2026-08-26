/**
 * Handover detector (transition-takes 02, pairwise: four-deck-performance
 * 10) — pure, under vitest.
 *
 * A reducer over CaptureEvents (transport.ts house style): feed it the
 * shared surface's event stream and it emits DetectedTakes when a
 * Handover settles. The glossary definition is the contract:
 *
 * - Audibility = playing AND (channel-fader gain × crossfader gain) ≥
 *   `audibleGain`, on the Master bus only — PFL/cue is invisible.
 * - An ENGAGEMENT opens when the incoming deck becomes audible while the
 *   incumbent is audible (overlap), or within `cutGapMaxS` of its
 *   cessation (hard cut).
 * - The Handover COMPLETES when the outgoing stays silent for
 *   `settleHorizonS`; returns within it fold (cross-cuts), and incoming
 *   silences shorter than the horizon fold too (tease continues).
 * - A tease where the incoming stays silent past the horizon while the
 *   outgoing plays on dissolves with no Take.
 *
 * ONE pair machine runs per unordered physical deck pair (six machines,
 * 4dp 10) — the glossary Handover rule applies per ordered pair,
 * deliberately liberal: when more than two decks are audible, one moment
 * may settle a Take on more than one pair (a chained double's half-swap
 * legitimately emits A→B and A→D). Each machine sees only its own two
 * decks; a third deck's audibility never gates a verdict (4dp 37).
 * Emitted slices are RELABELED to roles — outgoing = 'A', incoming = 'B'
 * (the editor/vectorization contract, ADR 0032) — with the physical decks
 * stamped on the init event and the Take.
 *
 * Settlement is time-driven: the ~1 Hz tick events advance the clock, so
 * the reducer never needs a timer.
 */
import {
  ALL_DECKS,
  applyEvent,
  deckAudible,
  deckSounding,
  initialAudibilityState,
  tenureHeld,
} from './audibilityReducer';
import type { AudibilityState, ReducerDeckState } from './audibilityReducer';
import { DEFAULT_DETECTOR_PARAMS, DETECTOR_VERSION } from './events';
import type {
  CaptureDeck,
  CaptureEvent,
  DetectorParams,
  DetectedTake,
} from './events';

/** The shared reducer's deck state (audibilityReducer.ts) plus the
 * detector's own audibility cache — the edge memory its machines key on. */
interface DeckCapture extends ReducerDeckState {
  audible: boolean;
  /** Time of the last audibility flip. */
  since: number;
  /** Sounding = emitting ANY Master-bus signal (audibility with a zero
   * gain threshold; audibility.ts). Audible ⊆ sounding. */
  sounding: boolean;
  /** Time of the last sounding flip — the entry-onset backdating clock
   * (#178): an overlap engagement's window starts here (capped), not at
   * the `audibleGain` crossing. */
  soundingSince: number;
}

/** The six unordered physical pairs — one Handover machine each. */
export const PAIR_KEYS = ['AB', 'AC', 'AD', 'BC', 'BD', 'CD'] as const;
export type PairKey = (typeof PAIR_KEYS)[number];
const PAIR_DECKS: Record<PairKey, [CaptureDeck, CaptureDeck]> = {
  AB: ['A', 'B'],
  AC: ['A', 'C'],
  AD: ['A', 'D'],
  BC: ['B', 'C'],
  BD: ['B', 'D'],
  CD: ['C', 'D'],
};

/** One pair's Handover machine — the phase-1 A/B state, per pair. */
export interface PairMachine {
  /** The audible-first deck of THIS pair — outgoing candidate. */
  incumbent: CaptureDeck | null;
  /** Engagement start (first trading instant), null = not engaged. */
  engagedSince: number | null;
  /** Track pair snapshotted when the engagement opened. */
  outgoingTrackId: number | null;
  incomingTrackId: number | null;
  /** Tease clock: incoming currently silent since (while engaged). */
  incomingSilentSince: number | null;
  /** Settle clock: outgoing (or lone incumbent) silent since. */
  outSilentSince: number | null;
  /** The incumbent's Track AT its cessation — the hard-cut engagement
   * snapshots this, so a Load onto the stopped deck within the cut gap
   * can't mis-attribute the outgoing Track. */
  outTrackAtCessation: number | null;
  /** For a zero-overlap hard cut ONLY: the incoming's audibility onset. A
   * cut engages AT the outgoing's cessation (so overlap is zero and the
   * naive window collapses); the incoming arrives shortly after within the
   * cut gap. The Take window then spans the cut ramp — cessation → this
   * onset — instead of degenerating to a single instant (issue #138 defect
   * 1; Take 960 was window_start == window_end). null for overlap
   * engagements, whose window end is the outgoing's own final cessation. */
  cutIncomingOnset: number | null;
  /** The last (outgoing, incoming, windowEnd) this machine emitted — the
   * per-engagement dedup guard (issue #138 defect 2). One physical pair
   * flickering across the settle horizon must not settle the SAME ordered
   * pair twice; a re-emit whose window end lands within `settleHorizonS` of
   * the previous one is the same Handover and is suppressed. */
  lastEmit: { outgoingTrackId: number; incomingTrackId: number; windowEndS: number } | null;
  /** Engagement-open snapshot, stamped into the Take slice as its `init`
   * event — ROLE-shaped (outgoing='A', incoming='B') with the physical
   * decks recorded on it. */
  openSnapshot: Extract<CaptureEvent, { kind: 'init' }> | null;
}

/** The detector's state IS the shared audibility reducer's state (deck/
 * mixer/tenure — audibilityReducer.ts) plus the verdict machinery layered
 * on top: the rolling log, the per-deck audibility cache, suspension, and
 * the six pair machines. */
export interface CaptureState extends Omit<AudibilityState, 'decks'> {
  /** Rolling event log (pruned; Take slices are cut from it). */
  log: CaptureEvent[];
  /** All four decks (ADR 0033), with the detector's audibility cache. */
  decks: Record<CaptureDeck, DeckCapture>;
  /** Verdicts suspended: tenure held ONLY (4dp 37 — a third audible deck
   * never gates; the >2-audible branch is gone). While suspended the log
   * still grows; every pair machine stands down, in-flight engagements
   * are discarded on entry, incumbents re-established on exit. The rule
   * itself (surfaceDisplaced) lives in audibilityReducer.ts — one
   * definition for detector, timeline, and recorder. */
  suspended: boolean;
  /** The six pair machines (4dp 10). */
  pairs: Record<PairKey, PairMachine>;
}

function freshMachine(): PairMachine {
  return {
    incumbent: null,
    engagedSince: null,
    outgoingTrackId: null,
    incomingTrackId: null,
    incomingSilentSince: null,
    outSilentSince: null,
    outTrackAtCessation: null,
    cutIncomingOnset: null,
    openSnapshot: null,
    lastEmit: null,
  };
}

export function initialCaptureState(params: DetectorParams = DEFAULT_DETECTOR_PARAMS): CaptureState {
  const base = initialAudibilityState(params);
  return {
    ...base,
    log: [],
    decks: Object.fromEntries(
      ALL_DECKS.map((ch) => [
        ch,
        { ...base.decks[ch], audible: false, since: 0, sounding: false, soundingSince: 0 },
      ])
    ) as Record<CaptureDeck, DeckCapture>,
    suspended: false,
    pairs: Object.fromEntries(PAIR_KEYS.map((k) => [k, freshMachine()])) as Record<
      PairKey,
      PairMachine
    >,
  };
}

/** The pair-mate of `ch` within `key`. */
function mate(key: PairKey, ch: CaptureDeck): CaptureDeck {
  const [x, y] = PAIR_DECKS[key];
  return ch === x ? y : x;
}

function dissolve(m: PairMachine): void {
  m.engagedSince = null;
  m.outgoingTrackId = null;
  m.incomingTrackId = null;
  m.incomingSilentSince = null;
  m.outSilentSince = null;
  m.outTrackAtCessation = null;
  m.cutIncomingOnset = null;
  m.openSnapshot = null;
  // NOTE: lastEmit deliberately survives a dissolve — it guards the NEXT
  // engagement (a flicker re-opening the same ordered pair; issue #138).
}

function openEngagement(
  s: CaptureState,
  m: PairMachine,
  key: PairKey,
  at: number,
  cutIncomingOnset: number | null = null
): void {
  const outgoing = m.incumbent!;
  const incoming = mate(key, outgoing);
  m.engagedSince = at;
  // Hard-cut path: the incumbent already ceased — its Track was
  // snapshotted then, so a Load within the cut gap can't mis-attribute.
  m.outgoingTrackId = m.outTrackAtCessation ?? s.decks[outgoing].trackId;
  m.incomingTrackId = s.decks[incoming].trackId;
  m.incomingSilentSince = null;
  // A cut engages AT the outgoing's cessation; remember the incoming's
  // onset so the Take window spans the cut ramp, not one instant (#138).
  m.cutIncomingOnset = cutIncomingOnset;
  const snapDeck = (d: DeckCapture) => ({
    trackId: d.trackId,
    playing: d.playing,
    fader: d.fader,
    trim: d.trim,
    eq: { ...d.eq },
    filter: d.filter,
    pitch: d.pitch,
    assignment: d.assignment,
  });
  // ROLE-shaped init (ADR 0032 via 4dp 10/12): 'A' is the outgoing role,
  // 'B' the incoming, whatever the physical decks — which are stamped.
  m.openSnapshot = {
    t: at,
    kind: 'init',
    outgoingChannel: 'A',
    decks: { A: snapDeck(s.decks[outgoing]), B: snapDeck(s.decks[incoming]) },
    crossfader: s.crossfader,
    crossfaderEnabled: s.crossfaderEnabled,
    physicalDecks: { outgoing, incoming },
  };
}

/** Relabel one log event into a pair's ROLE frame (outgoing→'A',
 * incoming→'B'); null = not this pair's evidence (another deck's event).
 * Channel-less controls and tenure markers pass through; ticks keep only
 * the pair's playheads. The emitted slice therefore honors the ADR 0032
 * contract — a Take slice only ever contains role-A/B events. */
function relabel(
  ev: CaptureEvent,
  outgoing: CaptureDeck,
  incoming: CaptureDeck
): CaptureEvent | null {
  const role = (ch: CaptureDeck): CaptureDeck | null =>
    ch === outgoing ? 'A' : ch === incoming ? 'B' : null;
  switch (ev.kind) {
    case 'control': {
      if (ev.channel === null) return ev;
      const r = role(ev.channel);
      return r === null ? null : { ...ev, channel: r };
    }
    case 'transport':
    case 'pitch':
    case 'bend':
    case 'loop':
    case 'load': {
      const r = role(ev.channel);
      return r === null ? null : { ...ev, channel: r };
    }
    case 'tick': {
      const playheads: Partial<Record<CaptureDeck, number>> = {};
      const po = ev.playheads[outgoing];
      const pi = ev.playheads[incoming];
      if (po !== undefined) playheads.A = po;
      if (pi !== undefined) playheads.B = pi;
      return { ...ev, playheads };
    }
    default:
      return ev; // tenure markers; init never rides the live log
  }
}

function emitTake(s: CaptureState, m: PairMachine, key: PairKey): DetectedTake | null {
  if (m.outgoingTrackId === null || m.incomingTrackId === null) return null;
  const windowStartS = m.engagedSince!;
  // A zero-overlap hard cut engages at the outgoing's cessation, so the
  // outgoing's own silence instant (outSilentSince) equals the window
  // start — degenerate. The window then spans the cut ramp: cessation →
  // the incoming's onset (#138 defect 1). An overlap engagement keeps the
  // outgoing's final cessation as its end (the glossary window: the
  // contiguous period the two tracks trade, ending at the outgoing's
  // cessation).
  const windowEndS =
    m.cutIncomingOnset !== null ? Math.max(m.outSilentSince!, m.cutIncomingOnset) : m.outSilentSince!;
  const outgoing = m.incumbent!;
  const incoming = mate(key, outgoing);
  const overlap = windowEndS - windowStartS;
  // One engagement, at most one Take per ordered pair (#138 defect 2): a
  // physical pair can flicker across the settle horizon and re-open the
  // same ordered pair; a re-emit whose window end lands within the settle
  // horizon of the previous emit is the same Handover, suppressed.
  if (
    m.lastEmit !== null &&
    m.lastEmit.outgoingTrackId === m.outgoingTrackId &&
    m.lastEmit.incomingTrackId === m.incomingTrackId &&
    windowEndS - m.lastEmit.windowEndS <= s.params.settleHorizonS
  ) {
    return null;
  }
  const confidence = !s.decks[incoming].audible ? 0.5 : overlap < 1 ? 0.7 : 0.9;
  const lo = windowStartS - s.params.padS;
  const hi = windowEndS + s.params.padS;
  m.lastEmit = {
    outgoingTrackId: m.outgoingTrackId,
    incomingTrackId: m.incomingTrackId,
    windowEndS,
  };
  return {
    outgoingTrackId: m.outgoingTrackId,
    incomingTrackId: m.incomingTrackId,
    outgoingDeck: outgoing,
    incomingDeck: incoming,
    windowStartS,
    windowEndS,
    confidence,
    detectorVersion: DETECTOR_VERSION,
    params: s.params,
    // now may exceed hi (settlement lags the window by the horizon);
    // slice by window+pad regardless — the horizon tail is not evidence.
    // The synthetic init head carries engagement-open state + deck roles.
    // Pre-window pad events ARE included (context); the init state already
    // reflects them, and that's safe: control events carry absolute values
    // (set, not delta), so replaying them over init is idempotent.
    // Single pass over the log (capture spine 02): relabel yields fresh
    // per-event copies, so the slice stays immutable evidence.
    events: sliceTake(s.log, lo, hi, outgoing, incoming, m.openSnapshot),
  };
}

/** Build a Take's role-relabeled event slice in one pass: the init head
 * (if any), then every logged event in [lo, hi] that belongs to the pair,
 * relabeled to A/B. relabel returns fresh copies, so the result is an
 * immutable evidence slice (never aliases the rolling log). */
function sliceTake(
  log: CaptureEvent[],
  lo: number,
  hi: number,
  outgoing: CaptureDeck,
  incoming: CaptureDeck,
  head: Extract<CaptureEvent, { kind: 'init' }> | null
): CaptureEvent[] {
  const events: CaptureEvent[] = [];
  if (head) events.push(head);
  for (const ev of log) {
    if (ev.t < lo || ev.t > hi) continue;
    const r = relabel(ev, outgoing, incoming);
    if (r !== null) events.push(r);
  }
  return events;
}

/** Deep-clone the reducible state so a mutating reduce can't reach the
 * caller's copy. The rolling `log` array is copied by reference-of-elements
 * (events are immutable); everything the imperative helpers write —
 * per-deck audibility cache, `eq`, pair machines — is cloned. */
function cloneCaptureState(state: CaptureState): CaptureState {
  return {
    ...state,
    decks: {
      A: { ...state.decks.A, eq: { ...state.decks.A.eq } },
      B: { ...state.decks.B, eq: { ...state.decks.B.eq } },
      C: { ...state.decks.C, eq: { ...state.decks.C.eq } },
      D: { ...state.decks.D, eq: { ...state.decks.D.eq } },
    },
    pairs: Object.fromEntries(
      PAIR_KEYS.map((k) => [k, { ...state.pairs[k] }])
    ) as Record<PairKey, PairMachine>,
    log: [...state.log],
  };
}

/**
 * Feed one event; returns the next state and any settled Takes. With six
 * pair machines one moment may settle several (deliberately liberal —
 * glossary Handover).
 *
 * PURE wrapper (the detector's tested seam): the input state is never
 * mutated — it is cloned once, then reduced in place. The always-on
 * recorder owns its state and skips the clone (`reduceCaptureInto` /
 * `reduceCaptureBatch`, capture spine 02): the deep clone was ~6× the
 * per-event cost during a busy passage (a crossfader ride).
 */
export function reduceCapture(
  state: CaptureState,
  e: CaptureEvent
): [CaptureState, DetectedTake[]] {
  const s = cloneCaptureState(state);
  const takes = reduceCaptureInto(s, e);
  return [s, takes];
}

/**
 * Reduce a whole batch of events into `state` IN PLACE (capture spine 02):
 * the recorder queues the events a single notify produced and reduces them
 * in one pass over its owned state — no per-event clone, no O(n) log copy.
 * Event timestamps are captured at enqueue, so ordering/clock are
 * identical to the per-event path; settlement is time-driven off the ~1 Hz
 * ticks regardless. Returns every Take the batch settled, in order.
 */
export function reduceCaptureBatch(state: CaptureState, events: CaptureEvent[]): DetectedTake[] {
  const takes: DetectedTake[] = [];
  for (const e of events) {
    const emitted = reduceCaptureInto(state, e);
    if (emitted.length > 0) takes.push(...emitted);
  }
  return takes;
}

/**
 * The mutating reduce core: apply one event to `s` IN PLACE and return any
 * settled Takes. The caller owns `s` (the recorder, or the pure wrapper's
 * fresh clone) — the imperative onEdge/applyEvent helpers write straight
 * to it.
 */
export function reduceCaptureInto(s: CaptureState, e: CaptureEvent): DetectedTake[] {
  s.log.push(e);
  const takes: DetectedTake[] = [];
  const now = e.t;

  // The shared audibility reducer (audibilityReducer.ts) applies the raw
  // event to deck/mixer/tenure state. Tenure markers (ADR 0033) move the
  // old recorder surface gate into the log: a machine holding the surface
  // suspends every pair machine's verdicts exactly as the surface gate did
  // — the log grows regardless. NOTE the phase-1 preview boundary holds:
  // previewStart/previewEnd flip `previewing` only, which audibility
  // ignores — a stab does NOT count toward audibility/engagements
  // (deliberate; revisiting that is a follow-up grill, not this issue).
  applyEvent(s, e);

  // Sounding cache (#178) — the entry-onset backdating clock, kept current
  // on every event (suspension included; it carries no verdicts of its
  // own). Audible ⊆ sounding, so the audibility flip that opens an
  // engagement below always sees this deck's soundingSince already
  // stamped — for a hot entry both flip on this very event and the
  // backdate is zero by construction.
  for (const ch of ALL_DECKS) {
    const sounding = deckSounding(s, ch);
    if (sounding !== s.decks[ch].sounding) {
      s.decks[ch].sounding = sounding;
      s.decks[ch].soundingSince = now;
    }
  }

  // Suspension edge — tenure ONLY (4dp 37; the one rule, shared with the
  // timeline and recorder). Entering discards in-flight engagements and
  // clears incumbency on every machine; leaving re-establishes each
  // machine's incumbent from its own decks' current audibility (the
  // recorder re-seeds in step).
  const suspendedNow = tenureHeld(s);
  if (suspendedNow && !s.suspended) {
    for (const key of PAIR_KEYS) {
      const m = s.pairs[key];
      dissolve(m);
      m.incumbent = null;
    }
  } else if (!suspendedNow && s.suspended) {
    for (const ch of ALL_DECKS) {
      const audible = deckAudible(s, ch);
      if (audible !== s.decks[ch].audible) {
        s.decks[ch].audible = audible;
        s.decks[ch].since = now;
      }
    }
    for (const key of PAIR_KEYS) {
      const [x, y] = PAIR_DECKS[key];
      // No Handover spans the suspended gap: audible-first (or nobody).
      s.pairs[key].incumbent = s.decks[x].audible ? x : s.decks[y].audible ? y : null;
    }
  }
  s.suspended = suspendedNow;

  if (s.suspended) {
    // Log grows (already pushed); machines stand down. Keep the deck
    // audibility cache current so the exit re-seed reads reality.
    for (const ch of ALL_DECKS) {
      const audible = deckAudible(s, ch);
      if (audible !== s.decks[ch].audible) {
        s.decks[ch].audible = audible;
        s.decks[ch].since = now;
      }
    }
    pruneLog(s, now);
    return takes;
  }

  // A Load re-premises the deck: the track being traded no longer exists
  // on it, so an open engagement's pair snapshot must not outlive the
  // decks it described (the sets-13 rehearsal-reload mis-attribution).
  // - Outgoing already ceased → the Handover was complete; its comeback
  //   is now impossible, so settle it immediately instead of waiting out
  //   the horizon (an eager next-track Load must not lose the Take).
  // - Otherwise → bail: abandoning a blend by loading fresh tracks is
  //   not a Handover; dissolve with no Take.
  // A Load onto a LIVE incumbent also resets incumbency — its audible run
  // ended by replacement, not by mix-out. Applied per machine whose pair
  // contains the loaded deck.
  if (e.kind === 'load') {
    for (const key of PAIR_KEYS) {
      if (!PAIR_DECKS[key].includes(e.channel)) continue;
      const m = s.pairs[key];
      if (m.engagedSince !== null) {
        if (m.outSilentSince !== null) {
          const take = emitTake(s, m, key);
          if (take) takes.push(take);
          const incoming = mate(key, m.incumbent!);
          m.incumbent = s.decks[incoming].audible ? incoming : null;
        }
        dissolve(m);
      }
      if (m.incumbent === e.channel && m.outSilentSince === null) {
        m.incumbent = null;
      }
    }
  }

  // Audibility edges — CESSATIONS FIRST: an event flipping both decks of
  // a pair at once (a crossfader flick) must anchor as a cut at the
  // cessation, on either incumbency, not ride whichever deck the loop
  // visited first. Each edge feeds every machine whose pair contains the
  // deck; the machines are pairwise-local (4dp 10/37).
  const edges = ALL_DECKS
    .map((ch) => ({ ch, audible: deckAudible(s, ch) }))
    .filter(({ ch, audible }) => audible !== s.decks[ch].audible)
    .sort((a, b) => Number(a.audible) - Number(b.audible));
  for (const { ch, audible } of edges) {
    s.decks[ch].audible = audible;
    s.decks[ch].since = now;
    for (const key of PAIR_KEYS) {
      if (PAIR_DECKS[key].includes(ch)) onEdge(s, key, ch, audible, now);
    }
  }

  // Time-driven settlement / dissolution, per machine.
  for (const key of PAIR_KEYS) {
    const m = s.pairs[key];
    if (m.outSilentSince !== null && now - m.outSilentSince >= s.params.settleHorizonS) {
      if (m.engagedSince !== null) {
        const take = emitTake(s, m, key);
        if (take) takes.push(take);
        // The incoming deck inherits incumbency (it may itself already be
        // silent — then nobody is incumbent).
        const incoming = mate(key, m.incumbent!);
        m.incumbent = s.decks[incoming].audible ? incoming : null;
        dissolve(m);
      } else {
        // Lone incumbent stopped and nothing came in: not a Handover.
        m.incumbent = null;
        m.outSilentSince = null;
        m.outTrackAtCessation = null;
      }
    }
    if (
      m.engagedSince !== null &&
      m.incomingSilentSince !== null &&
      now - m.incomingSilentSince >= s.params.settleHorizonS
    ) {
      // Tease-and-bail: the outgoing survived; no Take.
      dissolve(m);
    }
  }

  pruneLog(s, now);

  return takes;
}

/** Prune the rolling log to the current retention horizon — the most
 * retentive machine wins (an engaged pair pins its window's pad).
 *
 * Ring-buffer with an index horizon (capture spine 02): events are chrono-
 * ordered, so the dead prefix is a contiguous run at the front. Count it
 * and drop it with ONE in-place splice — no full `filter` copy per event
 * (the O(n)→O(n²) hazard over a busy passage). Nothing is dropped on the
 * common event (splice(0,0) is a no-op), so the steady-state cost is O(1).
 * `s.log[0]` stays the first retained event, as the detector reads it. */
function pruneLog(s: CaptureState, now: number): void {
  let keepFrom = Infinity;
  for (const key of PAIR_KEYS) {
    const m = s.pairs[key];
    const need =
      m.engagedSince !== null
        ? m.engagedSince - s.params.padS
        : (m.outSilentSince ?? now) - s.params.idleKeepS;
    if (need < keepFrom) keepFrom = need;
  }
  const log = s.log;
  if (log.length === 0 || log[0].t >= keepFrom) return;
  let dead = 0;
  while (dead < log.length && log[dead].t < keepFrom) dead++;
  log.splice(0, dead);
}

/** An audibility edge on one deck, within one pair machine. */
function onEdge(
  s: CaptureState,
  key: PairKey,
  ch: CaptureDeck,
  audible: boolean,
  now: number
): void {
  const m = s.pairs[key];
  if (m.incumbent === null) {
    if (audible) m.incumbent = ch;
    return;
  }

  const incumbent = m.incumbent;
  const isIncumbent = ch === incumbent;

  if (!isIncumbent) {
    // The pair-mate (incoming candidate).
    if (audible) {
      if (m.engagedSince !== null) {
        m.incomingSilentSince = null; // fold a tease gap
      } else if (s.decks[incumbent].audible) {
        // Overlap onset (#178): the window starts where the incoming first
        // SOUNDED, not where its rising gain crossed `audibleGain` — a
        // play-then-fader-slam entry loses its first beats otherwise.
        // Bounded by `entryBackdateMaxS` (a residual whisper-level fader
        // can hold the sounding clock open for minutes) and by the
        // incumbent's own audibility (an overlap cannot predate its
        // incumbent).
        const onset = Math.max(
          s.decks[ch].soundingSince,
          now - s.params.entryBackdateMaxS,
          s.decks[incumbent].since
        );
        openEngagement(s, m, key, onset);
      } else if (
        m.outSilentSince !== null &&
        now - m.outSilentSince <= s.params.cutGapMaxS
      ) {
        // Hard cut: engage AT the cessation (window start), and record the
        // incoming's onset (window end) so the slice spans the cut ramp
        // instead of collapsing to a single instant (#138 defect 1).
        openEngagement(s, m, key, m.outSilentSince, now);
      } else {
        // Incumbent long gone: fresh incumbency, no Handover.
        m.incumbent = ch;
        m.outSilentSince = null;
        m.outTrackAtCessation = null;
      }
    } else if (m.engagedSince !== null && m.outSilentSince === null) {
      m.incomingSilentSince = now; // tease clock (outgoing still here)
    }
    return;
  }

  // The incumbent (outgoing candidate).
  if (!audible) {
    m.outSilentSince = now;
    m.outTrackAtCessation = s.decks[incumbent].trackId;
  } else if (m.outSilentSince !== null) {
    m.outSilentSince = null; // cross-cut fold / lone-incumbent return
    m.outTrackAtCessation = null;
  }
}
