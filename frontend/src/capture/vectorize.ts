/**
 * Vectorizer (transition-takes 03) — pure, under vitest.
 *
 * Raw Take slice in → ordinary seconds-based Transition draft out
 * (ADR 0020: promotion idealizes). The transform:
 *
 * - ANCHORS: `startSec`/`bInSec` from playhead samples (ticks + transport
 *   events) nearest the window start, extrapolated at each deck's own
 *   rate; `durationSec` is the window length in outgoing-track seconds.
 * - CROSSFADER COMPOSED AWAY: effective per-deck gain (channel fader ×
 *   crossfader, dipless curve) baked into the fader lanes as fader
 *   POSITIONS (the lane domain — MixPlayer re-applies the fader taper).
 *   Trim stays out: gain staging, not the move.
 * - CONTINUOUS GESTURES COLLAPSE: pitch riding and Nudges (bends) never
 *   become lanes; the settled incoming pitch against the BPM ratio decides
 *   the single static tempo-match.
 * - SPARSE LANES: dense drag streams simplify (RDP) to editable
 *   breakpoints; untouched controls stay out of `lanes` entirely — except
 *   the incoming fader lane, always drawn: its model default (a 2s fade-in
 *   ramp) would lie about a deck that was already up.
 * - DISCRETE GESTURES PRESERVED (issue 04): incoming-deck beat jumps and
 *   hot-cue presses become Jump events; outgoing-deck ones are dropped
 *   (incoming-only, ADR 0020). Plain seeks are scrubbing — not gestures:
 *   a mid-window seek simply shifts the commit-point alignment, i.e. the
 *   final (post-seek) alignment wins, per the idealization rule.
 *
 * The editor's deck roles are track-based: editor A = the outgoing deck,
 * whichever physical channel it was on.
 */
import { jumpRepeatCount } from '../editor/mixModel';
import type { JumpEvent, LaneId, LanePoint, Lanes, Transition } from '../editor/mixModel';
import { channelFaderToGain, crossfaderGains } from '../playback/mixerMath';
import type { CaptureChannel, CaptureEvent, InitDeckState } from './events';

const OTHER: Record<CaptureChannel, CaptureChannel> = { A: 'B', B: 'A' };

/** Pre-step breakpoint spacing (normalized x) — mirrors the chop walls. */
const STEP_EPS = 0.002;
/** RDP tolerance in lane-value units. */
const SIMPLIFY_EPS = 0.015;
/** Constant-lane inclusion thresholds. */
const VARIES_EPS = 0.005;
const OFF_DEFAULT_EPS = 0.02;
/** Performed-vs-required pitch gap (percent) still reading as "matched". */
const TEMPO_MATCH_TOLERANCE_PERCENT = 1.5;
/** Discontinuities smaller than this are sample jitter, not gestures. */
const MIN_JUMP_SEC = 0.1;

export interface VectorizeInput {
  /** The Take's raw slice, starting with its `init` head. */
  events: CaptureEvent[];
  windowStartS: number;
  windowEndS: number;
}

export interface VectorizeFacts {
  /** Outgoing / incoming track BPMs (tempo-match inference). */
  bpmA: number | null;
  bpmB: number | null;
}

export interface VectorizedDraft {
  transition: Transition;
  /** Physical deck the outgoing track was on (editor A role). */
  outgoingChannel: CaptureChannel;
}

export function vectorizeTake(
  input: VectorizeInput,
  facts: VectorizeFacts
): VectorizedDraft | null {
  const init = input.events.find((e) => e.kind === 'init');
  if (!init || init.kind !== 'init') return null;
  const out = init.outgoingChannel;
  const inc = OTHER[out];
  const { windowStartS, windowEndS } = input;
  const windowLen = Math.max(0, windowEndS - windowStartS);

  const pitchAt = (ch: CaptureChannel, t: number): number => {
    let p = init.decks[ch].pitch;
    for (const e of input.events) {
      if (e.kind === 'pitch' && e.channel === ch && e.t <= t) p = e.value;
    }
    return p;
  };
  const rateAt = (ch: CaptureChannel, t: number) => 1 + pitchAt(ch, t) / 100;

  const playheadAt = (ch: CaptureChannel, t: number): number => {
    const samples: { t: number; pos: number }[] = [];
    for (const e of input.events) {
      if (e.kind === 'tick' && e.playheads[ch] !== undefined) {
        samples.push({ t: e.t, pos: e.playheads[ch]! });
      } else if (e.kind === 'transport' && e.channel === ch) {
        samples.push({ t: e.t, pos: e.playhead });
      }
    }
    if (samples.length === 0) return 0;
    samples.sort((a, b) => a.t - b.t);
    const before = [...samples].reverse().find((s) => s.t <= t);
    const ref = before ?? samples[0];
    // NO clamp: back-extrapolating past a mid-window start yields a
    // NEGATIVE position — exactly the model's silent lead gap (bInSec < 0
    // = the incoming's audio begins partway into the window).
    return ref.pos + (t - ref.t) * rateAt(ch, ref.t);
  };

  const startSec = playheadAt(out, windowStartS);
  const durationSec = windowLen * rateAt(out, windowStartS);

  // Static tempo-match from the settled incoming pitch (idealization).
  const required =
    facts.bpmA && facts.bpmB ? (facts.bpmA / facts.bpmB - 1) * 100 : null;
  const tempoMatch =
    required !== null &&
    Math.abs(pitchAt(inc, windowEndS) - required) <= TEMPO_MATCH_TOLERANCE_PERCENT;

  // DISCRETE GESTURES → JUMP EVENTS (issue 04, ADR 0020's line): beat
  // jumps and hot-cue presses on the INCOMING deck are intentional
  // structure, preserved; the outgoing deck's are dropped at vectorization
  // (incoming-only — the raw slice keeps them for a later both-decks
  // extension). Each delta measures the landing against the pre-jump
  // path — extrapolated from the latest sample strictly before the
  // gesture, so chained jumps compose correctly. Plain seeks are
  // scrubbing, not gestures.
  const jumps: JumpEvent[] = [];
  if (windowLen > 0) {
    for (const e of input.events) {
      if (e.kind !== 'transport' || e.channel !== inc) continue;
      if (e.action !== 'jumpBeats' && e.action !== 'hotCue') continue;
      if (e.t < windowStartS || e.t > windowEndS) continue;
      const pre = playheadStrictlyBefore(input.events, inc, e.t, rateAt);
      if (pre === null) continue;
      const deltaSec = e.playhead - pre;
      if (Math.abs(deltaSec) < MIN_JUMP_SEC) continue;
      jumps.push({ x: (e.t - windowStartS) / windowLen, deltaSec });
    }
    jumps.push(...loopJumps(input, inc, rateAt));
  }
  // Repeats each apply their delta (the model expands them back).
  const jumpTotal = jumps.reduce((sum, j) => sum + j.deltaSec * jumpRepeatCount(j), 0);

  // ALIGNMENT AT THE COMMIT POINT (PRD): the incoming's position is read
  // at the window END — after every Nudge/pitch correction has done its
  // work — and back-projected to the window start at the promoted rate.
  // Corrections thus fold INTO the single static alignment instead of
  // being frozen out of it. Jump deltas are subtracted: the model adds
  // them back at their instants (bTrackTimeAt), so the anchor stays the
  // PRE-jump alignment.
  const rateUsed = tempoMatch && required !== null ? 1 + required / 100 : rateAt(inc, windowEndS);
  const bInSec = playheadAt(inc, windowEndS) - windowLen * rateUsed - jumpTotal;

  return {
    outgoingChannel: out,
    transition: {
      startSec: Math.max(0, startSec),
      durationSec,
      bInSec,
      tempoMatch,
      lanes: windowLen > 0 ? buildLanes(input, init, out) : {},
      ...(jumps.length > 0 ? { jumps } : {}),
    },
  };
}

/**
 * LOOP ENGAGEMENTS → REPEATED JUMP EVENTS (looping 06, extending ADR
 * 0020's discrete-gesture rule): a held loop on the incoming deck
 * collapses to ONE backward Jump — displacement = the loop length, count
 * = the number of wraps — rather than k separate jumps. Wraps are pure
 * derivation (region + engage playhead + rate), never guessed from the
 * coarse ticks: the deck crosses the end edge every `len` track-seconds
 * once it reaches it. Each loop event (engage/resize/translate/release)
 * closes the previous segment; a loop still open at the window end counts
 * wraps up to the end. Outgoing-deck loops are dropped (incoming-only).
 */
function loopJumps(
  input: VectorizeInput,
  inc: CaptureChannel,
  rateAt: (ch: CaptureChannel, t: number) => number
): JumpEvent[] {
  const { windowStartS, windowEndS } = input;
  const windowLen = windowEndS - windowStartS;
  const out: JumpEvent[] = [];
  let open: { t: number; playhead: number; start: number; end: number } | null = null;

  const close = (tEnd: number): void => {
    if (!open) return;
    const { t: t0, playhead: p0, start, end } = open;
    open = null;
    const len = end - start;
    if (len <= 0 || tEnd <= t0) return;
    const rate = rateAt(inc, t0);
    const clampedEnd = Math.min(tEnd, windowEndS);
    const unwrapped = p0 + (clampedEnd - t0) * rate;
    const count = Math.floor((unwrapped - end) / len) + 1;
    if (count < 1) return;
    // First wrap: when the playhead reaches the end edge.
    const tw = t0 + (end - p0) / rate;
    const x = Math.min(1, Math.max(0, (tw - windowStartS) / windowLen));
    out.push({ x, deltaSec: -len, ...(count > 1 ? { count } : {}) });
  };

  for (const e of input.events) {
    if (e.kind !== 'loop' || e.channel !== inc || e.t > windowEndS) continue;
    close(e.t);
    if (e.region) {
      open = { t: e.t, playhead: e.playhead, start: e.region.start, end: e.region.end };
    }
  }
  close(windowEndS);
  return out;
}

/** Playhead extrapolated from the latest sample STRICTLY before t (null
 * when none) — the pre-gesture path a jump's delta is measured against. */
function playheadStrictlyBefore(
  events: CaptureEvent[],
  ch: CaptureChannel,
  t: number,
  rateAt: (ch: CaptureChannel, t: number) => number
): number | null {
  let ref: { t: number; pos: number } | null = null;
  for (const e of events) {
    if (e.t >= t) continue;
    if (e.kind === 'tick' && e.playheads[ch] !== undefined) ref = { t: e.t, pos: e.playheads[ch]! };
    else if (e.kind === 'transport' && e.channel === ch) ref = { t: e.t, pos: e.playhead };
  }
  return ref === null ? null : ref.pos + (t - ref.t) * rateAt(ch, ref.t);
}

// ── Lane building ────────────────────────────────────────────────────────

interface ControlState {
  decks: Record<CaptureChannel, Pick<InitDeckState, 'fader' | 'eq' | 'filter'>>;
  crossfader: number;
  crossfaderEnabled: boolean;
}

function buildLanes(
  input: VectorizeInput,
  init: Extract<CaptureEvent, { kind: 'init' }>,
  out: CaptureChannel
): Lanes {
  const { windowStartS, windowEndS } = input;
  const windowLen = windowEndS - windowStartS;
  const role = (ch: CaptureChannel): 'A' | 'B' => (ch === out ? 'A' : 'B');

  const state: ControlState = {
    decks: {
      A: { fader: init.decks.A.fader, eq: { ...init.decks.A.eq }, filter: init.decks.A.filter },
      B: { fader: init.decks.B.fader, eq: { ...init.decks.B.eq }, filter: init.decks.B.filter },
    },
    crossfader: init.crossfader,
    crossfaderEnabled: init.crossfaderEnabled,
  };

  // Effective fader-lane POSITION: position × √(crossfader gain) — squares
  // back to gain × gain under the lane's quadratic fader taper.
  const faderY = (ch: CaptureChannel): number => {
    const xf = crossfaderGains(state.crossfaderEnabled ? state.crossfader : 0);
    const gain = channelFaderToGain(state.decks[ch].fader) * (ch === 'A' ? xf.a : xf.b);
    return Math.min(1, Math.sqrt(gain));
  };
  const laneValue = (id: LaneId): number => {
    const ch: CaptureChannel = id.endsWith('A') ? out : OTHER[out];
    if (id.startsWith('fader')) return faderY(ch);
    if (id.startsWith('eqLow')) return state.decks[ch].eq.low;
    if (id.startsWith('eqMid')) return state.decks[ch].eq.mid;
    if (id.startsWith('eqHigh')) return state.decks[ch].eq.high;
    return (state.decks[ch].filter + 1) / 2; // filter → lane domain
  };

  const series = new Map<LaneId, LanePoint[]>();
  const initialY = new Map<LaneId, number>();
  const ensure = (id: LaneId): LanePoint[] => {
    let pts = series.get(id);
    if (!pts) {
      pts = [{ x: 0, y: initialY.get(id)! }];
      series.set(id, pts);
    }
    return pts;
  };
  const push = (id: LaneId, x: number, y: number): void => {
    const pts = ensure(id);
    const last = pts[pts.length - 1];
    if (Math.abs(last.y - y) < 1e-9) return;
    // Step shoulder so slams stay vertical after linear interpolation.
    if (x - last.x > 2 * STEP_EPS) pts.push({ x: x - STEP_EPS, y: last.y });
    pts.push({ x: Math.min(1, Math.max(last.x, x)), y });
  };

  const ALL_LANES: LaneId[] = [
    'faderA', 'faderB',
    'eqLowA', 'eqLowB', 'eqMidA', 'eqMidB', 'eqHighA', 'eqHighB',
    'filterA', 'filterB',
  ];
  for (const id of ALL_LANES) initialY.set(id, laneValue(id));
  // The incoming fader lane is always drawn (see module doc).
  ensure('faderB');

  for (const e of input.events) {
    if (e.kind !== 'control' || e.t < windowStartS || e.t > windowEndS) continue;
    const x = (e.t - windowStartS) / windowLen;
    const touched: LaneId[] = [];
    if (e.control === 'fader' && e.channel) {
      state.decks[e.channel].fader = e.value;
      touched.push(`fader${role(e.channel)}` as LaneId);
    } else if (e.control === 'crossfader' || e.control === 'crossfaderEnabled') {
      if (e.control === 'crossfader') state.crossfader = e.value;
      else state.crossfaderEnabled = e.value !== 0;
      touched.push('faderA', 'faderB');
    } else if (e.control === 'eqLow' && e.channel) {
      state.decks[e.channel].eq.low = e.value;
      touched.push(`eqLow${role(e.channel)}` as LaneId);
    } else if (e.control === 'eqMid' && e.channel) {
      state.decks[e.channel].eq.mid = e.value;
      touched.push(`eqMid${role(e.channel)}` as LaneId);
    } else if (e.control === 'eqHigh' && e.channel) {
      state.decks[e.channel].eq.high = e.value;
      touched.push(`eqHigh${role(e.channel)}` as LaneId);
    } else if (e.control === 'filter' && e.channel) {
      state.decks[e.channel].filter = e.value;
      touched.push(`filter${role(e.channel)}` as LaneId);
    }
    for (const id of touched) push(id, x, laneValue(id));
  }

  const lanes: Lanes = {};
  for (const [id, pts] of series) {
    const simplified = simplify(pts, SIMPLIFY_EPS);
    const ys = simplified.map((p) => p.y);
    const varies = Math.max(...ys) - Math.min(...ys) > VARIES_EPS;
    const restingDefault = id.startsWith('fader') ? 1 : 0.5;
    const offDefault = Math.abs(ys[0] - restingDefault) > OFF_DEFAULT_EPS;
    if (id === 'faderB' || varies || offDefault) lanes[id] = simplified;
  }
  return lanes;
}

/** Ramer–Douglas–Peucker on function-like points (vertical distance). */
function simplify(points: LanePoint[], eps: number): LanePoint[] {
  if (points.length <= 2) return points;
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [lo, hi] = stack.pop()!;
    const a = points[lo];
    const b = points[hi];
    let worst = -1;
    let worstDist = eps;
    for (let i = lo + 1; i < hi; i++) {
      const p = points[i];
      const span = b.x - a.x;
      const yOnSeg = span <= 0 ? a.y : a.y + ((p.x - a.x) / span) * (b.y - a.y);
      const d = Math.abs(p.y - yOnSeg);
      if (d > worstDist) {
        worst = i;
        worstDist = d;
      }
    }
    if (worst >= 0) {
      keep[worst] = true;
      stack.push([lo, worst], [worst, hi]);
    }
  }
  return points.filter((_, i) => keep[i]);
}
