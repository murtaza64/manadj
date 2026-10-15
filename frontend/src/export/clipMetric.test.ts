import { defaultClipSpec, lookAt } from './clipSpec';
import { describe, expect, it } from 'vitest';
import type { PlannedRoutine } from '../sets/routinePlan';
import { autoVizCues, barTier, buildClipMetric, buildTrackMetric, DEFAULT_AUTO_VIZ, metricAt } from './clipMetric';

// 120 BPM: a beat every 0.5 s, 400 beats.
const beatTimes = Array.from({ length: 400 }, (_, i) => 1 + i * 0.5);

describe('track metric', () => {
  it('anchors bars at hot cue 4 even when stored downbeats are off-phase', () => {
    const m = buildTrackMetric({
      beatTimes,
      downbeatTimes: beatTimes.filter((_, i) => i % 4 === 1), // wrong phase
      hotCues: [{ slot_number: 4, time_seconds: 1 + 66 * 0.5 + 0.004 }],
      drops: [{ time: 1 + (66 + 64) * 0.5, strength: 0.9 }, { time: 1 + (66 + 32) * 0.5, strength: 0.95 }],
    })!;
    expect(m.anchorBeat).toBe(66);
    expect(m.anchorSource).toBe('hotcue4');
    // Second drop on the 16-bar lattice kept; the off-lattice one dropped.
    expect(m.dropSecs).toEqual([1 + 66 * 0.5, 1 + 130 * 0.5]);
    const p = metricAt(m, 1 + 70 * 0.5)!;
    expect(p.bar).toBe(1);
    expect(p.beatInBar).toBe(0);
    expect(metricAt(m, 1 + 65 * 0.5)!.beatInBar).toBe(3);
  });
  it('tiers', () => {
    expect([0, 1, 2, 4, 8, 16, 32].map(barTier)).toEqual([5, 0, 1, 2, 3, 4, 5]);
  });
});

describe('clip metric', () => {
  // One slot playing the track from beat 0 at its native tempo, mix t = track t − 1.
  const routine = {
    beatOriginMixSec: 0,
    secPerBeat: 0.5,
    slots: [{
      trackId: 7, occupyFromMixSec: 0, entryMixSec: 0, releaseMixSec: 190, basePitchPercent: 0,
      trace: [{ beat: 0, pos: 1, jump: false, moving: true, ratePerBeat: 0.5 }, { beat: 380, pos: 191, jump: false, moving: true, ratePerBeat: 0.5 }],
    }],
  } as unknown as PlannedRoutine;
  const tm = buildTrackMetric({ beatTimes, downbeatTimes: [], hotCues: [{ slot_number: 4, time_seconds: 1 + 64 * 0.5 }] })!;
  const metric = buildClipMetric(routine, new Map([[7, tm]]), { startSec: 0, endSec: 180 });

  it('finds the drop and phrase boundaries on the mix clock', () => {
    const drop = metric.events.find((e) => e.drop)!;
    expect(drop.t).toBeCloseTo(32, 1);
    expect(drop.bar).toBe(0);
    const p16 = metric.events.filter((e) => e.tier >= 4).map((e) => Math.round(e.t));
    expect(p16).toEqual([32, 64, 96, 128, 160]);
  });
  it('auto programme switches on the drop with its impact', () => {
    const cues = autoVizCues(metric, { startSec: 0, endSec: 180 }, { ...DEFAULT_AUTO_VIZ, style: 'rotation', minGapSec: 20 });
    expect(cues[0]).toEqual({ atSec: 0, presetId: 'voyage' });
    expect(cues[1]).toMatchObject({ presetId: 'odyssey', impact: 'shockwave' });
    expect(cues[1].atSec).toBeCloseTo(32, 1);
  });
  it('varied transitions + look changes ride the switches', () => {
    const cues = autoVizCues(metric, { startSec: 0, endSec: 180 }, { ...DEFAULT_AUTO_VIZ, style: 'rotation', minGapSec: 20, transitions: true, lookChanges: true }, 2);
    expect(cues[1].transition).toMatchObject({ kind: 'blackout', placement: 'before', durationSec: 2 });
    expect(cues[1].look?.composite).toBe('screen');
    expect(cues.slice(2).some((c) => c.transition)).toBe(true);
  });
  it('storyboard: mixer-forward intro, blackout into the drop, the UI strips back by the end', () => {
    const cues = autoVizCues(metric, { startSec: 0, endSec: 180 }, { ...DEFAULT_AUTO_VIZ, minGapSec: 20 }, 2);
    expect(cues[0].look).toMatchObject({ showKnobs: true, showTitles: true, revealAtDrop: true });
    const drop = cues.find((c) => Math.abs(c.atSec - 32) < 0.5 && c.look)!;
    expect(drop.transition).toMatchObject({ kind: 'blackout', placement: 'before' });
    expect(drop.look).toMatchObject({ wavePalette: 'mono' });
    const spec = { ...defaultClipSpec({ kind: 'routine', uuid: 'r' }), viz: { cues, crossfadeSec: 2 } };
    expect(lookAt(spec, 20)).toMatchObject({ showKnobs: true, showPlayhead: true });
    const end = lookAt(spec, 179);
    expect(end).toMatchObject({ showKnobs: false, showPlayhead: false });
    expect(end.vizDim).toBeLessThan(0.12);
  });
});
