import { afterEach, describe, expect, it } from 'vitest';
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

// The ADR 0013 mayStart tripwire tests lived here until ADR 0022 removed
// the tripwire: with one shared AudioContext there is no second clock a
// start gesture could resurrect, and the editor's conductor drives these
// same engines — a per-surface start veto would block it.

describe('play latch (load in flight)', () => {
  it('play during a load latches intent without touching audio', async () => {
    const engine = new DeckEngine(unusedPort);
    // Loading state lets play latch intent without touching audio.
    const load = engine.load({ trackId: 1, audioUrl: 'http://127.0.0.1:1/none', bpm: 128 });
    engine.play();
    // The failing load clears the latch; the point is play() latched.
    await load;
    expect(engine.getSnapshot().loadState).toBe('error');
  });
});

describe('DeckEngine active loop (looping 03)', () => {
  afterEach(() => _clearBufferCacheForTests());

  const fakeBuffer = {
    duration: 180,
    sampleRate: 44100,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array(44100),
  } as unknown as AudioBuffer;

  /** A 120 BPM grid from 0s: beats every 0.5s across the whole track. */
  const beatTimes = Array.from({ length: 360 }, (_, i) => i * 0.5);

  async function loadedEngine(trackId: number, grid: number[] | null = beatTimes) {
    putCachedBuffer(trackId, fakeBuffer);
    const engine = new DeckEngine(unusedPort);
    await engine.load({
      trackId,
      audioUrl: 'http://127.0.0.1:1/none',
      bpm: 120,
      cueDefaults: Promise.resolve({ savedCuePoint: null, beatTimes: grid }),
    });
    return engine;
  }

  it('engages at the playhead and exposes the region in the snapshot', async () => {
    const engine = await loadedEngine(20);
    engine.seek(10.1);
    engine.toggleLoop();
    const s = engine.getSnapshot();
    expect(s.loop).not.toBeNull();
    // Quantize defaults ON: start snaps to the nearest beat, 4 beats long.
    expect(s.loop!.start).toBeCloseTo(10.0, 10);
    expect(s.loop!.end).toBeCloseTo(12.0, 10);
    expect(s.loop!.lengthBeats).toBe(4);
    expect(s.pendingLoopBeats).toBe(4);
    expect(s.hasBeatgrid).toBe(true);
    // Engage never moves the playhead.
    expect(engine.getPlayhead()).toBeCloseTo(10.1, 10);
  });

  it('release keeps the playhead where it is', async () => {
    const engine = await loadedEngine(21);
    engine.seek(10);
    engine.toggleLoop();
    engine.toggleLoop();
    expect(engine.getSnapshot().loop).toBeNull();
    expect(engine.getPlayhead()).toBeCloseTo(10, 10);
  });

  it('is inert on a gridless Track', async () => {
    const engine = await loadedEngine(22, null);
    engine.seek(10);
    engine.toggleLoop();
    expect(engine.getSnapshot().loop).toBeNull();
    expect(engine.getSnapshot().hasBeatgrid).toBe(false);
  });

  it('Load clears the loop but keeps the pending size', async () => {
    const engine = await loadedEngine(23);
    engine.seek(10);
    engine.toggleLoop();
    expect(engine.getSnapshot().loop).not.toBeNull();
    putCachedBuffer(24, fakeBuffer);
    await engine.load({
      trackId: 24,
      audioUrl: 'http://127.0.0.1:1/none',
      bpm: 120,
      cueDefaults: Promise.resolve({ savedCuePoint: null, beatTimes }),
    });
    const s = engine.getSnapshot();
    expect(s.loop).toBeNull();
    expect(s.pendingLoopBeats).toBe(4);
  });

  it('adjusts the pending size without a loaded Track (Deck preference)', () => {
    const engine = new DeckEngine(unusedPort);
    engine.resizeLoop('halve');
    expect(engine.getSnapshot().pendingLoopBeats).toBe(2);
    engine.resizeLoop('double');
    engine.resizeLoop('double');
    expect(engine.getSnapshot().pendingLoopBeats).toBe(8);
  });

  it('loopPreset engages, resizes in place, and the lit size releases (midi-performance-ops 02)', async () => {
    const engine = await loadedEngine(27);
    engine.seek(10);
    engine.loopPreset(8); // no loop → engage at the playhead
    let s = engine.getSnapshot();
    expect(s.loop!.start).toBeCloseTo(10, 10);
    expect(s.loop!.end).toBeCloseTo(14, 10);
    expect(s.pendingLoopBeats).toBe(8);
    engine.loopPreset(1); // different size → resize, start edge fixed
    s = engine.getSnapshot();
    expect(s.loop!.start).toBeCloseTo(10, 10);
    expect(s.loop!.end).toBeCloseTo(10.5, 10);
    expect(s.pendingLoopBeats).toBe(1);
    engine.loopPreset(1); // same size → release
    expect(engine.getSnapshot().loop).toBeNull();
  });

  it('loopPreset remembers the pending size without a loaded Track', () => {
    const engine = new DeckEngine(unusedPort);
    engine.loopPreset(16);
    const s = engine.getSnapshot();
    expect(s.loop).toBeNull();
    expect(s.pendingLoopBeats).toBe(16);
  });

  it('beat jump translates an active loop; seek cancels it', async () => {
    const engine = await loadedEngine(26);
    engine.seek(10);
    engine.toggleLoop(); // [10, 12)
    engine.jumpBeats(4); // +2s at 120 BPM
    let s = engine.getSnapshot();
    expect(s.loop!.start).toBeCloseTo(12, 10);
    expect(s.loop!.end).toBeCloseTo(14, 10);
    engine.seek(13);
    s = engine.getSnapshot();
    expect(s.loop).toBeNull();
  });

  it('loop state survives a pause (Deck state, not playback state)', async () => {
    const engine = await loadedEngine(25);
    engine.seek(10);
    engine.toggleLoop();
    engine.pause(); // already paused: still must not clear the loop
    expect(engine.getSnapshot().loop).not.toBeNull();
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
    engine.setTrackBpm(9, 240);
    expect(engine.getSnapshot().bpm).toBe(240);
    engine.jumpBeats(4); // 4 beats at 240 = 1s
    expect(engine.getPlayhead()).toBeCloseTo(13);
  });

  it('setTrackBpm ignores a push addressed to a track that is not loaded', async () => {
    putCachedBuffer(10, fakeBuffer);
    const engine = new DeckEngine(unusedPort);
    await engine.load({ trackId: 10, audioUrl: 'http://127.0.0.1:1/none', bpm: 120 });
    engine.setTrackBpm(99, 240);
    expect(engine.getSnapshot().bpm).toBe(120);
  });
});

describe('DeckEngine beatgrid refresh (cue-quantize-bpm 01)', () => {
  afterEach(() => _clearBufferCacheForTests());

  const fakeBuffer = {
    duration: 180,
    sampleRate: 44100,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array(44100),
  } as unknown as AudioBuffer;

  /** A 120 BPM grid from 0s: beats every 0.5s. */
  const grid120 = Array.from({ length: 360 }, (_, i) => i * 0.5);
  /** The same track re-tempo'd to 240 BPM: beats every 0.25s. */
  const grid240 = Array.from({ length: 720 }, (_, i) => i * 0.25);

  async function loadedEngine(trackId: number, grid: number[] | null = grid120) {
    putCachedBuffer(trackId, fakeBuffer);
    const engine = new DeckEngine(unusedPort);
    await engine.load({
      trackId,
      audioUrl: 'http://127.0.0.1:1/none',
      bpm: 120,
      cueDefaults: Promise.resolve({ savedCuePoint: null, beatTimes: grid }),
    });
    return engine;
  }

  it('a refreshed grid governs quantized cue placement (BPM re-tempo)', async () => {
    const engine = await loadedEngine(30);
    engine.setBeatTimes(30, grid240);
    engine.seek(10.35);
    // Paused, away from the cue: cue-down is a placement gesture —
    // Quantize (default ON) snaps it to the nearest beat.
    engine.cueDown();
    // The re-tempo'd grid gives 10.25; the stale load-time grid gave 10.5.
    expect(engine.getSnapshot().cuePoint).toBeCloseTo(10.25, 10);
  });

  it('ignores a refresh addressed to a track that is not loaded', async () => {
    const engine = await loadedEngine(31);
    engine.setBeatTimes(99, grid240);
    engine.seek(10.35);
    engine.cueDown();
    expect(engine.getSnapshot().cuePoint).toBeCloseTo(10.5, 10);
  });

  it('a grid removed by refresh leaves the deck gridless', async () => {
    const engine = await loadedEngine(32);
    expect(engine.getSnapshot().hasBeatgrid).toBe(true);
    engine.setBeatTimes(32, null);
    expect(engine.getSnapshot().hasBeatgrid).toBe(false);
    engine.seek(10);
    engine.toggleLoop(); // auto-loop is inert without a grid
    expect(engine.getSnapshot().loop).toBeNull();
  });
});
