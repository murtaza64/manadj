import { describe, expect, it } from 'vitest';
import { INITIAL_DOMINANCE, stepDominance } from './dominance';
import type { DominanceState } from './dominance';

const step = (
  state: DominanceState,
  a: number,
  b: number,
  dt = 1 / 60,
  eligibleA = true,
  eligibleB = true
) =>
  stepDominance(
    state,
    [
      { id: 'a', level: a, eligible: eligibleA },
      { id: 'b', level: b, eligible: eligibleB },
    ],
    dt
  );

const run = (
  state: DominanceState,
  a: number,
  b: number,
  seconds: number,
  dt = 1 / 60
) => {
  let s = state;
  for (let t = 0; t < seconds; t += dt) s = step(s, a, b, dt);
  return s;
};

describe('stepDominance', () => {
  it('picks the loudest channel from cold start', () => {
    const s = step(INITIAL_DOMINANCE, 0.2, 0.6);
    expect(s.dominantId).toBe('b');
  });

  it('ignores brief spikes from the other deck (double-drop flap)', () => {
    let s = run(INITIAL_DOMINANCE, 0.6, 0.3, 2);
    expect(s.dominantId).toBe('a');
    // 100ms spike on b, twice the level — must NOT flip.
    s = run(s, 0.6, 1.2, 0.1);
    expect(s.dominantId).toBe('a');
  });

  it('switches after a sustained clear takeover (~1s)', () => {
    let s = run(INITIAL_DOMINANCE, 0.6, 0.3, 2);
    // b becomes decisively louder and stays that way.
    s = run(s, 0.3, 0.9, 1.5);
    expect(s.dominantId).toBe('b');
  });

  it('holds the incumbent when levels are comparable (layered section)', () => {
    let s = run(INITIAL_DOMINANCE, 0.6, 0.3, 2);
    // Near-equal wobble: incumbent keeps the slot (hysteresis margin).
    s = run(s, 0.55, 0.6, 5);
    expect(s.dominantId).toBe('a');
  });

  it('hands off immediately when the incumbent goes ineligible', () => {
    let s = run(INITIAL_DOMINANCE, 0.6, 0.3, 2);
    s = step(s, 0, 0.3, 1 / 60, false, true);
    expect(s.dominantId).toBe('b');
  });

  it('returns null when nothing is eligible', () => {
    const s = step(INITIAL_DOMINANCE, 0.5, 0.5, 1 / 60, false, false);
    expect(s.dominantId).toBeNull();
  });
});
