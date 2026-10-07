/**
 * Beat FX lane (#353): the Beat FX SECTION as authored automation on a
 * Transition / Routine. Pure — under vitest.
 *
 * Model (design calls recorded on gh#353):
 * - ONE FX track per artifact, not one per role: the hardware section is a
 *   single strip with a radio target, so "FX moves from A to B" is just a
 *   step whose `target` changes — mutual exclusion holds by construction.
 * - STEPS carry the discrete state (on, effect, target, beat length):
 *   a step holds until the next one; before the first step the section is
 *   OFF. After the last step it keeps holding (the lanes' keep-last rule) —
 *   vectorization closes an FX still on at the window end with an explicit
 *   OFF step at x = 1, so the hold is visible and editable. Turning FX off
 *   never cuts a tail (the Mixer leaves returns connected).
 * - DEPTH (LEVEL/DEPTH) is a continuous breakpoint lane, linearly
 *   interpolated, held flat outside its points. Empty = 0 (the midpoint).
 * - Pair form: x on the window axis, roles 'A'/'B'/'master', depth in
 *   lane units (y = (depth + 1) / 2, the filter lane's 0.5-centred space).
 *   Routine form: routine beats, slotId/'master' targets, depth in mixer
 *   units (−1..1).
 * - An artifact with NO FX track auditions with the section OFF; players
 *   snapshot the live section on start and restore it on exit
 *   (BeatFxOverride, the SessionReplayDriver contract).
 */
import {
  BEAT_FX_EFFECTS,
  ECHO_BEATS_DEFAULT,
  type BeatFxEffectId,
  type BeatFxSectionState,
  type BeatFxTarget,
} from '../playback/beatFx';
import type { LanePoint } from './mixModel';
import type { RoutineLanePoint } from '../sets/routinePlan';

// ── Model ────────────────────────────────────────────────────────────────

export type PairFxTarget = 'A' | 'B' | 'master';

interface FxStepState<T> {
  on: boolean;
  selected: BeatFxEffectId;
  target: T;
  beats: number;
}

export interface PairFxStep extends FxStepState<PairFxTarget> {
  /** Window position (0..1 inside the window; may sit past 1 when the
   * author extends an FX beyond the window end). */
  x: number;
}

/** A Transition's Beat FX track. Steps x-sorted; depth in lane units. */
export interface TransitionBeatFx {
  steps: PairFxStep[];
  depth: LanePoint[];
}

export interface RoutineFxStep extends FxStepState<string> {
  /** Routine beat. */
  beat: number;
}

/** A Routine's (or pair projection's) Beat FX track: beat-sorted steps,
 * slotId or 'master' targets, depth in mixer units (−1..1). */
export interface RoutineBeatFx {
  steps: RoutineFxStep[];
  depth: RoutineLanePoint[];
}

/** The section verdict before target resolution (role / slot frame). */
export interface FxVerdict<T> extends FxStepState<T> {
  depth: number;
}

export const DEFAULT_FX_STEP: FxStepState<never> = {
  on: true,
  selected: 'echo',
  target: undefined as never,
  beats: ECHO_BEATS_DEFAULT,
};

// ── Evaluation ───────────────────────────────────────────────────────────

function lastAtOrBefore<S>(steps: S[], pos: number, posOf: (s: S) => number): S | null {
  let lo = 0;
  let hi = steps.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (posOf(steps[mid]) <= pos) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found < 0 ? null : steps[found];
}

/** Linear interpolation, flat outside the points; empty → fallback. */
function interp<P>(points: P[], pos: number, posOf: (p: P) => number, valueOf: (p: P) => number, fallback: number): number {
  if (points.length === 0) return fallback;
  if (pos <= posOf(points[0])) return valueOf(points[0]);
  const last = points[points.length - 1];
  if (pos >= posOf(last)) return valueOf(last);
  for (let i = 1; i < points.length; i++) {
    const b = points[i];
    if (pos <= posOf(b)) {
      const a = points[i - 1];
      const span = posOf(b) - posOf(a);
      const t = span <= 0 ? 1 : (pos - posOf(a)) / span;
      return valueOf(a) + (valueOf(b) - valueOf(a)) * t;
    }
  }
  return valueOf(last);
}

function verdict<T, S extends FxStepState<T>>(steps: S[], step: S | null, depth: number, fallbackTarget: T): FxVerdict<T> {
  if (step) return { on: step.on, selected: step.selected, target: step.target, beats: step.beats, depth };
  const first = steps[0];
  return {
    on: false,
    selected: first?.selected ?? 'echo',
    target: first?.target ?? fallbackTarget,
    beats: first?.beats ?? ECHO_BEATS_DEFAULT,
    depth,
  };
}

/** The pair FX verdict at window position x. */
export function pairFxAt(fx: TransitionBeatFx, x: number): FxVerdict<PairFxTarget> {
  const step = lastAtOrBefore(fx.steps, x, (s) => s.x);
  const y = interp(fx.depth, x, (p) => p.x, (p) => p.y, 0.5);
  return verdict<PairFxTarget, PairFxStep>(fx.steps, step, y * 2 - 1, 'A');
}

/** The routine FX verdict at a routine beat. */
export function routineFxAt(fx: RoutineBeatFx, beat: number): FxVerdict<string> {
  const step = lastAtOrBefore(fx.steps, beat, (s) => s.beat);
  const depth = interp(fx.depth, beat, (p) => p.beat, (p) => p.value, 0);
  return verdict<string, RoutineFxStep>(fx.steps, step, depth, 'master');
}

/** Resolve a verdict onto the physical section. `resolve` maps the
 * role/slot target to a Mixer target; null (no deck) → silent + off. */
export function fxSection<T>(v: FxVerdict<T>, resolve: (t: T) => BeatFxTarget | null): BeatFxSectionState {
  const target = resolve(v.target);
  return {
    selected: v.selected,
    target: target ?? 'sampler',
    on: v.on && target !== null,
    depth: Math.max(-1, Math.min(1, v.depth)),
    beats: v.beats,
  };
}

// ── Pair ↔ routine projection ────────────────────────────────────────────

/** Pair FX track → routine form (pair projection load). `slotOf` maps a
 * role to its slotId. */
export function pairFxToRoutine(
  fx: TransitionBeatFx,
  durationBeats: number,
  offsetBeats: number,
  slotOf: (role: 'A' | 'B') => string
): RoutineBeatFx {
  return {
    steps: fx.steps.map(({ x, ...s }) => ({
      ...s,
      beat: x * durationBeats + offsetBeats,
      target: s.target === 'master' ? 'master' : slotOf(s.target),
    })),
    depth: fx.depth.map((p) => ({ beat: p.x * durationBeats + offsetBeats, value: p.y * 2 - 1 })),
  };
}

/** Routine-form FX → pair form (pair save / kind crossing). `roleOf`
 * maps a slotId to its role; a slot outside the pair reads as an OFF
 * step on the outgoing role (no deck in the pair carries it). */
export function routineFxToPair(
  fx: RoutineBeatFx,
  toX: (beat: number) => number,
  roleOf: (slotId: string) => 'A' | 'B' | null
): TransitionBeatFx {
  return {
    steps: fx.steps.map(({ beat, ...s }) => {
      const role = s.target === 'master' ? 'master' : roleOf(s.target);
      return { ...s, x: toX(beat), target: role ?? 'A', on: s.on && role !== null };
    }),
    depth: fx.depth.map((p) => ({ x: toX(p.beat), y: (p.value + 1) / 2 })),
  };
}

// ── Derivation from capture evidence ────────────────────────────────────

/** Depth simplification tolerance (mixer units): knob streams thin to
 * editable breakpoints. */
const DEPTH_EPS = 0.02;

interface RawFx {
  pos: number;
  selected: BeatFxEffectId | null;
  target: unknown;
  on: boolean;
  depth: number;
  beats: number;
}

/** Shared walk: logged section snapshots (position-stamped, sorted) →
 * steps + depth points. `seed` = the state at `startPos` (null = none
 * logged). `mapTarget` resolves a logged target into the artifact frame
 * (null = not addressable here → reads OFF). Null result = no FX ever
 * sounded (idle FX evidence does not mint a track). */
function buildTrack<T>(
  seed: RawFx | null,
  events: RawFx[],
  mapTarget: (t: unknown) => T | null,
  fallbackTarget: T
): { steps: (FxStepState<T> & { pos: number })[]; depth: { pos: number; value: number }[] } | null {
  const steps: (FxStepState<T> & { pos: number })[] = [];
  const depth: { pos: number; value: number }[] = [];
  let sounded = false;
  let prevTarget = fallbackTarget;
  let prevSelected: BeatFxEffectId = 'echo';
  const push = (e: RawFx): void => {
    const mapped = mapTarget(e.target);
    const selected = e.selected && BEAT_FX_EFFECTS.includes(e.selected) ? e.selected : prevSelected;
    const on = e.on && e.selected !== null && mapped !== null;
    const target = mapped ?? prevTarget;
    prevTarget = target;
    prevSelected = selected;
    if (on) sounded = true;
    const step = { pos: e.pos, on, selected, target, beats: e.beats };
    const last = steps[steps.length - 1];
    if (
      !last ||
      last.on !== step.on ||
      (step.on && (last.selected !== step.selected || last.target !== step.target || last.beats !== step.beats))
    ) {
      // (An OFF step absorbs parameter changes made while off — the next
      // ON reads them from its own snapshot.)
      if (last && Math.abs(last.pos - step.pos) < 1e-9) steps[steps.length - 1] = step;
      else steps.push(step);
    }
    const d = Math.max(-1, Math.min(1, e.depth));
    const lastD = depth[depth.length - 1];
    if (!lastD || Math.abs(lastD.value - d) > 1e-9) {
      if (lastD && Math.abs(lastD.pos - e.pos) < 1e-9) depth[depth.length - 1] = { pos: e.pos, value: d };
      else {
        // Hold shoulder: the knob was still until this move.
        if (lastD && e.pos > lastD.pos) depth.push({ pos: e.pos, value: lastD.value });
        depth.push({ pos: e.pos, value: d });
      }
    }
  };
  if (seed) push(seed);
  for (const e of events) push(e);
  if (!sounded) return null;
  // A leading OFF step is the default — drop it (keeps tracks minimal).
  while (steps.length > 0 && !steps[0].on) steps.shift();
  return { steps, depth: simplifyDepth(depth) };
}

/** RDP over depth points (vertical distance), dropping duplicates. */
function simplifyDepth(points: { pos: number; value: number }[]): { pos: number; value: number }[] {
  if (points.length <= 2) {
    return points.length === 2 && Math.abs(points[0].value - points[1].value) < 1e-9 ? [points[0]] : points;
  }
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [lo, hi] = stack.pop()!;
    const a = points[lo];
    const b = points[hi];
    let worst = -1;
    let worstDist = DEPTH_EPS;
    for (let i = lo + 1; i < hi; i++) {
      const span = b.pos - a.pos;
      const onSeg = span <= 0 ? a.value : a.value + ((points[i].pos - a.pos) / span) * (b.value - a.value);
      const d = Math.abs(points[i].value - onSeg);
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
  const out = points.filter((_, i) => keep[i]);
  if (out.every((p) => Math.abs(p.value - out[0].value) < 1e-9)) return [out[0]];
  return out;
}

type SectionLike = {
  selected: BeatFxEffectId | null;
  target: unknown;
  on: boolean;
  depth: number;
  beats: number;
};

function isSection(v: unknown): v is SectionLike {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.on === 'boolean' && typeof o.depth === 'number' && typeof o.beats === 'number';
}

/**
 * A Take slice's Beat FX → the Transition's FX track (vectorizeTake).
 * Events are role-relabeled (#351): targets 'A'/'B' are physical
 * channels of the slice, `out` the outgoing one; 'sampler'/C/D read OFF.
 * The state at the window start (init head + earlier snapshots) seeds
 * x = 0; in-window snapshots map to x; an FX still ON at the window end
 * gets an explicit OFF step at x = 1. Undefined = no FX sounded in the
 * window (pre-#351 slices included).
 */
export function deriveTransitionBeatFx(
  events: readonly { t: number; kind: string }[],
  windowStartS: number,
  windowEndS: number,
  out: 'A' | 'B'
): TransitionBeatFx | undefined {
  const len = windowEndS - windowStartS;
  if (len <= 0) return undefined;
  let seed: RawFx | null = null;
  const inWindow: RawFx[] = [];
  for (const e of events) {
    const rec = e as unknown as Record<string, unknown>;
    if (e.kind === 'init' && isSection(rec.beatFx) && e.t <= windowStartS) {
      seed = { ...(rec.beatFx as SectionLike), pos: 0 };
    } else if (e.kind === 'beatFx' && isSection(rec)) {
      if (e.t <= windowStartS) seed = { ...rec, pos: 0 };
      else if (e.t <= windowEndS) inWindow.push({ ...rec, pos: (e.t - windowStartS) / len });
    }
  }
  const role = (t: unknown): PairFxTarget | null =>
    t === 'master' ? 'master' : t === out ? 'A' : t === 'A' || t === 'B' ? 'B' : null;
  const track = buildTrack<PairFxTarget>(seed, inWindow, role, 'A');
  if (!track) return undefined;
  const steps: PairFxStep[] = track.steps.map(({ pos, ...s }) => ({ ...s, x: pos }));
  const last = steps[steps.length - 1];
  if (last?.on) steps.push({ ...last, x: Math.max(last.x, 1), on: false });
  return {
    steps,
    depth: track.depth.map((p) => ({ x: p.pos, y: (p.value + 1) / 2 })),
  };
}

/**
 * A promoted Routine's recorded Beat FX (slot-addressed `beatFx` events,
 * beat-stamped; `target` = slot index | 'master' | null) → routine form.
 * Null = no FX sounded in the recording.
 */
export function recordedRoutineBeatFx(
  events: readonly Record<string, unknown>[],
  slotIdOf: (index: number) => string | null
): RoutineBeatFx | null {
  const raw: RawFx[] = [];
  for (const e of events) {
    const beat = e.beat;
    if (e.kind !== 'beatFx' || typeof beat !== 'number' || !isSection(e)) continue;
    raw.push({ ...e, pos: beat });
  }
  if (raw.length === 0) return null;
  raw.sort((a, b) => a.pos - b.pos);
  const map = (t: unknown): string | null =>
    t === 'master' ? 'master' : typeof t === 'number' ? slotIdOf(t) : null;
  const track = buildTrack<string>(null, raw, map, 'master');
  if (!track) return null;
  return {
    steps: track.steps.map(({ pos, ...s }) => ({ ...s, beat: pos })),
    depth: track.depth.map((p) => ({ beat: p.pos, value: p.value })),
  };
}

// ── Parsing (persisted opaque JSON) ─────────────────────────────────────

function parseStepCommon(o: Record<string, unknown>): Omit<FxStepState<unknown>, 'target'> | null {
  if (typeof o.on !== 'boolean' || typeof o.beats !== 'number') return null;
  const selected = BEAT_FX_EFFECTS.includes(o.selected as BeatFxEffectId)
    ? (o.selected as BeatFxEffectId)
    : 'echo';
  return { on: o.on, selected, beats: o.beats };
}

/** Tolerant read of a persisted Transition FX track. */
export function parseTransitionBeatFx(raw: unknown): TransitionBeatFx | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const steps: PairFxStep[] = [];
  for (const s of Array.isArray(o.steps) ? o.steps : []) {
    if (!s || typeof s !== 'object') continue;
    const r = s as Record<string, unknown>;
    const common = parseStepCommon(r);
    if (!common || typeof r.x !== 'number') continue;
    const target = r.target === 'A' || r.target === 'B' || r.target === 'master' ? r.target : null;
    if (!target) continue;
    steps.push({ ...common, x: r.x, target });
  }
  const depth = (Array.isArray(o.depth) ? o.depth : []).filter(
    (p): p is LanePoint => !!p && typeof p === 'object' && typeof p.x === 'number' && typeof p.y === 'number'
  ).map((p) => ({ x: p.x, y: p.y }));
  steps.sort((a, b) => a.x - b.x);
  depth.sort((a, b) => a.x - b.x);
  return { steps, depth };
}

/** Tolerant read of a persisted routine-form FX track. */
export function parseRoutineBeatFx(raw: unknown): RoutineBeatFx | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const steps: RoutineFxStep[] = [];
  for (const s of Array.isArray(o.steps) ? o.steps : []) {
    if (!s || typeof s !== 'object') continue;
    const r = s as Record<string, unknown>;
    const common = parseStepCommon(r);
    if (!common || typeof r.beat !== 'number' || typeof r.target !== 'string') continue;
    steps.push({ ...common, beat: r.beat, target: r.target });
  }
  const depth = (Array.isArray(o.depth) ? o.depth : []).filter(
    (p): p is RoutineLanePoint =>
      !!p && typeof p === 'object' && typeof p.beat === 'number' && typeof p.value === 'number'
  ).map((p) => ({ beat: p.beat, value: p.value }));
  steps.sort((a, b) => a.beat - b.beat);
  depth.sort((a, b) => a.beat - b.beat);
  return { steps, depth };
}

export function cloneRoutineBeatFx(fx: RoutineBeatFx): RoutineBeatFx {
  return { steps: fx.steps.map((s) => ({ ...s })), depth: fx.depth.map((p) => ({ ...p })) };
}

export function routineBeatFxEqual(a: RoutineBeatFx | undefined, b: RoutineBeatFx | undefined): boolean {
  if (!a || !b) return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

// ── Live-section override (players) ─────────────────────────────────────

export interface BeatFxSectionHost {
  getBeatFxSection?(): Readonly<BeatFxSectionState>;
  setBeatFxSection?(state: Readonly<BeatFxSectionState>): void;
}

function sameSection(a: BeatFxSectionState, b: BeatFxSectionState): boolean {
  return a.selected === b.selected && a.target === b.target && a.on === b.on
    && a.depth === b.depth && a.beats === b.beats;
}

/**
 * A player's borrow of the shared Beat FX section (the SessionReplayDriver
 * contract): engage snapshots the live section; apply writes the
 * artifact's verdict (null = no FX track → the live section, OFF) ONLY
 * when it changes — a hand on the FX strip mid-audition keeps sounding
 * until the artifact's next change; release restores the snapshot
 * (`keep` = takeover: the section stays as it sounds).
 */
export class BeatFxOverride {
  private live: BeatFxSectionState | null = null;
  private lastApplied: BeatFxSectionState | null = null;

  private readonly host: BeatFxSectionHost;

  constructor(host: BeatFxSectionHost) {
    this.host = host;
  }

  isEngaged(): boolean {
    return this.live !== null;
  }

  engage(): void {
    if (this.live || !this.host.getBeatFxSection || !this.host.setBeatFxSection) return;
    this.live = { ...this.host.getBeatFxSection() };
    this.lastApplied = null;
  }

  apply(state: BeatFxSectionState | null): void {
    if (!this.live) return;
    const next = state ?? { ...this.live, on: false };
    if (this.lastApplied && sameSection(this.lastApplied, next)) return;
    this.lastApplied = next;
    this.host.setBeatFxSection?.(next);
  }

  release(opts: { keep?: boolean } = {}): void {
    const live = this.live;
    this.live = null;
    this.lastApplied = null;
    if (live && !opts.keep) this.host.setBeatFxSection?.(live);
  }
}
