import { describe, expect, it } from 'vitest';
import { defaultClipSpec } from './clipSpec';
import { presetOnScreen } from './presetOnScreen';

describe('presetOnScreen', () => {
  const base = defaultClipSpec({ kind: 'routine', uuid: 'r' });
  const spec = { ...base, viz: { crossfadeSec: 2, cues: [
    { atSec: 0, presetId: 'voyage', params: { speed: 0.3 } },
    { atSec: 30, presetId: 'nova', transition: { kind: 'blast' as const, presetId: 'g07-x', durationSec: 4, placement: 'after' as const } },
  ] } };
  it('is the scene in force, with its params', () => {
    expect(presetOnScreen(spec, 10)).toEqual({ presetId: 'voyage', params: { speed: 0.3 } });
  });
  it('is the blast preset while a blast runs, then the scene', () => {
    expect(presetOnScreen(spec, 31)).toEqual({ presetId: 'g07-x' });
    expect(presetOnScreen(spec, 40)?.presetId).toBe('nova');
  });
});
