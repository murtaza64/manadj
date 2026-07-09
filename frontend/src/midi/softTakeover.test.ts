import { describe, expect, it } from 'vitest';
import { SoftTakeover } from './softTakeover';

/**
 * Pickup semantics (midi-controller 15): a mismatched hardware fader is
 * ignored until it reaches or crosses the software value, then latches.
 * External software changes unlatch so the next mismatched move can't
 * jump. Values here read as pitch percent (±8 domain), tolerance 0.1.
 */

const TOLERANCE = 0.1;

describe('SoftTakeover', () => {
  it('suppresses mismatched movement before pickup', () => {
    const t = new SoftTakeover(TOLERANCE);
    // software at +4, fader physically near the bottom
    expect(t.feed(-6, 4)).toBe(false);
    expect(t.feed(-5, 4)).toBe(false);
    expect(t.feed(0, 4)).toBe(false);
  });

  it('latches when crossing from below, then tracks', () => {
    const t = new SoftTakeover(TOLERANCE);
    expect(t.feed(2, 4)).toBe(false);
    expect(t.feed(4.5, 4)).toBe(true); // crossed 4 between samples
    expect(t.feed(5, 4.5)).toBe(true); // latched: tracks normally
    expect(t.feed(-2, 5)).toBe(true); // even large moves, once latched
  });

  it('latches when crossing from above', () => {
    const t = new SoftTakeover(TOLERANCE);
    expect(t.feed(6, -1)).toBe(false);
    expect(t.feed(3, -1)).toBe(false);
    expect(t.feed(-1.5, -1)).toBe(true); // crossed -1 going down
    expect(t.feed(-3, -1.5)).toBe(true);
  });

  it('latches on an exact match (within tolerance), even on the first sample', () => {
    const t = new SoftTakeover(TOLERANCE);
    expect(t.feed(0.05, 0)).toBe(true); // no previous sample: match still latches
    const u = new SoftTakeover(TOLERANCE);
    expect(u.feed(4, 4)).toBe(true);
  });

  it('first touch gets grace: a knob resting at the software value latches even though its first report is already past it', () => {
    // MIDI is silent until the control moves — fresh start, hardware
    // neutral, software at defaults: the first sample lands a few steps
    // beyond the value, not on it. Grace = 5× tolerance (0.5 here).
    const t = new SoftTakeover(TOLERANCE);
    expect(t.feed(0.4, 0)).toBe(true); // within grace: no wiggle needed
    expect(t.feed(0.6, 0.4)).toBe(true); // latched, tracks on
  });

  it('first-touch grace has a limit: a genuinely parked control still needs pickup', () => {
    const t = new SoftTakeover(TOLERANCE);
    expect(t.feed(0.6, 0)).toBe(false); // beyond grace: suppressed
    expect(t.feed(-0.05, 0)).toBe(true); // crossed 0: normal pickup
  });

  it('grace applies to the first sample only — not after an external-change unlatch', () => {
    const t = new SoftTakeover(TOLERANCE);
    expect(t.feed(2, 2)).toBe(true); // latched
    // MATCH moves software to 2.3 — within grace of the hardware's 2,
    // but the hardware genuinely sits elsewhere now: tight tolerance rules.
    expect(t.feed(2.0, 2.3)).toBe(false);
    expect(t.feed(2.35, 2.3)).toBe(true); // crossed: picked up
  });

  it('external software change unlatches; movement stays suppressed until re-pickup', () => {
    const t = new SoftTakeover(TOLERANCE);
    expect(t.feed(0, 0)).toBe(true); // latched at 0
    expect(t.feed(1, 0)).toBe(true); // fader → +1 applies
    // MATCH (external) sets software to +5: the next fader move must not jump
    expect(t.feed(1.2, 5)).toBe(false);
    expect(t.feed(3, 5)).toBe(false);
    // fader crosses +5: picked up again
    expect(t.feed(5.5, 5)).toBe(true);
    expect(t.feed(6, 5.5)).toBe(true);
  });

  it('a software change matching the last applied value keeps the latch', () => {
    const t = new SoftTakeover(TOLERANCE);
    expect(t.feed(2, 2)).toBe(true);
    // engine echoes our own write back (within tolerance): still latched
    expect(t.feed(2.5, 2)).toBe(true);
    expect(t.feed(3, 2.5)).toBe(true);
  });

  it('deck reload (software reset to 0) unlatches like any external change', () => {
    const t = new SoftTakeover(TOLERANCE);
    expect(t.feed(6, 6)).toBe(true); // latched high
    expect(t.feed(6.2, 0)).toBe(false); // reload reset pitch: suppressed
    expect(t.feed(4, 0)).toBe(false);
    expect(t.feed(-0.5, 0)).toBe(true); // crossed 0: picked up
  });

  it('crossing while waiting counts across suppressed samples, not just from latch time', () => {
    const t = new SoftTakeover(TOLERANCE);
    expect(t.feed(-6, 3)).toBe(false);
    expect(t.feed(-2, 3)).toBe(false);
    expect(t.feed(2, 3)).toBe(false);
    expect(t.feed(3.4, 3)).toBe(true); // previous suppressed sample was below
  });
});
