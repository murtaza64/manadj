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
const LIGHT_SLIDERS: [NumKey, string, number, number, number][] = [
  ['vizOpacity', 'Visualizer', 0, 1, 0.05], ['vizDim', 'Darken', 0, 1, 0.05], ['vignette', 'Vignette', 0, 1, 0.05], ['glow', 'Glow', 0, 1, 0.05],
];
const MOTION_SLIDERS: [NumKey, string, number, number, number][] = [
  ['beatPulse', 'Zoom pulse', 0, 1, 0.05], ['impactStrength', 'Impacts', 0, 1, 0.05], ['buildUp', 'Build-up', 0, 1, 0.05], ['waveZoomSec', 'Wave span s', 2, 16, 0.5],
];
const RESPONSE_SLIDERS: [NumKey, string, number, number, number][] = [
  ['hudAmount', 'Controls', 0, 2, 0.05], ['wavePulse', 'Waveforms', 0, 1, 0.05], ['dropBoost', 'Drop boost', 0, 2, 0.05],
];
type BoolKey = 'showKnobs' | 'showTitles' | 'showPlayhead' | 'showCues' | 'showGrid' | 'showTicker' | 'titleCards' | 'revealAtDrop' | 'phraseCountdown' | 'showHeader' | 'showFxPanel' | 'showFooter' | 'showWordmark';
const OVERLAYS: [BoolKey, string][] = [
  ['showTitles', 'Titles'], ['revealAtDrop', 'ID until drop'], ['titleCards', 'Title cards'],
  ['showKnobs', 'Mixer'], ['showTicker', 'Action pills'], ['phraseCountdown', 'Countdown'],
  ['showPlayhead', 'Playhead'], ['showCues', 'Cue flags'], ['showGrid', 'Beat grid'],
  ['showHeader', 'Top bar'], ['showFxPanel', 'FX strip'], ['showFooter', 'Footer'], ['showWordmark', 'Wordmark'],
];
const LAYOUTS = ['stack', 'side', 'grid', 'spotlight', 'vertical', 'mirror'] as const;
const VIEWS = ['wave', 'bars', 'ring', 'none'] as const;
const FONTS: { id: ClipLook['fontFace']; label: string; family: string }[] = [
  { id: 'sf', label: 'SF Pro', family: 'system-ui, -apple-system, sans-serif' },
  { id: 'avenir', label: 'Avenir', family: '"Avenir Next", Avenir, sans-serif' },
  { id: 'newyork', label: 'New York', family: '"New York", ui-serif, Georgia, serif' },
  { id: 'mono', label: 'Mono', family: 'var(--font-mono, monospace)' },
];
const CONTROL_PALETTES = ['classic', 'deck', 'neon', 'fire', 'ice', 'mono'] as const;
const CONTROL_SWATCH: Record<(typeof CONTROL_PALETTES)[number], string> = {
  classic: 'linear-gradient(90deg, #ff2d2d, #2dff6a, #3d6aff, #00ffc4)',
  deck: `linear-gradient(90deg, ${DECK_COLORS.A}, ${DECK_COLORS.B}, ${DECK_COLORS.C})`,
  neon: 'linear-gradient(90deg, #ff00aa, #00ffff, #ffff00)',
  fire: 'linear-gradient(90deg, #ff1a00, #ff7a00, #ffd000)',
  ice: 'linear-gradient(90deg, #1e5bff, #00c8ff, #b8f6ff)',
  mono: 'linear-gradient(90deg, #777, #fff)',
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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
  const ovr = (...keys: (keyof ClipLook)[]) => (has(...keys) ? ' lk-ovr' : '');
  const ovrX = (...keys: (keyof ClipLook)[]) => (has(...keys) && onClear
    ? <button className="lk-ovr-x" title="Clear this scene's change (inherit)" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClear(keys); }}>×</button>
    : null);
  const count = (keys: (keyof ClipLook)[]) => (overrides ? keys.filter((k) => k in overrides).length : 0);
  /** Card: a titled group; in scene scope the title counts this scene's changes. */
  const card = (title: string, keys: (keyof ClipLook)[], content: ReactNode, cls = '') => (
    <section className={`lk-card ${cls}`}>
      <h5>{title}{count(keys) > 0 && <span className="lk-count">{count(keys)}</span>}</h5>
      {content}
    </section>
  );
  /** Labelled segmented control. */
  const seg = <K extends keyof ClipLook>(key: K, label: string, options: readonly { id: ClipLook[K]; label: ReactNode; title?: string }[]) => (
    <div className={`lk-row${ovr(key)}`}>
      <span className="lk-label">{label}{ovrX(key)}</span>
      <div className={`lk-seg${options.length > 4 ? ' lk-seg-grid' : ''}`}>
        {options.map((o) => (
          <button key={String(o.id)} title={o.title} className={look[key] === o.id ? 'on' : ''} onClick={() => onChange({ [key]: o.id } as Partial<ClipLook>)}>{o.label}</button>
        ))}
      </div>
    </div>
  );
  const slider = ([k, label, min, max, step]: [NumKey, string, number, number, number]) => {
    const pct = ((look[k] - min) / (max - min)) * 100;
    return (
      <label key={k} className={`lk-row lk-slider${ovr(k)}`}>
        <span className="lk-label">{label}{ovrX(k)}</span>
        <input type="range" min={min} max={max} step={step} value={look[k]} style={{ ['--p' as string]: `${pct}%` }}
          onChange={(e) => onChange({ [k]: Number(e.target.value) } as Partial<ClipLook>)} />
        <span className="lk-val">{look[k].toFixed(k === 'waveZoomSec' ? 1 : 2)}</span>
      </label>
    );
  };
  const opt = <T extends string>(ids: readonly T[]) => ids.map((id) => ({ id, label: cap(id) }));
  return (
    <div className="lk">
      <section className="lk-styles">
        <span className="lk-label">Styles</span>
        <div className="lk-chips">
          {LOOK_PRESETS.map((p) => <button key={p.id} title={p.title} onClick={() => onChange(p.look)}>{p.label}</button>)}
        </div>
      </section>
      <div className="lk-cols">
        <div className="lk-col">
          {card('Decks', ['deckLayout', 'deckView', 'laneFrame', 'deckVisibility'], <>
            {seg('deckLayout', 'Layout', opt(LAYOUTS))}
            {seg('deckView', 'View', VIEWS.map((id) => ({ id, label: id === 'none' ? 'Viz' : cap(id), title: id === 'none' ? 'Visualizer only (lower third)' : undefined })))}
            {seg('laneFrame', 'Lanes', [{ id: 'bare', label: 'Full-bleed' }, { id: 'cards', label: 'Cards' }])}
            {seg('deckVisibility', 'Show', [{ id: 'audible', label: 'Audible' }, { id: 'all', label: 'All decks' }])}
          </>)}
          {card('Waveform', ['composite', 'wavePalette'], <>
            <div className={`lk-row lk-stack${ovr('composite')}`}>
              <span className="lk-label">Blend{ovrX('composite')}</span>
              <div className="lk-seg lk-seg-wrap">
                {COMPOSITES.map((c) => <button key={c.id} title={c.title} className={look.composite === c.id ? 'on' : ''} onClick={() => onChange({ composite: c.id })}>{cap(c.label.toLowerCase())}</button>)}
              </div>
            </div>
            <div className={`lk-row lk-stack${ovr('wavePalette')}`}>
              <span className="lk-label">Palette{ovrX('wavePalette')}</span>
              <div className="lk-swatches">
                {PALETTES.map((p) => (
                  <button key={p} title={p} className={look.wavePalette === p ? 'on' : ''} onClick={() => onChange({ wavePalette: p })}>
                    <i style={{ background: paletteSwatch(p) }} />{cap(p)}
                  </button>
                ))}
              </div>
            </div>
          </>)}
          {card('Type & controls', ['fontFace', 'controlStyle', 'levelStyle', 'controlPalette'], <>
            {seg('fontFace', 'Font', FONTS.map((f) => ({ id: f.id, label: <span style={{ fontFamily: f.family }}>{f.label}</span> })))}
            {seg('controlStyle', 'Controls', opt(['knobs', 'sliders'] as const))}
            {seg('levelStyle', 'Meters', [{ id: 'bar', label: 'Bar' }, { id: 'segments', label: 'LED' }])}
            <div className={`lk-row lk-stack${ovr('controlPalette')}`}>
              <span className="lk-label">Colours{ovrX('controlPalette')}</span>
              <div className="lk-swatches">
                {CONTROL_PALETTES.map((p) => (
                  <button key={p} className={look.controlPalette === p ? 'on' : ''} onClick={() => onChange({ controlPalette: p })}>
                    <i style={{ background: CONTROL_SWATCH[p] }} />{cap(p)}
                  </button>
                ))}
              </div>
            </div>
          </>)}
        </div>
        <div className="lk-col">
          {card('Light', ['vizOpacity', 'vizDim', 'vignette', 'glow'], LIGHT_SLIDERS.map(slider))}
          {card('Motion', ['beatPulse', 'impactStrength', 'buildUp', 'waveZoomSec', 'hudSource', 'hudAmount', 'wavePulse', 'dropBoost'], <>
            {MOTION_SLIDERS.map(slider)}
            {seg('hudSource', 'Pulse from', HUD_SOURCES.map((h) => ({ id: h.id, label: h.label === 'BEAT×ENERGY' ? 'Mixed' : cap(h.label.toLowerCase()), title: h.title })))}
            {RESPONSE_SLIDERS.map(slider)}
          </>)}
          {card('Overlays', [...OVERLAYS.map(([k]) => k), 'infoShade'], <>
            <div className="lk-toggles">
              {OVERLAYS.map(([k, label]) => (
                <button key={k} className={`lk-toggle${look[k] ? ' on' : ''}${ovr(k)}`} onClick={() => onChange({ [k]: !look[k] } as Partial<ClipLook>)}>
                  {label}{ovrX(k)}
                </button>
              ))}
            </div>
            {slider(['infoShade', 'Info scrim', 0, 1, 0.05])}
          </>)}
          {card('Text', ['accent', 'caption'], <>
            <div className={`lk-row${ovr('accent', 'caption')}`}>
              <span className="lk-label">Caption{ovrX('caption')}</span>
              <input className="lk-input" type="text" placeholder="@dj.reroll" value={look.caption} onChange={(e) => { onChange({ caption: e.target.value }); onCaption?.(e.target.value); }} />
              <input className="lk-color" type="color" title="Accent" value={look.accent} onChange={(e) => onChange({ accent: e.target.value })} />
            </div>
            {children}
          </>)}
        </div>
      </div>
    </div>
  );
}
