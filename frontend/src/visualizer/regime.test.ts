import { describe, expect, it } from 'vitest';
import { INITIAL_REGIME, regimeSignal, stepRegime } from './regime';
import type { RegimeState } from './regime';
import type { BandLevels } from './bands';

const DT = 1 / 60;
const quiet: BandLevels = { low: 0.05, mid: 0.05, high: 0.03 };
const groove: BandLevels = { low: 0.6, mid: 0.4, high: 0.3 };
const riser = (t: number): BandLevels => ({
  low: 0.1,
  mid: 0.2 + 0.5 * t,
  high: 0.15 + 0.55 * t,
});

function run(state: RegimeState, bands: (t: number) => BandLevels, seconds: number) {
  let s = state;
  for (let t = 0; t < seconds; t += DT) s = stepRegime(s, bands(t / seconds), DT);
  return s;
}

describe('stepRegime', () => {
  it('stays silent on quiet input', () => {
    const s = run(INITIAL_REGIME, () => quiet, 10);
    const sig = regimeSignal(s);
    expect(sig.buildup).toBeLessThan(0.15);
    expect(sig.dropTransition).toBe(0);
    expect(sig.breakdown).toBeLessThan(0.15);
  });

  it('a rising mid/high ramp reads as buildup', () => {
    let s = run(INITIAL_REGIME, () => quiet, 5);
    s = run(s, riser, 8);
    expect(regimeSignal(s).buildup).toBeGreaterThan(0.4);
  });

  it('a primed buildup landing on heavy bass fires dropTransition once', () => {
    let s = run(INITIAL_REGIME, () => quiet, 5);
    s = run(s, riser, 8);
    expect(regimeSignal(s).dropTransition).toBeLessThan(0.2);
    s = stepRegime(s, groove, DT);
    const sig = regimeSignal(s);
    expect(sig.dropTransition).toBeGreaterThan(0.5);
    expect(sig.dropAgeS).toBeLessThan(0.1);
    // decays over the plateau
    const later = run(s, () => groove, 6);
    expect(regimeSignal(later).dropTransition).toBeLessThan(0.25);
  });

  it('a bass slam without priming does NOT fire dropTransition', () => {
    let s = run(INITIAL_REGIME, () => quiet, 10);
    s = stepRegime(s, groove, DT);
    expect(regimeSignal(s).dropTransition).toBeLessThan(0.2);
  });

  it('sustained rises on a plateau and holds', () => {
    let s = run(INITIAL_REGIME, () => quiet, 5);
    s = run(s, () => groove, 8);
    expect(regimeSignal(s).sustained).toBeGreaterThan(0.5);
  });

  it('breakdown fires when a loud baseline goes quiet', () => {
    let s = run(INITIAL_REGIME, () => groove, 15);
    s = run(s, () => quiet, 4);
    expect(regimeSignal(s).breakdown).toBeGreaterThan(0.4);
  });

  it('drops rate-limit: no double fire within 4s', () => {
    let s = run(INITIAL_REGIME, () => quiet, 5);
    s = run(s, riser, 8);
    s = stepRegime(s, groove, DT);
    expect(regimeSignal(s).dropAgeS).toBeLessThan(0.1);
    // stay primed artificially and slam again immediately
    let s2 = { ...s, primed: 1, riser: 1 };
    s2 = run(s2, () => groove, 1);
    expect(regimeSignal(s2).dropAgeS).toBeGreaterThan(0.5); // no re-fire
  });
});
