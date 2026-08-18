/**
 * Session chunk buffer (Sessions PRD, ADR 0033) — the pure batching seam.
 * Push accumulates in order; drain cuts a chunk and empties; a quiet
 * buffer drains to nothing (so a silent 5s writes no chunk); a burst past
 * the safety valve is flagged for an early cut. Timers and I/O live in the
 * SessionSink shell and are not exercised here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { ChunkBuffer, SessionSink } from './sessionSink';
import type { CaptureEvent } from './events';

vi.mock('../api/client', () => ({
  api: {
    sessions: {
      recover: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({}),
      appendChunk: vi.fn().mockResolvedValue({}),
      end: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock('../api/queryClient', () => ({
  queryClient: { invalidateQueries: vi.fn().mockResolvedValue(undefined) },
}));

function tick(t: number): CaptureEvent {
  return { t, kind: 'tick', playheads: {} };
}

describe('ChunkBuffer', () => {
  it('accumulates pushed events and reports its size', () => {
    const buf = new ChunkBuffer();
    expect(buf.size).toBe(0);
    buf.push(tick(1));
    buf.push(tick(2));
    expect(buf.size).toBe(2);
  });

  it('drains events in push order and empties the buffer', () => {
    const buf = new ChunkBuffer();
    buf.push(tick(1));
    buf.push(tick(2));
    buf.push(tick(3));
    const chunk = buf.drain();
    expect(chunk.map((e) => e.t)).toEqual([1, 2, 3]);
    expect(buf.size).toBe(0);
  });

  it('drains an empty buffer to nothing (a quiet flush writes no chunk)', () => {
    const buf = new ChunkBuffer();
    expect(buf.drain()).toEqual([]);
  });

  it('separates successive chunks — a second drain does not resurface the first', () => {
    const buf = new ChunkBuffer();
    buf.push(tick(1));
    expect(buf.drain().map((e) => e.t)).toEqual([1]);
    buf.push(tick(2));
    buf.push(tick(3));
    expect(buf.drain().map((e) => e.t)).toEqual([2, 3]);
    expect(buf.drain()).toEqual([]);
  });

  it('flags overflow once the safety valve is reached', () => {
    const buf = new ChunkBuffer(3);
    buf.push(tick(1));
    buf.push(tick(2));
    expect(buf.overflowing).toBe(false);
    buf.push(tick(3));
    expect(buf.overflowing).toBe(true);
    // Draining clears the overflow.
    buf.drain();
    expect(buf.overflowing).toBe(false);
  });
});

describe('SessionSink activation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => vi.useRealTimers());

  it('does not persist an empty boot/remount lifetime', () => {
    const sink = new SessionSink();
    sink.start();
    sink.record(tick(0), false);
    sink.stop();

    expect(api.sessions.create).not.toHaveBeenCalled();
    expect(api.sessions.appendChunk).not.toHaveBeenCalled();
    expect(api.sessions.end).not.toHaveBeenCalled();
  });

  it('creates one row across a StrictMode-style sink remount', async () => {
    const syntheticMount = new SessionSink();
    syntheticMount.start();
    syntheticMount.record(tick(0), false);
    syntheticMount.stop();

    const realMount = new SessionSink();
    realMount.start();
    realMount.record(tick(0), false);
    realMount.record({ t: 1, kind: 'load', channel: 'A', trackId: 42, bpm: 174 }, true);
    for (let i = 0; i < 8; i += 1) await Promise.resolve();

    expect(api.sessions.create).toHaveBeenCalledOnce();
    realMount.stop();
  });

  it('opens once on the first live event and keeps the buffered seed', async () => {
    const sink = new SessionSink();
    sink.start();
    sink.record(tick(0), false);
    sink.record({ t: 1, kind: 'load', channel: 'A', trackId: 42, bpm: 174 }, true);
    sink.flush();
    for (let i = 0; i < 12; i += 1) await Promise.resolve();

    expect(api.sessions.create).toHaveBeenCalledOnce();
    expect(api.sessions.appendChunk).toHaveBeenCalledOnce();
    expect(vi.mocked(api.sessions.appendChunk).mock.calls[0][2]).toEqual([
      tick(0),
      { t: 1, kind: 'load', channel: 'A', trackId: 42, bpm: 174 },
    ]);
    sink.stop();
  });

  it('never opens a row for a lifetime of non-audible setup (loads, cueing, controls, tenure)', () => {
    const sink = new SessionSink();
    sink.start();
    // The recorder passes activatesSession=false for everything until a
    // Deck is Master-audible (sessions 11) — silent setup only buffers.
    sink.record({ t: 1, kind: 'load', channel: 'A', trackId: 42, bpm: 174 }, false);
    sink.record({ t: 2, kind: 'control', control: 'fader', channel: 'A', value: 0.8 }, false);
    sink.record({ t: 3, kind: 'transport', channel: 'A', action: 'seek', playhead: 30 }, false);
    sink.record({ t: 4, kind: 'tenure', edge: 'start', holder: 'editor' }, false);
    sink.record({ t: 9, kind: 'tenure', edge: 'end', holder: 'shared' }, false);
    sink.flush();
    sink.stop();

    expect(api.sessions.create).not.toHaveBeenCalled();
    expect(api.sessions.appendChunk).not.toHaveBeenCalled();
    expect(api.sessions.end).not.toHaveBeenCalled();
  });

  it('waits for stale-session recovery before opening the live Session', async () => {
    let finishRecovery: (() => void) | undefined;
    vi.mocked(api.sessions.recover).mockReturnValueOnce(
      new Promise<number>((resolve) => {
        finishRecovery = () => resolve(1);
      })
    );
    const sink = new SessionSink();
    sink.start();
    sink.record({ t: 1, kind: 'load', channel: 'A', trackId: 42, bpm: 174 }, true);

    await Promise.resolve();
    expect(api.sessions.create).not.toHaveBeenCalled();
    finishRecovery?.();
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    expect(api.sessions.create).toHaveBeenCalledOnce();
    sink.stop();
  });
});

// ── Ten-minute silence split (sessions 11) ────────────────────────────────
// split() closes the CURRENT Session (flush the idle tail, end the row) and
// goes dormant: the sink keeps buffering, opens no replacement row, and the
// next activating (Master-audible) event opens a fresh Session with a fresh
// uuid and a chunk seq restarting at 0 — no chunk sequence spans Sessions.

describe('SessionSink split (sessions 11)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => vi.useRealTimers());

  async function settle(): Promise<void> {
    for (let i = 0; i < 16; i += 1) await Promise.resolve();
  }

  it('split with no open Session is a no-op returning false', async () => {
    const sink = new SessionSink();
    sink.start();
    sink.record(tick(0), false);
    expect(sink.split()).toBe(false);
    await settle();
    expect(api.sessions.create).not.toHaveBeenCalled();
    expect(api.sessions.end).not.toHaveBeenCalled();
    sink.stop();
  });

  it('split flushes the idle tail into the old Session and ends exactly it', async () => {
    const sink = new SessionSink();
    sink.start();
    sink.record({ t: 1, kind: 'load', channel: 'A', trackId: 42, bpm: 174 }, false);
    sink.record({ t: 2, kind: 'transport', channel: 'A', action: 'play', playhead: 0 }, true);
    await settle();
    const uuid = sink.currentSessionUuid!;
    expect(uuid).not.toBeNull();
    sink.flush();
    // The observed idle tail rides the old log…
    sink.record(tick(300), false);
    sink.record(tick(600), false);
    expect(sink.split()).toBe(true);
    await settle();
    // …flushed at the split, into the OLD Session.
    const appends = vi.mocked(api.sessions.appendChunk).mock.calls;
    expect(appends.map(([u]) => u)).toEqual([uuid, uuid]);
    expect(appends[1][2]).toEqual([tick(300), tick(600)]);
    expect(api.sessions.end).toHaveBeenCalledExactlyOnceWith(uuid);
    expect(sink.currentSessionUuid).toBeNull();
    sink.stop();
  });

  it('stays dormant through continued silence — no empty replacement row', async () => {
    const sink = new SessionSink();
    sink.start();
    sink.record({ t: 1, kind: 'transport', channel: 'A', action: 'play', playhead: 0 }, true);
    await settle();
    sink.split();
    await settle();
    vi.mocked(api.sessions.create).mockClear();
    // Dormancy: silence keeps ticking, timer flushes fire — nothing opens.
    sink.record(tick(700), false);
    vi.advanceTimersByTime(20_000);
    await settle();
    expect(api.sessions.create).not.toHaveBeenCalled();
    expect(sink.currentSessionUuid).toBeNull();
    sink.stop();
  });

  it('the next activating event opens a fresh Session, seq restarting at 0, buffered context preserved', async () => {
    const sink = new SessionSink();
    sink.start();
    sink.record({ t: 1, kind: 'transport', channel: 'A', action: 'play', playhead: 0 }, true);
    sink.flush();
    sink.flush(); // exercise seq 0 then… nothing (empty buffer): one chunk
    await settle();
    const first = sink.currentSessionUuid!;
    sink.record(tick(60), false);
    sink.flush(); // seq 1 in the FIRST Session
    await settle();
    sink.split();
    await settle();
    // Dormant reconstruction context buffers rowlessly…
    sink.record({ t: 700, kind: 'load', channel: 'B', trackId: 7, bpm: 128 }, false);
    // …until live performance resumes: a NEW Session, a NEW uuid.
    sink.record({ t: 800, kind: 'transport', channel: 'B', action: 'play', playhead: 0 }, true);
    sink.flush();
    await settle();
    const second = vi.mocked(api.sessions.create).mock.calls[1][0];
    expect(api.sessions.create).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
    const appends = vi.mocked(api.sessions.appendChunk).mock.calls;
    const secondAppends = appends.filter(([u]) => u === second);
    expect(secondAppends).toHaveLength(1);
    // Chunk seq restarts at 0 — no chunk sequence spans Sessions.
    expect(secondAppends[0][1]).toBe(0);
    // The dormant-period context arrived with the new Session's first chunk.
    expect(secondAppends[0][2]).toEqual([
      { t: 700, kind: 'load', channel: 'B', trackId: 7, bpm: 128 },
      { t: 800, kind: 'transport', channel: 'B', action: 'play', playhead: 0 },
    ]);
    sink.stop();
  });

  it('stop() after a split ends nothing twice and leaves no silent row', async () => {
    const sink = new SessionSink();
    sink.start();
    sink.record({ t: 1, kind: 'transport', channel: 'A', action: 'play', playhead: 0 }, true);
    await settle();
    sink.split();
    await settle();
    sink.record(tick(700), false); // dormant tail, never audible again
    sink.stop();
    await settle();
    expect(api.sessions.end).toHaveBeenCalledTimes(1); // only the split's end
    expect(api.sessions.create).toHaveBeenCalledTimes(1);
  });
});
