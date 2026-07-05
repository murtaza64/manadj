import { describe, expect, it } from 'vitest';
import {
  initialTransportState,
  isAudioRunning,
  reduceTransport,
} from './transport';
import type { TransportContext, TransportState } from './transport';

function state(overrides: Partial<TransportState> = {}): TransportState {
  return { ...initialTransportState(), ...overrides };
}

/** A 120 BPM grid starting at 0.25s (beats every 0.5s), Quantize on. */
function quantized(beatTimes: number[] | null = [0.25, 0.75, 1.25, 1.75, 2.25]): TransportContext {
  return { quantize: true, beatTimes };
}

describe('play', () => {
  it('starts audio from the playhead when paused', () => {
    const [next, effects] = reduceTransport(state({ playhead: 12.5 }), { type: 'play' });
    expect(next.playing).toBe(true);
    expect(effects).toEqual([{ type: 'start', at: 12.5 }]);
  });

  it('is a no-op when already playing', () => {
    const s = state({ playing: true, playhead: 3 });
    const [next, effects] = reduceTransport(s, { type: 'play' });
    expect(next).toBe(s);
    expect(effects).toEqual([]);
  });

  it('takes over a running main-cue preview without restarting audio', () => {
    const s = state({ previewing: true, cuePoint: 10, playhead: 11 });
    const [next, effects] = reduceTransport(s, { type: 'play' });
    expect(next.playing).toBe(true);
    expect(next.previewing).toBe(true);
    expect(effects).toEqual([]);
  });

  it('takes over a running hot-cue preview without restarting audio', () => {
    const s = state({ hotCuePreviewSlot: 3, playhead: 42 });
    const [next, effects] = reduceTransport(s, { type: 'play' });
    expect(next.playing).toBe(true);
    expect(next.hotCuePreviewSlot).toBe(3);
    expect(effects).toEqual([]);
  });
});

describe('pause', () => {
  it('stops audio at the playhead and clears preview state', () => {
    const s = state({ playing: true, previewing: true, hotCuePreviewSlot: 2, playhead: 7 });
    const [next, effects] = reduceTransport(s, { type: 'pause' });
    expect(next.playing).toBe(false);
    expect(next.previewing).toBe(false);
    expect(next.hotCuePreviewSlot).toBeNull();
    expect(effects).toEqual([{ type: 'stop', at: 7 }]);
  });

  it('is a no-op when idle', () => {
    const s = state({ playhead: 5 });
    const [next, effects] = reduceTransport(s, { type: 'pause' });
    expect(next).toBe(s);
    expect(effects).toEqual([]);
  });
});

describe('toggle-play', () => {
  it('plays when paused', () => {
    const [next, effects] = reduceTransport(state({ playhead: 1 }), { type: 'toggle-play' });
    expect(next.playing).toBe(true);
    expect(effects).toEqual([{ type: 'start', at: 1 }]);
  });

  it('pauses when playing', () => {
    const [next, effects] = reduceTransport(state({ playing: true, playhead: 2 }), {
      type: 'toggle-play',
    });
    expect(next.playing).toBe(false);
    expect(effects).toEqual([{ type: 'stop', at: 2 }]);
  });
});

describe('seek', () => {
  it('moves the playhead without audio effects while stopped', () => {
    const [next, effects] = reduceTransport(state({ playhead: 4 }), { type: 'seek', time: 30 });
    expect(next.playhead).toBe(30);
    expect(effects).toEqual([]);
  });

  it('restarts audio at the target while playing', () => {
    const [next, effects] = reduceTransport(state({ playing: true, playhead: 4 }), {
      type: 'seek',
      time: 30,
    });
    expect(next.playhead).toBe(30);
    expect(effects).toEqual([{ type: 'start', at: 30 }]);
  });

  it('restarts audio at the target while previewing', () => {
    const s = state({ previewing: true, cuePoint: 4, playhead: 5 });
    const [, effects] = reduceTransport(s, { type: 'seek', time: 9 });
    expect(effects).toEqual([{ type: 'start', at: 9 }]);
  });
});

describe('cue-down', () => {
  it('sets the cue point at the playhead when paused away from the cue', () => {
    const [next, effects] = reduceTransport(state({ playhead: 20 }), { type: 'cue-down' });
    expect(next.cuePoint).toBe(20);
    expect(next.previewing).toBe(false);
    expect(effects).toEqual([]);
  });

  it('re-sets the cue point when paused with an existing cue elsewhere', () => {
    const s = state({ cuePoint: 10, playhead: 25 });
    const [next, effects] = reduceTransport(s, { type: 'cue-down' });
    expect(next.cuePoint).toBe(25);
    expect(effects).toEqual([]);
  });

  it('previews from the cue when paused at the cue point', () => {
    const s = state({ cuePoint: 10, playhead: 10 });
    const [next, effects] = reduceTransport(s, { type: 'cue-down' });
    expect(next.previewing).toBe(true);
    expect(next.cuePoint).toBe(10);
    expect(effects).toEqual([{ type: 'start', at: 10 }]);
  });

  it('treats playhead within epsilon of the cue as at-cue', () => {
    const s = state({ cuePoint: 10, playhead: 10.009 });
    const [next, effects] = reduceTransport(s, { type: 'cue-down' });
    expect(next.previewing).toBe(true);
    expect(effects).toEqual([{ type: 'start', at: 10 }]);
  });

  it('treats playhead outside epsilon of the cue as away-from-cue', () => {
    const s = state({ cuePoint: 10, playhead: 10.011 });
    const [next, effects] = reduceTransport(s, { type: 'cue-down' });
    expect(next.previewing).toBe(false);
    expect(next.cuePoint).toBe(10.011);
    expect(effects).toEqual([]);
  });

  it('returns to the cue and pauses the deck while playing', () => {
    const s = state({ playing: true, cuePoint: 10, playhead: 55, hotCuePreviewSlot: 1 });
    const [next, effects] = reduceTransport(s, { type: 'cue-down' });
    expect(next.playing).toBe(false);
    expect(next.previewing).toBe(false);
    expect(next.hotCuePreviewSlot).toBeNull();
    expect(next.playhead).toBe(10);
    expect(effects).toEqual([{ type: 'stop', at: 10 }]);
  });

  it('is a no-op while playing with no cue set', () => {
    const s = state({ playing: true, playhead: 55 });
    const [next, effects] = reduceTransport(s, { type: 'cue-down' });
    expect(next).toBe(s);
    expect(effects).toEqual([]);
  });
});

describe('cue-down under Quantize (placement snapping)', () => {
  it('snaps the cue point (and the parked playhead) to the nearest beat', () => {
    const [next, effects] = reduceTransport(state({ playhead: 0.9 }), { type: 'cue-down' }, quantized());
    expect(next.cuePoint).toBe(0.75);
    expect(next.playhead).toBe(0.75);
    expect(effects).toEqual([]);
  });

  it('stores the exact position with Quantize off', () => {
    const ctx: TransportContext = { quantize: false, beatTimes: [0.25, 0.75, 1.25] };
    const [next] = reduceTransport(state({ playhead: 0.9 }), { type: 'cue-down' }, ctx);
    expect(next.cuePoint).toBe(0.9);
    expect(next.playhead).toBe(0.9);
  });

  it('degrades to the exact position on a gridless Track', () => {
    const [next] = reduceTransport(state({ playhead: 0.9 }), { type: 'cue-down' }, quantized(null));
    expect(next.cuePoint).toBe(0.9);
  });

  it('defaults to unquantized behavior when no context is given', () => {
    const [next] = reduceTransport(state({ playhead: 0.9 }), { type: 'cue-down' });
    expect(next.cuePoint).toBe(0.9);
  });

  it('does not affect return-to-cue while playing', () => {
    const s = state({ playing: true, cuePoint: 0.9, playhead: 2.0 });
    const [next, effects] = reduceTransport(s, { type: 'cue-down' }, quantized());
    expect(next.playhead).toBe(0.9);
    expect(effects).toEqual([{ type: 'stop', at: 0.9 }]);
  });
});

describe('cue-up', () => {
  it('returns to the cue and stops when the deck stayed paused', () => {
    const s = state({ previewing: true, cuePoint: 10, playhead: 14 });
    const [next, effects] = reduceTransport(s, { type: 'cue-up' });
    expect(next.previewing).toBe(false);
    expect(next.playhead).toBe(10);
    expect(effects).toEqual([{ type: 'stop', at: 10 }]);
  });

  it('keeps playing when play was pressed during the preview', () => {
    const s = state({ previewing: true, playing: true, cuePoint: 10, playhead: 14 });
    const [next, effects] = reduceTransport(s, { type: 'cue-up' });
    expect(next.previewing).toBe(false);
    expect(next.playing).toBe(true);
    expect(next.playhead).toBe(14);
    expect(effects).toEqual([]);
  });

  it('is a no-op when not previewing', () => {
    const s = state({ playing: true, cuePoint: 10 });
    const [next, effects] = reduceTransport(s, { type: 'cue-up' });
    expect(next).toBe(s);
    expect(effects).toEqual([]);
  });
});

describe('hot-cue-down', () => {
  it('is a no-op for an unset slot', () => {
    const s = state({ playing: true, playhead: 5 });
    const [next, effects] = reduceTransport(s, { type: 'hot-cue-down', slot: 1, time: null });
    expect(next).toBe(s);
    expect(effects).toEqual([]);
  });

  it('jumps and keeps playing while the deck is playing', () => {
    const s = state({ playing: true, playhead: 50 });
    const [next, effects] = reduceTransport(s, { type: 'hot-cue-down', slot: 2, time: 32 });
    expect(next.playing).toBe(true);
    expect(next.hotCuePreviewSlot).toBeNull();
    expect(next.playhead).toBe(32);
    expect(effects).toEqual([{ type: 'start', at: 32 }]);
  });

  it('previews from the hot cue while the deck is paused', () => {
    const s = state({ playhead: 50 });
    const [next, effects] = reduceTransport(s, { type: 'hot-cue-down', slot: 2, time: 32 });
    expect(next.playing).toBe(false);
    expect(next.hotCuePreviewSlot).toBe(2);
    expect(next.playhead).toBe(32);
    expect(effects).toEqual([{ type: 'start', at: 32 }]);
  });
});

describe('hot-cue-down under Quantize (phase-preserving triggers)', () => {
  it('jumps immediately to cue + intra-beat phase while playing', () => {
    // playhead 1.4 → beat before 1.25, phase 0.15; cue 0.75 → land 0.9.
    const s = state({ playing: true, playhead: 1.4 });
    const [next, effects] = reduceTransport(s, { type: 'hot-cue-down', slot: 1, time: 0.75 }, quantized());
    expect(next.playing).toBe(true);
    expect(next.playhead).toBeCloseTo(0.9, 10);
    expect(effects).toHaveLength(1);
    expect(effects[0].type).toBe('start');
    expect(effects[0].at).toBeCloseTo(0.9, 10);
  });

  it('lands exactly on the cue with Quantize off', () => {
    const ctx: TransportContext = { quantize: false, beatTimes: [0.25, 0.75, 1.25, 1.75] };
    const s = state({ playing: true, playhead: 1.4 });
    const [next] = reduceTransport(s, { type: 'hot-cue-down', slot: 1, time: 0.75 }, ctx);
    expect(next.playhead).toBe(0.75);
  });

  it('lands exactly on the cue on a gridless Track', () => {
    const s = state({ playing: true, playhead: 1.4 });
    const [next] = reduceTransport(s, { type: 'hot-cue-down', slot: 1, time: 0.75 }, quantized(null));
    expect(next.playhead).toBe(0.75);
  });

  it('previews exactly from the cue while paused, regardless of the toggle', () => {
    const s = state({ playhead: 1.4 });
    const [next, effects] = reduceTransport(s, { type: 'hot-cue-down', slot: 2, time: 0.75 }, quantized());
    expect(next.hotCuePreviewSlot).toBe(2);
    expect(next.playhead).toBe(0.75);
    expect(effects).toEqual([{ type: 'start', at: 0.75 }]);
  });

  it('leaves seek (beat jump) exact with the toggle on', () => {
    const s = state({ playing: true, playhead: 1.4 });
    const [next, effects] = reduceTransport(s, { type: 'seek', time: 0.9 }, quantized());
    expect(next.playhead).toBe(0.9);
    expect(effects).toEqual([{ type: 'start', at: 0.9 }]);
  });
});

describe('hot-cue-up', () => {
  it('returns to the hot cue and stops when the deck stayed paused', () => {
    const s = state({ hotCuePreviewSlot: 2, playhead: 36 });
    const [next, effects] = reduceTransport(s, { type: 'hot-cue-up', slot: 2, time: 32 });
    expect(next.hotCuePreviewSlot).toBeNull();
    expect(next.playhead).toBe(32);
    expect(effects).toEqual([{ type: 'stop', at: 32 }]);
  });

  it('keeps playing when play was pressed during the preview', () => {
    const s = state({ hotCuePreviewSlot: 2, playing: true, playhead: 36 });
    const [next, effects] = reduceTransport(s, { type: 'hot-cue-up', slot: 2, time: 32 });
    expect(next.hotCuePreviewSlot).toBeNull();
    expect(next.playing).toBe(true);
    expect(next.playhead).toBe(36);
    expect(effects).toEqual([]);
  });

  it('is a no-op for a slot that is not being previewed', () => {
    const s = state({ hotCuePreviewSlot: 2, playhead: 36 });
    const [next, effects] = reduceTransport(s, { type: 'hot-cue-up', slot: 5, time: 40 });
    expect(next).toBe(s);
    expect(effects).toEqual([]);
  });

  it('is a no-op for a null time', () => {
    const s = state({ hotCuePreviewSlot: 2, playhead: 36 });
    const [next, effects] = reduceTransport(s, { type: 'hot-cue-up', slot: 2, time: null });
    expect(next).toBe(s);
    expect(effects).toEqual([]);
  });
});

describe('ended', () => {
  it('returns to the cue when the track ends during a main-cue preview', () => {
    const s = state({ previewing: true, cuePoint: 170, playhead: 180 });
    const [next, effects] = reduceTransport(s, { type: 'ended' });
    expect(next.playing).toBe(false);
    expect(next.previewing).toBe(false);
    expect(next.playhead).toBe(170);
    expect(effects).toEqual([{ type: 'stop', at: 170 }]);
  });

  it('stops at the playhead when the track ends during normal playback', () => {
    const s = state({ playing: true, playhead: 180 });
    const [next, effects] = reduceTransport(s, { type: 'ended' });
    expect(next.playing).toBe(false);
    expect(next.hotCuePreviewSlot).toBeNull();
    expect(effects).toEqual([{ type: 'stop', at: 180 }]);
  });
});

describe('isAudioRunning', () => {
  it('is false when idle', () => {
    expect(isAudioRunning(state())).toBe(false);
  });

  it('is true when playing', () => {
    expect(isAudioRunning(state({ playing: true }))).toBe(true);
  });

  it('is true during a main-cue preview', () => {
    expect(isAudioRunning(state({ previewing: true }))).toBe(true);
  });

  it('is true during a hot-cue preview', () => {
    expect(isAudioRunning(state({ hotCuePreviewSlot: 4 }))).toBe(true);
  });
});
