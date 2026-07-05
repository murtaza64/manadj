import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeckEngine } from './DeckEngine';
import { _clearBufferCacheForTests, putCachedBuffer } from './bufferCache';
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

describe('DeckEngine key lock (key-lock 03)', () => {
  it('defaults OFF at the engine level (editor decks keep varispeed)', () => {
    const engine = new DeckEngine(unusedPort);
    expect(engine.getSnapshot().keyLock).toBe(false);
  });

  it('setKeyLock flips the snapshot without touching audio', () => {
    const engine = new DeckEngine(unusedPort);
    engine.setKeyLock(true);
    expect(engine.getSnapshot().keyLock).toBe(true);
    engine.setKeyLock(false);
    expect(engine.getSnapshot().keyLock).toBe(false);
  });

  it('same-value setKeyLock does not emit (no re-render churn)', () => {
    const engine = new DeckEngine(unusedPort);
    let emits = 0;
    engine.subscribe(() => {
      emits += 1;
    });
    engine.setKeyLock(false); // already off
    expect(emits).toBe(0);
    engine.setKeyLock(true);
    expect(emits).toBe(1);
  });

  it('key lock survives a Load (Deck setting, not Track state)', async () => {
    const engine = new DeckEngine(unusedPort);
    engine.setKeyLock(true);
    await engine.load({ trackId: 1, audioUrl: 'http://127.0.0.1:1/none', bpm: 128 });
    expect(engine.getSnapshot().keyLock).toBe(true);
  });
});

describe('arbiter tripwire (ADR 0013)', () => {
  const blockedPort: DeckAudioPort = {
    ensureAudio: () => {
      throw new Error('audio must not be touched when blocked');
    },
    mayStart: () => false,
  };

  it('play/togglePlay/cueDown are warned no-ops when the surface is not audible', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const engine = new DeckEngine(blockedPort);
    engine.play();
    engine.togglePlay();
    engine.cueDown();
    expect(engine.getSnapshot().playing).toBe(false);
    expect(engine.getSnapshot().pendingPlay).toBe(false);
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  it('pause and stateless controls stay allowed while blocked', () => {
    const engine = new DeckEngine(blockedPort);
    engine.pause(); // never touches audio
    engine.setPitch(2);
    expect(engine.getSnapshot().pitchPercent).toBe(2);
  });

  it('a port without mayStart behaves as always-allowed (latch path)', async () => {
    const engine = new DeckEngine(unusedPort);
    // Loading state lets play latch intent without touching audio.
    const load = engine.load({ trackId: 1, audioUrl: 'http://127.0.0.1:1/none', bpm: 128 });
    engine.play();
    // The failing load clears the latch; the point is play() was not blocked.
    await load;
    expect(engine.getSnapshot().loadState).toBe('error');
  });
});

describe('decoded-buffer cache (mix-editor 28)', () => {
  afterEach(() => _clearBufferCacheForTests());

  // Duck-typed AudioBuffer: load() only reads channels for the cue scan.
  const fakeBuffer = {
    duration: 180,
    sampleRate: 44100,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array(44100), // silence
  } as unknown as AudioBuffer;

  it('a cached track loads to ready with no fetch and no audio touch', async () => {
    putCachedBuffer(7, fakeBuffer);
    const engine = new DeckEngine(unusedPort); // throws if audio is touched
    // Unroutable URL: any fetch attempt would fail the load.
    await engine.load({ trackId: 7, audioUrl: 'http://127.0.0.1:1/none', bpm: 128 });
    expect(engine.getSnapshot().loadState).toBe('ready');
    expect(engine.getSnapshot().duration).toBe(180);
  });

  it('an uncached track still takes the fetch path', async () => {
    const engine = new DeckEngine(unusedPort);
    await engine.load({ trackId: 8, audioUrl: 'http://127.0.0.1:1/none', bpm: 128 });
    expect(engine.getSnapshot().loadState).toBe('error');
  });

  it('setTrackBpm keeps beat-jump math honest after a BPM edit', async () => {
    putCachedBuffer(9, fakeBuffer);
    const engine = new DeckEngine(unusedPort);
    await engine.load({ trackId: 9, audioUrl: 'http://127.0.0.1:1/none', bpm: 120 });
    engine.seek(10);
    engine.jumpBeats(4); // 4 beats at 120 = 2s
    expect(engine.getPlayhead()).toBeCloseTo(12);
    engine.setTrackBpm(240);
    expect(engine.getSnapshot().bpm).toBe(240);
    engine.jumpBeats(4); // 4 beats at 240 = 1s
    expect(engine.getPlayhead()).toBeCloseTo(13);
  });
});
