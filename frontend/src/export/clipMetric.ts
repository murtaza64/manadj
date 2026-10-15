/**
 * Clip hypermeter (#377 round 3): where the mix's metrically important
 * instants fall on the Routine clock — drops and phrase boundaries of the
 * audible tracks — so visualizer changes, impacts and the header pips land
 * on real downbeats instead of `floor(routineBeat) % 4`.
 *
 * Per track the phrase lattice is anchored at hot cue 4 (cue-slot
 * convention: 4 = the drop), falling back to the first metric-ladder reset
 * mark, then the first downbeat. Bars count in whole beats from that
 * anchor (4/4), so a track whose stored downbeat phase is off still phrases
 * correctly. Drops = the anchor (when it is hot cue 4) plus strong drop
 * hypotheses that sit on the anchor's 16-bar lattice.
 *
 * On the Routine clock: each slot's trace maps track time → mix time; bar
 * crossings while the slot plays (no jumps) become events, kept when the
 * slot is audible (render meters). The dominant slot (smoothed post-fader
 * level with hysteresis) owns the header's bar/phrase readout.
 */
import { beatIndexAt } from '../editor/beatReadout';
import type { PlannedRoutine } from '../sets/routinePlan';
import { routineSlotStateAt } from '../sets/routinePlan';
import type { RenderMeters } from './routineAudioRender';
import { meterLevel } from './meterMath';
import type { ClipLook, CueTransition, TransitionVfx, VizCue } from './clipSpec';

export interface TrackMetricInput {
  beatTimes: number[];
  downbeatTimes: number[];
  hotCues: { slot_number: number; time_seconds: number }[];
  /** Drop hypotheses (/api/drops). */
  drops?: { time: number; strength: number }[] | null;
  /** Metric-ladder reset marks (track seconds). */
  resetMarks?: number[] | null;
  /** Low-band amplitude over the track (drop inference when no hot cue 4). */
  lowBand?: { values: Float32Array; duration: number } | null;
}

export interface TrackMetric {
  beatTimes: number[];
  /** Beat ordinal (into beatTimes) of the phrase anchor. */
  anchorBeat: number;
  anchorSource: 'hotcue4' | 'inferred' | 'ladder' | 'downbeat' | 'beat';
  /** Track-seconds of drops (sorted). */
  dropSecs: number[];
}

export const PHRASE_BARS = 16;

/** Build-up progress 0..1 through the `bars` bars before the next drop
 * (eased: slow start, steep at the end); 0 outside a build. */
export function buildUpAt(drops: readonly number[], t: number, barSec: number, bars = 16): number {
  let next = Infinity;
  for (const d of drops) if (d > t && d < next) next = d;
  const span = barSec * bars;
  if (!Number.isFinite(next) || next - t > span) return 0;
  return Math.pow(1 - (next - t) / span, 1.6);
}

const DROP_STRENGTH_MIN = 0.6;
const INFER_RATIO = 1.6;

/** Drops from energy: 8-bar boundaries (on the beat grid from `origin`)
 * where the low band's mean over the next 8 bars jumps ≥ INFER_RATIO× the
 * previous 8 and reaches ≥ 70 % of the track's loudest 8 bars; later drops
 * at least 32 bars on. */
export function inferDrops(beats: number[], origin: number, low: { values: Float32Array; duration: number }): number[] {
  const n = low.values.length;
  if (n < 16 || beats.length < 64) return [];
  const meanBetween = (a: number, b: number): number => {
    const i0 = Math.max(0, Math.floor((a / low.duration) * n));
    const i1 = Math.min(n, Math.ceil((b / low.duration) * n));
    let sum = 0;
    for (let i = i0; i < i1; i++) sum += low.values[i];
    return i1 > i0 ? sum / (i1 - i0) : 0;
  };
  const span = 32; // 8 bars of beats
  const first = origin % span;
  const blocks: { at: number; mean: number }[] = [];
  for (let b = first; b + span < beats.length; b += span) blocks.push({ at: beats[b], mean: meanBetween(beats[b], beats[b + span]) });
  const peak = blocks.reduce((m, x) => Math.max(m, x.mean), 0);
  if (peak <= 0) return [];
  const out: number[] = [];
  for (let i = 1; i < blocks.length; i++) {
    const { at, mean } = blocks[i];
    if (mean < 0.7 * peak || mean < INFER_RATIO * blocks[i - 1].mean) continue;
    if (out.length > 0 && at - out[out.length - 1] < (beats[span * 4] ?? Infinity) - beats[0]) continue;
    out.push(at);
  }
  return out;
}

export function buildTrackMetric(input: TrackMetricInput): TrackMetric | null {
  const beats = input.beatTimes;
  if (beats.length < 8) return null;
  const cue4 = input.hotCues.find((c) => c.slot_number === 4)?.time_seconds;
  let anchorSec: number;
  let anchorSource: TrackMetric['anchorSource'];
  if (cue4 !== undefined) { anchorSec = cue4; anchorSource = 'hotcue4'; }
  else if (input.resetMarks && input.resetMarks.length > 0) { anchorSec = input.resetMarks[0]; anchorSource = 'ladder'; }
  else if (input.downbeatTimes.length > 0) { anchorSec = input.downbeatTimes[0]; anchorSource = 'downbeat'; }
  else { anchorSec = beats[0]; anchorSource = 'beat'; }
  const anchorBeat = Math.round(beatIndexAt(beats, anchorSec) ?? 0);
  const dropSecs: number[] = [];
  if (anchorSource === 'hotcue4') dropSecs.push(beats[Math.max(0, Math.min(beats.length - 1, anchorBeat))]);
  for (const d of input.drops ?? []) {
    if (d.strength < DROP_STRENGTH_MIN) continue;
    const b = beatIndexAt(beats, d.time);
    if (b === null) continue;
    const rel = (b - anchorBeat) / (4 * PHRASE_BARS);
    if (Math.abs(rel - Math.round(rel)) * 4 * PHRASE_BARS > 0.3) continue;
    const at = beats[Math.round(b)] ?? d.time;
    if (!dropSecs.some((x) => Math.abs(x - at) < 1)) dropSecs.push(at);
  }
  dropSecs.sort((a, b) => a - b);
  // No hot cue 4 and no strong hypothesis: infer from the low band, and
  // anchor the phrase lattice on the first inferred drop.
  if (dropSecs.length === 0 && anchorSource !== 'hotcue4' && input.lowBand) {
    const inferred = inferDrops(beats, anchorBeat, input.lowBand);
    if (inferred.length > 0) {
      return { beatTimes: beats, anchorBeat: Math.round(beatIndexAt(beats, inferred[0]) ?? anchorBeat), anchorSource: 'inferred', dropSecs: inferred };
    }
  }
  return { beatTimes: beats, anchorBeat, anchorSource, dropSecs };
}

export interface MetricPosition {
  /** Fractional beats from the anchor (negative before it). */
  beat: number;
  bar: number;
  beatInBar: number;
  /** Beat phase 0..1. */
  phase: number;
  barInPhrase: number;
  phrase: number;
}

const mod = (a: number, n: number): number => ((a % n) + n) % n;

export function metricAt(m: TrackMetric, trackSec: number): MetricPosition | null {
  const idx = beatIndexAt(m.beatTimes, trackSec);
  if (idx === null) return null;
  const beat = idx - m.anchorBeat;
  const bar = Math.floor(beat / 4);
  return {
    beat, bar,
    beatInBar: mod(Math.floor(beat), 4),
    phase: mod(beat, 1),
    barInPhrase: mod(bar, PHRASE_BARS),
    phrase: Math.floor(bar / PHRASE_BARS),
  };
}

/** Hypermetric tier of a bar ordinal (from the anchor): 5 = 32-bar, 4 =
 * 16-bar phrase, 3 = 8, 2 = 4, 1 = 2, 0 = plain bar. */
export function barTier(bar: number): number {
  for (const [tier, n] of [[5, 32], [4, 16], [3, 8], [2, 4], [1, 2]] as const) if (mod(bar, n) === 0) return tier;
  return 0;
}

export interface MetricEvent {
  /** Mix second. */
  t: number;
  slot: number;
  bar: number;
  tier: number;
  drop: boolean;
  /** Smoothed post-fader level of the slot at the instant (0..1). */
  level: number;
  /** The slot was the dominant (loudest, hysteretic) one. */
  dominant: boolean;
}

export interface ClipMetric {
  tracks: ReadonlyMap<number, TrackMetric>;
  /** Events at tier ≥ 2 (4-bar) or drops, sorted by time. */
  events: MetricEvent[];
  /** Dominant slot index at a mix second (−1 = none). */
  dominantAt(t: number): number;
  /** Smoothed post level of a slot at a mix second (0..1). */
  levelAt(slot: number, t: number): number;
  /** Metric position of a slot at a mix second (null when the slot has no grid). */
  positionAt(slot: number, t: number): MetricPosition | null;
  /** 0..1 on-screen presence of a slot: ramps in just before it becomes
   * audible, holds through short silences, ramps out after (eased). */
  visibilityAt(slot: number, t: number): number;
  /** Most slots simultaneously visible over the clip (≥ 1). */
  maxConcurrent: number;
  /** First time each slot takes over as dominant (title cards). */
  takeovers: { t: number; slot: number }[];
}

const AUDIBLE_LEVEL = 0.4;
const SMOOTH_S = 0.6;
const HYSTERESIS = 1.25;

/** Smoothed per-slot levels + dominant slot per meter step. */
const VIS_ON = 0.14;
const VIS_HOLD_S = 2.5;
const VIS_RAMP_S = 0.55;
const VIS_LOOKAHEAD_S = 0.45;

/** Presence ramps per slot from the smoothed levels (see visibilityAt). */
function visibilityTimeline(levels: Float32Array[], stepSec: number): Float32Array[] {
  const ahead = Math.round(VIS_LOOKAHEAD_S / stepSec);
  const holdSteps = Math.round(VIS_HOLD_S / stepSec);
  const rate = stepSec / VIS_RAMP_S;
  return levels.map((lv) => {
    const n = lv.length;
    const raw = new Float32Array(n);
    let v = 0;
    let quiet = holdSteps;
    for (let k = 0; k < n; k++) {
      const look = lv[Math.min(n - 1, k + ahead)];
      quiet = look >= VIS_ON ? 0 : quiet + 1;
      const target = quiet < holdSteps ? 1 : 0;
      v = target > v ? Math.min(1, v + rate) : Math.max(0, v - rate);
      raw[k] = v;
    }
    return raw;
  });
}

function levelTimeline(meters: RenderMeters | undefined, nSlots: number): { levels: Float32Array[]; dominant: Int16Array; stepSec: number } {
  if (!meters) return { levels: [], dominant: new Int16Array(0), stepSec: 1 };
  const { steps, stepSec } = meters;
  const a = 1 - Math.exp(-stepSec / SMOOTH_S);
  const levels = Array.from({ length: nSlots }, () => new Float32Array(steps));
  const dominant = new Int16Array(steps).fill(-1);
  const cur = new Array<number>(nSlots).fill(0);
  let dom = -1;
  for (let k = 0; k < steps; k++) {
    for (let i = 0; i < nSlots; i++) {
      const v = meterLevel(meters.slot[i]?.post[k] ?? 0);
      // Fast attack, smoothed release: a deck slamming in owns the frame at once.
      cur[i] = v > cur[i] ? cur[i] + (v - cur[i]) * Math.min(1, a * 4) : cur[i] + (v - cur[i]) * a;
      levels[i][k] = cur[i];
    }
    let best = -1;
    for (let i = 0; i < nSlots; i++) if (cur[i] > 0.15 && (best < 0 || cur[i] > cur[best])) best = i;
    if (dom < 0 || cur[dom] <= 0.15) dom = best;
    else if (best >= 0 && best !== dom && cur[best] > cur[dom] * HYSTERESIS) dom = best;
    dominant[k] = dom;
  }
  return { levels, dominant, stepSec };
}

export function buildClipMetric(
  routine: PlannedRoutine,
  trackMetrics: ReadonlyMap<number, TrackMetric>,
  range: { startSec: number; endSec: number },
  meters?: RenderMeters,
): ClipMetric {
  const n = routine.slots.length;
  const lt = levelTimeline(meters, n);
  const stepOf = (t: number): number =>
    Math.max(0, Math.min(Math.max(0, lt.dominant.length - 1), Math.floor((t - range.startSec) / lt.stepSec)));
  const levelAt = (slot: number, t: number): number => (lt.levels[slot] ? lt.levels[slot][stepOf(t)] : 1);
  const dominantAt = (t: number): number => {
    if (lt.dominant.length > 0) return lt.dominant[stepOf(t)];
    // No meters: the playing slot with the highest fader.
    let best = -1;
    let bestF = -1;
    routine.slots.forEach((s, i) => {
      const st = routineSlotStateAt(routine, s, t);
      if (st.playing && s.trace.length > 0) {
        const f = t >= s.entryMixSec ? 1 - (t - s.entryMixSec) / 1e6 : 0;
        if (f > bestF) { bestF = f; best = i; }
      }
    });
    return best;
  };
  const positionAt = (slot: number, t: number): MetricPosition | null => {
    const s = routine.slots[slot];
    const m = s ? trackMetrics.get(s.trackId) : undefined;
    if (!s || !m) return null;
    return metricAt(m, routineSlotStateAt(routine, s, t).trackTime);
  };

  const events: MetricEvent[] = [];
  const dt = 1 / 100;
  routine.slots.forEach((slot, i) => {
    const m = trackMetrics.get(slot.trackId);
    if (!m) return;
    const t0 = Math.max(range.startSec, slot.occupyFromMixSec);
    const t1 = Math.min(range.endSec, Math.max(slot.releaseMixSec, slot.entryMixSec));
    let prev: { t: number; beat: number; playing: boolean } | null = null;
    for (let t = t0; t <= t1 + 1e-9; t += dt) {
      const st = routineSlotStateAt(routine, slot, t);
      const idx = beatIndexAt(m.beatTimes, st.trackTime);
      if (idx === null) { prev = null; continue; }
      const beat = idx - m.anchorBeat;
      if (prev && prev.playing && st.playing) {
        const d = beat - prev.beat;
        if (d > 0 && d < 1) {
          const b0 = Math.floor(prev.beat / 4);
          const b1 = Math.floor(beat / 4);
          if (b1 > b0) {
            const bar = b1;
            const f = (bar * 4 - prev.beat) / d;
            const at = prev.t + f * (t - prev.t);
            const trackAt = m.beatTimes[Math.round(bar * 4 + m.anchorBeat)] ?? st.trackTime;
            const drop = m.dropSecs.some((x) => Math.abs(x - trackAt) < 0.15);
            const tier = barTier(bar);
            const level = levelAt(i, at);
            if ((tier >= 2 || drop) && level >= AUDIBLE_LEVEL) {
              events.push({ t: at, slot: i, bar, tier, drop, level, dominant: dominantAt(at) === i });
            }
          }
        }
      }
      prev = { t, beat, playing: st.playing };
    }
  });
  events.sort((a, b) => a.t - b.t);

  const vis = visibilityTimeline(lt.levels, lt.stepSec);
  const ease = (x: number): number => x * x * (3 - 2 * x);
  const visibilityAt = (slot: number, t: number): number => {
    if (!vis[slot]) {
      const s = routine.slots[slot];
      return s && t >= s.occupyFromMixSec && t <= Math.max(s.releaseMixSec, s.entryMixSec) ? 1 : 0;
    }
    // Interpolate between steps so the slide is smooth at any frame rate.
    const f = (t - range.startSec) / lt.stepSec;
    const k = Math.max(0, Math.min(vis[slot].length - 1, Math.floor(f)));
    const k1 = Math.min(vis[slot].length - 1, k + 1);
    const fr = Math.max(0, Math.min(1, f - k));
    return ease(vis[slot][k] + (vis[slot][k1] - vis[slot][k]) * fr);
  };
  let maxConcurrent = 1;
  for (let k = 0; k < (vis[0]?.length ?? 0); k++) {
    let c = 0;
    for (let i = 0; i < n; i++) if (vis[i][k] > 0.5) c++;
    if (c > maxConcurrent) maxConcurrent = c;
  }
  if (vis.length === 0) maxConcurrent = Math.max(1, new Set(routine.slots.map((s) => s.deck).filter(Boolean)).size);
  const takeovers: { t: number; slot: number }[] = [];
  const seenDom = new Set<number>();
  for (let k = 0; k < lt.dominant.length; k++) {
    const d = lt.dominant[k];
    if (d >= 0 && !seenDom.has(d)) {
      seenDom.add(d);
      takeovers.push({ t: range.startSec + k * lt.stepSec, slot: d });
    }
  }
  return { tracks: trackMetrics, events, dominantAt, levelAt, positionAt, visibilityAt, maxConcurrent, takeovers };
}

export type VizImpact = 'none' | 'flash' | 'zoom' | 'shockwave' | 'strobe';

export interface AutoVizOptions {
  /** 'storyboard': an arc (mixer-forward intro, blackout into the drop,
   * restyles that brighten the visualizer and strip the UI as the clip
   * goes on); 'rotation': presets cycle on drops / phrases. */
  style?: 'storyboard' | 'rotation';
  /** Preset rotation (cycled). */
  presets: string[];
  /** Minimum seconds between preset switches. */
  minGapSec: number;
  /** Impact on drops / on phrase switches. */
  dropImpact: VizImpact;
  phraseImpact: VizImpact;
  /** Impact-only pulses on every audible 16-bar phrase that doesn't switch. */
  phrasePulses: boolean;
  /** Vary how cues arrive: blackouts into drops, blasts / VFX after them,
   * solos and kaleidoscopes on phrase switches. */
  transitions?: boolean;
  /** Keyframe look changes: each drop restyles the waves, breakdowns strip
   * the overlays back. */
  lookChanges?: boolean;
}

export const DEFAULT_AUTO_VIZ: AutoVizOptions = {
  presets: ['voyage', 'odyssey', 'nova', 'g05-materia-mercury', 'strata', 'siphon', 'aurora'],
  minGapSec: 20,
  dropImpact: 'shockwave',
  phraseImpact: 'flash',
  phrasePulses: true,
  style: 'storyboard',
  transitions: false,
  lookChanges: false,
};

const DROP_LOOKS: Partial<ClipLook>[] = [
  { composite: 'screen', wavePalette: 'neon', glow: 0.95, vizDim: 0.15, beatPulse: 0.5, showKnobs: true, showTicker: true },
  { composite: 'cards', wavePalette: 'fire', glow: 0.85, vizDim: 0.25, beatPulse: 0.6, showKnobs: true, showTicker: true },
  { composite: 'negative', wavePalette: 'deck', glow: 0.7, vizDim: 0.2, beatPulse: 0.45, showKnobs: true, showTicker: true },
  { composite: 'tint', wavePalette: 'ice', glow: 0.9, vizDim: 0.15, beatPulse: 0.5, showKnobs: true, showTicker: true },
];
const PHRASE_LOOKS: Partial<ClipLook>[] = [
  { composite: 'cards', wavePalette: 'deck', glow: 0.7, vizDim: 0.3, beatPulse: 0.35, showKnobs: true, showTicker: true },
  { composite: 'mask', wavePalette: 'mono', glow: 0.5, vizDim: 0.1, beatPulse: 0.25, showKnobs: false, showTicker: false },
];
type Tr = Omit<CueTransition, 'durationSec'> & { bars: number };
const DROP_TRANSITIONS: (Tr | null)[] = [
  { kind: 'blackout', placement: 'before', bars: 1 },
  { kind: 'blast', placement: 'after', bars: 2 },
  { kind: 'vfx', vfx: 'rgb', placement: 'after', bars: 2 },
  { kind: 'blackout', placement: 'before', bars: 2, hideWaves: true },
  { kind: 'vfx', vfx: 'glitch', placement: 'after', bars: 1 },
  { kind: 'cut', bars: 0 },
];
const PHRASE_TRANSITIONS: (Tr | null)[] = [
  null,
  { kind: 'solo', placement: 'after', bars: 4 },
  { kind: 'cut', bars: 0 },
  { kind: 'vfx', vfx: 'kaleido', placement: 'after', bars: 2 },
  null,
  { kind: 'vfx', vfx: 'tunnel', placement: 'after', bars: 2 },
];
const PULSE_VFX: TransitionVfx[] = ['invert', 'strobe', 'mirror'];

/** A metrically placed programme: preset switches on drops and on the
 * dominant slot's 32-bar boundaries (16-bar when the gap is long), with
 * impacts. Clip-relative seconds. */
export function autoVizCues(
  metric: ClipMetric, range: { startSec: number; endSec: number }, opts: AutoVizOptions, secPerBar = 2,
): VizCue[] {
  if ((opts.style ?? 'storyboard') === 'storyboard') return storyboardCues(metric, range, opts, secPerBar);
  const presets = opts.presets.length > 0 ? opts.presets : DEFAULT_AUTO_VIZ.presets;
  let pi = 0;
  const cues: VizCue[] = [{ atSec: 0, presetId: presets[0] }];
  let drops = 0;
  let phrases = 0;
  let pulses = 0;
  const transition = (tr: Tr | null, s: number): CueTransition | undefined => {
    if (!tr) return undefined;
    const { bars, ...rest } = tr;
    const out: CueTransition = { ...rest, durationSec: Math.max(0.5, Math.min(s, bars * secPerBar)) };
    if (tr.kind === 'blast') out.presetId = presets[(pi + Math.floor(presets.length / 2)) % presets.length];
    if (tr.kind === 'cut') delete out.durationSec;
    return out;
  };
  let lastSwitch = 0;
  const seen = new Set<number>();
  for (const e of metric.events) {
    const s = e.t - range.startSec;
    if (s < 1 || range.endSec - e.t < 4) continue;
    const key = Math.round(s * 10);
    if (seen.has(key)) continue;
    const strong = e.drop || (e.dominant && e.tier >= 5) || (e.dominant && e.tier >= 4 && s - lastSwitch > opts.minGapSec * 2);
    if (strong && s - lastSwitch >= (e.drop ? opts.minGapSec * 0.6 : opts.minGapSec)) {
      pi = (pi + 1) % presets.length;
      const cue: VizCue = { atSec: s, presetId: presets[pi], impact: e.drop ? opts.dropImpact : opts.phraseImpact };
      const n = e.drop ? drops++ : phrases++;
      if (opts.transitions) {
        const tr = transition(e.drop ? DROP_TRANSITIONS[n % DROP_TRANSITIONS.length] : PHRASE_TRANSITIONS[n % PHRASE_TRANSITIONS.length], s);
        if (tr) cue.transition = tr;
      }
      if (opts.lookChanges) cue.look = { ...(e.drop ? DROP_LOOKS[n % DROP_LOOKS.length] : PHRASE_LOOKS[n % PHRASE_LOOKS.length]) };
      cues.push(cue);
      lastSwitch = s;
      seen.add(key);
    } else if (opts.phrasePulses && (e.drop || (e.dominant && e.tier >= 4))) {
      const cue: VizCue = { atSec: s, presetId: presets[pi], impact: e.drop ? opts.dropImpact : opts.phraseImpact };
      if (opts.transitions && pulses++ % 2 === 1) {
        cue.transition = { kind: 'vfx', vfx: PULSE_VFX[Math.floor(pulses / 2) % PULSE_VFX.length], placement: 'after', durationSec: secPerBar };
      }
      cues.push(cue);
      seen.add(key);
    }
  }
  return cues;
}

/** Look fields the storyboard drives (each scene sets all of them). */
type StoryLook = Pick<ClipLook,
  'vizDim' | 'vignette' | 'vizOpacity' | 'composite' | 'wavePalette' | 'showKnobs' | 'showTitles' | 'showPlayhead' | 'showCues' | 'showTicker'>;
const STORY_COMPOSITES: ClipLook['composite'][] = ['screen', 'cards', 'mask', 'cards'];
const STORY_PALETTES: ClipLook['wavePalette'][] = ['neon', 'deck', 'deck', 'fire'];

const lerp = (a: number, b: number, k: number): number => a + (b - a) * Math.max(0, Math.min(1, k));
const r2 = (v: number): number => Math.round(v * 100) / 100;

/** The auto storyboard (modelled on a hand-authored clip): the intro is
 * mixer-forward (titles, knobs, a dim visualizer); a short blackout and a
 * preset blast break up the first phrase change; the visualizer blacks
 * out for a bar into each drop and the drop cuts to a restyled scene;
 * after it every scene change cuts to a new preset, the visualizer
 * brightens (darken / vignette → 0) and the UI strips back — knobs and
 * titles at ~2/3, playhead / cue flags / pills for the closing scene. */
export function storyboardCues(
  metric: ClipMetric, range: { startSec: number; endSec: number }, opts: AutoVizOptions, secPerBar = 2,
): VizCue[] {
  const presets = opts.presets.length > 0 ? opts.presets : DEFAULT_AUTO_VIZ.presets;
  const dur = Math.max(1, range.endSec - range.startSec);
  let pi = 0;
  const intro: StoryLook = {
    vizDim: 0.35, vignette: 0.6, vizOpacity: 0.75, composite: 'cards', wavePalette: 'deck',
    showKnobs: true, showTitles: true, showPlayhead: true, showCues: true, showTicker: true,
  };
  const cues: VizCue[] = [{ atSec: 0, presetId: presets[0], look: { ...intro, revealAtDrop: true } }];
  // Scenes carry only what they change against the running storyboard look.
  let running: Partial<ClipLook> = { ...intro };
  const changes = (target: Partial<ClipLook>): Partial<ClipLook> | undefined => {
    const out: Partial<ClipLook> = {};
    for (const [k, v] of Object.entries(target) as [keyof ClipLook, unknown][]) {
      if (running[k] !== v) (out as Record<string, unknown>)[k] = v;
    }
    running = { ...running, ...target };
    return Object.keys(out).length > 0 ? out : undefined;
  };
  // Candidate boundaries: audible drops and the dominant track's phrases
  // (16-bar before the first drop, 8-bar after it — the cuts quicken).
  const firstDropT = metric.events.find((e) => e.drop && e.t - range.startSec >= 1 && range.endSec - e.t >= 4)?.t ?? Infinity;
  const evs: { s: number; drop: boolean }[] = [];
  for (const e of metric.events) {
    const s = e.t - range.startSec;
    if (s < 1 || range.endSec - e.t < 4) continue;
    if (!e.drop && !(e.dominant && e.tier >= (e.t > firstDropT ? 3 : 4))) continue;
    const prev = evs[evs.length - 1];
    if (prev && s - prev.s < 0.5) { prev.drop ||= e.drop; continue; }
    evs.push({ s, drop: e.drop });
  }
  const firstDrop = evs.find((e) => e.drop)?.s ?? dur * 0.35;
  const minGap = Math.max(8, opts.minGapSec * 0.5);
  let last = 0;
  let scene = 0;
  let drops = 0;
  let blasted = false;
  for (const e of evs) {
    const s = e.s;
    if (!e.drop && s - last < minGap) {
      if (opts.phrasePulses) cues.push({ atSec: s, presetId: presets[pi], impact: opts.phraseImpact });
      continue;
    }
    if (e.drop && s - last < secPerBar * 2) continue;
    pi = (pi + 1) % presets.length;
    const cue: VizCue = { atSec: s, presetId: presets[pi], impact: e.drop ? opts.dropImpact : opts.phraseImpact };
    const p = s / dur;
    if (s < firstDrop) {
      // Intro: the first phrase change breaks with a blackout + a blast.
      if (!blasted && s > secPerBar) {
        cues.push({ atSec: r2(s - secPerBar / 2), presetId: presets[(pi + presets.length - 1) % presets.length], transition: { kind: 'blackout', placement: 'after', durationSec: r2(secPerBar / 2) } });
        cue.transition = { kind: 'blast', placement: 'after', durationSec: r2(secPerBar * 2), presetId: presets[(pi + Math.floor(presets.length / 2)) % presets.length] };
        blasted = true;
      } else {
        cue.transition = { kind: 'cut' };
      }
    } else {
      const q = (s - firstDrop) / Math.max(1, dur - firstDrop);
      const look: Partial<ClipLook> = e.drop && drops === 0
        ? { composite: 'cards', wavePalette: 'mono', vizDim: 0.12, vignette: 0.35, vizOpacity: 0.9 }
        : {
          composite: STORY_COMPOSITES[scene % STORY_COMPOSITES.length],
          wavePalette: STORY_PALETTES[scene % STORY_PALETTES.length],
          vizDim: r2(lerp(0.12, 0, q * 1.5)), vignette: r2(lerp(0.35, 0, q * 1.5)), vizOpacity: r2(lerp(0.9, 1, q * 2)),
        };
      look.showKnobs = look.showTitles = p < 0.65;
      look.showPlayhead = look.showCues = look.showTicker = p < 0.82;
      const diff = changes(look);
      if (diff) cue.look = diff;
      if (e.drop) {
        cue.transition = drops % 2 === 0
          ? { kind: 'blackout', placement: 'before', durationSec: r2(Math.min(secPerBar, s - last - 0.5)) }
          : { kind: 'blast', placement: 'after', durationSec: r2(secPerBar * 2), presetId: presets[(pi + 2) % presets.length] };
        drops++;
      } else {
        cue.transition = scene % 3 === 2 ? { kind: 'crossfade', durationSec: r2(secPerBar) } : { kind: 'cut' };
      }
      scene++;
    }
    cues.push(cue);
    last = s;
  }
  return cues.sort((a, b) => a.atSec - b.atSec);
}
