/**
 * Portrait clip scene (#377): a pure Canvas 2D frame painter.
 *
 * Look (review round 2): not app chrome — a visualizer preset fills the
 * background, the deck lanes float as dark glass cards with deck-colored
 * neon edges, waveforms bloom, mixer state reads as glowing knobs and
 * meters, and actions burst as rings/sweeps/pills rather than labels in
 * boxes. Everything is evaluated at the requested mix instant from the
 * PlannedRoutine + the render's meters, so frames are deterministic.
 *
 * Logical canvas is 1080×1920; `drawRoutineFrame` scales to the target.
 */
import type { DecodedWaveform } from '../waveform/blob';
import type { RGB, StyleParams } from '../waveform/styles';
import { createStripHistory, type StripHistory, type StripValues } from '../performance/stripHistory';
import { drawStyledWave, type ColumnModulation } from '../sets/ladderWaveStyle';
import type { PlannedRoutine, PlannedRoutineSlot, RoutineDeck } from '../sets/routinePlan';
import {
  ROUTINE_DECK_ORDER, routineSlotStateAt, slotLanesAt, slotOccupyingDeckAt,
} from '../sets/routinePlan';
import { routineFxAt } from '../editor/beatFxLane';
import type { RoutineAction } from './routineActions';
import { DECK_COLORS } from '../theme/deckColors';
import { BEAT_FX_COLORS } from '../theme/fxColors';
import { AUTOMATION_COLORS, FILTER_LPF_COLOR, FX_DEPTH_COLOR } from '../theme/automationColors';
import { DANGER, FONT_MONO, PLAYHEAD, TEXT, WARNING } from '../theme/tokens';
import { cueCssColor } from '../hotcues/palette';
import { trimToGain } from '../playback/mixerMath';
import { eqValueToGain } from '../playback/graph';
import { BEAT_FX_EFFECTS, BEAT_FX_LABELS, BEAT_FX_SHORT_LABELS, beatFxMixGains, formatBeatFxLength } from '../playback/beatFx';
import type { FilterSettings } from '../playback/filterSettings';
import { filterGroupGains } from '../waveform/filterModulation';
import type { RenderMeters } from './routineAudioRender';
import { meterLevel, stepMeter } from './meterMath';
import type { ClipLook, ProgrammeOverlay, TransitionVfx, WavePalette } from './clipSpec';
import type { ClipMetric, VizImpact } from './clipMetric';
import { DEFAULT_LOOK } from './clipSpec';

export const SCENE_W = 1080;
export const SCENE_H = 1920;

export interface SceneTrack {
  trackId: number;
  title: string;
  artist: string;
  bpm: number | null;
  durationSec: number;
  wave: DecodedWaveform | null;
  beatTimes: number[];
  downbeatTimes: number[];
  hotCues: { slot_number: number; time_seconds: number; color: string | null }[];
}

export interface RoutineScene {
  routine: PlannedRoutine;
  tracks: ReadonlyMap<number, SceneTrack>;
  actions: RoutineAction[];
  style: { styleId: string; params: StyleParams };
  filterSettings: Readonly<FilterSettings>;
  title: string;
  range: { startSec: number; endSec: number };
  look?: ClipLook;
  /** Master level at a mix instant, 0..1 (from the rendered audio). */
  masterLevel?: (t: number) => { left: number; right: number };
  /** Per-step strip meters captured during the render. */
  meters?: RenderMeters;
  /** Mix second of meter step 0 (the render's start; defaults to range start). */
  metersStartSec?: number;
  /** Mutable smoothing state for sequential frames (created lazily). */
  meterState?: { t: number; slot: { post: number; low: number; mid: number; high: number }[]; pulse: number };
  /** Hypermeter: drops / phrase events, dominant slot, levels (#377 r3). */
  metric?: ClipMetric;
  /** This frame's HUD pulse (beat × bass/energy, drop boost) — set by
   * drawRoutineFrame, read by every control that breathes with the beat. */
  hud?: number;
  /** Per-slot waveform strip history (created lazily, replayed on seeks). */
  stripState?: Map<number, { history: StripHistory; t: number }>;
}

export interface FrameExtras {
  /** Background layers (already rendered for this instant), back to front. */
  background?: { canvas: HTMLCanvasElement; alpha: number }[];
  /** Master fade multiplier (0 = black). */
  fade?: number;
  /** The most recent visualizer cue impact (kind + age seconds). */
  impact?: { kind: VizImpact; age: number } | null;
  /** A held programme transition running now (blackout / solo / blast / vfx). */
  overlay?: ProgrammeOverlay | null;
}

const FLASH_SEC = 0.6;
const PILL_SEC = 4.5;
const WAVE_COLUMN_PX = 2;
const WAVE_FILL = 0.84;

// ── Helpers ──────────────────────────────────────────────────────────────

const scratchCanvases = new Map<string, { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }>();
function scratch(key: string, w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  let s = scratchCanvases.get(key);
  if (!s) {
    const canvas = document.createElement('canvas');
    s = { canvas, ctx: canvas.getContext('2d')! };
    scratchCanvases.set(key, s);
  }
  if (s.canvas.width !== w || s.canvas.height !== h) {
    s.canvas.width = w;
    s.canvas.height = h;
  }
  return s;
}

export function sceneDecks(routine: PlannedRoutine): RoutineDeck[] {
  const used = new Set<RoutineDeck>();
  for (const s of routine.slots) if (s.deck) used.add(s.deck);
  return ROUTINE_DECK_ORDER.filter((d) => used.has(d));
}

const beatOf = (r: PlannedRoutine, t: number): number => (t - r.beatOriginMixSec) / r.secPerBeat;
const mixOf = (r: PlannedRoutine, beat: number): number => r.beatOriginMixSec + beat * r.secPerBeat;

function font(px: number, bold = false): string {
  return `${bold ? 'bold ' : ''}${px}px ${FONT_MONO}`;
}

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, alpha))})`;
}

function lowerBound(arr: number[], v: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function glowText(
  ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, blur: number, ink = color
): void {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.fillStyle = ink;
  ctx.fillText(text, x, y);
  ctx.fillText(text, x, y);
  ctx.restore();
}

function easeOut(k: number): number {
  return 1 - (1 - k) * (1 - k);
}

interface Layout {
  header: { y: number; h: number };
  lanes: { y: number; h: number; gap: number };
  fx: { y: number; h: number };
  ticker: { y: number; h: number };
  footer: { y: number; h: number };
}

function layoutFor(look: ClipLook): Layout {
  const header = { y: 0, h: look.showHeader ? 112 : 0 };
  const footer = { y: SCENE_H - (look.showFooter ? 90 : 24), h: look.showFooter ? 90 : 24 };
  const tickerH = look.showTicker ? 210 : 0;
  const ticker = { y: footer.y - tickerH, h: tickerH };
  const fxH = look.showFxPanel ? 96 : 0;
  const fx = { y: ticker.y - fxH, h: fxH };
  const lanesTop = header.y + header.h + (look.showHeader ? 8 : 40);
  return { header, lanes: { y: lanesTop, h: fx.y - lanesTop - 16, gap: 22 }, fx, ticker, footer };
}

// ── Meters ───────────────────────────────────────────────────────────────

function meterStep(scene: RoutineScene, t: number): { slot: { post: number; low: number; mid: number; high: number }[]; pulse: number } {
  const m = scene.meters;
  const n = scene.routine.slots.length;
  if (!scene.meterState) {
    scene.meterState = { t: -1, slot: scene.routine.slots.map(() => ({ post: 0, low: 0, mid: 0, high: 0 })), pulse: 0 };
  }
  const st = scene.meterState;
  if (!m) return st;
  const k = Math.max(0, Math.min(m.steps - 1, Math.floor((t - (scene.metersStartSec ?? scene.range.startSec)) / m.stepSec)));
  const dt = st.t < 0 || t < st.t ? 1 / 30 : t - st.t;
  st.t = t;
  let pulse = 0;
  for (let i = 0; i < n; i++) {
    const src = m.slot[i];
    const s = st.slot[i];
    if (!src) continue;
    s.post = stepMeter(s.post, meterLevel(src.post[k]), dt);
    s.low = stepMeter(s.low, meterLevel(src.low[k]), dt, 0.16);
    s.mid = stepMeter(s.mid, meterLevel(src.mid[k]), dt, 0.16);
    s.high = stepMeter(s.high, meterLevel(src.high[k]), dt, 0.16);
    pulse = Math.max(pulse, meterLevel(src.post[k]));
  }
  st.pulse = stepMeter(st.pulse, pulse, dt, 0.12);
  return st;
}

// ── Header ───────────────────────────────────────────────────────────────

/** Bar/beat position for the header and pulses: the dominant slot's
 * hypermeter (hot cue 4 anchored) when known, else the Routine clock. */
export function headerPositionAt(scene: RoutineScene, t: number): { beatInBar: number; phase: number; barInPhrase: number; phrase: number; slot: number } | null {
  const m = scene.metric;
  const dom = m ? m.dominantAt(t) : -1;
  const p = m && dom >= 0 ? m.positionAt(dom, t) : null;
  if (p) return { beatInBar: p.beatInBar, phase: p.phase, barInPhrase: p.barInPhrase, phrase: p.phrase, slot: dom };
  const beat = beatOf(scene.routine, t);
  if (beat < 0) return null;
  const bar = Math.floor(beat / 4);
  return { beatInBar: ((Math.floor(beat) % 4) + 4) % 4, phase: beat - Math.floor(beat), barInPhrase: ((bar % 16) + 16) % 16, phrase: Math.floor(bar / 16), slot: -1 };
}

/** HUD pulse 0..~1.6: the dominant track's beat envelope scaled by bass
 * and energy, boosted for the 16 bars after a drop. */
function hudPulseAt(scene: RoutineScene, t: number, bass: number, energy: number, look: ClipLook): number {
  if (look.hudSource === 'off' || look.hudAmount <= 0) return 0;
  const pos = headerPositionAt(scene, t);
  const env = pos ? Math.pow(1 - pos.phase, 3) * (pos.beatInBar === 0 ? 1 : 0.6) : 0;
  const barSec = scene.routine.secPerBeat * 4;
  let drop = 0;
  for (const e of scene.metric?.events ?? []) {
    if (!e.drop || e.t > t) continue;
    const age = t - e.t;
    if (age < barSec * 16) drop = Math.max(drop, 1 - age / (barSec * 16));
  }
  const base = look.hudSource === 'beat' ? env
    : look.hudSource === 'energy' ? energy * energy
    : look.hudSource === 'bass' ? bass * bass * (0.5 + 0.5 * env)
    : env * (0.25 + 0.5 * bass + 0.25 * energy);
  return base * look.hudAmount * (1 + look.dropBoost * drop);
}

/** Headerless HUD: `DROP IN n` floats over the deck stack only when a
 * drop is near, pulsing with the beat. */
function drawFloatingCountdown(ctx: CanvasRenderingContext2D, scene: RoutineScene, t: number, look: ClipLook, hud: number): void {
  const barSec = scene.routine.secPerBeat * 4;
  const next = scene.metric?.events.find((e) => e.drop && e.t > t - barSec && e.t - t < barSec * 8) ?? null;
  if (!next) return;
  const dt = next.t - t;
  const label = dt > 0 ? `DROP IN ${Math.ceil(dt / barSec)}` : 'DROP';
  const a = dt > 0 ? 0.85 : Math.max(0, 1 + dt / barSec);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.font = font(Math.round(34 * (1 + 0.12 * hud)), true);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  glowText(ctx, label, SCENE_W / 2, 64, DANGER, (14 + 30 * hud) * look.glow, dt > 0 ? DANGER : '#ffffff');
  ctx.restore();
}

function drawHeader(
  ctx: CanvasRenderingContext2D, scene: RoutineScene, t: number, L: Layout, look: ClipLook, hud: number
): void {
  const x0 = 44;
  const y = L.header.y;
  const accent = look.accent;
  const pulse = hud;
  ctx.textBaseline = 'middle';
  const pos = headerPositionAt(scene, t);
  const { routine } = scene;
  const rowY = y + 52;
  ctx.font = font(Math.round(26 * (1 + 0.08 * pulse)), true);
  // Right readout: drop countdown when one is near, else bar-of-phrase.
  const barSec = routine.secPerBeat * 4;
  const nextDrop = scene.metric?.events.find((e) => e.drop && e.t > t - barSec && e.t - t < barSec * 8) ?? null;
  ctx.textAlign = 'right';
  if (look.phraseCountdown && nextDrop) {
    const dt = nextDrop.t - t;
    const label = dt > 0 ? `DROP IN ${Math.ceil(dt / barSec)}` : 'DROP';
    const hot = dt <= 0 || (pos?.phase ?? 1) < 0.5;
    glowText(ctx, label, SCENE_W - x0, rowY, DANGER, (hot ? 22 : 10) * look.glow * (1 + pulse), hot ? '#ffffff' : DANGER);
  }
  ctx.textAlign = 'left';
  if (pos) glowText(ctx, `BAR ${pos.barInPhrase + 1}/16 · P${pos.phrase + 1}`, x0, rowY, accent, 10 * look.glow * (1 + pulse), TEXT);
  // Beat pips: the lit pip is the dominant track's real beat-in-bar.
  const pipX = SCENE_W / 2 - 3 * 28;
  for (let i = 0; i < 4; i++) {
    const lit = !!pos && i === pos.beatInBar;
    const k = lit ? Math.pow(1 - (pos?.phase ?? 0), 2) : 0;
    const r = lit ? 7 + 4 * k + 9 * pulse : 6 + 1.5 * pulse;
    ctx.save();
    ctx.shadowColor = accent;
    ctx.shadowBlur = lit ? 10 + 36 * Math.max(pulse, k * 0.5) * look.glow : 0;
    ctx.beginPath();
    ctx.arc(pipX + i * 56, rowY, r, 0, Math.PI * 2);
    ctx.fillStyle = lit ? (i === 0 ? '#ffffff' : accent) : 'rgba(255,255,255,0.22)';
    ctx.fill();
    ctx.restore();
  }
  // Phrase bar: 16 segments, passed bars lit, the current one bright.
  if (pos) {
    const pw = 360;
    const px = SCENE_W / 2 - pw / 2;
    const seg = pw / 16;
    for (let i = 0; i < 16; i++) {
      const cur = i === pos.barInPhrase;
      const passed = i < pos.barInPhrase;
      ctx.save();
      if (cur || passed) { ctx.shadowColor = accent; ctx.shadowBlur = (cur ? 12 : 6) * look.glow * (1 + 1.5 * pulse); }
      ctx.fillStyle = cur ? accent : passed ? rgba(accent, 0.4 + 0.35 * pulse) : i % 4 === 0 ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.1)';
      const sh = 6 + 6 * pulse * (cur ? 1 : 0.5);
      ctx.fillRect(px + i * seg + 1, rowY + 34 - sh / 2, seg - 2, sh);
      ctx.restore();
    }
  }
  // Master meter
  if (scene.masterLevel) {
    const lv = scene.masterLevel(t);
    const mw = SCENE_W - x0 * 2;
    const my = y + L.header.h - 14;
    for (const [i, v] of [lv.left, lv.right].entries()) {
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(x0, my + i * 5, mw, 3);
      const k = Math.max(0, Math.min(1, v));
      const grad = ctx.createLinearGradient(x0, 0, x0 + mw, 0);
      grad.addColorStop(0, accent);
      grad.addColorStop(0.8, accent);
      grad.addColorStop(0.92, WARNING);
      grad.addColorStop(1, DANGER);
      ctx.save();
      ctx.shadowColor = accent;
      ctx.shadowBlur = 8 * look.glow * (1 + 2 * pulse);
      ctx.fillStyle = grad;
      ctx.fillRect(x0, my + i * 5, mw * k, 3);
      ctx.restore();
    }
  }
}

// ── Deck lanes ───────────────────────────────────────────────────────────

interface LaneFrame {
  deck: RoutineDeck;
  slot: PlannedRoutineSlot | null;
  slotIndex: number;
  track: SceneTrack | null;
  state: 'pending' | 'live' | 'done' | 'empty';
  trackTime: number;
  playing: boolean;
  lanes: ReturnType<typeof slotLanesAt> | null;
}

function laneFrameAt(scene: RoutineScene, deck: RoutineDeck, t: number): LaneFrame {
  const { routine } = scene;
  const slot = slotOccupyingDeckAt(routine, deck, t);
  if (!slot) return { deck, slot: null, slotIndex: -1, track: null, state: 'empty', trackTime: 0, playing: false, lanes: null };
  const track = scene.tracks.get(slot.trackId) ?? null;
  const s = routineSlotStateAt(routine, slot, t);
  const beat = beatOf(routine, t);
  const state: LaneFrame['state'] = t < slot.entryMixSec - 1e-3
    ? 'pending'
    : t >= slot.releaseMixSec && !s.playing ? 'done' : 'live';
  return {
    deck, slot, slotIndex: routine.slots.indexOf(slot), track, state,
    trackTime: s.trackTime, playing: s.playing, lanes: slotLanesAt(slot, beat),
  };
}


// ── Waveform palettes ────────────────────────────────────────────────────

function hexRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
const mixRgb = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

const FIXED_PALETTES: Record<Exclude<WavePalette, 'style' | 'deck'>, [RGB, RGB, RGB]> = {
  neon: [[1, 0, 0.6], [0, 1, 1], [1, 1, 0.15]],
  fire: [[1, 0.08, 0], [1, 0.5, 0], [1, 0.95, 0.35]],
  ice: [[0.1, 0.25, 1], [0, 0.85, 1], [0.85, 1, 1]],
  mono: [[0.5, 0.5, 0.56], [0.78, 0.78, 0.84], [1, 1, 1]],
};

/** Group colors for a deck's waveform under the look's palette; null =
 * the user's waveform style colors. 'deck' tints the three groups from
 * the Deck color (deep → identity → white-hot) so decks read apart. */
export function paletteColors(palette: WavePalette, deck: RoutineDeck): [RGB, RGB, RGB] | null {
  if (palette === 'style') return null;
  if (palette === 'deck') {
    const c = hexRgb(DECK_COLORS[deck]);
    return [mixRgb(c, [0, 0, 0], 0.4), c, mixRgb(c, [1, 1, 1], 0.4)];
  }
  return FIXED_PALETTES[palette];
}

// ── Strip history (left of the playhead = what was heard) ───────────────

const HISTORY_STEP = 1 / 30;

function stripValuesOf(scene: RoutineScene, l: NonNullable<LaneFrame['lanes']>): StripValues {
  const m = modulationOf(scene, l);
  return { gain: m.scale, low: m.eq[0], mid: m.eq[1], high: m.eq[2], fader: l.fader };
}

/** The slot's strip history advanced to mix second `t` — the in-app deck
 * strip idiom (performance/stripHistory): behind the playhead each column
 * shows the strip as it was when that audio played; ahead, the current
 * controls. Sequential frames step forward; a seek replays from the
 * slot's occupancy (deterministic for any frame order). */
function slotHistoryAt(scene: RoutineScene, slotIndex: number, t: number): StripHistory {
  const { routine } = scene;
  const slot = routine.slots[slotIndex];
  if (!scene.stripState) scene.stripState = new Map();
  let st = scene.stripState.get(slotIndex);
  if (!st || t < st.t || t - st.t > 2) {
    // Replay from the slot's occupancy, never before the mix (session-span
    // slots can be occupied from −∞).
    const from = Math.max(slot.occupyFromMixSec, routine.mixStartSec - 1, t - 600);
    st = { history: createStripHistory(), t: from - HISTORY_STEP };
    scene.stripState.set(slotIndex, st);
  }
  for (let u = st.t + HISTORY_STEP; u <= t; u += HISTORY_STEP) {
    const s = routineSlotStateAt(routine, slot, u);
    st.history.record(s.trackTime, s.playing, stripValuesOf(scene, slotLanesAt(slot, beatOf(routine, u))));
    st.t = u;
  }
  return st.history;
}

/** Wave height at full fader + neutral trim: below the rail, so a fader
 * pull visibly shrinks the wave instead of hiding inside clipped peaks. */
const NOMINAL_WAVE_SCALE = 0.72;
const MIN_WAVE_SCALE = 0.04;
function modulationOf(scene: RoutineScene, l: NonNullable<LaneFrame['lanes']>): ColumnModulation {
  const sweep = filterGroupGains(scene.filterSettings, l.filter);
  // Height follows the fader POSITION (what the eye expects from a fader
  // move) × the real trim gain, not the fader's audio taper.
  const trim = trimToGain(l.trim) / trimToGain(0.5);
  const fader = Math.max(0, Math.min(1, l.fader));
  return {
    eq: [
      eqValueToGain(l.eq.low) * sweep[0],
      eqValueToGain(l.eq.mid) * sweep[1],
      eqValueToGain(l.eq.high) * sweep[2],
    ],
    scale: Math.max(MIN_WAVE_SCALE, Math.min(1.4, NOMINAL_WAVE_SCALE * fader * trim)),
  };
}

function drawKnob(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number,
  label: string, value: number, color: string, mode: 'bipolar' | 'filter', level: number, glow: number, pulse = 0
): void {
  r *= 1 + 0.1 * pulse;
  glow *= 1 + 1.6 * pulse;
  level = Math.min(1, level + 0.35 * pulse);
  const a0 = Math.PI * 0.75;
  const a1 = Math.PI * 2.25;
  const top = Math.PI * 1.5;
  // Track
  ctx.lineCap = 'round';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.arc(cx, cy, r, a0, a1);
  ctx.stroke();
  // Value arc. EQ fills up from the minimum (full to the top at neutral,
  // empty when killed; a boost past neutral glows hotter). The sweep
  // filter stays bipolar from the top (LPF left, HPF right).
  const v = mode === 'filter' ? Math.max(-1, Math.min(1, value)) : (Math.max(0, Math.min(1, value)) - 0.5) * 2;
  const ang = top + v * (Math.PI * 0.75);
  const arcColor = mode === 'filter' ? (v < 0 ? FILTER_LPF_COLOR : color) : color;
  const boost = mode === 'bipolar' ? Math.max(0, v) : 0;
  ctx.save();
  ctx.shadowColor = arcColor;
  ctx.shadowBlur = (14 + 30 * boost) * glow;
  ctx.strokeStyle = arcColor;
  ctx.lineWidth = 6 + 3 * boost;
  ctx.beginPath();
  if (mode === 'bipolar') {
    if (ang > a0 + 1e-3) ctx.arc(cx, cy, r, a0, ang);
  } else if (v >= 0) ctx.arc(cx, cy, r, top, ang);
  else ctx.arc(cx, cy, r, ang, top);
  ctx.stroke();
  if (boost > 0) {
    // The boost segment burns brighter.
    ctx.strokeStyle = `rgba(255,255,255,${0.35 + 0.5 * boost})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, r, top, ang);
    ctx.stroke();
  }
  ctx.restore();
  // Inner disc lit by the band's live level
  ctx.save();
  ctx.shadowColor = arcColor;
  ctx.shadowBlur = 24 * level * glow;
  ctx.fillStyle = rgba(arcColor, 0.12 + 0.75 * level);
  ctx.beginPath();
  ctx.arc(cx, cy, r - 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // Indicator
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(ang) * (r - 24), cy + Math.sin(ang) * (r - 24));
  ctx.lineTo(cx + Math.cos(ang) * (r - 8), cy + Math.sin(ang) * (r - 8));
  ctx.stroke();
  // Label
  ctx.font = font(18, true);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText(label, cx, cy + r + 18);
  ctx.textAlign = 'left';
}

/** Paint a lane's styled waveform window (columns on a fixed track-time
 * grid so scrolling is a pure translation) into the current transform at
 * (0,0,w,h). History-aware modulation: columns behind the playhead carry
 * the strip as heard, ahead the current controls. */
function drawLaneWave(
  ctx: CanvasRenderingContext2D, scene: RoutineScene, lf: LaneFrame, t: number,
  w: number, h: number, look: ClipLook, opts: {
    brightness: number; composite: ClipLook['composite']; bg: HTMLCanvasElement | null; bgRect: { x: number; y: number };
    fx?: LaneFx | null;
    /** 0..~2 — this frame's wave pulse (swell + glow). */
    pulse?: number;
  }
): { t0: number; xOf: (sec: number) => number } {
  const wp = opts.pulse ?? 0;
  const fill = Math.min(1, WAVE_FILL * (1 + 0.14 * wp));
  const visible = look.waveZoomSec;
  const pxPerSec = w / visible;
  const colDt = WAVE_COLUMN_PX / pxPerSec;
  const t0 = lf.trackTime - visible / 2;
  const xOf = (trackSec: number): number => ((trackSec - t0) / visible) * w;
  if (!lf.track?.wave || !lf.slot) return { t0, xOf };
  const k0 = Math.floor(t0 / colDt);
  const offset = (t0 / colDt - k0) * WAVE_COLUMN_PX;
  const cols = Math.ceil(w / WAVE_COLUMN_PX) + 2;
  const gridT0 = k0 * colDt;
  const gridT1 = gridT0 + cols * colDt;
  const H = Math.max(1, Math.ceil(h));
  const live = lf.lanes ? stripValuesOf(scene, lf.lanes) : null;
  const history = lf.slotIndex >= 0 ? slotHistoryAt(scene, lf.slotIndex, t) : null;
  const colors = paletteColors(look.wavePalette, lf.deck);
  const params = colors ? { ...scene.style.params, colors } : scene.style.params;
  const sc = scratch(`wave-${lf.deck}`, cols, H);
  drawStyledWave(sc.ctx, lf.track.wave, scene.style.styleId, params, {
    width: cols, height: H, dir: 'bipolar', range: [gridT0, gridT1],
    brightness: opts.brightness, transparent: true,
    modulate: live ? (x) => {
      const v = history ? history.at(gridT0 + (x + 0.5) * colDt, live) : live;
      return { eq: [v.low, v.mid, v.high], scale: v.gain };
    } : undefined,
  });
  let src: HTMLCanvasElement = sc.canvas;
  const comp = opts.composite;
  if (comp === 'negative' || comp === 'cutout') {
    // Silhouette: white (negative: the wave inverts the visualizer under
    // it) or black (cutout: the wave punches a hole, rimmed in its colors).
    const sil = scratch(`sil-${lf.deck}`, cols, H);
    sil.ctx.globalCompositeOperation = 'copy';
    sil.ctx.drawImage(sc.canvas, 0, 0);
    sil.ctx.globalCompositeOperation = 'source-in';
    sil.ctx.fillStyle = comp === 'negative' ? '#ffffff' : '#000000';
    sil.ctx.fillRect(0, 0, cols, H);
    sil.ctx.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.translate(0, h * (1 - fill) / 2);
    ctx.scale(1, fill);
    const dw0 = cols * WAVE_COLUMN_PX;
    if (comp === 'cutout') {
      ctx.save();
      ctx.filter = 'blur(6px)';
      ctx.globalAlpha *= 0.9;
      ctx.drawImage(sc.canvas, 0, 0, cols, H, -offset, 0, dw0, h);
      ctx.restore();
    } else {
      ctx.globalCompositeOperation = 'difference';
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sil.canvas, 0, 0, cols, H, -offset, 0, dw0, h);
    if (opts.fx) {
      ctx.globalCompositeOperation = 'source-over';
      drawWaveFx(ctx, sc.canvas, cols, H, -offset, dw0, w, h, pxPerSec, opts.fx, look.glow);
    }
    ctx.restore();
    return { t0, xOf };
  }
  if (opts.composite === 'mask' && opts.bg) {
    // The wave as a window onto the visualizer: wave alpha × background.
    const mk = scratch(`mask-${lf.deck}`, cols, H);
    mk.ctx.globalCompositeOperation = 'copy';
    mk.ctx.drawImage(sc.canvas, 0, 0);
    mk.ctx.globalCompositeOperation = 'source-in';
    const sx = (opts.bgRect.x - offset) / SCENE_W * opts.bg.width;
    const sy = opts.bgRect.y / SCENE_H * opts.bg.height;
    mk.ctx.drawImage(opts.bg, sx, sy, (cols * WAVE_COLUMN_PX) / SCENE_W * opts.bg.width, h / SCENE_H * opts.bg.height, 0, 0, cols, H);
    mk.ctx.globalCompositeOperation = 'source-over';
    // Faint palette underlay so a dark preset never blanks the wave.
    ctx.save();
    ctx.globalAlpha *= 0.3;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sc.canvas, 0, 0, cols, H, -offset, 0, cols * WAVE_COLUMN_PX, h);
    ctx.restore();
    src = mk.canvas;
  }
  ctx.save();
  if (opts.composite === 'screen' || opts.composite === 'stage') {
    // Additive light saturates fast: overlapping decks stay readable.
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha *= opts.composite === 'stage' ? 0.5 : 0.7;
  } else if (opts.composite === 'tint') {
    // The wave recolors the visualizer: its hue, the preset's light.
    ctx.globalCompositeOperation = 'color';
  }
  const dw = cols * WAVE_COLUMN_PX;
  // Headroom: the wave breathes inside its window (and swells on the pulse).
  ctx.translate(0, h * (1 - fill) / 2);
  ctx.scale(1, fill);
  if (look.glow > 0 && opts.brightness > 0.5 && opts.composite !== 'stage' && opts.composite !== 'tint') {
    ctx.save();
    ctx.globalAlpha *= Math.min(1, 0.55 * look.glow * (1 + 1.2 * wp));
    ctx.filter = `blur(${Math.round(9 + 10 * wp)}px)`;
    ctx.drawImage(src, 0, 0, cols, H, -offset, 0, dw, h);
    ctx.restore();
  }
  ctx.imageSmoothingEnabled = false;
  if (opts.composite === 'mask') {
    // Brighten the window: the preset seen through the wave pops.
    ctx.drawImage(src, 0, 0, cols, H, -offset, 0, dw, h);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha *= 0.5;
  }
  ctx.drawImage(src, 0, 0, cols, H, -offset, 0, dw, h);
  if (opts.fx) drawWaveFx(ctx, src, cols, H, -offset, dw, w, h, pxPerSec, opts.fx, look.glow);
  ctx.restore();
  return { t0, xOf };
}

/** An active Beat FX on this lane: effect, beat length (in track seconds
 * via the Routine tempo), wet amount and the FX-length phase. */
interface LaneFx {
  selected: string;
  beats: number;
  periodSec: number;
  wet: number;
  /** 0..1 phase within one FX period. */
  phase: number;
  color: string;
}

/** Beat FX as what it does to the sound, drawn on the wave itself:
 * echo = the past repeating at the playhead (decaying ghost copies one
 * period apart; low-cut echo = the ghosts lose their body), reverb = a
 * smeared halo, flanger = a swept comb (a tinted copy sliding a few px),
 * trans = a rhythmic gate, roll = the last period stuttering forward. */
function drawWaveFx(
  ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, cols: number, H: number,
  dx: number, dw: number, w: number, h: number, pxPerSec: number, fx: LaneFx, glow: number
): void {
  const periodPx = fx.periodSec * pxPerSec;
  const wet = Math.max(0.3, fx.wet);
  // The wave silhouette in the effect's color (echo/flanger copies read
  // as the effect, not as more wave).
  const tint = scratch('fx-tint', cols, H);
  tint.ctx.globalCompositeOperation = 'copy';
  tint.ctx.drawImage(src, 0, 0);
  tint.ctx.globalCompositeOperation = 'source-in';
  tint.ctx.fillStyle = fx.color;
  tint.ctx.fillRect(0, 0, cols, H);
  tint.ctx.globalCompositeOperation = 'source-over';
  const ghost = tint.canvas;
  ctx.save();
  if (fx.selected === 'echo' || fx.selected === 'lowCutEcho') {
    ctx.globalCompositeOperation = 'lighter';
    for (let n = 1; n <= 4; n++) {
      const a = wet * 0.6 * Math.pow(0.55, n - 1);
      ctx.save();
      ctx.globalAlpha = a;
      if (fx.selected === 'lowCutEcho') {
        // Body cut: thin ghosts (vertically squashed toward the centre).
        ctx.translate(0, h / 2);
        ctx.scale(1, 0.45);
        ctx.translate(0, -h / 2);
      }
      ctx.drawImage(ghost, 0, 0, cols, H, dx + n * periodPx, 0, dw, h);
      ctx.restore();
    }
  } else if (fx.selected === 'reverb') {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = wet * 0.7;
    ctx.filter = `blur(${Math.round(10 + 16 * wet)}px)`;
    ctx.drawImage(src, 0, 0, cols, H, dx, -h * 0.15, dw * 1.04, h * 1.3);
    ctx.filter = 'none';
    const g = ctx.createLinearGradient(w / 2, 0, w, 0);
    g.addColorStop(0, rgba(fx.color, 0.35 * wet));
    g.addColorStop(1, rgba(fx.color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(w / 2, 0, w / 2, h);
  } else if (fx.selected === 'flanger') {
    const sweep = Math.sin(fx.phase * Math.PI * 2);
    ctx.globalCompositeOperation = 'lighter';
    for (const k of [1, -1]) {
      ctx.globalAlpha = wet * 0.55;
      ctx.drawImage(ghost, 0, 0, cols, H, dx + k * (6 + 18 * sweep), 0, dw, h);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.18 * wet * (0.5 + 0.5 * sweep);
    ctx.fillStyle = fx.color;
    ctx.fillRect(0, 0, w, h);
  } else if (fx.selected === 'trans') {
    // Gate: closed on the second half of each period.
    if (fx.phase >= 0.5) {
      ctx.globalAlpha = 0.75 * wet;
      ctx.fillStyle = 'rgba(0,0,0,1)';
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 0.5 * wet;
      ctx.fillStyle = fx.color;
      ctx.fillRect(0, h / 2 - 2, w, 4);
    }
  } else if (fx.selected === 'roll') {
    // The last period, repeated forward from the playhead.
    const seg = Math.max(8, periodPx);
    const sx0 = (w / 2 - seg - dx) / dw * cols;
    const sw = seg / dw * cols;
    ctx.globalAlpha = 0.85 * wet;
    for (let x = w / 2; x < w; x += seg) {
      ctx.drawImage(src, sx0, 0, sw, H, x, 0, seg, h);
      ctx.fillStyle = rgba(fx.color, 0.8);
      ctx.fillRect(x - 1, 0, 2, h);
    }
  }
  ctx.restore();
  // Period pulse along the wave edge + label.
  const k = Math.pow(1 - fx.phase, 3);
  ctx.save();
  ctx.shadowColor = fx.color;
  ctx.shadowBlur = 24 * glow * (0.4 + k);
  ctx.fillStyle = rgba(fx.color, 0.35 + 0.6 * k);
  ctx.fillRect(0, 0, w, 3);
  ctx.fillRect(0, h - 3, w, 3);
  ctx.restore();
}

function drawGridAndCues(
  ctx: CanvasRenderingContext2D, scene: RoutineScene, lf: LaneFrame, t0: number, xOf: (s: number) => number,
  w: number, h: number, look: ClipLook
): void {
  if (!lf.track) return;
  const visible = look.waveZoomSec;
  const t1 = t0 + visible;
  const beats = lf.track.beatTimes;
  // Downbeats from the hypermeter (hot cue 4 anchored) when known, else the stored grid.
  const tm = scene.metric?.tracks.get(lf.track.trackId);
  const isDown = (i: number): boolean => (tm ? ((i - tm.anchorBeat) % 4 + 4) % 4 === 0 : false);
  const isPhrase = (i: number): boolean => (tm ? ((i - tm.anchorBeat) % 64 + 64) % 64 === 0 : false);
  const di = new Set<number>();
  if (!tm) {
    const downs = lf.track.downbeatTimes;
    for (let i = lowerBound(downs, t0); i < downs.length && downs[i] <= t1; i++) di.add(Math.round(downs[i] * 1000));
  }
  for (let i = look.showGrid ? lowerBound(beats, t0) : beats.length; i < beats.length && beats[i] <= t1; i++) {
    const bt = beats[i];
    const down = tm ? isDown(i) : di.has(Math.round(bt * 1000));
    const phrase = isPhrase(i);
    ctx.fillStyle = phrase ? rgba(look.accent, 0.6) : `rgba(255,255,255,${down ? 0.32 : 0.09})`;
    const bx = Math.round(xOf(bt));
    ctx.fillRect(bx - (down || phrase ? 1 : 0), 0, phrase ? 4 : down ? 3 : 1, h);
  }
  for (const cue of look.showCues ? lf.track.hotCues : []) {
    if (cue.time_seconds < t0 - 1 || cue.time_seconds > t1 + 1) continue;
    const cx = xOf(cue.time_seconds);
    const color = cueCssColor(cue.slot_number, cue.color);
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 14 * look.glow;
    ctx.fillStyle = color;
    ctx.fillRect(cx - 2, 0, 4, h);
    roundRect(ctx, cx - 18, 6, 36, 36, 8);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#0b0b0f';
    ctx.font = font(24, true);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(cue.slot_number), cx, 25);
    ctx.textAlign = 'left';
  }
  void w;
}

function drawPlayhead(ctx: CanvasRenderingContext2D, x: number, h: number, glow: number, dim: boolean): void {
  ctx.save();
  ctx.shadowColor = PLAYHEAD;
  ctx.shadowBlur = 18 * glow;
  ctx.fillStyle = dim ? rgba(PLAYHEAD, 0.4) : PLAYHEAD;
  ctx.fillRect(x - 2, 0, 4, h);
  ctx.restore();
}

const BEAT_FX_LABELS_FULL: Record<string, string> = BEAT_FX_LABELS;

/** The Beat FX acting on this lane's occupant now (its own target, or the
 * master bus), null when off. */
function laneFxAt(scene: RoutineScene, lf: LaneFrame, t: number): LaneFx | null {
  const { routine } = scene;
  if (!routine.beatFx || !lf.slot) return null;
  const beat = beatOf(routine, t);
  const v = routineFxAt(routine.beatFx, beat);
  if (!v.on || !(v.target === lf.slot.slotId || v.target === 'master')) return null;
  const period = Math.max(1 / 16, v.beats);
  return {
    selected: v.selected,
    beats: v.beats,
    periodSec: period * routine.secPerBeat,
    wet: beatFxMixGains(v.depth).wet,
    phase: (((beat / period) % 1) + 1) % 1,
    color: BEAT_FX_COLORS[v.selected],
  };
}

function laneStatusText(routine: PlannedRoutine, lf: LaneFrame, t: number): string {
  if (lf.slot && lf.state === 'pending') {
    const n = Math.max(1, Math.ceil((lf.slot.entryMixSec - t) / routine.secPerBeat / 4));
    return `IN ${n} BAR${n === 1 ? '' : 'S'}`;
  }
  return lf.state === 'done' ? 'OUT' : lf.playing ? '' : 'CUED';
}

export const LANE_INFO_H = 124;

/** One deck card at its natural height `h` (the caller squashes it in/out
 * with a vertical scale). The wave fills the top; the info row below is
 * split at the shared playhead: track name, artist, fader and level to the
 * left, the EQ/filter knobs to the right. No playhead of its own — the
 * frame draws one line through every card. */
function drawLane(
  ctx: CanvasRenderingContext2D, scene: RoutineScene, lf: LaneFrame, t: number,
  x: number, y: number, w: number, h: number, look: ClipLook,
  meter: { post: number; low: number; mid: number; high: number } | null,
  presence: number, bg: { canvas: HTMLCanvasElement; rect: (ly: number) => { x: number; y: number } } | null
): void {
  const { routine } = scene;
  const deckColor = DECK_COLORS[lf.deck];
  const dim = lf.state !== 'live';
  const infoH = look.showKnobs ? LANE_INFO_H : 64;
  const waveH = Math.max(0, h - infoH);
  const glow = look.glow;
  const level = meter?.post ?? 0;
  const edge = dim ? 0.25 : 0.5 + 0.5 * level;
  const composite = look.composite;
  const cx = x + w / 2;
  const fx = laneFxAt(scene, lf, t);
  // The beat breathes through this deck's controls, as loud as the deck is.
  const pulse = (scene.hud ?? 0) * (dim ? 0 : 0.3 + 0.7 * level);

  const bare = look.laneFrame === 'bare';
  const inset = bare ? 44 : 22;
  if (!bare) {
    // Card: dark glass with a deck-colored neon edge.
    ctx.save();
    ctx.shadowColor = deckColor;
    ctx.shadowBlur = (dim ? 6 : 16 + 26 * level) * glow;
    ctx.fillStyle = composite === 'screen' ? 'rgba(8, 8, 12, 0.28)' : composite === 'mask' ? 'rgba(4, 4, 8, 0.86)' : 'rgba(8, 8, 12, 0.72)';
    roundRect(ctx, x, y, w, h, 18);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = rgba(deckColor, edge);
    ctx.lineWidth = 2;
    roundRect(ctx, x + 1, y + 1, w - 2, h - 2, 17);
    ctx.stroke();
  } else if (composite === 'mask') {
    // The window composite needs a dark field to read against.
    ctx.fillStyle = 'rgba(4, 4, 8, 0.7)';
    ctx.fillRect(x, y, w, h - infoH);
  }
  if (bare && waveH > 8 && look.infoShade > 0) {
    // No box: a soft shade under the info row keeps the text legible (look.infoShade).
    const g = ctx.createLinearGradient(0, y + waveH - 10, 0, y + h);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.35, `rgba(0,0,0,${look.infoShade})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y + waveH - 10, w, infoH + 10);
  }

  // Waveform window
  const waveX = bare ? x : x + 2;
  const innerW = bare ? w : w - 4;
  if (waveH > 8) {
    ctx.save();
    if (bare) {
      ctx.beginPath();
      ctx.rect(waveX, y + 2, innerW, waveH);
    } else {
      roundRect(ctx, waveX, y + 2, innerW, waveH, 16);
    }
    ctx.clip();
    ctx.translate(waveX, y + 2);
    // Saturation ramp: a quiet deck's wave dims with its level.
    const bright = dim ? 0.4 : 0.5 + 0.5 * Math.min(1, presence * (0.35 + level));
    const { t0, xOf } = drawLaneWave(ctx, scene, lf, t, innerW, waveH, look, {
      brightness: bright, composite, bg: bg?.canvas ?? null, bgRect: bg ? bg.rect(y + 2) : { x: waveX, y: y + 2 }, fx,
      pulse: pulse * look.wavePulse,
    });
    drawGridAndCues(ctx, scene, lf, t0, xOf, innerW, waveH, look);
    ctx.restore();
    if (lf.slot) drawLaneBursts(ctx, scene, lf, t, waveX, y + 2, innerW, waveH, deckColor, glow);
    // Status chip (cue / incoming / out) in the wave's corner.
    const statusText = laneStatusText(routine, lf, t);
    if (statusText) {
      ctx.font = font(22, true);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      glowText(ctx, statusText, x + w - inset, y + 28, look.accent, 10 * glow, lf.state === 'pending' ? look.accent : 'rgba(255,255,255,0.55)');
      ctx.textAlign = 'left';
    }
  }

  // Beat FX label on the wave (the effect itself is drawn into the wave).
  if (fx) {
    ctx.save();
    const kk = Math.pow(1 - fx.phase, 3);
    ctx.font = font(Math.round(30 + 6 * kk), true);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const label = `${BEAT_FX_LABELS_FULL[fx.selected] ?? fx.selected} ${formatBeatFxLength(fx.beats)}`;
    const lw = ctx.measureText(label).width + 36;
    ctx.shadowColor = fx.color;
    ctx.shadowBlur = 26 * glow;
    ctx.fillStyle = rgba(fx.color, 0.85);
    roundRect(ctx, x + inset - 4, y + 14, lw, 46, 12);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#0b0b0f';
    ctx.fillText(label, x + inset + 14, y + 38);
    ctx.restore();
  }

  // Info row, split at the shared playhead.
  const iy = y + waveH;
  if (!bare) {
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(x + 14, iy, w - 28, 1);
  }
  const leftX = x + inset;
  const leftW = cx - 22 - leftX;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = font(Math.round(26 * (1 + 0.05 * pulse)), true);
  if (look.showTitles) {
    const revealed = titleRevealed(scene, lf.slotIndex, t);
    const title = lf.track ? (revealed ? lf.track.title : ID_LABEL) : '—';
    glowText(ctx, ellipsize(ctx, title, leftW), leftX, iy + 24, deckColor, dim ? 0 : 10 * glow * (1 + 2 * pulse), dim ? 'rgba(255,255,255,0.5)' : '#ffffff');
    ctx.font = font(20);
    ctx.fillStyle = dim ? 'rgba(255,255,255,0.3)' : rgba(deckColor, 0.85);
    ctx.fillText(ellipsize(ctx, `${lf.deck} · ${revealed ? lf.track?.artist ?? '' : ID_LABEL}`, leftW), leftX, iy + 50);
  }
  if (look.showKnobs) {
    const l = lf.lanes ?? { fader: 0, trim: 0.5, eq: { low: 0.5, mid: 0.5, high: 0.5 }, filter: 0 };
    ctx.save();
    if (dim) ctx.globalAlpha *= 0.5;
    const barW = leftW;
    const bar = (by: number, label: string, frac: number, fill: string | CanvasGradient, blur: number) => {
      ctx.font = font(15, true);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillText(label, leftX, by + 4);
      const bx = leftX + 62;
      const bw = barW - 62;
      const bh = 9 + 5 * pulse;
      const byy = by + 4.5 - bh / 2;
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      roundRect(ctx, bx, byy, bw, bh, bh / 2);
      ctx.fill();
      ctx.save();
      ctx.shadowColor = deckColor;
      ctx.shadowBlur = blur * (1 + 2 * pulse) + 10 * pulse * glow;
      ctx.fillStyle = fill;
      roundRect(ctx, bx, byy, Math.max(bh, bw * Math.max(0, Math.min(1, frac))), bh, bh / 2);
      ctx.fill();
      ctx.restore();
    };
    bar(iy + 76, 'FADER', l.fader, deckColor, 12 * glow);
    const lv = meter?.post ?? 0;
    const grad = ctx.createLinearGradient(leftX + 62, 0, leftX + barW, 0);
    grad.addColorStop(0, deckColor);
    grad.addColorStop(0.78, deckColor);
    grad.addColorStop(0.9, WARNING);
    grad.addColorStop(1, DANGER);
    bar(iy + 100, 'LEVEL', lv, grad, 20 * lv * glow);
    // Knobs right of the playhead
    const kr = 27;
    const rx0 = cx + 22;
    const rw = x + w - inset - rx0;
    const kgap = rw / 4;
    const ky = iy + 50;
    const kx = (i: number) => rx0 + kgap * (i + 0.5);
    drawKnob(ctx, kx(0), ky, kr, 'LOW', l.eq.low, AUTOMATION_COLORS.eqLow, 'bipolar', meter?.low ?? 0, glow, pulse);
    drawKnob(ctx, kx(1), ky, kr, 'MID', l.eq.mid, AUTOMATION_COLORS.eqMid, 'bipolar', meter?.mid ?? 0, glow, pulse);
    drawKnob(ctx, kx(2), ky, kr, 'HI', l.eq.high, AUTOMATION_COLORS.eqHigh, 'bipolar', meter?.high ?? 0, glow, pulse);
    drawKnob(ctx, kx(3), ky, kr, 'FILTER', l.filter, AUTOMATION_COLORS.filter, 'filter', Math.abs(l.filter) * lv, glow, pulse);
    ctx.restore();
  }
}

/** Single-stage composite: every visible deck's wave overlaid as light in
 * one tall stage, deck titles stacked above, a compact strip per deck below. */
function drawStage(
  ctx: CanvasRenderingContext2D, scene: RoutineScene, items: { lf: LaneFrame; vis: number; meter: { post: number; low: number; mid: number; high: number } | null }[],
  t: number, top: number, bottom: number, look: ClipLook, bg: HTMLCanvasElement | null
): void {
  const x = 44;
  const w = SCENE_W - 88;
  const shown = items.filter((i) => i.vis > 0.01);
  const titleRow = 44;
  let y = top;
  ctx.textBaseline = 'middle';
  for (const it of shown) {
    const color = DECK_COLORS[it.lf.deck];
    ctx.save();
    ctx.globalAlpha = it.vis;
    ctx.font = font(26, true);
    glowText(ctx, it.lf.deck, x + 4, y + titleRow / 2, color, 12 * look.glow);
    if (look.showTitles) {
      ctx.font = font(28, true);
      const title = ellipsize(ctx, titleRevealed(scene, it.lf.slotIndex, t) ? it.lf.track?.title ?? '—' : ID_LABEL, w - 260);
      glowText(ctx, title, x + 44, y + titleRow / 2, color, 10 * look.glow, '#ffffff');
    }
    // Level bar on the right
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(x + w - 180, y + titleRow / 2 - 4, 180, 8);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12 * look.glow;
    ctx.fillRect(x + w - 180, y + titleRow / 2 - 4, 180 * (it.meter?.post ?? 0), 8);
    ctx.restore();
    y += titleRow * it.vis;
  }
  const avail = Math.max(100, bottom - (y + 16));
  const stageH = Math.min(avail, 760);
  const stageY = y + 16 + (avail - stageH) / 2;
  ctx.save();
  if (look.laneFrame === 'bare') {
    ctx.beginPath();
    ctx.rect(0, stageY, SCENE_W, stageH);
    ctx.clip();
    ctx.translate(0, stageY);
  } else {
    ctx.fillStyle = 'rgba(4,4,8,0.35)';
    roundRect(ctx, x, stageY, w, stageH, 18);
    ctx.fill();
    roundRect(ctx, x, stageY, w, stageH, 18);
    ctx.clip();
    ctx.translate(x, stageY);
  }
  const sw = look.laneFrame === 'bare' ? SCENE_W : w;
  let dominantLf: LaneFrame | null = null;
  const dom = scene.metric?.dominantAt(t) ?? -1;
  for (const it of shown) {
    ctx.save();
    ctx.globalAlpha = it.vis;
    drawLaneWave(ctx, scene, it.lf, t, sw, stageH, look, { brightness: 1, composite: 'stage', bg, bgRect: { x: sw === w ? x : 0, y: stageY }, pulse: (scene.hud ?? 0) * look.wavePulse * (0.3 + 0.7 * (it.meter?.post ?? 0)) });
    ctx.restore();
    if (it.lf.slotIndex === dom) dominantLf = it.lf;
  }
  const ref = dominantLf ?? shown[0]?.lf ?? null;
  if (ref) {
    const visible = look.waveZoomSec;
    const t0 = ref.trackTime - visible / 2;
    drawGridAndCues(ctx, scene, ref, t0, (s) => ((s - t0) / visible) * sw, sw, stageH, look);
  }
  if (look.showPlayhead) drawPlayhead(ctx, sw / 2, stageH, look.glow, false);
  ctx.restore();
  for (const it of shown) if (it.lf.slot) {
    ctx.save();
    ctx.globalAlpha = it.vis;
    drawLaneBursts(ctx, scene, it.lf, t, sw === w ? x : 0, stageY, sw, stageH, DECK_COLORS[it.lf.deck], look.glow);
    ctx.restore();
  }
}

// ── Action bursts ────────────────────────────────────────────────────────

function actionColor(a: RoutineAction, deckColor: string): string {
  if (a.kind === 'hotCue' && a.cueSlot) return cueCssColor(a.cueSlot);
  if (a.kind === 'kill' || a.kind === 'restore') {
    if (a.label.startsWith('LOW')) return AUTOMATION_COLORS.eqLow;
    if (a.label.startsWith('MID')) return AUTOMATION_COLORS.eqMid;
    if (a.label.startsWith('HI')) return AUTOMATION_COLORS.eqHigh;
  }
  if (a.kind === 'filter') return a.label.includes('LPF') ? FILTER_LPF_COLOR : AUTOMATION_COLORS.filter;
  if (a.kind === 'filterOff') return AUTOMATION_COLORS.filter;
  if (a.kind === 'fx' || a.kind === 'fxOff') return FX_DEPTH_COLOR;
  return deckColor;
}

function drawLaneBursts(
  ctx: CanvasRenderingContext2D, scene: RoutineScene, lf: LaneFrame, t: number,
  x: number, y: number, w: number, h: number, deckColor: string, glow: number
): void {
  const { routine } = scene;
  const cx = x + w / 2;
  const cy = y + h / 2;
  for (const a of scene.actions) {
    if (a.slot !== lf.slotIndex) continue;
    const age = t - mixOf(routine, a.beat);
    if (age < 0 || age > FLASH_SEC) continue;
    const k = age / FLASH_SEC;
    const fade = 1 - k;
    const color = actionColor(a, deckColor);
    ctx.save();
    roundRect(ctx, x, y, w, h, 8);
    ctx.clip();
    if (a.kind === 'hotCue' || a.kind === 'play' || a.kind === 'loop' || a.kind === 'fx') {
      // Expanding rings from the playhead
      for (let i = 0; i < 3; i++) {
        const kk = Math.max(0, k - i * 0.12) / (1 - i * 0.12);
        if (kk <= 0) continue;
        const r = easeOut(kk) * w * 0.55;
        ctx.strokeStyle = rgba(color, (1 - kk) * 0.9);
        ctx.lineWidth = 10 * (1 - kk) + 2;
        ctx.shadowColor = color;
        ctx.shadowBlur = 24 * glow;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (a.kind === 'jump' || a.kind === 'seek') {
      // A light sweep across the lane in the jump's direction
      const dir = a.label.startsWith('◀') ? -1 : 1;
      const sx = cx + dir * easeOut(k) * w * 0.6;
      const g = ctx.createLinearGradient(sx - 120 * dir, 0, sx + 60 * dir, 0);
      g.addColorStop(0, rgba(color, 0));
      g.addColorStop(0.7, rgba(color, 0.7 * fade));
      g.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
      ctx.font = font(64, true);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      glowText(ctx, dir < 0 ? '◀◀' : '▶▶', sx, cy, color, 30 * glow, rgba('#ffffff', fade));
      ctx.textAlign = 'left';
    } else if (a.kind === 'kill' || a.kind === 'faderOut' || a.kind === 'pause' || a.kind === 'loopOff' || a.kind === 'fxOff') {
      // Shutter: horizontal bars closing in
      const n = 6;
      for (let i = 0; i < n; i++) {
        const by = y + (i / n) * h;
        ctx.fillStyle = rgba(color, 0.55 * fade);
        ctx.fillRect(x, by, w, (h / n) * (1 - easeOut(k)) * 0.5);
      }
    } else if (a.kind === 'restore' || a.kind === 'faderIn') {
      // Bloom wipe out from the playhead
      const r = easeOut(k) * w * 0.7;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, r));
      g.addColorStop(0, rgba(color, 0.0));
      g.addColorStop(0.85, rgba(color, 0.5 * fade));
      g.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
    } else if (a.kind === 'filter' || a.kind === 'filterOff') {
      // Vignette pulse in the filter's color
      const g = ctx.createRadialGradient(cx, cy, w * 0.15, cx, cy, w * 0.6);
      g.addColorStop(0, rgba(color, 0));
      g.addColorStop(1, rgba(color, 0.6 * fade));
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
    }
    // Label pop (Beat FX labels live on the wave already)
    if (a.kind === 'fx' || a.kind === 'fxOff') { ctx.restore(); continue; }
    const pop = 1 + 0.5 * (1 - easeOut(Math.min(1, k * 3)));
    ctx.font = font(Math.round(44 * pop), true);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lw = ctx.measureText(a.label).width + 44;
    ctx.shadowColor = color;
    ctx.shadowBlur = 30 * glow;
    ctx.fillStyle = rgba(color, Math.min(1, 0.35 + fade));
    roundRect(ctx, cx - lw / 2, cy - 36 * pop, lw, 72 * pop, 16);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#0b0b0f';
    ctx.fillText(a.label, cx, cy + 2);
    ctx.restore();
  }
}

// ── Beat FX strip ────────────────────────────────────────────────────────

function drawFxPanel(ctx: CanvasRenderingContext2D, scene: RoutineScene, t: number, L: Layout, look: ClipLook): void {
  const { routine } = scene;
  const x0 = 44;
  const y = L.fx.y;
  const v = routine.beatFx ? routineFxAt(routine.beatFx, beatOf(routine, t)) : null;
  const on = !!v && v.on;
  ctx.font = font(20, true);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText('BEAT FX', x0, y + 22);
  let cx = x0 + 110;
  const cy = y + 4;
  ctx.font = font(22, true);
  for (const id of BEAT_FX_EFFECTS) {
    const label = BEAT_FX_SHORT_LABELS[id];
    const cw = ctx.measureText(label).width + 26;
    const selected = v?.selected === id;
    const color = BEAT_FX_COLORS[id];
    ctx.save();
    if (selected && on) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 26 * look.glow;
      ctx.fillStyle = color;
      roundRect(ctx, cx, cy, cw, 38, 19);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#0b0b0f';
    } else {
      ctx.strokeStyle = selected ? rgba(color, 0.9) : 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 2;
      roundRect(ctx, cx + 1, cy + 1, cw - 2, 36, 18);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = selected ? color : 'rgba(255,255,255,0.45)';
    }
    ctx.textAlign = 'center';
    ctx.fillText(label, cx + cw / 2, cy + 20);
    cx += cw + 10;
  }
  ctx.textAlign = 'left';
  // Target + beats + depth
  const rightX = SCENE_W - x0;
  ctx.textAlign = 'right';
  ctx.font = font(22, true);
  const target = v ? (v.target === 'master' ? 'MST' : routine.slots.find((s) => s.slotId === v.target)?.deck ?? '—') : '—';
  const targetColor = target === 'MST' ? '#ffffff' : (DECK_COLORS as Record<string, string>)[target] ?? 'rgba(255,255,255,0.4)';
  glowText(ctx, `→ ${target}  ${v ? formatBeatFxLength(v.beats) : '—'}`, rightX, y + 22, on ? targetColor : 'rgba(0,0,0,0)', 12 * look.glow, on ? targetColor : 'rgba(255,255,255,0.4)');
  const depth = v ? v.depth : -1;
  const mw = 200;
  const mx = rightX - mw;
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  roundRect(ctx, mx, y + 60, mw, 10, 5);
  ctx.fill();
  ctx.save();
  ctx.shadowColor = FX_DEPTH_COLOR;
  ctx.shadowBlur = on ? 16 * look.glow : 0;
  ctx.fillStyle = on ? FX_DEPTH_COLOR : 'rgba(255,255,255,0.25)';
  roundRect(ctx, mx, y + 60, Math.max(10, mw * ((depth + 1) / 2)), 10, 5);
  ctx.fill();
  ctx.restore();
  ctx.font = font(16, true);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.textAlign = 'left';
  ctx.fillText('DEPTH', mx, y + 46);
}

// ── Floating action pills ────────────────────────────────────────────────

function drawTicker(ctx: CanvasRenderingContext2D, scene: RoutineScene, t: number, L: Layout, look: ClipLook, maxRows = 4): void {
  const { routine } = scene;
  const x0 = 44;
  const zoneY = L.ticker.y;
  const zoneH = L.ticker.h;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, zoneY - 10, SCENE_W, zoneH + 10);
  ctx.clip();
  ctx.textBaseline = 'middle';
  // Newest pill sits at the bottom; each older one is pushed up a row and
  // drifts/fades with age — a stack that floats, never overlaps.
  const rowH = 58;
  let lane = 0;
  for (let i = scene.actions.length - 1; i >= 0 && lane < maxRows; i--) {
    const a = scene.actions[i];
    const at = mixOf(routine, a.beat);
    const age = t - at;
    if (age < 0) continue;
    if (age > PILL_SEC) break;
    const k = age / PILL_SEC;
    const slot = a.slot === null ? null : routine.slots.find((s) => s.slot === a.slot) ?? null;
    const deck = slot?.deck ?? null;
    const color = deck ? DECK_COLORS[deck] : '#ffffff';
    const pillColor = actionColor(a, color);
    const drift = k * 24;
    const py = zoneY + zoneH - 40 - lane * rowH - drift;
    const alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    const pop = 1 + 0.25 * (1 - easeOut(Math.min(1, age * 5)));
    ctx.font = font(Math.round(28 * pop), true);
    const label = a.label;
    const lw = ctx.measureText(label).width + 90;
    const px = x0 + lane * 18;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = pillColor;
    ctx.shadowBlur = 22 * look.glow * (1 + 1.5 * (scene.hud ?? 0));
    ctx.fillStyle = 'rgba(8,8,12,0.75)';
    roundRect(ctx, px, py - 24 * pop, lw, 48 * pop, 24 * pop);
    ctx.fill();
    ctx.strokeStyle = rgba(pillColor, 0.9);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = color;
    roundRect(ctx, px + 10, py - 16, 32, 32, 8);
    ctx.fill();
    ctx.fillStyle = '#0b0b0f';
    ctx.font = font(22, true);
    ctx.textAlign = 'center';
    ctx.fillText(deck ?? 'M', px + 26, py + 1);
    ctx.textAlign = 'left';
    ctx.font = font(Math.round(28 * pop), true);
    ctx.fillStyle = pillColor;
    ctx.fillText(label, px + 56, py + 1);
    ctx.restore();
    lane++;
  }
  ctx.restore();
}

// ── Footer ───────────────────────────────────────────────────────────────

function drawFooter(ctx: CanvasRenderingContext2D, scene: RoutineScene, t: number, L: Layout, look: ClipLook): void {
  const x0 = 44;
  const y = L.footer.y;
  const total = scene.range.endSec - scene.range.startSec;
  const elapsed = t - scene.range.startSec;
  const w = SCENE_W - x0 * 2;
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  roundRect(ctx, x0, y + 8, w, 6, 3);
  ctx.fill();
  ctx.save();
  ctx.shadowColor = look.accent;
  ctx.shadowBlur = 12 * look.glow * (1 + 2 * (scene.hud ?? 0));
  ctx.fillStyle = look.accent;
  roundRect(ctx, x0, y + 8, Math.max(6, w * Math.max(0, Math.min(1, elapsed / total))), 6, 3);
  ctx.fill();
  ctx.restore();
  ctx.font = font(22);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(`${formatClock(elapsed)} / ${formatClock(total)}`, x0, y + 40);
  if (look.caption) {
    ctx.textAlign = 'center';
    ctx.font = font(24, true);
    glowText(ctx, look.caption, SCENE_W / 2, y + 40, look.accent, 10 * look.glow, '#ffffff');
  }
  if (look.showWordmark) {
    // manaDJ: lowercase "mana", the DJ in the accent.
    ctx.textAlign = 'left';
    ctx.font = font(24, true);
    const djW = ctx.measureText('DJ').width;
    const manaW = ctx.measureText('mana').width;
    const wx = SCENE_W - x0 - djW - manaW;
    glowText(ctx, 'mana', wx, y + 40, look.accent, 12 * look.glow, 'rgba(255,255,255,0.75)');
    glowText(ctx, 'DJ', wx + manaW, y + 40, look.accent, 14 * look.glow, look.accent);
  }
  ctx.textAlign = 'left';
}

// ── Title cards ──────────────────────────────────────────────────────────

const CARD_SEC = 3.4;

const ID_LABEL = 'ID';

/** Mix second a slot's first drop lands: −Infinity when the track was
 * already past its first drop when the clip (or the slot) starts — the
 * opening track of a span cut mid-song isn't an ID — else its first
 * audible drop event (Infinity = never in the render). Cached per metric
 * and range. */
const firstDropCache = new WeakMap<object, { start: number; map: Map<number, number> }>();
function firstDropAt(scene: RoutineScene, slot: number): number {
  const m = scene.metric;
  if (!m) return Infinity;
  let c = firstDropCache.get(m);
  if (!c || c.start !== scene.range.startSec) {
    const map = new Map<number, number>();
    for (const e of m.events) if (e.drop && !map.has(e.slot)) map.set(e.slot, e.t);
    scene.routine.slots.forEach((s, i) => {
      const firstDropSec = m.tracks.get(s.trackId)?.dropSecs[0];
      if (firstDropSec === undefined) return;
      const at = Math.max(scene.range.startSec, s.entryMixSec);
      if (routineSlotStateAt(scene.routine, s, at).trackTime >= firstDropSec - 0.05) map.set(i, -Infinity);
    });
    c = { start: scene.range.startSec, map };
    firstDropCache.set(m, c);
  }
  return c.map.get(slot) ?? Infinity;
}

/** Is this slot's title shown yet (revealAtDrop hides it until its drop)? */
function titleRevealed(scene: RoutineScene, slot: number, t: number): boolean {
  const look = scene.look ?? DEFAULT_LOOK;
  return !look.revealAtDrop || slot < 0 || t >= firstDropAt(scene, slot);
}

function activeTitleCard(scene: RoutineScene, t: number): { slot: number; age: number } | null {
  const m = scene.metric;
  if (!m) return null;
  const look = scene.look ?? DEFAULT_LOOK;
  if (look.revealAtDrop) {
    // One card per track, at its drop: the reveal — and the opening track
    // at the clip start when its drop already passed.
    let best: { slot: number; age: number } | null = null;
    const opener = m.dominantAt(scene.range.startSec + 0.5);
    if (opener >= 0 && firstDropAt(scene, opener) === -Infinity) {
      const age = t - (scene.range.startSec + 0.2);
      if (age >= 0 && age < CARD_SEC) best = { slot: opener, age };
    }
    scene.routine.slots.forEach((_, i) => {
      const at = firstDropAt(scene, i);
      const age = t - at;
      if (Number.isFinite(at) && at >= scene.range.startSec && age >= 0 && age < CARD_SEC && (!best || age < best.age)) best = { slot: i, age };
    });
    return best;
  }
  // The clip opens on whoever owns the mix at its start, then each takeover.
  const startDom = m.dominantAt(scene.range.startSec + 0.5);
  const tk = [
    ...(startDom >= 0 ? [{ t: scene.range.startSec, slot: startDom }] : []),
    ...m.takeovers.filter((x) => x.t > scene.range.startSec + 1 && x.slot !== startDom),
  ];
  for (let i = tk.length - 1; i >= 0; i--) {
    const age = t - Math.max(tk[i].t, scene.range.startSec + 0.2);
    if (age >= 0 && age < CARD_SEC) return { slot: tk[i].slot, age };
  }
  return null;
}

function drawTitleCard(ctx: CanvasRenderingContext2D, scene: RoutineScene, card: { slot: number; age: number }, y: number, look: ClipLook): void {
  const slot = scene.routine.slots[card.slot];
  const track = slot ? scene.tracks.get(slot.trackId) : null;
  if (!slot || !track) return;
  const color = slot.deck ? DECK_COLORS[slot.deck] : look.accent;
  const inK = easeOut(Math.min(1, card.age / 0.45));
  const outK = card.age > CARD_SEC - 0.5 ? (CARD_SEC - card.age) / 0.5 : 1;
  const x = 44 - (1 - inK) * 260;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(inK, outK));
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(6,6,10,0.78)';
  const w = SCENE_W - 88;
  ctx.shadowColor = color;
  ctx.shadowBlur = 24 * look.glow;
  roundRect(ctx, x, y, w, 96, 14);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = color;
  ctx.fillRect(x, y + 14, 6, 68);
  ctx.font = font(18, true);
  ctx.fillStyle = rgba(color, 0.9);
  ctx.fillText(`NOW · DECK ${slot.deck ?? '—'}`, x + 26, y + 24);
  ctx.font = font(36, true);
  const tt = ellipsize(ctx, track.title, w - 50);
  glowText(ctx, tt, x + 26, y + 56, color, 14 * look.glow, '#ffffff');
  ctx.font = font(22);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText(ellipsize(ctx, track.artist, w - 50), x + 26, y + 82);
  ctx.restore();
}

// ── Impacts ──────────────────────────────────────────────────────────────

function impactZoom(impact: FrameExtras['impact'], strength: number): number {
  if (!impact) return 0;
  const k = Math.exp(-impact.age * 3.2);
  if (impact.kind === 'zoom') return 0.16 * strength * k;
  if (impact.kind === 'shockwave') return 0.08 * strength * k;
  return 0;
}

function drawImpact(ctx: CanvasRenderingContext2D, impact: NonNullable<FrameExtras['impact']>, look: ClipLook): void {
  const str = look.impactStrength;
  if (str <= 0 || impact.age > 1.6) return;
  const { kind, age } = impact;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  if (kind === 'flash' || kind === 'shockwave') {
    const a = (kind === 'flash' ? 0.55 : 0.28) * str * Math.exp(-age * 6);
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.fillRect(0, 0, SCENE_W, SCENE_H);
  }
  if (kind === 'shockwave' && age < 1.2) {
    const r = easeOut(age / 1.2) * SCENE_H * 0.85;
    const k = 1 - age / 1.2;
    ctx.lineWidth = 70 * k + 4;
    ctx.strokeStyle = rgba(look.accent, 0.55 * str * k);
    ctx.shadowColor = look.accent;
    ctx.shadowBlur = 40;
    ctx.beginPath();
    ctx.arc(SCENE_W / 2, SCENE_H / 2, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 10 * k + 2;
    ctx.strokeStyle = `rgba(255,255,255,${0.7 * str * k})`;
    ctx.beginPath();
    ctx.arc(SCENE_W / 2, SCENE_H / 2, r * 0.92, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (kind === 'strobe' && age < 1.2 && Math.floor(age * 16) % 2 === 0) {
    ctx.fillStyle = `rgba(255,255,255,${0.32 * str * (1 - age / 1.2)})`;
    ctx.fillRect(0, 0, SCENE_W, SCENE_H);
  }
  ctx.restore();
}

// ── Transition VFX ───────────────────────────────────────────────────────

function hash01(a: number, b: number): number {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Post effect over the finished frame (device pixels), beat-synced.
 * `beatIndex`/`phase`: the dominant track's beat in the bar and its phase. */
function applyVfx(
  ctx: CanvasRenderingContext2D, kind: TransitionVfx,
  b: { t: number; age: number; remaining: number; hud: number; beatIndex: number; phase: number },
  W: number, H: number,
): void {
  const env = Math.max(0, Math.min(1, b.age / 0.08, b.remaining / 0.08));
  if (env <= 0) return;
  const src = scratch('vfx-src', W, H);
  src.ctx.globalCompositeOperation = 'copy';
  src.ctx.drawImage(ctx.canvas, 0, 0);
  src.ctx.globalCompositeOperation = 'source-over';
  const beatK = Math.pow(1 - b.phase, 3);
  const u = W / SCENE_W;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (kind === 'rgb') {
    // Chromatic split: the channels pull apart on every beat.
    const dx = (12 + 44 * beatK + 24 * b.hud) * u * env;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ([['#ff0000', -dx, -dx * 0.25], ['#00ff00', 0, 0], ['#0000ff', dx, dx * 0.25]] as const).forEach(([c, ox, oy], i) => {
      const ch = scratch(`vfx-ch${i}`, W, H);
      ch.ctx.globalCompositeOperation = 'copy';
      ch.ctx.drawImage(src.canvas, 0, 0);
      ch.ctx.globalCompositeOperation = 'multiply';
      ch.ctx.fillStyle = c;
      ch.ctx.fillRect(0, 0, W, H);
      ch.ctx.globalCompositeOperation = 'source-over';
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(ch.canvas, ox, oy);
    });
  } else if (kind === 'glitch') {
    // Torn horizontal slices, reseeded 12× a second and on each beat.
    const n = 18;
    const seed = Math.floor(b.t * 12) + b.beatIndex * 101;
    const amp = 140 * u * (0.35 + beatK) * env;
    for (let i = 0; i < n; i++) {
      const r = hash01(seed, i);
      if (r < 0.5) continue;
      const y0 = Math.floor((hash01(seed, i + 50) * H));
      const hh = Math.max(4, Math.floor(hash01(seed, i + 90) * H * 0.07));
      const dx = (r - 0.75) * 4 * amp;
      ctx.drawImage(src.canvas, 0, y0, W, hh, dx, y0, W, hh);
      if (r > 0.85) {
        ctx.globalCompositeOperation = 'difference';
        ctx.fillStyle = r > 0.93 ? 'rgba(0,255,255,0.8)' : 'rgba(255,0,255,0.7)';
        ctx.fillRect(0, y0, W, hh);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  } else if (kind === 'mirror') {
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(src.canvas, 0, 0, W / 2, H, 0, 0, W / 2, H);
  } else if (kind === 'kaleido') {
    // Four-way mirror of the slowly turning frame, kicked on the beat.
    const q = scratch('vfx-kq', Math.ceil(W / 2), Math.ceil(H / 2));
    q.ctx.setTransform(1, 0, 0, 1, 0, 0);
    q.ctx.fillStyle = '#000';
    q.ctx.fillRect(0, 0, q.canvas.width, q.canvas.height);
    q.ctx.translate(W / 2, H / 2);
    q.ctx.rotate(b.t * 0.5 + beatK * 0.12);
    const z = 1.35 + 0.08 * beatK;
    q.ctx.scale(z, z);
    q.ctx.drawImage(src.canvas, -W / 2, -H / 2);
    q.ctx.setTransform(1, 0, 0, 1, 0, 0);
    const qw = q.canvas.width;
    const qh = q.canvas.height;
    ctx.drawImage(q.canvas, 0, 0);
    ctx.save(); ctx.translate(W, 0); ctx.scale(-1, 1); ctx.drawImage(q.canvas, 0, 0, qw, qh); ctx.restore();
    ctx.save(); ctx.translate(0, H); ctx.scale(1, -1); ctx.drawImage(q.canvas, 0, 0, qw, qh); ctx.restore();
    ctx.save(); ctx.translate(W, H); ctx.scale(-1, -1); ctx.drawImage(q.canvas, 0, 0, qw, qh); ctx.restore();
    ctx.globalAlpha = 0.3 * env;
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(src.canvas, 0, 0);
  } else if (kind === 'invert') {
    // The frame flips negative on the off-beats.
    if (b.beatIndex % 2 === 1) {
      ctx.globalCompositeOperation = 'difference';
      ctx.fillStyle = `rgba(255,255,255,${env})`;
      ctx.fillRect(0, 0, W, H);
    }
  } else if (kind === 'tunnel') {
    // Zoom echoes rushing outward, longer on the beat.
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 1; i <= 5; i++) {
      const z = 1 + i * 0.07 * (0.5 + beatK);
      ctx.globalAlpha = (0.3 / i) * env;
      ctx.drawImage(src.canvas, W / 2 - (W * z) / 2, H / 2 - (H * z) / 2, W * z, H * z);
      const zi = 1 - i * 0.12;
      ctx.globalAlpha = (0.2 / i) * env;
      ctx.drawImage(src.canvas, W / 2 - (W * zi) / 2, H / 2 - (H * zi) / 2, W * zi, H * zi);
    }
  } else if (kind === 'strobe') {
    // 16th-note strobe: lit on the even 16ths, white kick on the beat.
    const sixteenth = Math.floor(b.phase * 4);
    if (sixteenth % 2 === 1) {
      ctx.fillStyle = `rgba(0,0,0,${0.92 * env})`;
      ctx.fillRect(0, 0, W, H);
    } else if (sixteenth === 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,255,255,${0.22 * env * (1 - b.phase * 4)})`;
      ctx.fillRect(0, 0, W, H);
    }
  }
  ctx.restore();
}

// ── Frame ────────────────────────────────────────────────────────────────

const LANE_MAX_H = 560;

/** Paint the frame at mix instant `t` into a `width`×`height` 2D context. */
export function drawRoutineFrame(
  ctx: CanvasRenderingContext2D, scene: RoutineScene, t: number, width: number, height: number,
  extras: FrameExtras = {}
): void {
  const look = scene.look ?? DEFAULT_LOOK;
  const decks = sceneDecks(scene.routine);
  const L = layoutFor(look);
  const ov = extras.overlay ?? null;
  // Solo: one deck fills the frame (absent deck = whoever dominated as it began).
  let soloDeck: RoutineDeck | null = null;
  if (ov?.kind === 'solo') {
    soloDeck = ov.deck ?? scene.routine.slots[scene.metric?.dominantAt(scene.range.startSec + ov.startSec) ?? -1]?.deck ?? null;
    if (soloDeck && !decks.includes(soloDeck)) soloDeck = null;
  }
  const hideWaves = ov?.kind === 'blackout' && !!ov.hideWaves;
  if (soloDeck) {
    const top = L.header.h + (look.showHeader ? 12 : 24);
    L.lanes = { y: top, h: L.footer.y - 16 - top, gap: 0 };
  }
  const meters = meterStep(scene, t);
  const pos = headerPositionAt(scene, t);
  // Beat pulse (dominant track's beats, downbeats harder) + impact zoom.
  const beatK = pos ? Math.pow(1 - pos.phase, 4) * (pos.beatInBar === 0 ? 1 : 0.45) * look.beatPulse : 0;
  const zoomImpact = impactZoom(extras.impact, look.impactStrength);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);
  ctx.scale(width / SCENE_W, height / SCENE_H);

  // Background: compose the programme layers once (the mask composite
  // samples the same image), then draw it with the pulse/impact zoom.
  let bg: HTMLCanvasElement | null = null;
  const layers = extras.background ?? [];
  if (layers.length > 0) {
    const bw = layers[0].canvas.width;
    const bh = layers[0].canvas.height;
    const comp = scratch('bg-comp', bw, bh);
    comp.ctx.globalAlpha = 1;
    comp.ctx.fillStyle = '#000';
    comp.ctx.fillRect(0, 0, bw, bh);
    for (const layer of layers) {
      comp.ctx.globalAlpha = Math.max(0, Math.min(1, layer.alpha));
      comp.ctx.drawImage(layer.canvas, 0, 0, bw, bh);
    }
    comp.ctx.globalAlpha = 1;
    bg = comp.canvas;
    const z = 1 + 0.03 * beatK + zoomImpact;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, look.vizOpacity));
    ctx.translate(SCENE_W / 2, SCENE_H / 2);
    ctx.scale(z, z);
    ctx.drawImage(bg, -SCENE_W / 2, -SCENE_H / 2, SCENE_W, SCENE_H);
    ctx.restore();
  }
  // Bright presets must not wash the cards out: flat dim + vignette.
  if (look.vizDim > 0) {
    ctx.fillStyle = `rgba(0,0,0,${look.vizDim})`;
    ctx.fillRect(0, 0, SCENE_W, SCENE_H);
  }
  if (look.vignette > 0) {
    const vg = ctx.createRadialGradient(SCENE_W / 2, SCENE_H / 2, SCENE_H * 0.2, SCENE_W / 2, SCENE_H / 2, SCENE_H * 0.75);
    vg.addColorStop(0, `rgba(0,0,0,${0.15 * look.vignette})`);
    vg.addColorStop(1, `rgba(0,0,0,${look.vignette})`);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, SCENE_W, SCENE_H);
  }

  const bass = meters.slot.reduce((m, x) => Math.max(m, x.low), 0);
  const hud = hudPulseAt(scene, t, bass, meters.pulse, look);
  scene.hud = hud;
  if (look.showHeader) drawHeader(ctx, scene, t, L, look, hud);
  else if (look.phraseCountdown) drawFloatingCountdown(ctx, scene, t, look, hud);

  // Deck stack: presence-weighted, centered; cards unfold in/out with
  // their presence and the stack slides to make room.
  const items = decks.map((deck) => {
    const lf = laneFrameAt(scene, deck, t);
    const m = lf.slotIndex >= 0 ? meters.slot[lf.slotIndex] ?? null : null;
    const vis = lf.slotIndex < 0 ? 0
      : soloDeck ? (deck === soloDeck ? 1 : 0)
      : look.deckVisibility === 'all' ? 1
      : scene.metric ? scene.metric.visibilityAt(lf.slotIndex, t) : 1;
    return { lf, meter: m, vis };
  });
  const uiZoom = 1 + 0.01 * beatK + zoomImpact * 0.12;
  ctx.save();
  ctx.translate(SCENE_W / 2, L.lanes.y + L.lanes.h / 2);
  ctx.scale(uiZoom, uiZoom);
  ctx.translate(-SCENE_W / 2, -(L.lanes.y + L.lanes.h / 2));
  if (hideWaves) {
    // blackout with the waves: nothing but the overlays
  } else if (look.composite === 'stage') {
    drawStage(ctx, scene, items, t, L.lanes.y, L.lanes.y + L.lanes.h, look, bg);
  } else {
    const M = soloDeck ? 1 : look.deckVisibility === 'all' ? Math.max(1, decks.length) : Math.max(2, scene.metric?.maxConcurrent ?? decks.length);
    const gap = L.lanes.gap;
    const hNat = Math.min(soloDeck ? Infinity : LANE_MAX_H, (L.lanes.h - gap * (M - 1)) / M);
    const sumV = items.reduce((a, it) => a + it.vis, 0);
    const total = hNat * sumV + gap * Math.max(0, sumV - 1);
    let y = L.lanes.y + (L.lanes.h - total) / 2;
    let top = Infinity;
    let bottom = -Infinity;
    for (const it of items) {
      if (it.vis <= 0.002) continue;
      const ly = y;
      ctx.save();
      ctx.globalAlpha = it.vis;
      ctx.translate(0, ly);
      ctx.scale(1, it.vis);
      const bare = look.laneFrame === 'bare';
      drawLane(ctx, scene, it.lf, t, bare ? 0 : 44, 0, bare ? SCENE_W : SCENE_W - 88, hNat, look, it.meter, it.vis,
        bg ? { canvas: bg, rect: (wy) => ({ x: bare ? 0 : 46, y: ly + wy * it.vis }) } : null);
      ctx.restore();
      top = Math.min(top, ly);
      bottom = Math.max(bottom, ly + hNat * it.vis);
      y += (hNat + gap) * it.vis;
    }
    // One playhead through every card.
    if (look.showPlayhead && bottom > top) {
      ctx.save();
      ctx.shadowColor = PLAYHEAD;
      ctx.shadowBlur = 18 * look.glow * (1 + 2 * hud);
      ctx.fillStyle = PLAYHEAD;
      const pw = 4 + 4 * hud;
      ctx.fillRect(SCENE_W / 2 - pw / 2, top - 6, pw, bottom - top + 12);
      ctx.restore();
    }
  }
  ctx.restore();

  // Solo is full-frame (the lane owns the ticker / FX strip / card space);
  // a full blackout keeps only the countdown and footer.
  const quiet = !!soloDeck || hideWaves;
  if (look.showFxPanel && !quiet) drawFxPanel(ctx, scene, t, L, look);
  const card = look.titleCards && !quiet ? activeTitleCard(scene, t) : null;
  if (look.showTicker && !quiet) drawTicker(ctx, scene, t, L, look, card ? 1 : 4);
  if (card) drawTitleCard(ctx, scene, card, look.showTicker ? L.ticker.y + 4 : L.fx.y - 110, look);
  if (look.showFooter) drawFooter(ctx, scene, t, L, look);
  if (extras.impact) drawImpact(ctx, extras.impact, look);
  if (ov?.kind === 'vfx' && ov.vfx) {
    const pos2 = headerPositionAt(scene, t);
    applyVfx(ctx, ov.vfx, { t, age: ov.age, remaining: ov.remaining, hud, beatIndex: pos2 ? pos2.beatInBar : Math.floor(t * 2), phase: pos2?.phase ?? 0 }, width, height);
  }
  const fade = extras.fade ?? 1;
  if (fade < 1) {
    ctx.fillStyle = `rgba(0,0,0,${1 - fade})`;
    ctx.fillRect(0, 0, SCENE_W, SCENE_H);
  }
  ctx.restore();
}
