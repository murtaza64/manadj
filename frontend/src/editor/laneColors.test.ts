/**
 * Lane color table (mix-editor 39 RGB experiment over the 32 family):
 * faders ARE the deck anchors, filters keep their spectrum-ramp hue
 * (−80° off the anchor), and the EQ bands are an RGB triad — LOW red,
 * MID green, HIGH blue — tilted blueward on deck A, redward on deck B.
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

describe('LANE_COLORS (RGB EQ triad over the deck anchors)', () => {
  it('fader lanes ARE the deck colors', () => {
    expect(LANE_COLORS.faderA).toBe(DECK_COLORS.A);
    expect(LANE_COLORS.faderB).toBe(DECK_COLORS.B);
  });

  it('filter lanes wear the 32-family LOW hue (−20° off the anchor)', () => {
    for (const deck of ['A', 'B'] as const) {
      const [anchorHue] = hueSat(DECK_COLORS[deck]);
      const [h] = hueSat(LANE_COLORS[`filter${deck}`]);
      expect(Math.abs(hueDelta(anchorHue - 20, h)), `filter${deck} hue`).toBeLessThan(2);
    }
  });

  it('EQ bands are an RGB triad: LOW red, MID green, HIGH blue-dominant', () => {
    const dominant = (hex: string): 'r' | 'g' | 'b' => {
      const v = parseInt(hex.slice(1), 16);
      const r = (v >> 16) & 0xff;
      const g = (v >> 8) & 0xff;
      const b = v & 0xff;
      return r >= g && r >= b ? 'r' : g >= b ? 'g' : 'b';
    };
    for (const deck of ['A', 'B'] as const) {
      expect(dominant(LANE_COLORS[`eqLow${deck}`]), `eqLow${deck}`).toBe('r');
      expect(dominant(LANE_COLORS[`eqMid${deck}`]), `eqMid${deck}`).toBe('g');
      expect(dominant(LANE_COLORS[`eqHigh${deck}`]), `eqHigh${deck}`).toBe('b');
    }
  });

  it('each B band sits redder (closer to red) than its A counterpart', () => {
    const distToRed = (hex: string) => Math.abs(hueDelta(hueSat(hex)[0], 0));
    for (const band of ['eqLow', 'eqMid', 'eqHigh'] as const) {
      const a = distToRed(LANE_COLORS[`${band}A`]);
      const b = distToRed(LANE_COLORS[`${band}B`]);
      expect(b, `${band}: B redder than A`).toBeLessThan(a);
    }
  });

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
