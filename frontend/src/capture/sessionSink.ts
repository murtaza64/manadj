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
 *    take sink's fire-and-forget posture (ADR 0011): starts buffering on
 *    `start()`, opens the persisted Session on the first live event, appends
 *    drained chunks in `seq` order, and `end()`s on `stop()`. Synthetic
 *    boot/remount lifetimes therefore leave no empty Session rows. A dead
 *    backend loses a chunk (logged), capture keeps running; there is no
 *    retry queue. The Session uuid it holds stamps each Take.
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
  /** Serialize recovery → create → chunk appends → end. In particular, a
   * first live event arriving during boot must not be closed by recovery. */
  private writes: Promise<void> = Promise.resolve();

  /** The persisted Session's uuid, or null before the first live event / after
   * stop. Read by `persistTake` to stamp each Take (ADR 0033). */
  get currentSessionUuid(): string | null {
    return this.uuid;
  }

  /** Begin buffering and the ~5s flush timer. The database row opens lazily
   * on the first live event, not on a synthetic React boot/remount. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.writes = api.sessions
      .recover()
      .then(() => void queryClient.invalidateQueries({ queryKey: ['sessions'] }))
      .catch((err) => console.error('session: stale-session recovery failed', err));
    this.timer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  private activate(): void {
    if (this.uuid !== null) return;
    const uuid = crypto.randomUUID();
    this.uuid = uuid;
    this.writes = this.writes
      .then(() => api.sessions.create(uuid))
      .then(() => void queryClient.invalidateQueries({ queryKey: ['sessions'] }))
      .catch((err) => console.error('session: create failed', err));
  }

  /** Record one event. Seed snapshots and empty ticks pass
   * `activatesSession=false`: they remain buffered as reconstruction context
   * but do not create an empty row. The first live event opens the Session. */
  record(event: CaptureEvent, activatesSession = true): void {
    if (!this.started) return;
    this.buffer.push(event);
    if (activatesSession) this.activate();
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
    this.writes = this.writes
      .then(() => api.sessions.appendChunk(uuid, seq, events))
      .then(() => void queryClient.invalidateQueries({ queryKey: ['sessions'] }))
      .catch((err) => console.error('session: chunk append failed — tail lost', err));
  }

  /** Close the Session: flush the tail, end it, stop the timer. Idempotent. */
  stop(): void {
    if (!this.started) return;
    this.flush();
    const uuid = this.uuid;
    if (uuid !== null) {
      this.writes = this.writes
        .then(() => api.sessions.end(uuid))
        .then(() => void queryClient.invalidateQueries({ queryKey: ['sessions'] }))
        .catch((err) => console.error('session: end failed', err));
    } else {
      // A boot/remount that saw no live event is intentionally ephemeral.
      this.buffer.drain();
    }
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.uuid = null;
    this.started = false;
  }
}
