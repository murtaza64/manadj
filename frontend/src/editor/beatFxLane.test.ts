import { describe, expect, it, vi } from 'vitest';
import {
  BeatFxOverride,
  deriveTransitionBeatFx,
  fxSection,
  pairFxAt,
  pairFxToRoutine,
  recordedRoutineBeatFx,
  routineFxAt,
  routineFxToPair,
  type TransitionBeatFx,
} from './beatFxLane';
import type { BeatFxSectionState } from '../playback/beatFx';
import { editedPairTransition, transitionToProjection } from './pairSlotTranslation';
import type { Transition } from './mixModel';

const fx = (t: number, target: string, on: boolean, extra: Partial<BeatFxSectionState> = {}) => ({
  t, kind: 'beatFx', selected: 'echo', target, on, depth: 0, beats: 0.5, ...extra,
});

describe('deriveTransitionBeatFx', () => {
  it('echo-out: seeds from before the window, steps in-window, closes with OFF at x=1', () => {
    const out = deriveTransitionBeatFx(
      [
        { t: 0, kind: 'init' },
        fx(5, 'A', false),
        fx(12, 'A', true, { depth: 0.2 }),
        fx(14, 'A', true, { depth: 0.6 }),
        fx(16, 'A', true, { depth: 0.6, beats: 1 }),
      ],
      10,
      20,
      'A'
    )!;
    expect(out.steps.map((s) => [s.x, s.on, s.target, s.beats])).toEqual([
      [0.2, true, 'A', 0.5],
      [0.6, true, 'A', 1],
      [1, false, 'A', 1],
    ]);
    expect(out.depth[0]).toEqual({ x: 0, y: 0.5 });
    expect(pairFxAt(out, 0.5).depth).toBeCloseTo(0.6, 5);
  });

  it('maps the outgoing channel to role A and the other to B', () => {
    const out = deriveTransitionBeatFx([fx(11, 'B', true), fx(12, 'A', true)], 10, 20, 'B')!;
    expect(out.steps.map((s) => s.target)).toEqual(['A', 'B', 'B']);
  });

  it('idle FX evidence and pre-#351 slices mint no track', () => {
    expect(deriveTransitionBeatFx([fx(12, 'A', false)], 10, 20, 'A')).toBeUndefined();
    expect(deriveTransitionBeatFx([{ t: 0, kind: 'init' }], 10, 20, 'A')).toBeUndefined();
    // sampler (a deck outside the pair) reads OFF.
    expect(deriveTransitionBeatFx([fx(12, 'sampler', true)], 10, 20, 'A')).toBeUndefined();
  });

  it('reads the init head section', () => {
    const out = deriveTransitionBeatFx(
      [{ t: 9, kind: 'init', beatFx: { selected: 'reverb', target: 'master', on: true, depth: 1, beats: 1 } } as never],
      10, 20, 'A'
    )!;
    expect(out.steps[0]).toMatchObject({ x: 0, on: true, selected: 'reverb', target: 'master' });
  });
});

describe('evaluation', () => {
  const track: TransitionBeatFx = {
    steps: [
      { x: 0.25, on: true, selected: 'echo', target: 'A', beats: 0.5 },
      { x: 0.5, on: true, selected: 'echo', target: 'B', beats: 0.5 },
      { x: 0.75, on: false, selected: 'echo', target: 'B', beats: 0.5 },
    ],
    depth: [{ x: 0, y: 0.5 }, { x: 1, y: 1 }],
  };
  it('off before the first step; FX moves A→B as a target step; holds the last', () => {
    expect(pairFxAt(track, 0.1).on).toBe(false);
    expect(pairFxAt(track, 0.3)).toMatchObject({ on: true, target: 'A' });
    expect(pairFxAt(track, 0.6)).toMatchObject({ on: true, target: 'B' });
    expect(pairFxAt(track, 2).on).toBe(false);
    expect(pairFxAt(track, 0.5).depth).toBeCloseTo(0.5, 5);
  });
  it('resolves roles onto decks; an unresolvable target is silent and off', () => {
    const v = pairFxAt(track, 0.3);
    expect(fxSection(v, () => 'C')).toMatchObject({ target: 'C', on: true });
    expect(fxSection(v, () => null)).toMatchObject({ target: 'sampler', on: false });
  });
  it('pair ↔ routine projection round-trips', () => {
    const r = pairFxToRoutine(track, 32, 0, (role) => (role === 'A' ? '0' : '1'));
    expect(r.steps.map((s) => [s.beat, s.target])).toEqual([[8, '0'], [16, '1'], [24, '1']]);
    expect(routineFxAt(r, 10).target).toBe('0');
    const back = routineFxToPair(r, (b) => b / 32, (id) => (id === '0' ? 'A' : id === '1' ? 'B' : null));
    expect(back).toEqual(track);
  });
});

describe('recordedRoutineBeatFx', () => {
  it('slot-index targets become slot ids', () => {
    const out = recordedRoutineBeatFx(
      [
        { kind: 'beatFx', beat: 0, seeded: true, selected: 'echo', target: 0, on: false, depth: 0, beats: 0.5 },
        { kind: 'beatFx', beat: 4, selected: 'echo', target: 2, on: true, depth: 0, beats: 0.5 },
        { kind: 'beatFx', beat: 8, selected: 'echo', target: null, on: false, depth: 0, beats: 0.5 },
      ],
      (i) => `s${i}`
    )!;
    expect(out.steps.map((s) => [s.beat, s.target, s.on])).toEqual([[4, 's2', true], [8, 's2', false]]);
  });
});

describe('BeatFxOverride', () => {
  const live: BeatFxSectionState = { selected: 'reverb', target: 'B', on: true, depth: 0.3, beats: 1 };
  it('snapshots, writes only changes, restores (or keeps on takeover)', () => {
    let cur = { ...live };
    const set = vi.fn((s: BeatFxSectionState) => { cur = { ...s }; });
    const host = { getBeatFxSection: () => cur, setBeatFxSection: set };
    const o = new BeatFxOverride(host);
    o.apply(null);
    expect(set).not.toHaveBeenCalled(); // not engaged
    o.engage();
    o.apply(null);
    expect(cur).toEqual({ ...live, on: false });
    o.apply(null);
    expect(set).toHaveBeenCalledTimes(1);
    o.release();
    expect(cur).toEqual(live);
    o.engage();
    o.apply({ ...live, target: 'A' });
    o.release({ keep: true });
    expect(cur.target).toBe('A');
  });
});

describe('pair projection save', () => {
  const tr: Transition = {
    startSec: 30, durationSec: 16, bInSec: 0, tempoMatch: true, lanes: {},
    beatFx: { steps: [{ x: 0.5, on: true, selected: 'echo', target: 'A', beats: 0.5 }], depth: [{ x: 0, y: 0.5 }] },
  };
  const input = { uuid: 'u', name: 'n', transition: tr, trackAId: 1, trackBId: 2, bpmA: 120, bpmB: 120 };
  it('unchanged FX passes through verbatim; edits and removal re-derive', () => {
    const p = transitionToProjection(input);
    expect(p.edits.beatFx!.steps[0]).toMatchObject({ beat: 16, target: '0' });
    const ctx = { original: tr, durationBeats: p.sourceDurationBeats, secPerBeat: p.secPerBeat };
    expect(editedPairTransition(p.edits, p.edits, ctx).beatFx).toBe(tr.beatFx);
    const moved = { ...p.edits, beatFx: { ...p.edits.beatFx!, steps: [{ ...p.edits.beatFx!.steps[0], beat: 24, target: '1' }] } };
    expect(editedPairTransition(moved, p.edits, ctx).beatFx!.steps[0]).toMatchObject({ x: 0.75, target: 'B' });
    const { beatFx: _drop, ...removed } = p.edits;
    void _drop;
    expect(editedPairTransition(removed, p.edits, ctx).beatFx).toBeUndefined();
  });
});
