/**
 * Lane color table (mix-editor 32): deck hue families — every lane's hue
 * is its deck anchor plus a uniform role offset, at full saturation.
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

const ROLE_OFFSETS: [role: string, offset: number][] = [
  ['eqLow', -40],
  ['filter', -22],
  ['fader', 0],
  ['eqMid', 22],
  ['eqHigh', 42],
];

describe('LANE_COLORS (deck hue families)', () => {
  it('fader lanes ARE the deck colors', () => {
    expect(LANE_COLORS.faderA).toBe(DECK_COLORS.A);
    expect(LANE_COLORS.faderB).toBe(DECK_COLORS.B);
  });

  it('matches the settled table (issue 32) exactly', () => {
    expect(LANE_COLORS).toEqual({
      faderA: '#00e5ff',
      faderB: '#ff2d95',
      eqLowA: '#00ff6e',
      eqLowB: '#b52dff',
      eqMidA: '#008cff',
      eqMidB: '#ff2d4e',
      eqHighA: '#2d50ff',
      eqHighB: '#ff5c2d',
      filterA: '#00ffc3',
      filterB: '#f22dff',
    });
  });

  it.each(['A', 'B'] as const)(
    'deck %s lanes sit near the uniform role offsets from the deck anchor',
    (deck) => {
      const [anchorHue] = hueSat(DECK_COLORS[deck]);
      for (const [role, offset] of ROLE_OFFSETS) {
        const id = `${role}${deck}` as LaneId;
        const [h] = hueSat(LANE_COLORS[id]);
        // The settled hexes were eyeballed off the nominal offsets — the
        // family relationship (order + rough spacing) is what's guarded.
        expect(Math.abs(hueDelta(anchorHue + offset, h)), `${id} hue`).toBeLessThan(15);
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

  it('chip order is FADER LOW MID HIGH FILTER, deck-pure', () => {
    for (const deck of ['A', 'B'] as const) {
      const order = DECK_LANE_ORDER[deck];
      expect(order.map((id) => LANE_LABELS[id])).toEqual([
        'FADER',
        'LOW',
        'MID',
        'HIGH',
        'FILTER',
      ]);
      for (const id of order) expect(id.endsWith(deck)).toBe(true);
    }
  });
});
