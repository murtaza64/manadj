/**
 * DeckEngine — framework-free playback engine for the Practice view's Deck.
 *
 * Buffer-based Web Audio (ADR 0007): the whole track is fetched and decoded
 * into an AudioBuffer; seeks/cues/beatjumps are sample-accurate. Source nodes
 * are one-shot, so every start recreates one and the engine keeps its own
 * playhead clock against AudioContext.currentTime.
 *
 * Transport/cue semantics live in the pure reducer (transport.ts); this class
 * interprets its AudioEffects against the graph (graph.ts).
 */

import { initialTransportState, isAudioRunning, reduceTransport } from './transport';
import type { TransportEvent, TransportState } from './transport';
import { DeckGraph, DECLICK_S } from './graph';
import type { EqBand } from './graph';

export type LoadState = 'empty' | 'fetching' | 'decoding' | 'ready' | 'error';

export interface DeckTrackInfo {
  trackId: number;
  audioUrl: string;
  bpm: number | null;
}

export interface DeckSnapshot {
  loadState: LoadState;
  loadError: string | null;
  trackId: number | null;
  bpm: number | null;
  /** Track duration in seconds (0 until ready). */
  duration: number;
  playing: boolean;
  previewing: boolean;
  hotCuePreviewSlot: number | null;
  cuePoint: number | null;
  /** Varispeed, percent (±). */
  pitchPercent: number;
  /** EQ control values in [0,1]; 0.5 = flat. */
  eq: Record<EqBand, number>;
  /** Sweep filter position in [-1,1]; 0 = off. */
  filterPosition: number;
}

interface ActiveSource {
  node: AudioBufferSourceNode;
  envelope: GainNode;
  /** Set when the engine stops it deliberately, so onended isn't a natural end. */
  stopped: boolean;
}

const PITCH_RANGE_PERCENT = 8;

export class DeckEngine {
  // Created lazily and recreated if closed: React StrictMode dev double-mount
  // disposes the engine once before the real mount, and a closed AudioContext
  // is unusable (frozen currentTime, failing resume).
  private ctx: AudioContext | null = null;
  private graph: DeckGraph | null = null;

  private buffer: AudioBuffer | null = null;
  private trackInfo: DeckTrackInfo | null = null;
  private loadState: LoadState = 'empty';
  private loadError: string | null = null;
  private loadAbort: AbortController | null = null;

  private transport: TransportState = initialTransportState();
  private source: ActiveSource | null = null;

  /** Clock anchor: playhead position (s) at ctx time `anchorCtxTime`. */
  private anchorPosition = 0;
  private anchorCtxTime = 0;

  private pitchPercent = 0;
  private eq: Record<EqBand, number> = { low: 0.5, mid: 0.5, high: 0.5 };
  private filterPosition = 0;

  private listeners = new Set<() => void>();
  private snapshot: DeckSnapshot;

  constructor() {
    this.snapshot = this.buildSnapshot();
  }

  /** Get a usable context+graph, (re)creating them if absent or closed. */
  private ensureAudio(): { ctx: AudioContext; graph: DeckGraph } {
    if (!this.ctx || !this.graph || this.ctx.state === 'closed') {
      console.debug('[DeckEngine] creating AudioContext');
      this.ctx = new AudioContext();
      this.graph = new DeckGraph(this.ctx);
      // Reapply sound-control state to the fresh graph.
      for (const band of ['low', 'mid', 'high'] as const) {
        this.graph.setEqValue(band, this.eq[band]);
      }
      this.graph.setFilterPosition(this.filterPosition);
    }
    return { ctx: this.ctx, graph: this.graph };
  }

  // ── Loading ────────────────────────────────────────────────────────────

  async load(info: DeckTrackInfo): Promise<void> {
    this.loadAbort?.abort();
    const abort = new AbortController();
    this.loadAbort = abort;

    // Reset the deck for the new track.
    this.stopAudio(0);
    this.transport = initialTransportState();
    this.buffer = null;
    this.trackInfo = info;
    this.loadState = 'fetching';
    this.loadError = null;
    this.emit();

    try {
      const res = await fetch(info.audioUrl, { signal: abort.signal });
      if (!res.ok) throw new Error(`audio fetch failed: ${res.status}`);
      const bytes = await res.arrayBuffer();
      if (abort.signal.aborted) return;

      this.loadState = 'decoding';
      this.emit();
      const buffer = await this.ensureAudio().ctx.decodeAudioData(bytes);
      if (abort.signal.aborted) return;

      this.buffer = buffer;
      this.loadState = 'ready';
      this.emit();
    } catch (err) {
      if (abort.signal.aborted) return;
      this.loadState = 'error';
      this.loadError = err instanceof Error ? err.message : String(err);
      this.emit();
    }
  }

  // ── Transport interface ────────────────────────────────────────────────

  play(): void {
    this.dispatch({ type: 'play' });
  }

  pause(): void {
    this.dispatch({ type: 'pause' });
  }

  togglePlay(): void {
    this.dispatch({ type: 'toggle-play' });
  }

  seek(seconds: number): void {
    if (!this.buffer) return;
    this.dispatch({ type: 'seek', time: this.clampTime(seconds) });
  }

  jumpBeats(beats: number): void {
    if (!this.buffer) return;
    // BPM-less tracks assume 120 (library-player parity): a usable jump beats
    // a silently dead control.
    const bpm = this.trackInfo?.bpm ?? 120;
    const target = this.getPlayhead() + beats * (60 / bpm);
    this.dispatch({ type: 'seek', time: this.clampTime(target) });
  }

  cueDown(): void {
    this.dispatch({ type: 'cue-down' });
  }

  cueUp(): void {
    this.dispatch({ type: 'cue-up' });
  }

  hotCueDown(slot: number, timeSeconds: number | null): void {
    this.dispatch({
      type: 'hot-cue-down',
      slot,
      time: timeSeconds === null ? null : this.clampTime(timeSeconds),
    });
  }

  hotCueUp(slot: number, timeSeconds: number | null): void {
    this.dispatch({ type: 'hot-cue-up', slot, time: timeSeconds });
  }

  // ── Sound controls ─────────────────────────────────────────────────────

  setEqValue(band: EqBand, value: number): void {
    this.eq = { ...this.eq, [band]: value };
    // Applied to the live graph if one exists; ensureAudio reapplies otherwise.
    this.graph?.setEqValue(band, value);
    this.emit();
  }

  setFilterPosition(position: number): void {
    this.filterPosition = position;
    this.graph?.setFilterPosition(position);
    this.emit();
  }

  setPitch(percent: number): void {
    const clamped = Math.max(-PITCH_RANGE_PERCENT, Math.min(PITCH_RANGE_PERCENT, percent));
    // Re-anchor the clock at the old rate, then step the rate at the same
    // instant. An instant rate set (no smoothing) keeps the playhead clock
    // exact — a smoothed rate would drift against the anchor math.
    if (this.source && !this.source.stopped && this.ctx) {
      const now = this.ctx.currentTime;
      this.anchorPosition = this.getPlayhead();
      this.anchorCtxTime = now;
      this.source.node.playbackRate.setValueAtTime(this.rateFor(clamped), now);
    }
    this.pitchPercent = clamped;
    this.emit();
  }

  // ── Reads ──────────────────────────────────────────────────────────────

  /** True if the deck's audio is audibly running (playing or any preview). */
  isAudioRunning(): boolean {
    return isAudioRunning(this.transport);
  }

  /** Current playhead in seconds. Cheap; safe to poll per animation frame. */
  getPlayhead(): number {
    if (this.source && !this.source.stopped && this.ctx) {
      const elapsed = (this.ctx.currentTime - this.anchorCtxTime) * this.rateFor(this.pitchPercent);
      return this.clampTime(this.anchorPosition + elapsed);
    }
    return this.transport.playhead;
  }

  getSnapshot(): DeckSnapshot {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Tear down audio resources. Safe to keep using the engine afterwards —
   * the context is recreated on demand (React StrictMode dev double-mount
   * disposes once before the real mount).
   */
  dispose(): void {
    this.loadAbort?.abort();
    this.stopAudio(this.getPlayhead());
    if (this.ctx && this.ctx.state !== 'closed') void this.ctx.close();
    this.ctx = null;
    this.graph = null;
    this.listeners.clear();
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private dispatch(event: TransportEvent): void {
    if (!this.buffer) return;
    const synced = { ...this.transport, playhead: this.getPlayhead() };
    const [next, effects] = reduceTransport(synced, event);
    this.transport = next;
    for (const effect of effects) {
      if (effect.type === 'start') this.startAudio(effect.at);
      else this.stopAudio(effect.at);
    }
    this.emit();
  }

  private startAudio(at: number): void {
    if (!this.buffer) return;
    const { ctx, graph } = this.ensureAudio();
    if (ctx.state === 'suspended') {
      ctx.resume().catch((err) => {
        console.warn('[DeckEngine] AudioContext.resume() failed:', err);
      });
    }
    this.killCurrentSource();

    const offset = Math.max(0, Math.min(at, this.buffer.duration - 0.001));
    const node = ctx.createBufferSource();
    node.buffer = this.buffer;
    node.playbackRate.value = this.rateFor(this.pitchPercent);

    const envelope = graph.createEnvelope();
    node.connect(envelope);

    const active: ActiveSource = { node, envelope, stopped: false };
    node.onended = () => {
      // Natural end of buffer (deliberate stops set `stopped` first).
      if (!active.stopped && this.source === active) {
        this.source = null;
        // The clock can no longer be read from the source; rest the playhead
        // at the end of the track before reducing.
        this.transport = {
          ...this.transport,
          playhead: this.buffer?.duration ?? this.transport.playhead,
        };
        this.dispatch({ type: 'ended' });
      }
    };

    node.start(0, offset);
    this.source = active;
    this.anchorPosition = offset;
    this.anchorCtxTime = ctx.currentTime;
  }

  private stopAudio(at: number): void {
    this.killCurrentSource();
    this.transport = { ...this.transport, playhead: this.clampTime(at) };
  }

  /** Declick-fade and stop the current source, if any. */
  private killCurrentSource(): void {
    const active = this.source;
    if (!active || active.stopped) {
      this.source = null;
      return;
    }
    active.stopped = true;
    // An active source implies a live graph/context.
    if (this.graph && this.ctx) {
      this.graph.releaseEnvelope(active.envelope);
      try {
        active.node.stop(this.ctx.currentTime + DECLICK_S * 1.5);
      } catch {
        // Source may never have started or already ended; nothing to do.
      }
    }
    this.source = null;
  }

  private rateFor(pitchPercent: number): number {
    return 1 + pitchPercent / 100;
  }

  private clampTime(seconds: number): number {
    const duration = this.buffer?.duration ?? 0;
    return Math.max(0, Math.min(seconds, duration));
  }

  private buildSnapshot(): DeckSnapshot {
    return {
      loadState: this.loadState,
      loadError: this.loadError,
      trackId: this.trackInfo?.trackId ?? null,
      bpm: this.trackInfo?.bpm ?? null,
      duration: this.buffer?.duration ?? 0,
      playing: this.transport.playing,
      previewing: this.transport.previewing,
      hotCuePreviewSlot: this.transport.hotCuePreviewSlot,
      cuePoint: this.transport.cuePoint,
      pitchPercent: this.pitchPercent,
      eq: this.eq,
      filterPosition: this.filterPosition,
    };
  }

  private emit(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }
}
