/**
 * Replay planner tests (sessions 05) — pure, no audio (prior art: the Set
 * planner suite). Synthetic streams use the real capture vocabulary.
 */
import { describe, expect, it } from 'vitest';
import type { CaptureEvent } from '../capture/events';
import { planReplay } from './replayPlanner';
import type { ReplayCue } from './replayPlanner';

function seed(t: number): CaptureEvent[] {
  const evs: CaptureEvent[] = [];
  for (const ch of ['A', 'B', 'C', 'D'] as const) {
    evs.push({ t, kind: 'control', control: 'fader', channel: ch, value: 1 });
    evs.push({ t, kind: 'control', control: 'trim', channel: ch, value: 0.5 });
    evs.push({
      t,
      kind: 'control',
      control: 'crossfaderAssignment',
      channel: ch,
      value: ch === 'A' || ch === 'C' ? -1 : 1,
    });
  }
  evs.push({ t, kind: 'control', control: 'crossfaderEnabled', channel: null, value: 0 });
  return evs;
}

/** A two-deck blend: A playing from t=2; B loaded at 20, in from 30;
 * fader swap 40..50; A pauses at 60; ticks at 1 Hz throughout. */
function blendLog(): CaptureEvent[] {
  const evs: CaptureEvent[] = [
    ...seed(0),
    { t: 1, kind: 'load', channel: 'A', trackId: 11, bpm: 174 },
    { t: 2, kind: 'transport', channel: 'A', action: 'play', playhead: 60 },
    { t: 20, kind: 'load', channel: 'B', trackId: 22, bpm: 172 },
    { t: 21, kind: 'control', control: 'fader', channel: 'B', value: 0 },
    { t: 25, kind: 'pitch', channel: 'B', value: 1.2 },
    { t: 30, kind: 'transport', channel: 'B', action: 'play', playhead: 8 },
    { t: 40, kind: 'control', control: 'fader', channel: 'B', value: 0.5 },
    { t: 45, kind: 'control', control: 'fader', channel: 'B', value: 1 },
    { t: 50, kind: 'control', control: 'fader', channel: 'A', value: 0 },
    { t: 55, kind: 'transport', channel: 'A', action: 'seek', playhead: 12 },
    { t: 60, kind: 'transport', channel: 'A', action: 'pause', playhead: 15 },
  ];
  for (let t = 3; t <= 65; t += 1) {
    const playheads: Record<string, number> = {};
    if (t >= 3 && t < 60) playheads.A = t <= 55 ? 60 + (t - 2) : 12 + (t - 55);
    if (t >= 31) playheads.B = 8 + (t - 30);
    if (Object.keys(playheads).length > 0) {
      evs.push({ t, kind: 'tick', playheads } as CaptureEvent);
    }
  }
  evs.sort((a, b) => a.t - b.t);
  return evs;
}

describe('planReplay — seed (state at T)', () => {
  it('reconstructs a mid-engagement start point exactly', () => {
    const res = planReplay(blendLog(), 42);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { seed: s } = res.plan;
    // A: playing from 60s track-time at t=2 → at t=42 ≈ 100 (ticks carry it).
    expect(s.decks.A.trackId).toBe(11);
    expect(s.decks.A.playing).toBe(true);
    expect(s.decks.A.playhead).toBeCloseTo(100, 0);
    // B: loaded at 20, playing from 8 at t=30 → ≈ 20; mid-swap fader 0.5.
    expect(s.decks.B.trackId).toBe(22);
    expect(s.decks.B.playing).toBe(true);
    expect(s.decks.B.playhead).toBeCloseTo(20, 0);
    expect(s.decks.B.fader).toBe(0.5);
    expect(s.decks.B.pitch).toBe(1.2);
    // Mixer-wide state.
    expect(s.crossfaderEnabled).toBe(false);
    expect(s.decks.A.assignment).toBe('left');
    expect(res.plan.trackIds.sort()).toEqual([11, 22]);
  });

  it('derives playheads analytically between ticks', () => {
    // Start between the t=31 and t=32 ticks: B's playhead extrapolates.
    const res = planReplay(blendLog(), 31.5);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.seed.decks.B.playhead).toBeCloseTo(9.5, 1);
  });
});

describe('planReplay — cues (the schedule)', () => {
  it('maps future events to offsets; seek-class actions become seeks', () => {
    const res = planReplay(blendLog(), 42);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { cues, endT, startT } = res.plan;
    expect(startT).toBe(42);
    expect(endT).toBe(65);
    // Ordered, all strictly after T.
    expect(cues.every((c) => c.offsetS > 0)).toBe(true);
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i].offsetS).toBeGreaterThanOrEqual(cues[i - 1].offsetS);
    }
    // The fader swap tail (t=45, 50) at offsets 3 and 8.
    const faders = cues.filter((c): c is Extract<ReplayCue, { kind: 'control' }> => c.kind === 'control' && c.control === 'fader');
    expect(faders.map((c) => [c.offsetS, c.channel, c.value])).toEqual([
      [3, 'B', 1],
      [8, 'A', 0],
    ]);
    // The t=55 seek arrives as a seek cue at offset 13.
    const seeks = cues.filter((c) => c.kind === 'seek');
    expect(seeks).toEqual([{ offsetS: 13, kind: 'seek', channel: 'A', playhead: 12 }]);
    // The t=60 pause at offset 18.
    const pauses = cues.filter((c) => c.kind === 'pause');
    expect(pauses).toEqual([{ offsetS: 18, kind: 'pause', channel: 'A', playhead: 15 }]);
    // Ticks became sync cues.
    expect(cues.some((c) => c.kind === 'sync')).toBe(true);
  });

  it('a jumpBeats/hotCue transport event replays as a seek to its position', () => {
    const events: CaptureEvent[] = [
      ...seed(0),
      { t: 1, kind: 'load', channel: 'A', trackId: 7, bpm: 174 },
      { t: 2, kind: 'transport', channel: 'A', action: 'play', playhead: 0 },
      { t: 5, kind: 'transport', channel: 'A', action: 'jumpBeats', playhead: 16.5, detail: 32 },
      { t: 7, kind: 'transport', channel: 'A', action: 'hotCue', playhead: 64, detail: 2 },
      { t: 9, kind: 'tick', playheads: { A: 66 } },
    ];
    const res = planReplay(events, 3);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const seeks = res.plan.cues.filter((c) => c.kind === 'seek');
    expect(seeks).toEqual([
      { offsetS: 2, kind: 'seek', channel: 'A', playhead: 16.5 },
      { offsetS: 4, kind: 'seek', channel: 'A', playhead: 64 },
    ]);
  });

  it('future loads join trackIds; tenure markers never replay', () => {
    const events: CaptureEvent[] = [
      ...seed(0),
      { t: 1, kind: 'load', channel: 'A', trackId: 7, bpm: 174 },
      { t: 2, kind: 'transport', channel: 'A', action: 'play', playhead: 0 },
      { t: 5, kind: 'tenure', edge: 'start', holder: 'editor' },
      { t: 8, kind: 'tenure', edge: 'end', holder: 'shared' },
      { t: 10, kind: 'load', channel: 'B', trackId: 9, bpm: 170 },
      { t: 12, kind: 'transport', channel: 'B', action: 'play', playhead: 0 },
      { t: 14, kind: 'tick', playheads: { A: 12, B: 2 } },
    ];
    const res = planReplay(events, 3);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.trackIds.sort()).toEqual([7, 9]);
    expect(res.plan.cues.filter((c) => c.kind === 'load')).toEqual([
      { offsetS: 7, kind: 'load', channel: 'B', trackId: 9 },
    ]);
    // No cue kind carries tenure.
    expect(res.plan.cues.every((c) => c.kind !== ('tenure' as never))).toBe(true);
  });
});

describe('planReplay — refusals', () => {
  it('refuses an empty log', () => {
    expect(planReplay([], 0)).toEqual({ ok: false, reason: 'empty-log' });
  });

  it('refuses a moment with nothing loaded and nothing upcoming', () => {
    const events: CaptureEvent[] = [...seed(0), { t: 30, kind: 'tick', playheads: {} }];
    const res = planReplay(events, 5);
    expect(res).toEqual({ ok: false, reason: 'nothing-loaded' });
  });

  it('accepts a silent moment when a future load will sound', () => {
    const events: CaptureEvent[] = [
      ...seed(0),
      { t: 10, kind: 'load', channel: 'A', trackId: 7, bpm: 174 },
      { t: 12, kind: 'transport', channel: 'A', action: 'play', playhead: 0 },
      { t: 14, kind: 'tick', playheads: { A: 2 } },
    ];
    const res = planReplay(events, 2);
    expect(res.ok).toBe(true);
  });
});

describe('planReplay — four-deck parity (sessions 09)', () => {
  /** C/D carry the blend; A/B silent. Handler-only C/D transports included. */
  function fourDeckLog(): CaptureEvent[] {
    const evs: CaptureEvent[] = [
      ...seed(0),
      { t: 1, kind: 'load', channel: 'C', trackId: 31, bpm: 170 },
      { t: 2, kind: 'transport', channel: 'C', action: 'play', playhead: 10 },
      { t: 4, kind: 'load', channel: 'D', trackId: 41, bpm: 172 },
      { t: 5, kind: 'control', control: 'fader', channel: 'D', value: 0 },
      { t: 6, kind: 'transport', channel: 'D', action: 'play', playhead: 0 },
      { t: 7, kind: 'pitch', channel: 'D', value: -0.8 },
      // Handler-only gestures: a C seek, a D beat jump, a C hot cue.
      { t: 8, kind: 'transport', channel: 'C', action: 'seek', playhead: 64 },
      { t: 9, kind: 'transport', channel: 'D', action: 'jumpBeats', playhead: 32.5, detail: 16 },
      { t: 10, kind: 'transport', channel: 'C', action: 'hotCue', playhead: 96.25, detail: 2 },
      { t: 11, kind: 'control', control: 'fader', channel: 'D', value: 1 },
      { t: 12, kind: 'tick', playheads: { C: 98.25, D: 35.5 } },
      { t: 14, kind: 'transport', channel: 'C', action: 'pause', playhead: 100 },
    ];
    return evs;
  }

  it('seeds C/D exactly like A/B (physical identity, no A/B remap)', () => {
    const res = planReplay(fourDeckLog(), 7.5);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { seed: s } = res.plan;
    expect(s.decks.C.trackId).toBe(31);
    expect(s.decks.C.playing).toBe(true);
    expect(s.decks.C.playhead).toBeCloseTo(15.5, 1); // 10 @t=2 → +5.5
    expect(s.decks.D.trackId).toBe(41);
    expect(s.decks.D.pitch).toBe(-0.8);
    expect(s.decks.D.fader).toBe(0);
    // A/B stay empty — never absorbed into the C/D roles or vice versa.
    expect(s.decks.A.trackId).toBeNull();
    expect(s.decks.B.trackId).toBeNull();
    expect(res.plan.trackIds.sort()).toEqual([31, 41]);
  });

  it('schedules handler-only C/D transports on their original decks', () => {
    const res = planReplay(fourDeckLog(), 7.5);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const seeks = res.plan.cues.filter((c) => c.kind === 'seek');
    // Seek, jumpBeats, and hotCue all replay as seeks — on C and D, never A/B.
    expect(seeks).toEqual([
      { offsetS: 0.5, kind: 'seek', channel: 'C', playhead: 64 },
      { offsetS: 1.5, kind: 'seek', channel: 'D', playhead: 32.5 },
      { offsetS: 2.5, kind: 'seek', channel: 'C', playhead: 96.25 },
    ]);
    const pauses = res.plan.cues.filter((c) => c.kind === 'pause');
    expect(pauses).toEqual([{ offsetS: 6.5, kind: 'pause', channel: 'C', playhead: 100 }]);
    // The D fader cue keeps its channel.
    const dFader = res.plan.cues.find((c) => c.kind === 'control' && c.control === 'fader');
    expect(dFader).toMatchObject({ channel: 'D', value: 1 });
    // Sync cues carry C/D playheads.
    const sync = res.plan.cues.find((c) => c.kind === 'sync');
    expect(sync).toMatchObject({ playheads: { C: 98.25, D: 35.5 } });
  });
});
