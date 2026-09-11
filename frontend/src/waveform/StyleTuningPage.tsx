import { useState } from 'react';
import type { CSSProperties } from 'react';
import { SettingsDeckPreview } from '../settings/SettingsDeckPreview';
import { AutoBlurSelect } from '../components/AutoBlurSelect';
import { STYLE_REGISTRY, getStyle } from './styles';
import type { RGB, StyleParams } from './styles';

const rgbToHex = ([r, g, b]: RGB) =>
  '#' + [r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
const hexToRgb = (hex: string): RGB => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];
import { resetSlots, setSlot, useStyleSlot } from './styleSlots';
import type { SlotName } from './styleSlots';
import './styleTuning.css';

export default function StyleTuningPage() {
  const [editedSlot, setEditedSlot] = useState<SlotName>('full');
  const slot = useStyleSlot(editedSlot);

  const patch = (params: Partial<StyleParams>) => setSlot(editedSlot, { params });
  const p = slot.params;
  const colors = p.colors ?? getStyle(slot.styleId).defaultColors;

  const slider = (
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    set: (v: number) => void,
    bandColor?: RGB,
  ) => (
    <label className={`tune-slider${bandColor ? ' tune-band-gain' : ''}`} key={label}
      style={bandColor ? { '--waveform-band': rgbToHex(bandColor) } as CSSProperties : undefined}>
      <span>
        {label}: <span className="val">{value.toFixed(2)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => set(Number(e.target.value))}
      />
    </label>
  );

  return (
    <div className="tune-page">
      <div className="settings-section-heading">
        <div><h2>Waveforms</h2><p>Set the full waveform and minimap independently. Changes repaint every surface live.</p></div>
        <button className="btn btn-secondary" onClick={() => resetSlots()}>
          Reset waveform defaults
        </button>
      </div>
      <SettingsDeckPreview />

      <div className="tune-controls">
        <div className="tune-slot-row">
          <span>editing slot:</span>
          {(['full', 'minimap'] as const).map((name) => (
            <label key={name}>
              <input
                type="radio"
                checked={editedSlot === name}
                onChange={() => setEditedSlot(name)}
              />
              {name}
            </label>
          ))}
           <AutoBlurSelect aria-label="Waveform color style"
            value={slot.styleId}
            onChange={(e) => setSlot(editedSlot, { styleId: e.target.value })}
          >
            {STYLE_REGISTRY.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
           </AutoBlurSelect>
          <label>
            <input
              type="checkbox"
              checked={p.smooth}
              onChange={(e) => patch({ smooth: e.target.checked })}
            />
            smooth color
          </label>
        </div>
        <div className="tune-sliders">
          {slider('display gamma', p.displayGamma, 0.25, 2.5, 0.05, (v) => patch({ displayGamma: v }))}
          {slider('master', p.master, 0.2, 3, 0.02, (v) => patch({ master: v }))}
          {slider('low gain', p.gains[0], 0, 3, 0.05, (v) => patch({ gains: [v, p.gains[1], p.gains[2]] }), colors[0])}
          {slider('mid gain', p.gains[1], 0, 3, 0.05, (v) => patch({ gains: [p.gains[0], v, p.gains[2]] }), colors[1])}
          {slider('high gain', p.gains[2], 0, 3, 0.05, (v) => patch({ gains: [p.gains[0], p.gains[1], v] }), colors[2])}
          {slider('low/mid boundary (band)', p.b1, 1, 7, 1, (v) => patch({ b1: v, b2: Math.max(p.b2, v + 1) }))}
          {slider('mid/high boundary (band)', p.b2, 2, 8, 1, (v) => patch({ b2: v, b1: Math.min(p.b1, v - 1) }))}
          {slider('core whiteness', p.coreWhite, 0, 1, 0.02, (v) => patch({ coreWhite: v }))}
          {slider('core bloom', p.coreBloom, 0, 1, 0.02, (v) => patch({ coreBloom: v }))}
          {(['low', 'mid', 'high'] as const).map((band, i) => {
            const current = colors;
            return (
              <label className="tune-slider" key={band}>
                <span>{band} color</span>
                <input
                  type="color"
                  value={rgbToHex(current[i])}
                  onChange={(e) => {
                    const next = [...current] as [RGB, RGB, RGB];
                    next[i] = hexToRgb(e.target.value);
                    patch({ colors: next });
                  }}
                />
              </label>
            );
          })}
          <label className="tune-slider">
            <span>&nbsp;</span>
            <button
              className="btn btn-secondary"
              disabled={p.colors === null}
              onClick={() => patch({ colors: null })}
            >
              style default colors
            </button>
          </label>
        </div>
      </div>
      <p className="tune-hint">
        Band edges: 20 / 60 / 150 / 400 / 1k / 2.5k / 6k / 12k / 20k Hz.
      </p>
    </div>
  );
}
