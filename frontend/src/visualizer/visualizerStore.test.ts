import { describe, expect, it } from 'vitest';
import { getParamValues, setParamValue, resetParams } from './visualizerStore';
import { presetById } from './presets';

describe('preset param store', () => {
  it('resolves declared defaults, applies sets, and clamps', () => {
    const voyage = presetById('voyage');
    resetParams('voyage');
    const defaults = getParamValues(voyage);
    expect(defaults.palette).toBe(1);
    expect(defaults.dust).toBe(1);

    setParamValue('voyage', 'palette', 3);
    expect(getParamValues(voyage).palette).toBe(3);
    // New object per change (render loop and useSyncExternalStore rely on it).
    expect(getParamValues(voyage)).not.toBe(defaults);

    setParamValue('voyage', 'dust', 99);
    // setParamValue stores raw; resolveParams clamps on reload — live value
    // is what the slider sent (sliders already bound to min/max).
    expect(getParamValues(voyage).dust).toBe(99);
    resetParams('voyage');
    expect(getParamValues(voyage).dust).toBe(1);
  });
});
