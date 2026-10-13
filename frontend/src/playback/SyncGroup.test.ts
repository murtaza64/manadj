import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeckEngine } from './DeckEngine';
import { SyncGroup } from './SyncGroup';
import { CHANNEL_IDS, type ChannelId } from './mixer';
import { _clearBufferCacheForTests, putCachedBuffer } from './bufferCache';
import { _resetAudibleSurfacesForTests, claimAudible, registerSurface, releaseAudible } from './audibleSurface';
import { setQuantize } from './quantizeStore';
import { effectiveBpm } from './tempo';

vi.mock('../settings/persistedSettings', () => ({ writeSetting: vi.fn() }));
vi.mock('./worklet/deckSourceNode', () => ({
  DeckSourceNode: { create: vi.fn(async (ctx: AudioContext) => ({
    ctx,
    loadTrack() {}, start() {}, stop() {}, setMode() {}, setLoop() {}, setRateAt() {},
    connect() {}, disconnect() {}, setScratch() {},
  })) },
}));

const buffer = {
  duration: 180, sampleRate: 44100, numberOfChannels: 1,
  getChannelData: () => new Float32Array(44100),
} as unknown as AudioBuffer;
const clock = { currentTime: 0, state: 'running' };
const ctx = clock as AudioContext;
let engines: Record<ChannelId, DeckEngine>;
let group: SyncGroup;
let stop: () => void;

async function load(deck: ChannelId, bpm: number | null = 120, grid = true) {
  const trackId = CHANNEL_IDS.indexOf(deck) + 1;
  putCachedBuffer(trackId, buffer);
  await engines[deck].load({
    trackId, audioUrl: '/test-audio', bpm,
    beatTimes: Promise.resolve(grid && bpm ? Array.from({ length: 400 }, (_, i) => i * 60 / bpm) : null),
  });
  await engines[deck].prepareScratchReplay();
}
function tempo(deck: ChannelId) {
  const s = engines[deck].getSnapshot();
  return effectiveBpm(s.bpm!, s.pitchPercent);
}

beforeEach(() => {
  clock.currentTime = 0;
  _resetAudibleSurfacesForTests();
  setQuantize(false);
  engines = Object.fromEntries(CHANNEL_IDS.map(deck => [deck, new DeckEngine({
    ensureAudio: () => ({ ctx, input: {} as AudioNode }),
  })])) as Record<ChannelId, DeckEngine>;
  group = new SyncGroup(engines);
  stop = group.start();
});
afterEach(() => {
  stop();
  CHANNEL_IDS.forEach(deck => engines[deck].dispose());
  _clearBufferCacheForTests();
  _resetAudibleSurfacesForTests();
});

describe('shared Group Tempo', () => {
  it('captures own tempo without a peer, then any of four members can ride the group', async () => {
    for (const deck of CHANNEL_IDS) await load(deck);
    for (const deck of CHANNEL_IDS) expect(group.toggle(deck)?.kind).toBe('match');
    for (const deck of CHANNEL_IDS) {
      group.setPitch(deck, CHANNEL_IDS.indexOf(deck) + 1);
      for (const member of CHANNEL_IDS) expect(engines[member].getSnapshot().pitchPercent)
        .toBeCloseTo(CHANNEL_IDS.indexOf(deck) + 1);
    }
    expect(group.getSnapshot().decks).toEqual({ A: 'synced', B: 'synced', C: 'synced', D: 'synced' });
  });

  it('captures the nearest playing peer once, rather than chasing unsynced pitch', async () => {
    await load('A', 120); await load('B', 124); await load('C', 128);
    engines.B.play(); engines.C.play();
    group.toggle('A');
    expect(tempo('A')).toBeCloseTo(124);
    group.setPitch('B', 4);
    expect(tempo('A')).toBeCloseTo(124);
    group.toggle('B');
    expect(tempo('B')).toBeCloseTo(124);
    group.setPitch('B', 2);
    expect(tempo('A')).toBeCloseTo(tempo('B'));
  });

  it('holds half/double relationships, excludes bend, and leaves pitch on disengage', async () => {
    await load('A', 85); await load('B', 170);
    group.toggle('A'); group.toggle('B');
    group.setPitch('B', 4);
    expect(tempo('B')).toBeCloseTo(tempo('A') * 2);
    engines.A.setBend(2);
    expect(group.getSnapshot().tempo).toBeCloseTo(88.4);
    expect(engines.B.getSnapshot().bendPercent).toBe(0);
    group.toggle('A'); group.setPitch('B', 1);
    expect(engines.A.getSnapshot().pitchPercent).toBeCloseTo(4);
    group.toggle('B');
    expect(group.getSnapshot().tempo).toBeNull();
    expect(engines.B.getSnapshot().pitchPercent).toBeCloseTo(1);
  });

  it('refuses an unreachable join; clamps and recovers members during a ride', async () => {
    await load('A', 100); await load('B', 108); await load('C', 140);
    group.toggle('B'); group.toggle('A');
    expect(group.toggle('C')).toEqual({ kind: 'out-of-reach' });
    expect(group.getSnapshot().decks.C).toBe('off');
    expect(engines.C.getSnapshot().pitchPercent).toBe(0);
    group.setPitch('B', 8);
    expect(engines.A.getSnapshot().pitchPercent).toBe(8);
    expect(group.getSnapshot().decks.A).toBe('out-of-lock');
    group.setPitch('B', 0);
    expect(group.getSnapshot().decks.A).toBe('synced');
    expect(tempo('A')).toBeCloseTo(108);
  });

  it('retains membership through pause, same-track reload, missing BPM, and late metadata', async () => {
    await load('A'); group.toggle('A'); group.setPitch('A', 4);
    engines.A.play(); engines.A.pause();
    expect(group.getSnapshot().decks.A).toBe('synced');
    const reloading = load('A', null);
    expect(group.getSnapshot().decks.A).toBe('waiting');
    await reloading;
    expect(group.getSnapshot().decks.A).toBe('waiting');
    engines.A.setTrackBpm(1, 240);
    expect(tempo('A')).toBeCloseTo(249.6);
    expect(group.getSnapshot().decks.A).toBe('synced');
    expect(engines.A.getSnapshot().playing).toBe(false);
    expect(group.getSnapshot().tempo).toBeCloseTo(124.8);
    engines.A.setTrackBpm(1, 140);
    expect(group.getSnapshot().decks.A).toBe('out-of-lock');
    group.toggle('A');
    expect(group.getSnapshot().decks.A).toBe('off');
  });

  it('rejects invalid/empty decks and releases membership on machine ownership', async () => {
    expect(group.toggle('A')).toBeNull();
    await load('A', NaN); expect(group.toggle('A')).toBeNull();
    await load('A'); group.toggle('A'); group.setPitch('A', 3);
    registerSurface('editor', { transport: { togglePlay() {} }, silence() {} });
    claimAudible('editor');
    expect(group.getSnapshot().tempo).toBeNull();
    expect(group.getSnapshot().decks.A).toBe('off');
    expect(group.toggle('A')).toBeNull();
    expect(group.match('A')).toBeNull();
    expect(engines.A.getSnapshot().pitchPercent).toBeCloseTo(3);
    // UI pitch still reaches the engine so the Conductor can observe takeover.
    group.setPitch('A', 8);
    expect(engines.A.getSnapshot().pitchPercent).toBe(8);
    releaseAudible('editor');
    expect(group.getSnapshot().decks.A).toBe('off');
  });

  it('MATCH changes group tempo without dropping membership', async () => {
    await load('A'); await load('B', 124); await load('C');
    group.toggle('A'); group.toggle('C'); engines.B.play();
    group.match('A');
    expect(group.getSnapshot().tempo).toBeCloseTo(124);
    expect(tempo('C')).toBeCloseTo(124);
    expect(group.getSnapshot().decks.A).toBe('synced');
  });
});

describe('one-shot phase alignment', () => {
  it('projects the quotient of opposite octave members (4:1)', async () => {
    await load('A', 120); await load('B', 60); await load('C', 240);
    group.toggle('A'); group.toggle('B');
    engines.B.seek(20.2); engines.B.play();
    engines.C.seek(10.1); engines.C.play();
    setQuantize(true); group.toggle('C');
    expect(engines.C.getPlayhead()).toBeCloseTo(10.2);
  });

  it('does not turn a pending quantized launch into an immediate phase seek', async () => {
    vi.useFakeTimers();
    try {
      await load('A'); await load('B'); setQuantize(true);
      engines.B.seek(20.4); engines.B.play();
      engines.A.setLaunchReferenceProvider(() => engines.B.asLaunchReference());
      engines.A.seek(10); engines.A.play();
      const gestures = vi.fn(); engines.A.addTransportEventListener(gestures);
      group.match('A'); group.toggle('A');
      expect(gestures).not.toHaveBeenCalled();
      expect(engines.A.getPlayhead()).toBe(10);
      vi.advanceTimersByTime(110);
      expect(engines.A.getSnapshot().playing).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it.each(['match', 'toggle'] as const)('%s aligns only with Quantize on, never on pitch rides or nudges', async action => {
    await load('A'); await load('B');
    engines.A.seek(10.1); engines.B.seek(20.2);
    engines.A.play(); engines.B.play();
    group[action]('A');
    expect(engines.A.getPlayhead()).toBeCloseTo(10.1);
    if (action === 'toggle') group.toggle('A');
    setQuantize(true);
    group[action]('A');
    expect(engines.A.getPlayhead()).toBeCloseTo(10.2);
    group.setPitch('A', 2); engines.A.setBend(-2);
    expect(engines.A.getPlayhead()).toBeCloseTo(10.2);
  });

  it('keeps paused cue positions and skips gridless/scratching phase correction', async () => {
    await load('A'); await load('B');
    engines.A.seek(10.1); engines.B.seek(20.2); engines.B.play();
    setQuantize(true); group.match('A');
    expect(engines.A.getPlayhead()).toBeCloseTo(10.1);
    engines.A.play(); engines.A.setBeatTimes(1, null); group.match('A');
    expect(engines.A.getPlayhead()).toBeCloseTo(10.1);
    engines.A.setBeatTimes(1, [0, 0.5, 1]);
    engines.A.beginScratch(); group.match('A');
    expect(engines.A.getSnapshot().scratching).toBe(true);
    expect(engines.A.getPlayhead()).toBeCloseTo(10.1);
  });

  it('preserves a loop region and wraps the one-shot landing into it', async () => {
    await load('A'); await load('B'); setQuantize(true);
    engines.A.seek(10); engines.A.loopPreset(1);
    const loop = engines.A.getSnapshot().loop;
    engines.A.play(); engines.B.seek(20.4); engines.B.play();
    group.match('A');
    expect(engines.A.getSnapshot().loop).toEqual(loop);
    expect(engines.A.getPlayhead()).toBeCloseTo(10.4);
  });

  it('wraps an EOF-crossing loop at the playable end instead of stopping', async () => {
    await load('A'); await load('B'); setQuantize(true);
    engines.A.seek(179); engines.A.loopPreset(4); engines.A.play();
    clock.currentTime = 0.9;
    engines.B.seek(20.1); engines.B.play();
    group.match('A');
    expect(engines.A.getSnapshot().playing).toBe(true);
    expect(engines.A.getSnapshot().loop).toMatchObject({ start: 179, end: 181 });
    expect(engines.A.getPlayhead()).toBeCloseTo(179.1);
  });

  it('launches against a synced member rather than an unrelated playing deck', async () => {
    await load('A'); await load('B'); await load('C');
    group.toggle('B'); group.toggle('C');
    engines.A.seek(10.1); engines.A.play();
    engines.B.seek(20.2); engines.B.play();
    expect(group.launchReference('C')?.playhead).toBeCloseTo(20.2);
    engines.B.pause();
    expect(group.launchReference('C')).toBeNull();
  });
});
