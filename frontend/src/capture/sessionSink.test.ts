/**
 * Session chunk buffer (Sessions PRD, ADR 0033) — the pure batching seam.
 * Push accumulates in order; drain cuts a chunk and empties; a quiet
 * buffer drains to nothing (so a silent 5s writes no chunk); a burst past
 * the safety valve is flagged for an early cut. Timers and I/O live in the
 * SessionSink shell and are not exercised here.
 */
import { describe, expect, it } from 'vitest';
import { ChunkBuffer } from './sessionSink';
import type { CaptureEvent } from './events';

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
