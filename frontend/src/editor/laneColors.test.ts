/**
 * Lane color table (mix-editor 32 + review nit): each deck's lanes are
 * one spectrum ramp along the display order (FILTER→LOW→MID→HIGH→FADER),
 * uniform hue steps into the deck anchor; decks mirror around the seam.
 */
import { describe, expect, it } from 'vitest';
import { DECK_COLORS } from '../theme/deckColors';
import { DECK_LANE_ORDER, LANE_COLORS, LANE_LABELS } from './laneColors';
import { LANE_IDS } from './mixModel';
import type { LaneId } from './mixModel';

/** '#rrggbb' → [hue 0..360, saturation 0..1] (lightness unused). */
function hueSat(hex: string): [number, number] {
  const v = parseInt(hex.slice(1), 16);
  const r = ((v >> 16) & 0xff) / 255;
  const g = ((v >> 8) & 0xff) / 255;
  const b = (v & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return [h, s];
}

/** Signed circular hue distance a→b in degrees (−180..180]. */
function hueDelta(a: number, b: number): number {
  return ((b - a + 540) % 360) - 180;
}

/** Spectrum ramp: role → hue offset from the deck anchor (uniform 20°
 * steps along the display order, ending at the fader = anchor). */
const ROLE_OFFSETS: [role: string, offset: number][] = [
  ['filter', -80],
  ['eqHigh', -60],
  ['eqMid', -40],
  ['eqLow', -20],
  ['fader', 0],
];

describe('LANE_COLORS (deck spectrum ramps)', () => {
  it('fader lanes ARE the deck colors', () => {
    expect(LANE_COLORS.faderA).toBe(DECK_COLORS.A);
    expect(LANE_COLORS.faderB).toBe(DECK_COLORS.B);
  });

  it('matches the settled table (issue 32 + review nit) exactly', () => {
    expect(LANE_COLORS).toEqual({
      faderA: '#00e5ff',
      faderB: '#ff2d95',
      eqLowA: '#00ffc4',
      eqLowB: '#ff2ddb',
      eqMidA: '#00ff6f',
      eqMidB: '#dd2dff',
      eqHighA: '#00ff1a',
      eqHighB: '#972dff',
      filterA: '#3bff00',
      filterB: '#512dff',
    });
  });

  it.each(['A', 'B'] as const)(
    'deck %s lanes sit at the uniform spectrum offsets from the deck anchor',
    (deck) => {
      const [anchorHue] = hueSat(DECK_COLORS[deck]);
      for (const [role, offset] of ROLE_OFFSETS) {
        const id = `${role}${deck}` as LaneId;
        const [h] = hueSat(LANE_COLORS[id]);
        expect(Math.abs(hueDelta(anchorHue + offset, h)), `${id} hue`).toBeLessThan(2);
      }
    }
  );

  it.each(['A', 'B'] as const)(
    'deck %s hues ramp monotonically along the display order (spectrum reading)',
    (deck) => {
      const [anchorHue] = hueSat(DECK_COLORS[deck]);
      // Walk A's order FILTER→FADER (B's array is the mirror — same walk).
      const roles = deck === 'A' ? DECK_LANE_ORDER.A : [...DECK_LANE_ORDER.B].reverse();
      let prev = -Infinity;
      for (const id of roles) {
        const [h] = hueSat(LANE_COLORS[id]);
        const rel = hueDelta(anchorHue, h); // offset from anchor, ≤ 0
        expect(rel, `${id} offset order`).toBeGreaterThan(prev);
        expect(rel, `${id} offset sign`).toBeLessThanOrEqual(0.5);
        prev = rel;
      }
    }
  );

  it('every lane is fully saturated', () => {
    for (const id of LANE_IDS) {
      const [, s] = hueSat(LANE_COLORS[id]);
      expect(s, `${id} saturation`).toBeGreaterThan(0.99);
    }
  });
});

describe('LANE_LABELS / DECK_LANE_ORDER', () => {
  it('labels every lane with a terse role name shared across decks', () => {
    for (const id of LANE_IDS) expect(LANE_LABELS[id]).toMatch(/^(FADER|LOW|MID|HIGH|FILTER)$/);
    expect(LANE_LABELS.faderA).toBe(LANE_LABELS.faderB);
    expect(LANE_LABELS.eqLowA).toBe(LANE_LABELS.eqLowB);
  });

  it('display order is mirrored: A FILTER→FADER (LOW beside fader), B reversed, deck-pure', () => {
    expect(DECK_LANE_ORDER.A.map((id) => LANE_LABELS[id])).toEqual([
      'FILTER',
      'HIGH',
      'MID',
      'LOW',
      'FADER',
    ]);
    expect(DECK_LANE_ORDER.B.map((id) => LANE_LABELS[id])).toEqual(
      [...DECK_LANE_ORDER.A.map((id) => LANE_LABELS[id])].reverse()
    );
    for (const deck of ['A', 'B'] as const) {
      for (const id of DECK_LANE_ORDER[deck]) expect(id.endsWith(deck)).toBe(true);
    }
  });
});
