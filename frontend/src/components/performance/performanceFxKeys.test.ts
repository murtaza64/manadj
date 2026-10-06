import { describe, expect, it, vi } from 'vitest';
import { dispatchPerformanceFxKey } from './performanceFxKeys';

function rig(target: 'A' | 'B' | 'C' | 'D' | 'master' = 'A') {
  const section = { selected: 'echo' as const, target, on: false, depth: 0, beats: 0.5 };
  const mixer = {
    selectBeatFx: vi.fn(), toggleBeatFxOn: vi.fn(), stepBeatFxBeats: vi.fn(),
    getBeatFxSection: () => section, setBeatFxDepth: vi.fn(), selectBeatFxTarget: vi.fn(),
  };
  return { section, mixer };
}

describe('Performance Beat FX keyboard map', () => {
  it('selects effects, toggles and changes beat fraction', () => {
    const { mixer } = rig();
    for (const key of ['1', '2', '3', '4', '5', '6']) {
      expect(dispatchPerformanceFxKey(key, mixer as never, 4)).toBe(true);
    }
    expect(mixer.selectBeatFx.mock.calls).toEqual([['echo'], ['reverb'], ['flanger']]);
    expect(mixer.toggleBeatFxOn).toHaveBeenCalledOnce();
    expect(mixer.stepBeatFxBeats.mock.calls).toEqual([['halve'], ['double']]);
  });

  it('steps and clamps bipolar depth', () => {
    const { section, mixer } = rig();
    section.depth = 0.95;
    dispatchPerformanceFxKey('8', mixer as never, 4);
    expect(mixer.setBeatFxDepth).toHaveBeenLastCalledWith(1);
    section.depth = -0.95;
    dispatchPerformanceFxKey('7', mixer as never, 4);
    expect(mixer.setBeatFxDepth).toHaveBeenLastCalledWith(-1);
  });

  it('cycles only targets present in the displayed deck layout', () => {
    const { mixer } = rig('B');
    dispatchPerformanceFxKey('0', mixer as never, 2);
    expect(mixer.selectBeatFxTarget).toHaveBeenLastCalledWith('master');
    dispatchPerformanceFxKey('9', mixer as never, 2);
    expect(mixer.selectBeatFxTarget).toHaveBeenLastCalledWith('A');
    expect(dispatchPerformanceFxKey('-', mixer as never, 4)).toBe(false);
  });
});
