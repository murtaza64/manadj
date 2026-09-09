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
  it.each([false, true])('moving hand-up immediately resumes pitch-adjusted intent (playing=%s)', async playing => {
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
    const landing = deck.getPlayhead();
    jog.onTouch(false, 51);
    expect(deck.getSnapshot()).toMatchObject({ playing, scratching: false });
    ctx.currentTime = 0.052;
    expect(deck.getPlayhead()).toBeCloseTo(landing + (playing ? 0.0012 : 0), 9);
    jog.dispose();
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
    deck.beginScratch();
    deck.setSlipMode(false); // applies to the NEXT gesture
    expect(deck.asLaunchReference()).toBeNull();
    deck.scratchMove(-0.5, 0.05);
    ctx.currentTime = 1;
    expect(deck.getPlayhead()).toBeCloseTo(11.872);
    deck.setPitch(20);
    deck.setBend(2); // 1.224x from this instant
    ctx.currentTime = 3;
    deck.endScratch(); // hidden = 10 + 1 + 2*1.224, folded
    expect(deck.getPlayhead()).toBeCloseTo(11.448);
    expect(deck.getSnapshot()).toMatchObject({ playing: true, scratching: false, slipMode: false });
    ctx.currentTime = 4;
    expect(deck.getPlayhead()).toBeCloseTo(10.672);
  });

  it('Slip restores a paused deck to its stationary hidden position', async () => {
    const { deck, ctx } = await setup();
    deck.setSlipMode(true);
    deck.beginScratch();
    deck.scratchMove(0.1, 0.01);
    ctx.currentTime = 3;
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
