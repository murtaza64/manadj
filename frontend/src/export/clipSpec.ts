/**
 * Clip spec (#377 review → clip editor): everything that shapes a video
 * clip EXCEPT the performance itself. The audio and deck actions always
 * come from the source artifact untouched; the clip owns its time range,
 * fades, visualizer programme and look.
 */

import type { AutoVizOptions, VizImpact } from './clipMetric';
import type { RoutineDeck } from '../sets/routinePlan';

export type ClipSource =
  | { kind: 'routine'; uuid: string }
  | { kind: 'transition'; uuid: string }
  | { kind: 'candidate'; uuid: string }
  | { kind: 'routine-take'; uuid: string }
  | { kind: 'session'; uuid: string; startS: number; endS: number };

/** How a cue arrives. `crossfade` / `cut` shape the switch itself; the
 * held kinds play a segment of `durationSec` before or after the cue
 * (a build into it / a moment after it) and then hand back:
 * - `blackout`: the visualizer goes black (`hideWaves`: the waves too)
 * - `solo`: one deck's waveform fills the frame (`deck`; absent = whoever dominates)
 * - `blast`: another preset (`presetId`) takes over, then the programme returns
 * - `vfx`: a post effect (`vfx`) over the whole frame */
export type CueTransitionKind = 'crossfade' | 'cut' | 'blackout' | 'solo' | 'blast' | 'vfx';
export type TransitionVfx = 'rgb' | 'glitch' | 'kaleido' | 'mirror' | 'invert' | 'tunnel' | 'strobe';
export const HELD_TRANSITIONS: readonly CueTransitionKind[] = ['blackout', 'solo', 'blast', 'vfx'];

export interface CueTransition {
  kind: CueTransitionKind;
  /** crossfade: fade length (default `viz.crossfadeSec`; it also blends the
   * cue's numeric look overrides); held kinds: the segment length. */
  durationSec?: number;
  /** Held kinds: the segment ends at the cue ('before') or starts at it ('after'). */
  placement?: 'before' | 'after';
  deck?: RoutineDeck;
  presetId?: string;
  vfx?: TransitionVfx;
  hideWaves?: boolean;
}

/** A visualizer programme point (keyframe): from `atSec` (clip-relative)
 * the preset `presetId` plays and `look` overrides layer over the clip
 * look (they persist until a later cue overrides them again). */
export interface VizCue {
  atSec: number;
  presetId: string;
  /** Frame-wide accent landing on the cue (drops, phrase boundaries). A
   * cue repeating the running preset is an impact-only pulse. */
  impact?: VizImpact;
  /** This cue's preset param overrides (keyframe values; defaults fill the rest). */
  params?: Record<string, number>;
  /** Look fields this keyframe changes. */
  look?: Partial<ClipLook>;
  /** How it arrives; absent = crossfade over `viz.crossfadeSec`. */
  transition?: CueTransition;
}

export type WavePalette = 'style' | 'deck' | 'neon' | 'fire' | 'ice' | 'mono';
/** How the deck waveforms meet the visualizer: glass cards, the wave as a
 * window onto the preset, additive light over it, or one shared stage. */
export type WaveComposite = 'cards' | 'mask' | 'screen' | 'stage' | 'negative' | 'cutout' | 'tint';
/** What the HUD controls breathe with. */
export type HudSource = 'beat-energy' | 'beat' | 'energy' | 'bass' | 'off';
export type DeckVisibility = 'all' | 'audible';
/** Deck lanes: full-bleed waveforms with no box (default), or glass cards. */
export type LaneFrame = 'bare' | 'cards';

export interface ClipLook {
  /** Accent for the chip, pips, progress — defaults to the Routine accent. */
  accent: string;
  /** Seconds of track visible across a lane. */
  waveZoomSec: number;
  /** 0..1 — bloom/glow strength. */
  glow: number;
  /** 0..1 — visualizer background opacity. */
  vizOpacity: number;
  /** 0..1 — flat darkening over the visualizer. */
  vizDim: number;
  /** 0..1 — edge darkening (vignette) over the visualizer. */
  vignette: number;
  /** HUD response: source, amount (0..2) and the after-drop boost (0..2). */
  hudSource: HudSource;
  hudAmount: number;
  dropBoost: number;
  /** 0..1 — the waveforms themselves breathe with the HUD pulse (swell + glow). */
  wavePulse: number;
  showTicker: boolean;
  /** The dormant Beat FX selector strip (off: FX show on their target wave only). */
  showFxPanel: boolean;
  showKnobs: boolean;
  /** Overrides the derived title; empty = derived. */
  title: string;
  /** Free caption under the footer (handle, event, …). Defaults to the
   * last handle used (see rememberHandle). */
  caption: string;
  /** Footer: progress bar, clock, caption and the manaDJ wordmark. */
  showFooter: boolean;
  showWordmark: boolean;
  wavePalette: WavePalette;
  laneFrame: LaneFrame;
  /** 0..1 — dark shade behind the track title / controls row (full-bleed lanes). */
  infoShade: number;
  composite: WaveComposite;
  /** 'audible': silent decks hide, cards fade with their post-fader level
   * and the lanes reflow. */
  deckVisibility: DeckVisibility;
  /** 0..1 — frame zoom pulse on the dominant track's beats (downbeats harder). */
  beatPulse: number;
  /** 0..1 — scale of cue impacts (flash / zoom / shockwave / strobe). */
  impactStrength: number;
  /** Title card when a new track takes over the mix. */
  titleCards: boolean;
  /** Track titles read "ID" until the track's drop (hot cue 4) lands; the
   * title card then reveals it. */
  revealAtDrop: boolean;
  /** Header counts bars to the next phrase / drop. */
  phraseCountdown: boolean;
  /** Beat grid lines on the waveforms. */
  showGrid: boolean;
  /** Top HUD bar (bar/phrase readout, beat pips, master meter). Off: the
   * beat lives in the controls' pulse instead. */
  showHeader: boolean;
}

export interface ClipSpec {
  source: ClipSource;
  /** Mix-second range inside the source's planned clock; null = whole. */
  range: { startSec: number; endSec: number } | null;
  fadeInSec: number;
  fadeOutSec: number;
  viz: {
    cues: VizCue[];
    crossfadeSec: number;
    /** When set, the cues are regenerated from the mix's hypermeter
     * (drops / phrase boundaries) at load — the headless driver's knob;
     * the editor turns it into editable cues. */
    auto?: Partial<AutoVizOptions> | null;
  };
  look: ClipLook;
  fps: number;
  width: number;
  height: number;
}

export const DEFAULT_LOOK: ClipLook = {
  accent: '#a8ff00',
  waveZoomSec: 5,
  glow: 0.7,
  vizOpacity: 0.75,
  vizDim: 0.3,
  vignette: 0.65,
  hudSource: 'beat-energy',
  hudAmount: 1,
  dropBoost: 0.9,
  wavePulse: 0.4,
  showTicker: true,
  showFxPanel: false,
  showKnobs: true,
  title: '',
  caption: '',
  showFooter: true,
  showWordmark: true,
  wavePalette: 'deck',
  laneFrame: 'bare',
  infoShade: 0.45,
  composite: 'cards',
  deckVisibility: 'audible',
  beatPulse: 0.35,
  impactStrength: 0.8,
  titleCards: true,
  revealAtDrop: false,
  phraseCountdown: true,
  showGrid: false,
  showHeader: false,
};

const HANDLE_KEY = 'manadj-clip-handle';
const DEFAULT_HANDLE = '@dj.reroll';

/** The DJ handle new clips caption with: the last one typed, else the default. */
export function defaultHandle(): string {
  try {
    return localStorage.getItem(HANDLE_KEY) ?? DEFAULT_HANDLE;
  } catch {
    return DEFAULT_HANDLE;
  }
}

export function rememberHandle(handle: string): void {
  try {
    localStorage.setItem(HANDLE_KEY, handle);
  } catch {
    // ignore
  }
}

export function defaultClipSpec(source: ClipSource): ClipSpec {
  return {
    source,
    range: null,
    fadeInSec: 0.5,
    fadeOutSec: 1.0,
    viz: { cues: [{ atSec: 0, presetId: 'voyage' }], crossfadeSec: 2 },
    look: { ...DEFAULT_LOOK, caption: defaultHandle() },
    fps: 30,
    width: 1080,
    height: 1920,
  };
}

export function sourceKey(source: ClipSource): string {
  return source.kind === 'session'
    ? `session:${source.uuid}:${source.startS.toFixed(1)}-${source.endS.toFixed(1)}`
    : `${source.kind}:${source.uuid}`;
}

const STORAGE_PREFIX = 'manadj-clip:';

export function loadClipSpec(source: ClipSource): ClipSpec {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + sourceKey(source));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ClipSpec>;
      const base = defaultClipSpec(source);
      return {
        ...base, ...parsed, source,
        look: { ...base.look, ...(parsed.look ?? {}) },
        viz: { ...base.viz, ...(parsed.viz ?? {}) },
      };
    }
  } catch {
    // ignore
  }
  return defaultClipSpec(source);
}

export function saveClipSpec(spec: ClipSpec): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + sourceKey(spec.source), JSON.stringify(spec));
  } catch {
    // ignore
  }
}

/** Master fade multiplier at clip-relative second `s` (linear ramps). */
export function fadeGainAt(spec: ClipSpec, s: number, durationSec: number): number {
  let g = 1;
  if (spec.fadeInSec > 0) g = Math.min(g, s / spec.fadeInSec);
  if (spec.fadeOutSec > 0) g = Math.min(g, (durationSec - s) / spec.fadeOutSec);
  return Math.max(0, Math.min(1, g));
}

/** Visualizer programme at clip-relative second `s`: current preset, the
 * previous one and the crossfade progress (1 = current fully in). Cues
 * repeating the running preset don't crossfade (impact-only). */
export interface VizState {
  presetId: string;
  /** The running cue's param overrides. */
  params: Record<string, number> | null;
  from: string | null;
  fromParams: Record<string, number> | null;
  mix: number;
}

export function vizAt(spec: ClipSpec, s: number): VizState {
  const cues = sortedCues(spec);
  if (cues.length === 0) return { presetId: 'voyage', params: null, from: null, fromParams: null, mix: 1 };
  let i = 0;
  for (let k = 0; k < cues.length; k++) if (cues[k].atSec <= s) i = k;
  const cur = cues[i];
  // The switch that brought the current preset in.
  let j = i;
  while (j > 0 && cues[j - 1].presetId === cur.presetId) j--;
  const prev = j > 0 ? cues[j - 1] : null;
  const fade = fadeSecOf(spec, cues[j]);
  const mix = prev && fade > 0 ? Math.min(1, (s - cues[j].atSec) / fade) : 1;
  const fading = !!prev && mix < 1;
  return {
    presetId: cur.presetId, params: cur.params ?? null,
    from: fading ? prev.presetId : null, fromParams: fading ? prev.params ?? null : null, mix,
  };
}

/** The most recent impact at or before `s`: kind + age in seconds. */
export function impactAt(spec: ClipSpec, s: number): { kind: VizImpact; age: number } | null {
  const cues = sortedCues(spec);
  for (let k = cues.length - 1; k >= 0; k--) {
    const c = cues[k];
    if (c.atSec > s) continue;
    if (!c.impact || c.impact === 'none') continue;
    return { kind: c.impact, age: s - c.atSec };
  }
  return null;
}

/** Seconds the cue's switch (preset crossfade + numeric look blend) takes;
 * 0 = an instant cut (cut and every held kind). */
export function fadeSecOf(spec: ClipSpec, cue: VizCue): number {
  const tr = cue.transition;
  if (!tr || tr.kind === 'crossfade') return Math.max(0, tr?.durationSec ?? spec.viz.crossfadeSec);
  return 0;
}

export const DEFAULT_HOLD_SEC = 4;

/** A held transition's segment, clip-relative; null for crossfade / cut. */
export function holdSpan(cue: VizCue): { startSec: number; endSec: number } | null {
  const tr = cue.transition;
  if (!tr || !HELD_TRANSITIONS.includes(tr.kind)) return null;
  const d = Math.max(0.05, tr.durationSec ?? DEFAULT_HOLD_SEC);
  return (tr.placement ?? defaultPlacement(tr.kind)) === 'before'
    ? { startSec: cue.atSec - d, endSec: cue.atSec }
    : { startSec: cue.atSec, endSec: cue.atSec + d };
}

export function defaultPlacement(kind: CueTransitionKind): 'before' | 'after' {
  return kind === 'blackout' ? 'before' : 'after';
}

/** The held segment running at `s` (the latest-starting one wins). */
export interface ProgrammeOverlay {
  kind: 'blackout' | 'solo' | 'blast' | 'vfx';
  /** Seconds into / left in the segment. */
  age: number;
  remaining: number;
  /** Clip second the segment starts. */
  startSec: number;
  deck?: RoutineDeck;
  presetId?: string;
  vfx?: TransitionVfx;
  hideWaves?: boolean;
}

export function overlayAt(spec: ClipSpec, s: number): ProgrammeOverlay | null {
  let best: ProgrammeOverlay | null = null;
  for (const c of sortedCues(spec)) {
    const h = holdSpan(c);
    if (!h || s < h.startSec || s >= h.endSec) continue;
    if (best && best.startSec > h.startSec) continue;
    const tr = c.transition!;
    best = {
      kind: tr.kind as ProgrammeOverlay['kind'], age: s - h.startSec, remaining: h.endSec - s, startSec: h.startSec,
      deck: tr.deck, presetId: tr.presetId, vfx: tr.vfx ?? 'rgb', hideWaves: tr.hideWaves,
    };
  }
  return best;
}

/** Look fields that blend across a crossfade; the rest switch at the cue. */
const NUMERIC_LOOK_KEYS = (Object.keys(DEFAULT_LOOK) as (keyof ClipLook)[]).filter((k) => typeof DEFAULT_LOOK[k] === 'number');

function lerpHex(a: string, b: string, k: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  if (!Number.isFinite(pa) || !Number.isFinite(pb)) return k < 0.5 ? a : b;
  const ch = (sh: number) => Math.round(((pa >> sh) & 255) * (1 - k) + ((pb >> sh) & 255) * k);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

/** The look in force at clip second `s`: `spec.look` with every landed
 * cue's overrides layered in order; a crossfading cue blends the numeric
 * fields (and the accent) over its fade, enums/booleans switch at the cue. */
export function lookAt(spec: ClipSpec, s: number): ClipLook {
  const cues = sortedCues(spec);
  let cur = spec.look;
  for (const c of cues) {
    if (c.atSec > s) break;
    if (!c.look || Object.keys(c.look).length === 0) continue;
    const next: ClipLook = { ...cur, ...c.look };
    const fade = fadeSecOf(spec, c);
    const k = fade > 0 ? Math.min(1, (s - c.atSec) / fade) : 1;
    if (k < 1) {
      const e = k * k * (3 - 2 * k);
      const blended = { ...next } as Record<keyof ClipLook, unknown>;
      for (const key of NUMERIC_LOOK_KEYS) blended[key] = (cur[key] as number) * (1 - e) + (next[key] as number) * e;
      blended.accent = lerpHex(cur.accent, next.accent, e);
      cur = blended as unknown as ClipLook;
    } else {
      cur = next;
    }
  }
  return cur;
}

/** The look right after cue `index` (sorted order) has fully landed —
 * what a cue's look editor shows. */
export function lookAfterCue(spec: ClipSpec, index: number): ClipLook {
  const cues = sortedCues(spec);
  let cur = spec.look;
  for (let k = 0; k <= index && k < cues.length; k++) if (cues[k].look) cur = { ...cur, ...cues[k].look };
  return cur;
}

const sortCache = new WeakMap<VizCue[], VizCue[]>();
export function sortedCues(spec: ClipSpec): VizCue[] {
  let s = sortCache.get(spec.viz.cues);
  if (!s) {
    s = [...spec.viz.cues].sort((a, b) => a.atSec - b.atSec);
    sortCache.set(spec.viz.cues, s);
  }
  return s;
}

/** Every preset the programme can show (cue presets + blasts). */
export function programmePresetIds(spec: ClipSpec): string[] {
  const ids = new Set<string>();
  for (const c of spec.viz.cues) {
    ids.add(c.presetId);
    if (c.transition?.kind === 'blast' && c.transition.presetId) ids.add(c.transition.presetId);
  }
  return [...ids];
}

/** Per-frame programme state for `drawRoutineFrame` callers (clip second `s`). */
export function programmeFrame(spec: ClipSpec, s: number, durationSec: number): {
  look: ClipLook; fade: number; impact: { kind: VizImpact; age: number } | null; overlay: ProgrammeOverlay | null;
} {
  return { look: lookAt(spec, s), fade: fadeGainAt(spec, s, durationSec), impact: impactAt(spec, s), overlay: overlayAt(spec, s) };
}

/** Short timeline / list badge per transition kind. */
export function transitionBadge(tr: CueTransition | undefined): string {
  if (!tr || tr.kind === 'crossfade') return '';
  if (tr.kind === 'vfx') return (tr.vfx ?? 'rgb').toUpperCase();
  if (tr.kind === 'solo') return `SOLO ${tr.deck ?? ''}`.trim();
  return tr.kind.toUpperCase();
}
