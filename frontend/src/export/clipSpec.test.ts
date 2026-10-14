import { describe, expect, it } from 'vitest';
import { defaultClipSpec, fadeGainAt, impactAt, lookAfterCue, lookAt, overlayAt, programmePresetIds, vizAt, type VizCue } from './clipSpec';

describe('clipSpec', () => {
  const spec = defaultClipSpec({ kind: 'routine', uuid: 'r' });
  it('fades ramp linearly at both ends', () => {
    const s = { ...spec, fadeInSec: 1, fadeOutSec: 2 };
    expect(fadeGainAt(s, 0, 10)).toBe(0);
    expect(fadeGainAt(s, 0.5, 10)).toBeCloseTo(0.5);
    expect(fadeGainAt(s, 5, 10)).toBe(1);
    expect(fadeGainAt(s, 9, 10)).toBeCloseTo(0.5);
    expect(fadeGainAt(s, 10, 10)).toBe(0);
  });
  it('programme cues crossfade in order', () => {
    const s = { ...spec, viz: { cues: [{ atSec: 0, presetId: 'voyage' }, { atSec: 30, presetId: 'nova' }], crossfadeSec: 2 } };
    expect(vizAt(s, 10)).toMatchObject({ presetId: 'voyage', from: null, mix: 1 });
    expect(vizAt(s, 31)).toMatchObject({ presetId: 'nova', from: 'voyage', mix: 0.5 });
    expect(vizAt(s, 40)).toMatchObject({ presetId: 'nova', from: null, mix: 1 });
  });
  it('impact-only cues keep the running preset without a crossfade', () => {
    const s = { ...spec, viz: { cues: [
      { atSec: 0, presetId: 'voyage' },
      { atSec: 30, presetId: 'nova', impact: 'shockwave' as const },
      { atSec: 50, presetId: 'nova', impact: 'flash' as const },
    ], crossfadeSec: 2 } };
    expect(vizAt(s, 50.5)).toMatchObject({ presetId: 'nova', from: null, mix: 1 });
    expect(vizAt(s, 31)).toMatchObject({ presetId: 'nova', from: 'voyage', mix: 0.5 });
    expect(impactAt(s, 31)).toEqual({ kind: 'shockwave', age: 1 });
    expect(impactAt(s, 52)).toEqual({ kind: 'flash', age: 2 });
    expect(impactAt(s, 10)).toBeNull();
  });
  describe('keyframes (r4)', () => {
    const withCues = (cues: VizCue[]) => ({ ...spec, look: { ...spec.look, glow: 0.2, composite: 'cards' as const, showTicker: true }, viz: { cues, crossfadeSec: 2 } });
    it('look overrides persist from their cue; numeric fields blend over a crossfade, enums switch', () => {
      const s = withCues([
        { atSec: 0, presetId: 'voyage' },
        { atSec: 10, presetId: 'nova', look: { glow: 1, composite: 'screen' } },
        { atSec: 20, presetId: 'voyage', look: { showTicker: false } },
      ]);
      expect(lookAt(s, 5).glow).toBe(0.2);
      expect(lookAt(s, 11).glow).toBeCloseTo(0.6);
      expect(lookAt(s, 10.01).composite).toBe('screen');
      expect(lookAt(s, 30)).toMatchObject({ glow: 1, composite: 'screen', showTicker: false });
      expect(lookAfterCue(s, 1)).toMatchObject({ glow: 1, showTicker: true });
      const plain = withCues([{ atSec: 0, presetId: 'voyage' }]);
      expect(lookAt(plain, 5)).toBe(plain.look);
    });
    it('cut transitions switch presets and looks instantly', () => {
      const s = withCues([
        { atSec: 0, presetId: 'voyage' },
        { atSec: 10, presetId: 'nova', look: { glow: 1 }, transition: { kind: 'cut' } },
      ]);
      expect(vizAt(s, 10.1)).toMatchObject({ presetId: 'nova', from: null, mix: 1 });
      expect(lookAt(s, 10.1).glow).toBe(1);
    });
    it('a crossfade can carry its own length', () => {
      const s = withCues([{ atSec: 0, presetId: 'voyage' }, { atSec: 10, presetId: 'nova', transition: { kind: 'crossfade', durationSec: 8 } }]);
      expect(vizAt(s, 12).mix).toBeCloseTo(0.25);
    });
    it('held transitions run before or after their cue and hand back', () => {
      const s = withCues([
        { atSec: 0, presetId: 'voyage' },
        { atSec: 10, presetId: 'nova', transition: { kind: 'blackout', durationSec: 2 } },
        { atSec: 30, presetId: 'nova', transition: { kind: 'blast', durationSec: 4, presetId: 'aurora' } },
        { atSec: 50, presetId: 'nova', transition: { kind: 'solo', durationSec: 4, placement: 'before', deck: 'B' } },
      ]);
      expect(overlayAt(s, 7.9)).toBeNull();
      expect(overlayAt(s, 9)).toMatchObject({ kind: 'blackout', age: 1, remaining: 1 });
      expect(overlayAt(s, 10)).toBeNull();
      expect(vizAt(s, 10.05)).toMatchObject({ presetId: 'nova', from: null });
      expect(overlayAt(s, 33)).toMatchObject({ kind: 'blast', presetId: 'aurora' });
      expect(overlayAt(s, 34)).toBeNull();
      expect(overlayAt(s, 47)).toMatchObject({ kind: 'solo', deck: 'B', startSec: 46 });
      expect(programmePresetIds(s).sort()).toEqual(['aurora', 'nova', 'voyage']);
    });
  });
});
