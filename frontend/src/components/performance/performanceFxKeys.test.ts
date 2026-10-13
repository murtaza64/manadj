import { describe, expect, it, vi } from 'vitest';
import { dispatchPerformanceFxKey, isPerformanceFxKey, performanceFxTargetKey } from './performanceFxKeys';

function rig(selected: 'echo' | 'reverb' | 'flanger' | null = 'echo') {
  const section = { selected, target: 'A' as const, on: false, depth: 0, beats: 0.5 };
  return {
    section,
    toggleBeatFxOn: vi.fn(), stepBeatFxBeats: vi.fn(), selectBeatFxTarget: vi.fn(),
    selectBeatFx: vi.fn((effect) => { section.selected = effect; }),
    getBeatFxSection: () => section,
  };
}

describe('Performance Beat FX keyboard map', () => {
  it('maps 1-5 to targets, 6/7 to length, - to on/off', () => {
    const mixer = rig();
    for (const key of ['1', '2', '3', '4', '5', '6', '7', '-']) {
      expect(dispatchPerformanceFxKey(key, mixer as never, 4)).toBe(true);
    }
    expect(mixer.selectBeatFxTarget.mock.calls).toEqual([['A'], ['B'], ['C'], ['D'], ['master']]);
    expect(mixer.stepBeatFxBeats.mock.calls).toEqual([['halve'], ['double']]);
    expect(mixer.toggleBeatFxOn).toHaveBeenCalledOnce();
  });

  it('cycles the effect type with 8/9, wrapping and starting from ---', () => {
    const mixer = rig('echo');
    dispatchPerformanceFxKey('9', mixer as never, 4);
    dispatchPerformanceFxKey('9', mixer as never, 4);
    dispatchPerformanceFxKey('9', mixer as never, 4);
    dispatchPerformanceFxKey('8', mixer as never, 4);
    expect(mixer.selectBeatFx.mock.calls).toEqual([['reverb'], ['flanger'], ['echo'], ['flanger']]);
    const none = rig(null);
    dispatchPerformanceFxKey('8', none as never, 4);
    expect(none.selectBeatFx).toHaveBeenLastCalledWith('flanger');
  });

  it('leaves 0 (held knob), = and hidden C/D targets to other owners', () => {
    const mixer = rig();
    expect(dispatchPerformanceFxKey('0', mixer as never, 4)).toBe(false);
    expect(dispatchPerformanceFxKey('=', mixer as never, 4)).toBe(false);
    expect(isPerformanceFxKey('3', 2)).toBe(false);
    expect(isPerformanceFxKey('4', 2)).toBe(false);
    expect(isPerformanceFxKey('5', 2)).toBe(true);
    expect(mixer.selectBeatFxTarget).not.toHaveBeenCalled();
  });

  it('exposes target keys for hints', () => {
    expect(performanceFxTargetKey('A')).toBe('1');
    expect(performanceFxTargetKey('master')).toBe('5');
    expect(performanceFxTargetKey('sampler')).toBeNull();
  });
});
