/**
 * Session sink (Sessions PRD, ADR 0033): stream the recorder's whole event
 * log to the backend as append-only chunks.
 *
 * Two pieces:
 *
 *  - `ChunkBuffer` — a PURE batching buffer (no timers, no I/O): events push
 *    in, `drain()` cuts a chunk and empties. The flush POLICY is time
 *    (~5s) + on-demand (gate transitions, page-hide) — the buffer only
 *    decides that an empty buffer yields nothing and that a burst past
 *    `maxBatch` is a chunk to cut now (a safety valve, not the normal path).
 *    This is the seam the vitest covers.
 *
 *  - `SessionSink` — the timer/I/O shell around the buffer, matching the
 *    take sink's fire-and-forget posture (ADR 0011): opens a Session on
 *    `start()`, appends drained chunks in `seq` order, `flush()`es on
 *    demand, `end()`s on `stop()`. A dead backend loses a chunk (logged),
 *    capture keeps running; there is no retry queue. The Session uuid it
 *    holds is what stamps each Take (`persistTake` reads `currentSessionUuid`).
 */
import { api } from '../api/client';
import { queryClient } from '../api/queryClient';
import type { CaptureEvent } from './events';

/** ~5s flush cadence (ADR 0033) — the normal chunk boundary. */
export const FLUSH_INTERVAL_MS = 5000;
/** Safety valve: a burst this large is cut immediately rather than held. */
export const MAX_BATCH = 2000;

/**
 * A pure append-and-drain batching buffer. No time, no I/O — the SessionSink
 * supplies both. Cutting a chunk is `drain()`; the flush schedule lives
 * outside.
 */
export class ChunkBuffer {
  private events: CaptureEvent[] = [];
  private readonly maxBatch: number;

  constructor(maxBatch: number = MAX_BATCH) {
    this.maxBatch = maxBatch;
  }

  /** Buffer one event. Order is preserved; nothing is dropped here. */
  push(event: CaptureEvent): void {
    this.events.push(event);
  }

  /** Events awaiting a flush. */
  get size(): number {
    return this.events.length;
  }

  /** True once the buffer has grown past its safety valve — the shell
   * should cut a chunk now rather than wait for the timer. */
  get overflowing(): boolean {
    return this.events.length >= this.maxBatch;
  }

  /**
   * Cut a chunk: return the buffered events (in push order) and empty the
   * buffer. An empty buffer drains to `[]` — the shell skips the POST, so a
   * quiet 5s writes no chunk.
   */
  drain(): CaptureEvent[] {
    if (this.events.length === 0) return [];
    const chunk = this.events;
    this.events = [];
    return chunk;
  }
}

export class SessionSink {
  private buffer = new ChunkBuffer();
  private uuid: string | null = null;
  private seq = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  /** The open Session's uuid, or null before start / after stop. Read by
   * `persistTake` to stamp each Take with its Session (ADR 0033). */
  get currentSessionUuid(): string | null {
    return this.uuid;
  }

  /** Open the Session and begin the ~5s flush timer. Fire-and-forget: the
   * uuid is minted locally so chunk appends need no create round-trip. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.uuid = crypto.randomUUID();
    const uuid = this.uuid;
    void api.sessions
      .create(uuid)
      .then(() => void queryClient.invalidateQueries({ queryKey: ['sessions'] }))
      .catch((err) => console.error('session: create failed', err));
    this.timer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  /** Record one event. Overflowing the safety valve cuts a chunk early. */
  record(event: CaptureEvent): void {
    if (!this.started) return;
    this.buffer.push(event);
    if (this.buffer.overflowing) this.flush();
  }

  /** Cut and append the pending chunk now (timer tick, gate transition,
   * page-hide). A quiet buffer is a no-op. */
  flush(): void {
    const uuid = this.uuid;
    if (uuid === null) return;
    const events = this.buffer.drain();
    if (events.length === 0) return;
    const seq = this.seq++;
    void api.sessions
      .appendChunk(uuid, seq, events)
      .then(() => void queryClient.invalidateQueries({ queryKey: ['sessions'] }))
      .catch((err) => console.error('session: chunk append failed — tail lost', err));
  }

  /** Close the Session: flush the tail, end it, stop the timer. Idempotent. */
  stop(): void {
    if (!this.started) return;
    this.flush();
    const uuid = this.uuid;
    if (uuid !== null) {
      void api.sessions
        .end(uuid)
        .then(() => void queryClient.invalidateQueries({ queryKey: ['sessions'] }))
        .catch((err) => console.error('session: end failed', err));
    }
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.uuid = null;
    this.started = false;
  }
}
