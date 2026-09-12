// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { DeckContext, useDeckSnapshot, type DeckContextValue } from '../../hooks/useDeck';
import { DeckEngine } from '../../playback/DeckEngine';
import { createBeatjumpSize } from '../../playback/beatjump';
import { _clearBufferCacheForTests, putCachedBuffer } from '../../playback/bufferCache';
import { setQuantize } from '../../playback/quantizeStore';
import type { DeckAudioPort } from '../../playback/mixer';
import { DeckKeys } from './DeckKeys';
import { CaptureRecorder, type CaptureMixerSource } from '../../capture/recorder';
import type { CaptureEvent } from '../../capture/events';

const starts = vi.hoisted(() => [] as { position: number; when: number }[]);
const build = vi.hoisted(() => ({ gate: null as Promise<void> | null }));
vi.mock('../../hooks/useHotCueActions', () => ({ useHotCueActions: () => ({ enabled: false }) }));
vi.mock('../../hooks/useMixer', () => ({ useMixer: () => ({}) }));
vi.mock('../../settings/persistedSettings', () => ({ writeSetting: vi.fn(), removeSetting: vi.fn() }));
vi.mock('../../playback/worklet/deckSourceNode', () => ({
  DeckSourceNode: class {
    static async create(ctx: AudioContext) { await build.gate; return new this(ctx); }
    ctx: AudioContext;
    constructor(ctx: AudioContext) { this.ctx = ctx; }
    loadTrack() {}
    start(position: number, _id: number, when: number) { starts.push({ position, when }); }
    stop() {}
    setMode() {}
    setLoop() {}
    setRateAt() {}
    connect() {}
    disconnect() {}
  },
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
function Status() {
  return <span>{useDeckSnapshot(s => s.playing) ? 'playing' : 'paused'}</span>;
}
afterEach(() => {
  _clearBufferCacheForTests();
  setQuantize(true);
  vi.restoreAllMocks();
  starts.length = 0;
  build.gate = null;
  vi.useRealTimers();
});

it.each<{ gapMs: number; warm: boolean; quantize: boolean; running: boolean; resumeBetween?: boolean }>([
  { gapMs: 0, warm: true, quantize: false, running: true },
  { gapMs: 5, warm: true, quantize: false, running: true },
  { gapMs: 0, warm: false, quantize: false, running: true },
  { gapMs: 0, warm: true, quantize: true, running: true },
  { gapMs: 0, warm: true, quantize: false, running: false },
  { gapMs: 0, warm: true, quantize: false, running: false, resumeBetween: true },
  { gapMs: 0, warm: false, quantize: false, running: false, resumeBetween: true },
])('keyboard start timing: %j', async ({ gapMs, warm, quantize, running, resumeBetween }) => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  setQuantize(quantize);
  let wall = 1000;
  let audio = 10;
  let state: AudioContextState = running ? 'running' : 'suspended';
  vi.spyOn(performance, 'now').mockImplementation(() => wall);
  const ctx = { get currentTime() { return audio; }, get state() { return state; },
    resume: async () => {} } as AudioContext;
  const port: DeckAudioPort = { ensureAudio: () => ({ ctx, input: {} as AudioNode }) };
  const engines = { A: new DeckEngine(port), B: new DeckEngine(port),
    C: new DeckEngine(port), D: new DeckEngine(port) };
  const mixer: CaptureMixerSource = {
    getChannelState: () => ({ trim: 0.5, eq: { low: 0.5, mid: 0.5, high: 0.5 },
      filter: 0, fader: 1, pfl: false, stems: { vocals: true, drums: true, bass: true, other: true } }),
    getCrossfader: () => 0, getCrossfaderAssignment: () => 'thru',
    getCrossfaderEnabled: () => false, getMaster: () => 1, subscribe: () => () => {},
  };
  const captured: CaptureEvent[] = [];
  let recorder: CaptureRecorder | undefined;
  let releaseBuild = () => {};
  putCachedBuffer(1, {
    duration: 180, sampleRate: 44100, numberOfChannels: 1,
    getChannelData: () => new Float32Array(44100),
  } as unknown as AudioBuffer);
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    for (const engine of [engines.A, engines.B]) {
      await engine.load({ trackId: 1, audioUrl: '/unused', bpm: 120,
        beatTimes: Promise.resolve(Array.from({ length: 360 }, (_, i) => i * 0.5)) });
      if (warm) {
        engine.play();
        for (let i = 0; i < 4; i++) await Promise.resolve();
        engine.pause();
      }
      engine.seek(30);
      engine.setPitch(10);
    }
    const render = () => act(async () => root.render(<>
      {(['A', 'B'] as const).map(deck => (
        <DeckContext.Provider key={deck} value={{ deck, engine: engines[deck],
          loadedTrack: { id: 1 }, beatjump: createBeatjumpSize() } as DeckContextValue}>
          <DeckKeys /><Status />
        </DeckContext.Provider>
      ))}
    </>));
    await render();
    recorder = new CaptureRecorder(mixer, engines, () => {}, event => captured.push(event));
    recorder.start();
    if (!warm) build.gate = new Promise(resolve => { releaseBuild = resolve; });
    // Both OS events already exist when A's playback update blocks the UI.
    const a = new KeyboardEvent('keydown', { key: 'd', bubbles: true });
    const b = new KeyboardEvent('keydown', { key: 'k', bubbles: true });
    Object.defineProperty(a, 'timeStamp', { value: wall });
    Object.defineProperty(b, 'timeStamp', { value: wall + gapMs });
    await act(async () => { document.dispatchEvent(a); });
    wall += 250;
    const elapsed = running ? 0.25 : resumeBetween ? 0.05 : 0;
    if (resumeBetween) state = 'running';
    audio += elapsed;
    await act(async () => { document.dispatchEvent(b); });
    expect(engines.A.getSnapshot().playing).toBe(true);
    expect(engines.B.getSnapshot().playing).toBe(true);
    expect(engines.A.getPlayhead()).toBeCloseTo(30 + elapsed * 1.1, 8);
    const gapSeconds = !quantize && (running || resumeBetween) ? gapMs / 1000 : elapsed;
    expect(engines.A.getPlayhead() - engines.B.getPlayhead()).toBeCloseTo(gapSeconds * 1.1, 8);
    const plays = captured.filter(e => e.kind === 'transport' && e.action === 'play');
    expect(plays).toHaveLength(2);
    expect(plays[1]).toMatchObject({ channel: 'B', playhead: engines.B.getPlayhead() });
    await act(async () => { releaseBuild(); });
    expect(starts.slice(-2)).toEqual([
      { position: 30 * 44100, when: 10 },
      { position: 30 * 44100, when: 10 + gapSeconds },
    ]);
    // Source commands and capture precede publication. An unrelated parent
    // render must not sneak the authoritative state into the UI early.
    await render();
    expect(container.textContent).toBe('pausedpaused');
    act(() => vi.runOnlyPendingTimers());
    expect(container.textContent).toBe('playingplaying');
    // Pausing uses the live position, not the age of its keyboard event.
    const pauseElapsed = state === 'running' ? 1 : 0;
    audio += pauseElapsed;
    wall += 1000;
    act(() => document.dispatchEvent(a));
    expect(engines.A.getSnapshot().playing).toBe(false);
    expect(engines.A.getPlayhead()).toBeCloseTo(30 + (elapsed + pauseElapsed) * 1.1, 8);
  } finally {
    recorder?.dispose();
    releaseBuild();
    act(() => root.unmount());
    for (const engine of Object.values(engines)) engine.dispose();
  }
});

it.each(['release', 'resize'] as const)('preserves a pending keyboard launch through loop %s', async change => {
  setQuantize(false);
  let audio = 10;
  vi.spyOn(performance, 'now').mockReturnValue(1000);
  const ctx = { get currentTime() { return audio; }, state: 'running' } as AudioContext;
  const engine = new DeckEngine({ ensureAudio: () => ({ ctx, input: {} as AudioNode }) });
  putCachedBuffer(1, {
    duration: 180, sampleRate: 44100, numberOfChannels: 1,
    getChannelData: () => new Float32Array(44100),
  } as unknown as AudioBuffer);
  let release = () => {};
  build.gate = new Promise(resolve => { release = resolve; });
  try {
    await engine.load({ trackId: 1, audioUrl: '/unused', bpm: 120,
      beatTimes: Promise.resolve(Array.from({ length: 360 }, (_, i) => i * 0.5)) });
    engine.seek(30);
    engine.loopPreset(0.25);
    engine.togglePlay(1000);
    audio += 0.1875;
    expect(engine.getPlayhead()).toBeCloseTo(30.0625, 8);
    if (change === 'release') engine.toggleLoop();
    else engine.resizeActiveLoop('double');
    expect(engine.getPlayhead()).toBeCloseTo(30.0625, 8);
    release();
    for (let i = 0; i < 4; i++) await Promise.resolve();
    expect(starts).toEqual([{ position: 30.0625 * 44100, when: audio }]);
    expect(engine.getPlayhead()).toBeCloseTo(30.0625, 8);
  } finally {
    release();
    engine.dispose();
  }
});
