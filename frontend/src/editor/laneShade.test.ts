/**
 * Lane deviation shading (mix-editor 39): neutral definitions, the
 * grey→color ramp, the vectorizer-epsilon lockstep, and the filter's
 * per-side hue split.
 */
import { describe, expect, it } from 'vitest';
import { OFF_DEFAULT_EPS } from '../capture/vectorize';
import {
  NEUTRAL_EPS,
  emptyLaneShade,
  isNeutral,
  laneDeviation,
  laneFillAnchor,
  laneNeutral,
  laneRestingDefault,
  pointStroke,
  segmentShade,
} from './laneShade';

const rgb = (s: string): [number, number, number, number] => {
  const m = s.match(/rgba\((\d+),(\d+),(\d+),([\d.]+)\)/)!;
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
};

describe('neutral definitions', () => {
  it('fader neutral is EMPTY; EQ and filter neutral is center', () => {
    expect(laneNeutral('faderA')).toBe(0);
    expect(laneNeutral('faderB')).toBe(0);
    expect(laneNeutral('eqMidA')).toBe(0.5);
    expect(laneNeutral('filterB')).toBe(0.5);
  });

  it('fill anchors: fader and EQ from MIN (energy), filter from center', () => {
    expect(laneFillAnchor('faderA')).toBe(0);
    expect(laneFillAnchor('eqLowB')).toBe(0);
    expect(laneFillAnchor('filterA')).toBe(0.5);
  });

  it('deviation normalizes over the reachable range', () => {
    expect(laneDeviation('faderA', 1)).toBe(1); // full up
    expect(laneDeviation('faderA', 0)).toBe(0); // silent = neutral
    expect(laneDeviation('eqLowA', 0)).toBe(1); // full kill
    expect(laneDeviation('eqLowA', 0.25)).toBeCloseTo(0.5);
    expect(laneDeviation('filterA', 1)).toBe(1);
  });

  it('the visual epsilon IS the vectorizer epsilon (no lying pixels)', () => {
    expect(NEUTRAL_EPS).toBe(OFF_DEFAULT_EPS);
    expect(isNeutral('eqMidA', 0.5 + OFF_DEFAULT_EPS - 0.001)).toBe(true);
    expect(isNeutral('eqMidA', 0.5 + OFF_DEFAULT_EPS + 0.001)).toBe(false);
    expect(isNeutral('faderA', 0.01)).toBe(true); // near-silent
    expect(isNeutral('faderA', 0.99)).toBe(false); // full is a DEVIATION now
  });
});

describe('grey-at-neutral, color-when-away', () => {
  it('a neutral FILTER segment strokes grey and has NO fill', () => {
    const s = segmentShade('filterA', '#3bff00', 0.5, 0.505);
    for (const stop of s.stroke) expect(rgb(stop.color).slice(0, 3)).toEqual([140, 140, 150]);
    expect(s.fill).toBeNull();
  });

  it('a FULL fader segment is colored with the constant-alpha energy fill', () => {
    const s = segmentShade('faderA', '#00e5ff', 1, 1);
    for (const stop of s.stroke) expect(rgb(stop.color).slice(0, 3)).toEqual([0, 229, 255]);
    for (const stop of s.fill!) {
      expect(rgb(stop.color).slice(0, 3)).toEqual([0, 229, 255]);
      expect(rgb(stop.color)[3]).toBeCloseTo(0.15);
    }
  });

  it('fader fill alpha is CONSTANT — height encodes the level, not opacity', () => {
    const s = segmentShade('faderA', '#00e5ff', 1, 0.1); // long pull-down
    for (const stop of s.fill!) expect(rgb(stop.color)[3]).toBeCloseTo(0.15);
  });

  it('a SILENT fader segment greys out with no fill', () => {
    const s = segmentShade('faderA', '#00e5ff', 0, 0.01);
    expect(rgb(s.stroke[0].color).slice(0, 3)).toEqual([140, 140, 150]);
    expect(s.fill).toBeNull();
  });

  it('the stroke grades with the interpolated value: grey end → full color end', () => {
    const s = segmentShade('eqMidA', '#00ff6f', 0.0, 1.0); // kill → full boost
    expect(rgb(s.stroke[0].color).slice(0, 3)).toEqual([140, 140, 150]); // killed end
    const [r, g, b, a] = rgb(s.stroke[s.stroke.length - 1].color);
    expect([r, g, b]).toEqual([0, 255, 111]); // max end at the band color
    expect(a).toBe(1);
    expect(s.fill).not.toBeNull();
  });

  it('triangular sections grade the fill with the INTERPOLATED value', () => {
    // Filter ramp from neutral to full HPF: alpha starts at the base,
    // hits the ceiling exactly where deviation saturates (dev = RAMP_FULL
    // at |y-0.5| = 0.3 → 60% along), and stays clamped to the end.
    const s = segmentShade('filterA', '#3bff00', 0.5, 1.0);
    const stops = s.fill!;
    expect(stops).toHaveLength(3);
    expect(stops[0].offset).toBe(0);
    expect(stops[1].offset).toBeCloseTo(0.6);
    expect(stops[2].offset).toBe(1);
    expect(rgb(stops[0].color)[3]).toBeCloseTo(0.1); // neutral end: base
    expect(rgb(stops[1].color)[3]).toBeCloseTo(0.4); // saturation crossing
    expect(rgb(stops[2].color)[3]).toBeCloseTo(0.4); // clamped to the top
  });

  it('a neutral-crossing FILTER segment dips to base alpha at the axis', () => {
    const s = segmentShade('filterA', '#3bff00', 0.2, 0.8); // LPF → HPF
    const axis = s.fill!.find((st) => Math.abs(st.offset - 0.5) < 1e-9)!;
    expect(rgb(axis.color)[3]).toBeCloseTo(0.1);
  });

  it('mild deviation lands between grey and the lane color', () => {
    const s = segmentShade('eqMidA', '#00ff6f', 0.5, 0.47);
    const [r, g, b] = rgb(s.stroke[s.stroke.length - 1].color); // deviated end
    expect(r).toBeLessThan(140);
    expect(r).toBeGreaterThan(0);
    expect(g).toBeGreaterThan(140);
    expect(g).toBeLessThan(255);
    expect(b).toBeGreaterThan(111);
    expect(b).toBeLessThan(150);
  });

  it('fill strength follows the ramp', () => {
    const mild = segmentShade('eqMidA', '#00ff6f', 0.5, 0.55)!;
    const hard = segmentShade('eqMidA', '#00ff6f', 0.5, 1.0)!;
    const endAlpha = (s: typeof mild) => rgb(s.fill![s.fill!.length - 1].color)[3];
    expect(endAlpha(mild)).toBeLessThan(endAlpha(hard));
  });

  it('a slam segment (one neutral endpoint) reads at the far end\'s strength', () => {
    const s = segmentShade('faderA', '#00e5ff', 1, 0); // full pull
    expect(rgb(s.stroke[0].color)[3]).toBe(1); // the full end carries it
  });

  it('point dots follow the same ramp', () => {
    expect(rgb(pointStroke('eqMidA', '#00ff6f', 0)).slice(0, 3)).toEqual([140, 140, 150]);
    expect(rgb(pointStroke('eqMidA', '#00ff6f', 1)).slice(0, 3)).toEqual([0, 255, 111]);
    expect(rgb(pointStroke('filterA', '#3bff00', 0.5)).slice(0, 3)).toEqual([140, 140, 150]);
  });
});

describe('EQ absolute ramp (RGB experiment)', () => {
  it('a neutral EQ segment renders at PARTIAL strength, filled from min', () => {
    const s = segmentShade('eqMidA', '#00ff6f', 0.5, 0.5);
    // Stroke: halfway between grey and the band color.
    const [r, g] = rgb(s.stroke[0].color);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(140);
    expect(g).toBeGreaterThan(140);
    expect(g).toBeLessThan(255);
    // Fill exists (the area from min to center) at partial alpha.
    expect(s.fill).not.toBeNull();
    expect(rgb(s.fill![0].color)[3]).toBeCloseTo(0.225);
  });

  it('a killed EQ end fades to grey and near-zero alpha', () => {
    const s = segmentShade('eqMidA', '#00ff6f', 0.5, 0.0);
    const kill = s.fill![s.fill!.length - 1];
    expect(rgb(kill.color).slice(0, 3)).toEqual([140, 140, 150]);
    expect(rgb(kill.color)[3]).toBeCloseTo(0.05);
  });

  it('a boosted EQ end reaches the full band color', () => {
    const s = segmentShade('eqMidA', '#00ff6f', 0.5, 1.0);
    const boost = s.fill![s.fill!.length - 1];
    expect(rgb(boost.color).slice(0, 3)).toEqual([0, 255, 111]);
    expect(rgb(boost.color)[3]).toBeCloseTo(0.4);
  });
});

describe('empty lanes', () => {
  it('render a neutral-grey line at the resting default with a grey fill', () => {
    const fader = emptyLaneShade('faderA');
    expect(fader.y).toBe(1); // untouched fader = FULL
    expect(rgb(fader.stroke).slice(0, 3)).toEqual([140, 140, 150]);
    expect(rgb(fader.fill).slice(0, 3)).toEqual([140, 140, 150]);
    const eq = emptyLaneShade('eqMidB');
    expect(eq.y).toBe(0.5);
    expect(laneRestingDefault('filterA')).toBe(0.5);
  });
});

describe('filter hue split (LPF dark / HPF light)', () => {
  it('the LPF side blends toward black, the HPF side toward white', () => {
    const lpf = segmentShade('filterA', '#3bff00', 0.5, 0.1);
    const hpf = segmentShade('filterA', '#3bff00', 0.5, 0.9);
    const end = (s: typeof lpf) => rgb(s.fill![s.fill!.length - 1].color);
    const [lr, lg, lb] = end(lpf);
    const [hr, hg, hb] = end(hpf);
    expect(lr + lg + lb).toBeLessThan(hr + hg + hb);
    // Both stay recognizably the lane hue (green-dominant).
    expect(lg).toBeGreaterThan(lr);
    expect(hg).toBeGreaterThan(hr);
  });

  it('a side-crossing segment switches hue HARD at the axis (twin stops)', () => {
    const s = segmentShade('filterA', '#3bff00', 0.1, 0.9);
    const axisStops = s.fill!.filter((st) => Math.abs(st.offset - 0.5) < 1e-9);
    expect(axisStops).toHaveLength(2);
    const [before, after] = axisStops.map((st) => rgb(st.color));
    const lum = (c: number[]) => c[0] + c[1] + c[2];
    expect(lum(before)).toBeLessThan(lum(after)); // dark LPF → light HPF
  });
});
