/**
 * The clip look editor (#377 r5), shared by BASE LOOK (the clip's look) and
 * the scene inspector (one cue's keyframe changes). In scene scope
 * `overrides` marks the fields this scene changes (magenta, × = inherit).
 */
import type { ReactNode } from 'react';
import type { ClipLook, WaveComposite, WavePalette } from './clipSpec';
import { paletteColors } from './routineVideoScene';
import { DECK_COLORS } from '../theme/deckColors';
import { LOOK_PRESETS } from './lookOptions';

const PALETTES: WavePalette[] = ['deck', 'style', 'neon', 'fire', 'ice', 'mono'];
const COMPOSITES: { id: WaveComposite; label: string; title: string }[] = [
  { id: 'cards', label: 'SOLID', title: 'Waveforms drawn solid over the visualizer' },
  { id: 'mask', label: 'WINDOW', title: 'The waveform is a window onto the visualizer' },
  { id: 'screen', label: 'LIGHT', title: 'Waveforms add as light over the visualizer' },
  { id: 'negative', label: 'NEGATIVE', title: 'The waveform imprints a negative: the visualizer inverts inside it' },
  { id: 'cutout', label: 'CUTOUT', title: 'The waveform punches a black hole in the visualizer, rimmed in its colors' },
  { id: 'tint', label: 'TINT', title: 'The waveform recolors the visualizer: deck hue, preset light' },
  { id: 'stage', label: 'STAGE', title: 'One shared stage: every deck overlaid' },
];
const HUD_SOURCES: { id: ClipLook['hudSource']; label: string; title: string }[] = [
  { id: 'beat-energy', label: 'BEAT×ENERGY', title: 'Beat envelope scaled by bass and energy' },
  { id: 'beat', label: 'BEAT', title: 'Pure beat envelope (dominant track grid)' },
  { id: 'energy', label: 'ENERGY', title: 'Follows the audible level, no beat shape' },
  { id: 'bass', label: 'BASS', title: 'Follows the low band, beat-shaped' },
  { id: 'off', label: 'OFF', title: 'Controls stay still' },
];
type NumKey = 'glow' | 'vizOpacity' | 'vizDim' | 'vignette' | 'infoShade' | 'beatPulse' | 'impactStrength' | 'waveZoomSec' | 'hudAmount' | 'wavePulse' | 'dropBoost' | 'buildUp';
const VIZ_SLIDERS: [NumKey, string, number, number, number][] = [
  ['vizOpacity', 'visualizer', 0, 1, 0.05], ['vizDim', 'darken', 0, 1, 0.05], ['vignette', 'vignette', 0, 1, 0.05], ['glow', 'glow', 0, 1, 0.05],
];
const MOTION_SLIDERS: [NumKey, string, number, number, number][] = [
  ['beatPulse', 'zoom pulse', 0, 1, 0.05], ['impactStrength', 'impacts', 0, 1, 0.05], ['waveZoomSec', 'wave zoom s', 2, 16, 0.5], ['infoShade', 'controls shade', 0, 1, 0.05], ['buildUp', 'build-up', 0, 1, 0.05],
];
const RESPONSE_SLIDERS: [NumKey, string, number, number, number][] = [
  ['hudAmount', 'controls', 0, 2, 0.05], ['wavePulse', 'waveforms', 0, 1, 0.05], ['dropBoost', 'drop boost', 0, 2, 0.05],
];
type BoolKey = 'showKnobs' | 'showTitles' | 'showPlayhead' | 'showCues' | 'showGrid' | 'showTicker' | 'titleCards' | 'revealAtDrop' | 'phraseCountdown' | 'showHeader' | 'showFxPanel' | 'showFooter' | 'showWordmark';
const OVERLAYS: [BoolKey, string][] = [
  ['showKnobs', 'mixer row'], ['showTitles', 'track titles'], ['showPlayhead', 'playhead'], ['showCues', 'hot cue flags'],
  ['showTicker', 'action pills'], ['titleCards', 'title cards'], ['revealAtDrop', 'titles at drop'], ['phraseCountdown', 'drop countdown'],
  ['showGrid', 'beat grid'], ['showHeader', 'top bar'], ['showFxPanel', 'beat fx strip'], ['showFooter', 'footer'], ['showWordmark', 'manaDJ mark'],
];

function paletteSwatch(p: WavePalette): string {
  if (p === 'style') return 'var(--surface1)';
  if (p === 'deck') return `linear-gradient(90deg, ${DECK_COLORS.A}, ${DECK_COLORS.B}, ${DECK_COLORS.C}, ${DECK_COLORS.D})`;
  const c = paletteColors(p, 'A')!.map(([r, g, b]) => `rgb(${r * 255}, ${g * 255}, ${b * 255})`);
  return `linear-gradient(90deg, ${c.join(', ')})`;
}

interface Props {
  look: ClipLook;
  onChange: (patch: Partial<ClipLook>) => void;
  /** Scene scope: the fields this scene changes. */
  overrides?: Partial<ClipLook> | null;
  onClear?: (keys: (keyof ClipLook)[]) => void;
  onCaption?: (caption: string) => void;
  /** Extra fields under the text row (BASE LOOK: file name). */
  children?: ReactNode;
}

export function LookControls({ look, onChange, overrides, onClear, onCaption, children }: Props) {
  const has = (...keys: (keyof ClipLook)[]) => !!overrides && keys.some((k) => k in overrides);
  const ovr = (...keys: (keyof ClipLook)[]) => (has(...keys) ? ' ce-ovr' : '');
  const ovrX = (...keys: (keyof ClipLook)[]) => (has(...keys) && onClear
    ? <button className="ce-ovr-x" title="Clear this scene's change (inherit)" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClear(keys); }}>×</button>
    : null);
  const slider = ([k, label, min, max, step]: [NumKey, string, number, number, number]) => (
    <label key={k} className={ovr(k).trim()}><span>{label}{ovrX(k)}</span>
      <input type="range" min={min} max={max} step={step} value={look[k]} onChange={(e) => onChange({ [k]: Number(e.target.value) } as Partial<ClipLook>)} />
      <span className="ce-val">{look[k].toFixed(k === 'waveZoomSec' ? 1 : 2)}</span>
    </label>
  );
  return (
    <>
      <section className="ce-group">
        <h4>Styles <span className="ce-muted">{overrides ? 'apply to this scene' : 'apply to the clip'}</span></h4>
        <div className="ce-chips">
          {LOOK_PRESETS.map((p) => <button key={p.id} className="btn btn-mini" title={p.title} onClick={() => onChange(p.look)}>{p.label}</button>)}
        </div>
      </section>
      <section className="ce-group">
        <h4>Waveforms</h4>
        <div className={`ce-seg${ovr('composite')}`}>
          {ovrX('composite')}
          {COMPOSITES.map((c) => <button key={c.id} title={c.title} className={`btn btn-mini${look.composite === c.id ? ' btn-selected' : ''}`} onClick={() => onChange({ composite: c.id })}>{c.label}</button>)}
        </div>
        <div className={`ce-swatches${ovr('wavePalette')}`}>
          {ovrX('wavePalette')}
          {PALETTES.map((p) => (
            <button key={p} className={`ce-swatch${look.wavePalette === p ? ' ce-swatch-on' : ''}`} onClick={() => onChange({ wavePalette: p })} title={p}>
              <span style={{ background: paletteSwatch(p) }} />{p.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="ce-seg">
          <span className={`ce-seg${ovr('laneFrame')}`}>
            {ovrX('laneFrame')}
            <span className="ce-muted">lanes</span>
            {(['bare', 'cards'] as const).map((v) => <button key={v} className={`btn btn-mini${look.laneFrame === v ? ' btn-selected' : ''}`} onClick={() => onChange({ laneFrame: v })}>{v === 'bare' ? 'FULL-BLEED' : 'CARDS'}</button>)}
          </span>
          <span className={`ce-seg${ovr('deckVisibility')}`}>
            {ovrX('deckVisibility')}
            <span className="ce-muted">decks</span>
            {(['audible', 'all'] as const).map((v) => <button key={v} className={`btn btn-mini${look.deckVisibility === v ? ' btn-selected' : ''}`} onClick={() => onChange({ deckVisibility: v })}>{v.toUpperCase()}</button>)}
          </span>
        </div>
        <div className="ce-seg">
          <span className={`ce-seg${ovr('deckLayout')}`}>
            {ovrX('deckLayout')}
            <span className="ce-muted">layout</span>
            {(['stack', 'side', 'grid', 'spotlight', 'vertical', 'mirror'] as const).map((v) => <button key={v} className={`btn btn-mini${look.deckLayout === v ? ' btn-selected' : ''}`} onClick={() => onChange({ deckLayout: v })}>{v.toUpperCase()}</button>)}
          </span>
          <span className={`ce-seg${ovr('deckView')}`}>
            {ovrX('deckView')}
            <span className="ce-muted">view</span>
            {(['wave', 'bars', 'ring', 'none'] as const).map((v) => <button key={v} className={`btn btn-mini${look.deckView === v ? ' btn-selected' : ''}`} onClick={() => onChange({ deckView: v })}>{v.toUpperCase()}</button>)}
          </span>
        </div>
        <div className="ce-seg">
          <span className={`ce-seg${ovr('fontFace')}`}>
            {ovrX('fontFace')}
            <span className="ce-muted">font</span>
            {(['mono', 'sf', 'avenir', 'newyork'] as const).map((v) => <button key={v} className={`btn btn-mini${look.fontFace === v ? ' btn-selected' : ''}`} onClick={() => onChange({ fontFace: v })}>{v.toUpperCase()}</button>)}
          </span>
        </div>
        <div className="ce-seg">
          <span className={`ce-seg${ovr('controlStyle')}`}>
            {ovrX('controlStyle')}
            <span className="ce-muted">controls</span>
            {(['knobs', 'sliders'] as const).map((v) => <button key={v} className={`btn btn-mini${look.controlStyle === v ? ' btn-selected' : ''}`} onClick={() => onChange({ controlStyle: v })}>{v.toUpperCase()}</button>)}
          </span>
          <span className={`ce-seg${ovr('levelStyle')}`}>
            {ovrX('levelStyle')}
            <span className="ce-muted">levels</span>
            {(['bar', 'segments'] as const).map((v) => <button key={v} className={`btn btn-mini${look.levelStyle === v ? ' btn-selected' : ''}`} onClick={() => onChange({ levelStyle: v })}>{v.toUpperCase()}</button>)}
          </span>
        </div>
        <div className="ce-seg">
          <span className={`ce-seg${ovr('controlPalette')}`}>
            {ovrX('controlPalette')}
            <span className="ce-muted">control colours</span>
            {(['classic', 'deck', 'neon', 'fire', 'ice', 'mono'] as const).map((v) => <button key={v} className={`btn btn-mini${look.controlPalette === v ? ' btn-selected' : ''}`} onClick={() => onChange({ controlPalette: v })}>{v.toUpperCase()}</button>)}
          </span>
        </div>
      </section>
      <section className="ce-group">
        <h4>Visualizer</h4>
        <div className="ce-sliders">{VIZ_SLIDERS.map(slider)}</div>
      </section>
      <section className="ce-group">
        <h4>Overlays</h4>
        <div className="ce-checks">
          {OVERLAYS.map(([k, label]) => (
            <label key={k} className={`ce-check${ovr(k)}`}>{ovrX(k)}<input type="checkbox" checked={look[k]} onChange={(e) => onChange({ [k]: e.target.checked } as Partial<ClipLook>)} />{label}</label>
          ))}
        </div>
      </section>
      <section className="ce-group">
        <h4>Motion</h4>
        <div className="ce-sliders">{MOTION_SLIDERS.map(slider)}</div>
      </section>
      <section className="ce-group">
        <h4>Response <span className="ce-muted">how the controls and waves breathe</span></h4>
        <div className={`ce-seg${ovr('hudSource')}`}>
          {ovrX('hudSource')}
          {HUD_SOURCES.map((h) => <button key={h.id} title={h.title} className={`btn btn-mini${look.hudSource === h.id ? ' btn-selected' : ''}`} onClick={() => onChange({ hudSource: h.id })}>{h.label}</button>)}
        </div>
        <div className="ce-sliders">{RESPONSE_SLIDERS.map(slider)}</div>
      </section>
      <section className="ce-group">
        <h4>Text</h4>
        <div className="ce-fields">
          <label className={ovr('accent').trim()}>accent{ovrX('accent')}<input type="color" value={look.accent} onChange={(e) => onChange({ accent: e.target.value })} /></label>
          <label className={`ce-wide${ovr('caption')}`}>handle / caption{ovrX('caption')}<input type="text" placeholder="@dj.reroll" value={look.caption} onChange={(e) => { onChange({ caption: e.target.value }); onCaption?.(e.target.value); }} /></label>
          {children}
        </div>
      </section>
    </>
  );
}
