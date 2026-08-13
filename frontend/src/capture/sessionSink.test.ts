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
