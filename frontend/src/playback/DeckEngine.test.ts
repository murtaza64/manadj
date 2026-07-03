import { describe, expect, it } from 'vitest';
import { DeckEngine } from './DeckEngine';
import type { DeckAudioPort } from './mixer';

/**
 * Engine-level bend semantics, exercised through the public interface with
 * no audio: bend/pitch state and their load behavior don't need a source
 * node. The port is a true seam and is never reached in these paths (audio
 * access only happens on decode/start, and the load here fails at fetch).
 */
const unusedPort: DeckAudioPort = {
  ensureAudio: () => {
    throw new Error('audio must not be touched in these tests');
  },
};

describe('DeckEngine bend', () => {
  it('exposes bend in the snapshot and releases to zero', () => {
    const engine = new DeckEngine(unusedPort);
    expect(engine.getSnapshot().bendPercent).toBe(0);
    engine.setBend(2);
    expect(engine.getSnapshot().bendPercent).toBe(2);
    engine.setBend(0);
    expect(engine.getSnapshot().bendPercent).toBe(0);
  });

  it('keeps pitch independent of bend', () => {
    const engine = new DeckEngine(unusedPort);
    engine.setPitch(4);
    engine.setBend(-2);
    expect(engine.getSnapshot().pitchPercent).toBe(4);
    expect(engine.getSnapshot().bendPercent).toBe(-2);
    engine.setBend(0);
    expect(engine.getSnapshot().pitchPercent).toBe(4);
  });

  it('auto-clears bend on Load (even a failing one), keeping pitch', async () => {
    const engine = new DeckEngine(unusedPort);
    engine.setPitch(4);
    engine.setBend(2);
    // Unroutable port: the fetch fails fast, but the load reset runs first.
    await engine.load({ trackId: 1, audioUrl: 'http://127.0.0.1:1/none', bpm: 128 });
    expect(engine.getSnapshot().loadState).toBe('error');
    expect(engine.getSnapshot().bendPercent).toBe(0);
    expect(engine.getSnapshot().pitchPercent).toBe(4);
  });
});
