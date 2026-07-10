import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeckEngine } from './DeckEngine';
import { _clearBufferCacheForTests, putCachedBuffer } from './bufferCache';
import type { DeckAudioPort } from './mixer';

// The lead-in audio tests drive the frame-0 entry through a mocked worklet
// node — the pre-start scheduling and the on-time entry are the engine's
// concern; the real DeckSourceNode needs an AudioWorklet the test env lacks.
const startCalls: { positionFrames: number; startId: number }[] = [];
const stopCalls: number[] = [];
vi.mock('./worklet/deckSourceNode', () => {
  class FakeDeckSourceNode {
    static create = vi.fn(async (ctx: AudioContext) => new FakeDeckSourceNode(ctx));
    ctx: AudioContext;
    onEnded: ((startId: number) => void) | null = null;
    constructor(ctx: AudioContext) {
      this.ctx = ctx;
    }
    loadTrack(): void {}
    start(positionFrames: number, startId: number): void {
      startCalls.push({ positionFrames, startId });
    }
    stop(): void {
      stopCalls.push(1);
    }
    setMode(): void {}
    setLoop(): void {}
    setRateAt(): void {}
    connect(): void {}
    disconnect(): void {}
  }
  return { DeckSourceNode: FakeDeckSourceNode };
});

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

  it('resizeActiveLoop resizes only a running loop (midi-performance-ops 03)', async () => {
    const engine = await loadedEngine(28);
    engine.seek(10);
    // No loop: consumed = false, and even the pending size stays put (the
    // idle press belongs to beatjump-size).
    expect(engine.resizeActiveLoop('halve')).toBe(false);
    expect(engine.getSnapshot().pendingLoopBeats).toBe(4);
    engine.toggleLoop(); // [10, 12)
    expect(engine.resizeActiveLoop('halve')).toBe(true);
    const s = engine.getSnapshot();
    expect(s.loop!.end).toBeCloseTo(11, 10);
    expect(s.loop!.lengthBeats).toBe(2);
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

  it('displays the loop size as a live-grid projection after a re-tempo (ADR 0027 §6)', async () => {
    const engine = await loadedEngine(29);
    engine.seek(10);
    engine.toggleLoop(); // [10, 12) = 4 beats on the 0.5s grid
    expect(engine.getSnapshot().loopBeatsLabel).toBe('4');
    // Re-tempo to 174: the audible region is untouched, but the displayed
    // beat count projects the new grid — 2.0s spans ~5.8 beats.
    const grid174 = Array.from({ length: 600 }, (_, i) => i * (60 / 174));
    engine.setBeatTimes(29, grid174);
    const s = engine.getSnapshot();
    expect(s.loop!.start).toBeCloseTo(10, 10);
    expect(s.loop!.end).toBeCloseTo(12, 10);
    expect(s.loopBeatsLabel).toBe('~5.8');
  });

  it('loop state survives a pause (Deck state, not playback state)', async () => {
    const engine = await loadedEngine(25);
    engine.seek(10);
    engine.toggleLoop();
    engine.pause(); // already paused: still must not clear the loop
    expect(engine.getSnapshot().loop).not.toBeNull();
  });
});

describe('jumpBeats displaces via the live grid (ADR 0027 §5)', () => {
  afterEach(() => _clearBufferCacheForTests());

  const fakeBuffer = {
    duration: 180,
    sampleRate: 44100,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array(44100),
  } as unknown as AudioBuffer;

  /** A 120 BPM grid from 0s: beats every 0.5s across the whole track. */
  const grid120 = Array.from({ length: 360 }, (_, i) => i * 0.5);
  /** Variable grid: 120 BPM until t=60 (beats 0..120), then 150 BPM
   * (0.4s beats). */
  const gridVar = [
    ...Array.from({ length: 120 }, (_, i) => i * 0.5),
    ...Array.from({ length: 150 }, (_, i) => 60 + i * 0.4),
  ];

  async function loadedEngine(trackId: number, grid: number[] | null) {
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

  it('preserves intra-beat phase exactly (off-phase regression)', async () => {
    const engine = await loadedEngine(40, grid120);
    engine.seek(10.125); // beat coordinate 20.25
    engine.jumpBeats(4);
    expect(engine.getPlayhead()).toBe(12.125); // (20+4)+0.25 exactly
    engine.jumpBeats(-4);
    expect(engine.getPlayhead()).toBe(10.125);
  });

  it('equals the old scalar math on a constant grid', async () => {
    const engine = await loadedEngine(41, grid120);
    engine.seek(10);
    engine.jumpBeats(4); // 4 beats at 120 = 2s, same as beats*(60/bpm)
    expect(engine.getPlayhead()).toBeCloseTo(12, 10);
  });

  it('jumps across a tempo boundary by beat count, not first-segment seconds', async () => {
    const engine = await loadedEngine(42, gridVar);
    engine.seek(59); // beat 118: 2 beats at 0.5s remain before the boundary
    engine.jumpBeats(8);
    // beats 118→120 cover 1.0s; 6 more at 0.4s cover 2.4s → 62.4.
    // The scalar math said 59 + 8×0.5 = 63.
    expect(engine.getPlayhead()).toBeCloseTo(62.4, 10);
  });

  it('a stale engine bpm scalar cannot skew a gridded jump', async () => {
    const engine = await loadedEngine(43, grid120);
    engine.setTrackBpm(43, 87); // half-time-ish scalar; the grid says 120
    engine.seek(10);
    engine.jumpBeats(4);
    expect(engine.getPlayhead()).toBeCloseTo(12, 10); // grid wins
  });

  it('falls back to the bpm scalar without a grid', async () => {
    const engine = await loadedEngine(44, null);
    engine.seek(10);
    engine.jumpBeats(4); // 4 beats at 120 = 2s
    expect(engine.getPlayhead()).toBeCloseTo(12, 10);
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

describe('pre-start lead-in placement (issue 07)', () => {
  afterEach(() => _clearBufferCacheForTests());

  const fakeBuffer = {
    duration: 180,
    sampleRate: 44100,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array(44100),
  } as unknown as AudioBuffer;

  /** A 120 BPM grid from 0s: beats every 0.5s. */
  const grid120 = Array.from({ length: 360 }, (_, i) => i * 0.5);

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

  it('seek before the track holds a negative playhead instead of clamping to 0', async () => {
    const engine = await loadedEngine(50);
    engine.seek(-1.5);
    expect(engine.getPlayhead()).toBeCloseTo(-1.5, 10);
  });

  it('a backward beat jump near the head preserves the beat distance', async () => {
    const engine = await loadedEngine(51);
    engine.seek(0.5); // half a second in
    engine.jumpBeats(-4); // 4 beats × 0.5s back = 2s → -1.5s, not 0
    expect(engine.getPlayhead()).toBeCloseTo(-1.5, 10);
  });

  it('preserves grid phase across the lead-in (jump out returns exactly)', async () => {
    const engine = await loadedEngine(52);
    engine.seek(0.375); // beat coordinate 0.75 (intra-beat phase 0.75)
    engine.jumpBeats(-4); // extrapolates the edge interval into the lead-in
    expect(engine.getPlayhead()).toBeCloseTo(-1.625, 10);
    engine.jumpBeats(4); // back out lands exactly where it started
    expect(engine.getPlayhead()).toBeCloseTo(0.375, 10);
  });

  it('bounds the lead-in at the floor (no unbounded pre-roll)', async () => {
    const engine = await loadedEngine(53);
    engine.seek(-1000);
    expect(engine.getPlayhead()).toBeCloseTo(-30, 10); // MAX_LEAD_IN_SECONDS
  });

  it('never places a cue in the lead-in (cues are real track time)', async () => {
    const engine = await loadedEngine(54);
    engine.seek(-2);
    engine.cueDown(); // set the cue at the current (negative) position
    // A cue clamps to >= 0 even though the playhead is negative.
    expect(engine.getSnapshot().cuePoint).toBeGreaterThanOrEqual(0);
  });
});

describe('pre-start lead-in audio (issue 07)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    startCalls.length = 0;
    stopCalls.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
    _clearBufferCacheForTests();
  });

  const fakeBuffer = {
    duration: 180,
    sampleRate: 44100,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array(44100),
  } as unknown as AudioBuffer;

  /** An AudioContext stub whose currentTime the test advances by hand,
   * paired with a fake channel input. Only the fields the start path
   * touches are present. */
  function fakeAudioPort() {
    const ctx = {
      currentTime: 0,
      state: 'running',
      resume: () => Promise.resolve(),
    } as { currentTime: number; state: AudioContextState; resume: () => Promise<void> };
    const input = {} as AudioNode;
    const port: DeckAudioPort = {
      ensureAudio: () => ({ ctx: ctx as unknown as AudioContext, input }),
    };
    return { port, ctx };
  }

  async function loadedEngine(port: DeckAudioPort, trackId: number) {
    putCachedBuffer(trackId, fakeBuffer);
    const engine = new DeckEngine(port);
    await engine.load({
      trackId,
      audioUrl: 'http://127.0.0.1:1/none',
      bpm: 120,
      cueDefaults: Promise.resolve({
        savedCuePoint: null,
        beatTimes: Array.from({ length: 360 }, (_, i) => i * 0.5),
      }),
    });
    return engine;
  }

  it('plays silence through the lead-in, then enters the track on time at frame 0', async () => {
    const { port, ctx } = fakeAudioPort();
    const engine = await loadedEngine(port, 60);
    engine.seek(-2); // two seconds of pre-start lead-in
    engine.play();
    // Silent: no worklet voice yet, clock parked at the lead-in start.
    expect(startCalls).toHaveLength(0);
    expect(engine.getPlayhead()).toBeCloseTo(-2, 6);

    // Halfway through the lead-in: still silent, clock counting up.
    ctx.currentTime = 1;
    await vi.advanceTimersByTimeAsync(1000);
    expect(startCalls).toHaveLength(0);
    expect(engine.getPlayhead()).toBeCloseTo(-1, 6);

    // The t=0 crossing: the frame-0 voice starts on time.
    ctx.currentTime = 2;
    await vi.advanceTimersByTimeAsync(1000);
    expect(startCalls).toHaveLength(1);
    expect(startCalls[0].positionFrames).toBe(0);
    expect(engine.getPlayhead()).toBeCloseTo(0, 4);
  });

  it('a mid-play backward jump into the lead-in silences the running voice', async () => {
    const { port, ctx } = fakeAudioPort();
    const engine = await loadedEngine(port, 63);
    engine.seek(1.5);
    engine.play();
    await vi.advanceTimersByTimeAsync(0); // flush the async node build
    expect(startCalls).toHaveLength(1); // voice running at 1.5s
    // Jump 4 beats back (2s at 120 BPM): target -0.5s, mid-play.
    engine.jumpBeats(-4);
    // The old voice is retired — the lead-in is silent, not the old audio
    // playing on until track start.
    expect(stopCalls).toHaveLength(1);
    expect(startCalls).toHaveLength(1); // no new voice yet
    expect(engine.getPlayhead()).toBeCloseTo(-0.5, 6);
    // The t=0 crossing still enters on time at frame 0.
    ctx.currentTime = 0.5;
    await vi.advanceTimersByTimeAsync(500);
    expect(startCalls).toHaveLength(2);
    expect(startCalls[1].positionFrames).toBe(0);
  });

  it('a pause during the lead-in cancels the entry and rests at the negative position', async () => {
    const { port, ctx } = fakeAudioPort();
    const engine = await loadedEngine(port, 61);
    engine.seek(-2);
    engine.play();
    ctx.currentTime = 1;
    engine.pause();
    // Advancing past where the entry WOULD have fired: it must not.
    ctx.currentTime = 5;
    await vi.advanceTimersByTimeAsync(5000);
    expect(startCalls).toHaveLength(0);
    expect(engine.getPlayhead()).toBeCloseTo(-1, 4); // rested where paused
  });

  it('a rate change during the lead-in re-times the on-time entry', async () => {
    const { port, ctx } = fakeAudioPort();
    const engine = await loadedEngine(port, 62);
    engine.seek(-2);
    engine.play();
    // Slow to 0.75× at the midpoint: 1s of lead-in remains, now at 0.75
    // rate → 1.333s of wall-clock to the t=0 crossing.
    ctx.currentTime = 1;
    engine.setPitch(-25); // rate 0.75 (engine clamps at ±25%)
    expect(startCalls).toHaveLength(0);
    // At the OLD timing (another 1s → ctx 2) the entry must NOT fire yet.
    ctx.currentTime = 2;
    await vi.advanceTimersByTimeAsync(1000);
    expect(startCalls).toHaveLength(0);
    // At the re-timed crossing (~1.333s of wall-clock from the change).
    ctx.currentTime = 2.334;
    await vi.advanceTimersByTimeAsync(400);
    expect(startCalls).toHaveLength(1);
    expect(startCalls[0].positionFrames).toBe(0);
  });
});
