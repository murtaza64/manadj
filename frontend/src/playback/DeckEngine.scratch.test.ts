import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeckEngine } from './DeckEngine';
import { _clearBufferCacheForTests, putCachedBuffer } from './bufferCache';
import type { DeckAudioPort } from './mixer';
import { DeckSourceKernel } from './worklet/deckSourceKernel';
import type { ScratchMotion, ScratchFrame, ScheduledScratchFrame } from './worklet/scratchMotion';
import { scratchPosition } from './worklet/scratchMotion';
import { JogController } from '../midi/jog';
import { GRV6_JOG_CALIBRATION } from '../midi/jogCalibration';
import { CaptureRecorder } from '../capture/recorder';
import type { CaptureEvent } from '../capture/events';
import { planReplay } from '../sessions/replayPlanner';

const nodes: { kernel: DeckSourceKernel; scheduleScratch: ReturnType<typeof vi.fn>; cancelScratchSchedule: ReturnType<typeof vi.fn>;
  onEnded: ((startId: number) => void) | null;
  setMode: ReturnType<typeof vi.fn>; setScratch: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = [];
vi.mock('./worklet/deckSourceNode', () => ({
  DeckSourceNode: {
    create: vi.fn(async (ctx: AudioContext) => {
      const kernel = new DeckSourceKernel(1, 0);
      const node = {
        ctx, kernel, preserveScratchSchedule: false,
        onEnded: null as ((startId: number) => void) | null,
        loadTrack: vi.fn((buffer: AudioBuffer) => kernel.setTrack([buffer.getChannelData(0)], 1)),
        setMode: vi.fn((mode: 'resample' | 'stretch') => kernel.setMode(mode)),
        setLoop: vi.fn((region) => kernel.setLoop(region)),
        setRateAt: vi.fn(), start: vi.fn((p, id, when) => kernel.start(p, id, when, node.preserveScratchSchedule)),
        stop: vi.fn(() => kernel.stop(node.preserveScratchSchedule)),
        setScratch: vi.fn((motion: ScratchMotion) => kernel.setScratch(motion)),
        scheduleScratch: vi.fn((frames: ScheduledScratchFrame[]) => kernel.scheduleScratch(frames)),
        cancelScratchSchedule: vi.fn(() => kernel.cancelScratchSchedule()),
        connect: vi.fn(), disconnect: vi.fn(),
      };
      nodes.push(node);
      return node;
    }),
  },
}));

afterEach(() => { _clearBufferCacheForTests(); nodes.length = 0; });

async function setup() {
  const ctx = { currentTime: 0, state: 'running' };
  const port = { ensureAudio: () => ({ ctx, input: {} }) } as unknown as DeckAudioPort;
  putCachedBuffer(225, {
    duration: 100, sampleRate: 1000, numberOfChannels: 1,
    getChannelData: () => Float32Array.from({ length: 100000 }, (_, i) => i / 100000),
  } as unknown as AudioBuffer);
  const deck = new DeckEngine(port);
  await deck.load({ trackId: 225, audioUrl: '', bpm: 120,
    beatTimes: Promise.resolve(Array.from({ length: 200 }, (_, i) => i / 2)) });
  deck.seek(10);
  return { deck, ctx };
}

describe('DeckEngine Slip loops', () => {
  it('captures the resolved loop exit and carries it into a mid-loop replay plan', async () => {
    vi.useFakeTimers({ toFake: ['performance', 'setInterval', 'clearInterval'] });
    let recorder: CaptureRecorder | null = null;
    try {
      const { deck, ctx } = await setup();
      const events: CaptureEvent[] = [];
      const empty = () => new DeckEngine({ ensureAudio() { throw new Error('empty deck'); } });
      recorder = new CaptureRecorder({
        getChannelState: () => ({ fader: 1, trim: 0.5, eq: { low: 0.5, mid: 0.5, high: 0.5 },
          filter: 0, pfl: false, stems: { vocals: true, drums: true, bass: true, other: true } }),
        getCrossfader: () => 0, getCrossfaderAssignment: () => 'thru', getCrossfaderEnabled: () => false,
        getMaster: () => 1, subscribe: () => () => {},
      }, { A: deck, B: empty(), C: empty(), D: empty() }, () => {}, event => events.push(event));
      recorder.start();
      deck.setSlipMode(true);
      deck.play();
      await Promise.resolve();
      deck.toggleLoop();
      for (let i = 1; i <= 5; i++) {
        ctx.currentTime = i;
        vi.advanceTimersByTime(1000);
      }
      deck.toggleLoop();
      const exit = events.filter(e => e.kind === 'loop').at(-1)!;
      expect(exit).toMatchObject({ kind: 'loop', region: null, playhead: 15 });
      const result = planReplay([...events, { t: exit.t + 2, kind: 'tick', playheads: { A: 17 } }], exit.t - 2);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.plan.seed.decks.A.loop).toEqual({ start: 10, end: 12 });
        expect(result.plan.cues.find(c => c.kind === 'loop')).toMatchObject({ region: null, playhead: 15 });
      }
    } finally { recorder?.dispose(); vi.useRealTimers(); }
  });

  it.each([false, true])('returns to the unlooped clock after wraps (Key Lock=%s)', async keyLock => {
    const { deck, ctx } = await setup();
    deck.setKeyLock(keyLock);
    deck.setSlipMode(true);
    deck.play();
    await Promise.resolve();
    deck.toggleLoop();
    const kernel = nodes[0].kernel;
    kernel.render([new Float32Array(5000)], new Float32Array([1]), 0, 1000);
    ctx.currentTime = 5;
    expect(deck.getPlayhead()).toBe(11);
    expect(kernel.livePositionFrames).toBeCloseTo(11000);
    expect(deck.getSlipReturnPlayhead()).toBe(15);
    deck.toggleLoop();
    expect(deck.getSnapshot()).toMatchObject({ loop: null, playing: true });
    expect(deck.getSlipReturnPlayhead()).toBeNull();
    expect(deck.getPlayhead()).toBe(15);
    kernel.render([new Float32Array(100)], new Float32Array([1]), 5, 1000);
    ctx.currentTime = 5.1;
    expect(kernel.livePositionFrames).toBeCloseTo(deck.getPlayhead() * 1000);
  });

  it('keeps a normal loop normal when Slip is enabled after entry', async () => {
    const { deck, ctx } = await setup();
    deck.play();
    await Promise.resolve();
    deck.toggleLoop();
    deck.setSlipMode(true);
    ctx.currentTime = 5;
    expect(deck.getSlipReturnPlayhead()).toBeNull();
    deck.toggleLoop();
    expect(deck.getPlayhead()).toBe(11); // no phantom Slip from the raw audio anchor
  });

  it('preserves entry phase and integrates pitch/bend through resize and loop translation', async () => {
    const { deck, ctx } = await setup();
    deck.seek(10.1);
    deck.setSlipMode(true);
    deck.play();
    await Promise.resolve();
    deck.loopPreset(4);
    expect(deck.getSlipReturnPlayhead()).toBeCloseTo(10.1);
    ctx.currentTime = 1.5;
    deck.resizeLoop('halve'); // phase-mod restart from 11.6 to 10.6
    expect(deck.getPlayhead()).toBeCloseTo(10.6);
    expect(deck.getSlipReturnPlayhead()).toBeCloseTo(11.6);
    deck.setPitch(20);
    deck.setBend(2);
    deck.resizeActiveLoop('double');
    deck.loopPreset(8);
    deck.jumpBeats(16); // audible region translates, outer clock does not
    ctx.currentTime = 3.5;
    expect(deck.getSlipReturnPlayhead()).toBeCloseTo(14.048);
    deck.setBend(0);
    ctx.currentTime = 4.5;
    deck.loopPreset(8); // lit preset releases
    expect(deck.getPlayhead()).toBeCloseTo(15.248);
    expect(deck.getSnapshot().loop).toBeNull();
  });

  it('arms while paused and starts the hidden clock only at actual audio launch', async () => {
    const { deck, ctx } = await setup();
    deck.setSlipMode(true);
    deck.toggleLoop();
    ctx.currentTime = 5;
    expect(deck.getSlipReturnPlayhead()).toBe(10);
    deck.play();
    await Promise.resolve();
    ctx.currentTime = 8;
    expect(deck.getSlipReturnPlayhead()).toBe(13);
    deck.toggleLoop();
    expect(deck.getPlayhead()).toBe(13);
  });

  it('preserves an armed return through a paused loop translation before Play', async () => {
    const { deck, ctx } = await setup();
    deck.setSlipMode(true);
    deck.toggleLoop();
    deck.jumpBeats(16);
    expect(deck.getPlayhead()).toBe(18);
    expect(deck.getSlipReturnPlayhead()).toBe(10);
    deck.play();
    await Promise.resolve();
    ctx.currentTime = 3;
    expect(deck.getSlipReturnPlayhead()).toBe(13);
    deck.toggleLoop();
    expect(deck.getPlayhead()).toBe(13);
  });

  it.each([false, true])('release preserves a pending quantized launch (late timer=%s)', async late => {
    vi.useFakeTimers();
    try {
      const { deck, ctx } = await setup();
      deck.setSlipMode(true);
      deck.toggleLoop();
      deck.jumpBeats(16);
      deck.setLaunchReferenceProvider(() => ({ beatTimes: [0, 0.5, 1, 1.5, 2], playhead: 0.4 + ctx.currentTime }));
      deck.play(); // waits 100ms for peer beat
      deck.toggleLoop();
      expect(deck.getPlayhead()).toBe(10);
      ctx.currentTime = 0.05;
      vi.advanceTimersByTime(50);
      expect(deck.getPlayhead()).toBe(10);
      ctx.currentTime = late ? 0.55 : 0.1;
      vi.advanceTimersByTime(50);
      if (late) {
        expect(deck.getPlayhead()).toBe(10);
        ctx.currentTime = 0.6;
        vi.advanceTimersByTime(50);
      }
      await Promise.resolve();
      ctx.currentTime = late ? 0.7 : 0.2;
      expect(deck.getPlayhead()).toBeCloseTo(10.1);
      expect(deck.getSlipReturnPlayhead()).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it('keeps the outer return through a nested Slip scratch', async () => {
    const { deck, ctx } = await setup();
    deck.setSlipMode(true);
    deck.play();
    await Promise.resolve();
    deck.toggleLoop();
    ctx.currentTime = 1;
    deck.beginScratch();
    deck.scratchMove(-0.1, 0.01);
    ctx.currentTime = 3;
    deck.setPitch(20);
    ctx.currentTime = 4;
    expect(deck.getSlipReturnPlayhead()).toBeCloseTo(14.2);
    deck.endScratch();
    expect(deck.getSnapshot().loop).toMatchObject({ start: 10, end: 12 });
    expect(deck.getPlayhead()).toBeGreaterThanOrEqual(10);
    expect(deck.getPlayhead()).toBeLessThan(12);
    expect(deck.getSlipReturnPlayhead()).toBeCloseTo(14.2);
    ctx.currentTime = 5;
    deck.toggleLoop();
    expect(deck.getPlayhead()).toBeCloseTo(15.4);
  });

  it('can resize and release while scratching without losing the outer return', async () => {
    const { deck, ctx } = await setup();
    deck.setSlipMode(true);
    deck.play();
    await Promise.resolve();
    deck.toggleLoop();
    deck.beginScratch();
    ctx.currentTime = 3;
    deck.resizeLoop('halve');
    expect(deck.getSnapshot().scratching).toBe(false);
    expect(deck.getSlipReturnPlayhead()).toBe(13);
    deck.beginScratch();
    ctx.currentTime = 5;
    deck.toggleLoop();
    expect(deck.getSnapshot()).toMatchObject({ scratching: false, loop: null, playing: true });
    expect(deck.getPlayhead()).toBe(15);
  });

  describe.each([false, true])('Slip cancellation while playing=%s', playing => {
    it.each(['loop', 'scratch', 'nested'] as const)('discards the %s return without moving or ending the gesture', async gesture => {
      const { deck, ctx } = await setup();
      deck.setSlipMode(true);
      if (playing) deck.play();
      await Promise.resolve();
      if (gesture !== 'scratch') deck.toggleLoop();
      if (gesture !== 'loop') {
        deck.beginScratch();
        deck.scratchMove(-0.1, 0.01);
      }
      ctx.currentTime = gesture === 'loop' ? 3 : 0.005;
      expect(deck.getSlipReturnPlayhead()).not.toBeNull();
      const position = deck.getPlayhead();
      const motion = deck.getScratchState();
      const loop = deck.getSnapshot().loop;
      deck.setSlipMode(false);
      expect(deck.getSlipReturnPlayhead()).toBeNull();
      expect(deck.getPlayhead()).toBe(position);
      expect(deck.getScratchState()).toEqual(motion);
      expect(deck.getSnapshot()).toMatchObject({ playing, slipMode: false, slipLoopActive: false,
        scratching: gesture !== 'loop' });
      expect(deck.getSnapshot().loop).toBe(loop);

      deck.setSlipMode(true); // no resurrection of either pending return
      deck.setPitch(20);
      ctx.currentTime = 4;
      expect(deck.getSlipReturnPlayhead()).toBeNull();
      const release = deck.getPlayhead();
      if (gesture !== 'loop') deck.endScratch();
      if (gesture !== 'scratch') deck.toggleLoop();
      expect(deck.getPlayhead()).toBeCloseTo(release);
      expect(deck.getSnapshot()).toMatchObject({ playing, scratching: false, loop: null });

      // The next gesture can use the now-enabled preference normally.
      if (gesture === 'scratch') deck.beginScratch();
      else deck.toggleLoop();
      expect(deck.getSlipReturnPlayhead()).not.toBeNull();
    });
  });

  it.each(['pause', 'togglePlay', 'seek', 'cue', 'hotCue', 'dispose', 'load', 'machine'] as const)(
    '%s cancels a pending return without later resurrecting it', async action => {
      const { deck, ctx } = await setup();
      deck.setSlipMode(true);
      deck.play();
      await Promise.resolve();
      deck.toggleLoop();
      ctx.currentTime = 5;
      if (action === 'pause') deck.pause();
      if (action === 'togglePlay') deck.togglePlay();
      if (action === 'seek') deck.seek(40);
      if (action === 'cue') deck.cueDown();
      if (action === 'hotCue') deck.hotCueDown(1, 40);
      if (action === 'dispose') deck.dispose();
      if (action === 'load') await deck.load({ trackId: 225, audioUrl: '', bpm: 120 });
      if (action === 'machine') deck.setLoopRegion(null, 40);
      expect(deck.getSlipReturnPlayhead()).toBeNull();
      if (['seek', 'hotCue', 'machine'].includes(action)) expect(deck.getPlayhead()).toBe(40);
      if (action === 'pause' || action === 'togglePlay') {
        expect(deck.getPlayhead()).toBe(11);
        deck.toggleLoop();
        expect(deck.getPlayhead()).toBe(11);
      }
    });

  it('keeps no-op cue releases and grid edits from canceling a Slip loop', async () => {
    const { deck, ctx } = await setup();
    deck.setSlipMode(true);
    deck.play();
    await Promise.resolve();
    deck.toggleLoop();
    deck.hotCueDown(1, null);
    deck.hotCueUp(2, 20);
    deck.cueUp();
    deck.setBeatTimes(225, null);
    ctx.currentTime = 5;
    expect(deck.getSlipReturnPlayhead()).toBe(15);
    deck.toggleLoop();
    expect(deck.getPlayhead()).toBe(15);
    deck.toggleLoop(); // gridless entry remains inert
    expect(deck.getSlipReturnPlayhead()).toBeNull();
  });

  it('holds at hidden EOF while the loop sounds, then stops on release', async () => {
    const { deck, ctx } = await setup();
    deck.seek(99);
    deck.setSlipMode(true);
    deck.play();
    await Promise.resolve();
    deck.toggleLoop();
    ctx.currentTime = 5;
    expect(deck.getSlipReturnPlayhead()).toBe(100);
    expect(deck.getSnapshot().playing).toBe(true);
    deck.toggleLoop();
    expect(deck.getPlayhead()).toBe(100);
    expect(deck.getSnapshot()).toMatchObject({ playing: false, previewing: false, loop: null });
    ctx.currentTime = 10;
    expect(deck.getSlipReturnPlayhead()).toBeNull();
    expect(deck.getPlayhead()).toBe(100);
  });

  it('machine loop placement preserves recorded positions without latching live Slip', async () => {
    const { deck, ctx } = await setup();
    deck.setSlipMode(true);
    deck.play();
    await Promise.resolve();
    deck.setLoopRegion({ start: 10, end: 12 }, 11.5);
    ctx.currentTime = 1;
    expect(deck.getPlayhead()).toBe(10.5);
    expect(deck.getSlipReturnPlayhead()).toBeNull();
    deck.setLoopRegion(null, 35);
    expect(deck.getPlayhead()).toBe(35);
    nodes[0].kernel.render([new Float32Array(100)], new Float32Array([1]), 1, 1000);
    expect(nodes[0].kernel.livePositionFrames).toBeCloseTo(35100);
  });
});

describe('DeckEngine platter', () => {
  it.each([false, true])('capture clock reproduces live same-quantum motion (seeded=%s)', async seeded => {
    vi.useFakeTimers({ toFake: ['performance', 'setInterval', 'clearInterval'] });
    let recorder: CaptureRecorder | null = null;
    try {
      const { deck, ctx } = await setup();
      const events: CaptureEvent[] = [];
      const empty = () => new DeckEngine({ ensureAudio() { throw new Error('empty deck must not start audio'); } });
      recorder = new CaptureRecorder({
        getChannelState: () => ({ fader: 1, trim: 0.5, eq: { low: 0.5, mid: 0.5, high: 0.5 },
          filter: 0, pfl: false, stems: { vocals: true, drums: true, bass: true, other: true } }),
        getCrossfader: () => 0, getCrossfaderAssignment: () => 'thru', getCrossfaderEnabled: () => false,
        getMaster: () => 1, subscribe: () => () => {},
      }, { A: deck, B: empty(), C: empty(), D: empty() }, () => {}, event => events.push(event));
      if (!seeded) recorder.start();
      deck.beginScratch();
      await Promise.resolve();
      deck.scratchMove(0.0054, 0.005);
      vi.advanceTimersByTime(2);
      if (seeded) recorder.start();
      deck.scratchMove(0.0054, 0.001);
      const moves = events.filter(e => e.kind === 'transport' && e.action === 'scratchMove');
      expect(moves).toHaveLength(2);
      expect(moves[1].t).toBe(moves[0].t);
      expect(moves[1]).toMatchObject({ audioTime: 0, trackDuration: 100 });
      ctx.currentTime = 0.004;
      const result = planReplay([...events, { t: moves[1].t + 1, kind: 'tick', playheads: {} }], moves[1].t + 0.004);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const seed = result.plan.seed.decks.A;
      expect(seed.playhead).toBeCloseTo(deck.getPlayhead(), 12);
      expect(seed.scratch!.rate).toBeCloseTo(deck.getScratchState()!.rate, 12);
      expect(seed.scratch!.drive).toBeCloseTo(deck.getScratchState()!.drive, 12);
    } finally { recorder?.dispose(); vi.useRealTimers(); }
  });
  it.each([false, true])('still hand-up immediately resumes pitch-adjusted intent (playing=%s)', async playing => {
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
    try {
      const { deck, ctx } = await setup();
      deck.setPitch(20);
      if (playing) deck.play();
      const jog = new JogController({
        isPlaying: () => deck.getSnapshot().playing, getPlayhead: () => deck.getPlayhead(),
        seek: p => deck.seek(p), setBend: p => deck.setBend(p),
        scratch: { begin: () => deck.beginScratch(), move: (d, t) => deck.scratchMove(d, t),
          end: () => deck.endScratch(), isActive: () => deck.getSnapshot().scratching,
          vinylMode: () => deck.getSnapshot().vinylMode, rate: () => deck.getScratchState()?.rate ?? 0 },
      });
      jog.onTouch(true, 0);
      await Promise.resolve();
      for (let i = 1; i <= 10; i++) {
        ctx.currentTime = i * 0.005;
        jog.onTouchTicks(20, i * 5, GRV6_JOG_CALIBRATION, 'grv6');
      }
      ctx.currentTime = 0.051;
      vi.advanceTimersByTime(30); // Motion goes stale: release must not coast.
      const landing = deck.getPlayhead();
      jog.onTouch(false, 81);
      expect(deck.getSnapshot()).toMatchObject({ playing, scratching: false });
      ctx.currentTime = 0.052;
      expect(deck.getPlayhead()).toBeCloseTo(landing + (playing ? 0.0012 : 0), 9);
      jog.dispose();
    } finally { vi.useRealTimers(); }
  });

  it.each([false, true])('fresh physical reverse rim ticks preserve playing=%s without bending', async playing => {
    vi.useFakeTimers();
    try {
      const { deck, ctx } = await setup();
      if (playing) deck.play();
      const jog = new JogController({
        isPlaying: () => deck.getSnapshot().playing, getPlayhead: () => deck.getPlayhead(),
        seek: p => deck.seek(p), setBend: p => deck.setBend(p),
        scratch: { begin: () => deck.beginScratch(), move: (d, t) => deck.scratchMove(d, t),
          end: () => deck.endScratch(), isActive: () => deck.getSnapshot().scratching,
          vinylMode: () => deck.getSnapshot().vinylMode, rate: () => deck.getScratchState()?.rate ?? 0 },
      });
      jog.onTouch(true, 0);
      await Promise.resolve();
      for (let i = 1; i <= 10; i++) {
        ctx.currentTime = i * 0.005;
        jog.onTouchTicks(-60, i * 5, GRV6_JOG_CALIBRATION, 'grv6');
      }
      expect(deck.getScratchState()!.rate).toBeLessThan(-2);
      jog.onTouch(false, 50);
      expect(deck.getSnapshot().scratching).toBe(true);
      for (let i = 11; i <= 15; i++) {
        ctx.currentTime = i * 0.005;
        vi.advanceTimersByTime(5);
        jog.onTicks(-50, i * 5, GRV6_JOG_CALIBRATION, 'grv6');
        expect(deck.getSnapshot()).toMatchObject({ scratching: true, bendPercent: 0 });
      }
      expect(deck.getScratchState()!.rate).toBeLessThan(-1);
      ctx.currentTime += 0.012;
      vi.advanceTimersByTime(12);
      expect(deck.getSnapshot()).toMatchObject({ scratching: false, playing, bendPercent: 0 });
      jog.dispose();
    } finally { vi.useRealTimers(); }
  });
  it('replays historical Vinyl preferences without ending a newer queued scratch', async () => {
    const { deck, ctx } = await setup();
    await deck.prepareScratchReplay();
    deck.scheduleScratch([{ time: 1, position: 10, playing: false, loop: null, rate: 1,
      motion: { position: 10, time: 1, drive: -8, rate: -2, trackDuration: 100, loop: null } }]);
    nodes[0].kernel.render([new Float32Array(20)], new Float32Array([1]), 1, 1000);
    ctx.currentTime = 1.02;
    expect(deck.getSnapshot().scratching).toBe(true);
    deck.withScratchSchedule(() => {
      deck.setVinylMode(false);
      deck.setVinylMode(true);
    });
    nodes[0].kernel.render([new Float32Array(20)], new Float32Array([1]), 1.02, 1000);
    ctx.currentTime = 1.04;
    expect(deck.getSnapshot()).toMatchObject({ scratching: true, vinylMode: true });
    expect(deck.getPlayhead()).toBeLessThan(10);
    expect(nodes[0].kernel.livePositionFrames).toBeCloseTo(deck.getPlayhead() * 1000);
  });

  it.each([1.02, 1.045])('preserves post-EOF scratch when ended arrives at %s', async (callbackTime) => {
    const { deck, ctx } = await setup();
    await deck.prepareScratchReplay();
    deck.scheduleScratch([
      { time: 1, position: 99.99, playing: true, loop: null, rate: 1, motion: null },
      { time: 1.04, position: 100, playing: false, loop: null, rate: 1,
        motion: { position: 100, time: 1.04, drive: -8, rate: -2, trackDuration: 100, loop: null } },
    ]);
    ctx.currentTime = 1;
    expect(deck.getSnapshot().playing).toBe(true);
    const kernel = nodes[0].kernel;
    const ended = kernel.render([new Float32Array(20)], new Float32Array([1]), 1, 1000);
    expect(ended).not.toBeNull();
    if (callbackTime > 1.02) kernel.render([new Float32Array(25)], new Float32Array([1]), 1.02, 1000);
    ctx.currentTime = callbackTime;
    nodes[0].onEnded!(ended!);
    expect(nodes[0].cancelScratchSchedule).not.toHaveBeenCalled();
    if (callbackTime === 1.02) expect(deck.getSnapshot().playing).toBe(false);
    const out = [new Float32Array(Math.round((1.06 - callbackTime) * 1000))];
    kernel.render(out, new Float32Array([1]), callbackTime, 1000);
    ctx.currentTime = 1.06;
    expect(deck.getSnapshot()).toMatchObject({ playing: false, scratching: true });
    expect(deck.getPlayhead()).toBeLessThan(100);
    expect(kernel.livePositionFrames).toBeCloseTo(deck.getPlayhead() * 1000);
    expect(out[0].some((v) => v !== 0)).toBe(true);
  });

  it('mirrors queued looped motion and release without rAF, and cancels only its owner', async () => {
    const { deck, ctx } = await setup();
    await deck.prepareScratchReplay();
    deck.setKeyLock(true);
    const loop = { start: 10, end: 12 };
    const frames: ScratchFrame[] = [
      { time: 1, position: 10.1, playing: true, loop, rate: 1,
        motion: { position: 10.1, time: 1, drive: -16, rate: -16, trackDuration: 100, loop } },
      { time: 1.2, position: 11.8, playing: true, loop, rate: 1, motion: null },
    ];
    const owner = deck.scheduleScratch(frames);
    const kernel = nodes[0].kernel;
    kernel.render([new Float32Array(150)], new Float32Array([1]), 1, 1000);
    ctx.currentTime = 1.15;
    expect(deck.getPlayhead()).toBeCloseTo(11.844);
    expect(kernel.livePositionFrames).toBeCloseTo(11844);
    expect(deck.getSnapshot()).toMatchObject({ scratching: true, playing: true, loop });
    kernel.render([new Float32Array(100)], new Float32Array([1]), 1.15, 1000);
    ctx.currentTime = 1.25;
    expect(deck.getPlayhead()).toBeCloseTo(11.85);
    expect(kernel.livePositionFrames).toBeCloseTo(11850);
    expect(deck.getSnapshot().scratching).toBe(false);
    deck.beginScratch(); // the human replaces replay ownership
    deck.scratchMove(-0.1, 0.02);
    deck.cancelScheduledScratch(owner);
    expect(deck.getSnapshot().scratching).toBe(true);
    expect(deck.getScratchState()?.drive).toBeLessThan(0);
  });

  it.each(['pause', 'seek', 'dispose', 'load'] as const)('%s cancels a future replay schedule', async (action) => {
    const { deck, ctx } = await setup();
    await deck.prepareScratchReplay();
    deck.scheduleScratch([{ time: 1, position: 10, playing: false, loop: null, rate: 1,
      motion: { position: 10, time: 1, drive: -8, rate: -2, trackDuration: 100, loop: null } }]);
    if (action === 'pause') deck.pause();
    if (action === 'seek') deck.seek(20);
    if (action === 'dispose') deck.dispose();
    if (action === 'load') await deck.load({ trackId: 225, audioUrl: '', bpm: 120 });
    ctx.currentTime = 2;
    expect(deck.getSnapshot().scratching).toBe(false);
    expect(nodes[0].cancelScratchSchedule).toHaveBeenCalled();
  });
  it('sounds paused continuous reverse motion, preserves unsaturated displacement, then holds', async () => {
    const { deck, ctx } = await setup();
    deck.beginScratch();
    await Promise.resolve();
    deck.scratchMove(-0.08, 0.01);
    ctx.currentTime = 0.005;
    expect(deck.getPlayhead()).toBeGreaterThan(9.98);
    expect(deck.getPlayhead()).toBeLessThan(10);
    expect(deck.getScratchState()!.rate).toBeLessThan(0);
    deck.scratchMove(-0.08, 0.01);
    ctx.currentTime = 0.1;
    expect(deck.getPlayhead()).toBeCloseTo(9.84);
    expect(Math.abs(deck.getScratchState()!.rate)).toBeLessThan(0.002);
    expect(deck.getSnapshot()).toMatchObject({ playing: false, scratching: true, vinylMode: true, slipMode: false });
    deck.endScratch();
    expect(deck.getPlayhead()).toBeCloseTo(9.84);
    expect(deck.getSnapshot()).toMatchObject({ playing: false, scratching: false });
    expect(deck.getScratchState()).toBeNull();
  });

  it('latches Slip on touch and advances its looped hidden timeline at composed tempo', async () => {
    const { deck, ctx } = await setup();
    deck.toggleLoop(); // [10, 12)
    deck.play();
    await Promise.resolve();
    deck.setSlipMode(true);
    expect(deck.getSlipReturnPlayhead()).toBeNull();
    deck.beginScratch();
    expect(deck.asLaunchReference()).toBeNull();
    deck.scratchMove(-0.5, 0.05);
    ctx.currentTime = 1;
    expect(deck.getPlayhead()).toBeCloseTo(11.872);
    expect(deck.getSlipReturnPlayhead()).toBeCloseTo(11);
    deck.setPitch(20);
    deck.setBend(2); // 1.224x from this instant
    ctx.currentTime = 3;
    expect(deck.getSlipReturnPlayhead()).toBeCloseTo(11.448);
    deck.endScratch(); // hidden = 10 + 1 + 2*1.224, folded
    expect(deck.getSlipReturnPlayhead()).toBeNull();
    expect(deck.getPlayhead()).toBeCloseTo(11.448);
    expect(deck.getSnapshot()).toMatchObject({ playing: true, scratching: false, slipMode: true });
    ctx.currentTime = 4;
    expect(deck.getPlayhead()).toBeCloseTo(10.672);
  });

  it('Slip restores a paused deck to its stationary hidden position', async () => {
    const { deck, ctx } = await setup();
    deck.setSlipMode(true);
    deck.beginScratch();
    deck.scratchMove(0.1, 0.01);
    ctx.currentTime = 3;
    expect(deck.getSlipReturnPlayhead()).toBe(10);
    deck.endScratch();
    expect(deck.getPlayhead()).toBe(10);
    expect(deck.getSnapshot().playing).toBe(false);
  });

  it('off-latched Slip stays off and replay may supply an explicit landing', async () => {
    const { deck, ctx } = await setup();
    deck.beginScratch();
    deck.setSlipMode(true);
    deck.scratchMove(-0.1, 0.01);
    ctx.currentTime = 1;
    expect(deck.getSlipReturnPlayhead()).toBeNull();
    deck.endScratch();
    expect(deck.getPlayhead()).toBeCloseTo(9.9);
    deck.beginScratch();
    deck.endScratch(42);
    expect(deck.getPlayhead()).toBe(42);
  });

  it('preserves a fractional final-millisecond replay landing and stops at Slip exhaustion', async () => {
    const { deck, ctx } = await setup();
    deck.play();
    await Promise.resolve();
    deck.beginScratch();
    deck.endScratch(99.9995);
    expect(deck.getPlayhead()).toBe(99.9995);
    deck.setSlipMode(true);
    deck.beginScratch();
    deck.scratchMove(-0.1, 0.01);
    ctx.currentTime = 1;
    expect(deck.getSlipReturnPlayhead()).toBe(100);
    deck.endScratch();
    expect(deck.getPlayhead()).toBe(100);
    expect(deck.getSnapshot()).toMatchObject({ playing: false, scratching: false });
  });

  it('captures accepted motion before additive takeover listeners, with current snapshots', async () => {
    const { deck } = await setup();
    const calls: string[] = [];
    deck.setTransportEventHandler(e => {
      calls.push(`capture:${e.action}`);
      expect(deck.getSnapshot().scratching).toBe(e.action !== 'scratchEnd');
      if (e.action === 'scratchMove') {
        expect(deck.getScratchState()).toMatchObject(e.filter!);
        expect(e.trackDuration).toBe(100);
      }
    });
    deck.addTransportEventListener(e => calls.push(`takeover:${e.action}`));
    deck.beginScratch();
    deck.scratchMove(NaN, 0.01);
    deck.scratchMove(-0.1, 0);
    deck.scratchMove(-0.1, 0.01);
    deck.endScratch();
    expect(calls).toEqual(['capture:scratchBegin', 'takeover:scratchBegin',
      'capture:scratchMove', 'takeover:scratchMove', 'capture:scratchEnd', 'takeover:scratchEnd']);
  });

  it('does not send Key Lock changes into the scratch voice; restores the latest setting', async () => {
    const { deck } = await setup();
    deck.setKeyLock(true);
    deck.beginScratch();
    await Promise.resolve();
    nodes[0].setMode.mockClear();
    deck.setKeyLock(false);
    deck.setKeyLock(true);
    expect(nodes[0].setMode).not.toHaveBeenCalled();
    deck.endScratch();
    expect(nodes[0].setMode).toHaveBeenLastCalledWith('stretch');
  });

  it.each(['pause', 'seek', 'cue', 'dispose', 'vinyl', 'load'] as const)(
    '%s cancels a paused scratch, even before worklet creation resolves', async action => {
      const { deck, ctx } = await setup();
      deck.beginScratch();
      deck.scratchMove(-0.1, 0.01);
      if (action === 'pause') deck.pause();
      if (action === 'seek') deck.seek(20);
      if (action === 'cue') deck.cueDown();
      if (action === 'dispose') deck.dispose();
      if (action === 'vinyl') deck.setVinylMode(false);
      if (action === 'load') await deck.load({ trackId: 225, audioUrl: '', bpm: 120 });
      const position = deck.getPlayhead();
      await Promise.resolve();
      ctx.currentTime = 2;
      deck.scratchMove(-0.5, 0.02);
      expect(deck.getSnapshot().scratching).toBe(false);
      expect(deck.getPlayhead()).toBe(position);
      expect(deck.getScratchState()).toBeNull();
      expect(nodes.every(node => node.setScratch.mock.calls.length === 0)).toBe(true);
    });

  it('ignores touch with no ready track or Vinyl disabled', async () => {
    const empty = new DeckEngine({ ensureAudio() { throw new Error('no audio'); } });
    empty.beginScratch();
    expect(empty.getSnapshot().scratching).toBe(false);
    const { deck } = await setup();
    deck.setVinylMode(false);
    deck.beginScratch();
    expect(deck.getSnapshot().scratching).toBe(false);
  });

  it('clamps both track edges without ending the scratch and bounds the rate', async () => {
    const { deck, ctx } = await setup();
    deck.seek(0.02);
    deck.beginScratch();
    deck.scratchMove(-100, 0.001);
    ctx.currentTime = 0.1;
    expect(deck.getPlayhead()).toBe(0);
    deck.scratchMove(1000, 0.001);
    ctx.currentTime = 1.1;
    expect(deck.getPlayhead()).toBeCloseTo(0.128);
    ctx.currentTime = 10;
    expect(deck.getPlayhead()).toBeCloseTo(0.128); // saturation drops debt, never seconds of coast
    expect(deck.getSnapshot().scratching).toBe(true);
    deck.scratchMove(-0.08, 0.01);
    ctx.currentTime = 10.01;
    expect(deck.getPlayhead()).toBeGreaterThan(0.048);
    expect(deck.getPlayhead()).toBeLessThan(0.128);
  });

  it('checkpoints the complete continuous filter inside a stroke', async () => {
    const { deck, ctx } = await setup();
    deck.beginScratch();
    await Promise.resolve();
    deck.scratchMove(-0.08, 0.01);
    const original = nodes[0].setScratch.mock.lastCall![0] as ScratchMotion;
    ctx.currentTime = 0.0095;
    const remaining = deck.getScratchState()!;
    const position = deck.getPlayhead();
    deck.endScratch();
    deck.scheduleScratch([{ time: ctx.currentTime, position, playing: false, loop: null, rate: 1,
      motion: { ...original, ...remaining, position, time: ctx.currentTime } }]);
    ctx.currentTime = 0.01;
    expect(deck.getPlayhead()).toBeCloseTo(scratchPosition(original, 0.01), 10);
    expect(deck.getScratchState()!.rate).toBeLessThan(0);
  });

  it('keeps the UI and PCM clock aligned through irregular bursts and reversal', async () => {
    const { deck, ctx } = await setup();
    const kernel = new DeckSourceKernel(5, 0);
    const data = Float32Array.from({ length: 100000 }, (_, i) => i / 100000);
    kernel.setTrack([data], 1);
    deck.beginScratch();
    await Promise.resolve();
    const renderThrough = (time: number) => {
      const motion = nodes[0].setScratch.mock.lastCall![0] as ScratchMotion;
      kernel.setScratch(motion);
      // A command delivered 2ms late must still render the same position
      // as the main clock, not restart its full duration on delivery.
      const out = [new Float32Array(5)];
      kernel.render(out, new Float32Array([1]), time - 0.005, 1000);
      ctx.currentTime = time;
      expect(kernel.livePositionFrames! / 1000).toBeCloseTo(deck.getPlayhead(), 9);
    };
    deck.scratchMove(-0.08, 0.01);
    renderThrough(0.007);
    deck.scratchMove(-0.12, 0.012);
    deck.scratchMove(-0.04, 0.003);
    renderThrough(0.014);
    deck.scratchMove(0.2, 0.013);
    renderThrough(0.021);
    renderThrough(0.1);
    expect(deck.getPlayhead()).toBeGreaterThan(9.7);
    expect(deck.getPlayhead()).toBeLessThan(10.2);
    expect(Math.abs(deck.getScratchState()!.rate)).toBeLessThan(0.01);
  });
});
