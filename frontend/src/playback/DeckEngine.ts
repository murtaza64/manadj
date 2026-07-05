/**
 * DeckEngine — framework-free playback engine for one Deck.
 *
 * Buffer-based Web Audio (ADR 0007): the whole track is fetched and decoded
 * into an AudioBuffer; seeks/cues/beatjumps are sample-accurate. Source nodes
 * are one-shot, so every start recreates one and the engine keeps its own
 * playhead clock against AudioContext.currentTime.
 *
 * The deck does not own an AudioContext or any sound-shaping (ADR 0009): it
 * is constructed against a DeckAudioPort (the Mixer's channel input) and
 * keeps only transport, declick envelopes, and varispeed.
 *
 * Transport/cue semantics live in the pure reducer (transport.ts); this class
 * interprets its AudioEffects against its channel input.
 */

import { initialTransportState, isAudioRunning, reduceTransport } from './transport';
import type { TransportEvent, TransportState } from './transport';
import { DECLICK_S } from './graph';
import type { DeckAudioPort } from './mixer';
import { getCachedBuffer, putCachedBuffer } from './bufferCache';
import { firstNonSilentTime, resolveInitialCue } from './cueDefaults';
import { PITCH_RANGE_PERCENT, composeRate } from './tempo';

export type LoadState = 'empty' | 'fetching' | 'decoding' | 'ready' | 'error';

export interface CueDefaultsInfo {
  /** Persisted Main cue, if any (CDJ memory-cue behavior). */
  savedCuePoint: number | null;
  /** First beat time from the Beatgrid, if any (cue default fallback). */
  firstBeatTime: number | null;
}

export interface DeckTrackInfo {
  trackId: number;
  audioUrl: string;
  bpm: number | null;
  /**
   * Saved-cue / first-beat lookup, fetched by the caller in parallel with
   * the audio. A promise so load() can start immediately — the engine knows
   * about the new track from the first instant, and audio + cue metadata
   * download concurrently. Rejections fall through to engine defaults.
   */
  cueDefaults?: Promise<CueDefaultsInfo>;
}

export interface DeckSnapshot {
  loadState: LoadState;
  loadError: string | null;
  trackId: number | null;
  bpm: number | null;
  /** Track duration in seconds (0 until ready). */
  duration: number;
  playing: boolean;
  /** Play was pressed while loading: playback starts when decode completes. */
  pendingPlay: boolean;
  previewing: boolean;
  hotCuePreviewSlot: number | null;
  cuePoint: number | null;
  /** Varispeed, percent (±). */
  pitchPercent: number;
  /** Momentary nudge, percent (± — stacked on pitch, 0 when released). */
  bendPercent: number;
}

interface ActiveSource {
  node: AudioBufferSourceNode;
  envelope: GainNode;
  /** Set when the engine stops it deliberately, so onended isn't a natural end. */
  stopped: boolean;
}

export class DeckEngine {
  /** Last audio access from the port (context may be revived by the Mixer). */
  private audio: { ctx: AudioContext; input: AudioNode } | null = null;

  private buffer: AudioBuffer | null = null;
  private trackInfo: DeckTrackInfo | null = null;
  private loadState: LoadState = 'empty';
  private loadError: string | null = null;
  private loadAbort: AbortController | null = null;

  private transport: TransportState = initialTransportState();
  private source: ActiveSource | null = null;
  /** Play pressed while loading — fires as soon as decode completes. */
  private pendingPlay = false;

  /** Clock anchor: playhead position (s) at ctx time `anchorCtxTime`. */
  private anchorPosition = 0;
  private anchorCtxTime = 0;

  private pitchPercent = 0;
  /** Momentary nudge multiplier on top of pitch; 0 when released. */
  private bendPercent = 0;

  private listeners = new Set<() => void>();
  private snapshot: DeckSnapshot;

  /**
   * Invoked when the user sets the Main cue (cue button while paused away
   * from the cue) — the persistence hook, called with the engine's own
   * loaded trackId so a cue can never persist against a track that is
   * merely *about* to load. The engine stays API-ignorant; the React layer
   * wires this to the backend. Defaults applied at load do NOT fire it.
   */
  private onCueSet: ((trackId: number, timeSeconds: number) => void) | null = null;

  setCueSetHandler(
    handler: ((trackId: number, timeSeconds: number) => void) | null
  ): void {
    this.onCueSet = handler;
  }

  private readonly port: DeckAudioPort;
  /** Varispeed reach, percent. Defaults to the hardware-like fader range;
   * the Transition editor's private decks pass a wider one (templates
   * imply tempo-match and must hold beat alignment on extreme pairs). */
  private readonly pitchRangePercent: number;

  constructor(port: DeckAudioPort, pitchRangePercent: number = PITCH_RANGE_PERCENT) {
    this.port = port;
    this.pitchRangePercent = pitchRangePercent;
    this.snapshot = this.buildSnapshot();
  }

  /** Get the live context and this deck's channel input from the Mixer. */
  private ensureAudio(): { ctx: AudioContext; input: AudioNode } {
    this.audio = this.port.ensureAudio();
    return this.audio;
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
    this.pendingPlay = false;
    // A nudge is a momentary correction against the *previous* pairing —
    // never carried onto a fresh track. Pitch persists (deliberate setting).
    this.bendPercent = 0;
    this.loadState = 'fetching';
    this.loadError = null;
    this.emit();

    try {
      // Decoded-buffer cache (mix-editor 28): another surface (or a
      // previous Load) may already hold this track's decode — reuse it and
      // skip fetch+decode entirely (mode-switch into the editor path).
      let buffer = getCachedBuffer(info.trackId);
      if (!buffer) {
        const res = await fetch(info.audioUrl, { signal: abort.signal });
        if (!res.ok) throw new Error(`audio fetch failed: ${res.status}`);
        const bytes = await res.arrayBuffer();
        if (abort.signal.aborted) return;

        this.loadState = 'decoding';
        this.emit();
        buffer = await this.ensureAudio().ctx.decodeAudioData(bytes);
        if (abort.signal.aborted) return;
        putCachedBuffer(info.trackId, buffer);
      }

      // Cue metadata was fetched concurrently with the audio; absence (or a
      // failed lookup) falls through the default precedence.
      const cueInfo = await (info.cueDefaults ?? Promise.resolve(null)).catch(
        () => null
      );
      if (abort.signal.aborted) return;

      this.buffer = buffer;

      // Resolve the initial Main cue (saved → first beat → first
      // non-silence → 0) and park the deck at it, CDJ-style. Non-silence
      // considers every channel (earliest sound in any).
      let firstNonSilence: number | null = null;
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const t = firstNonSilentTime(buffer.getChannelData(c), buffer.sampleRate);
        if (t !== null && (firstNonSilence === null || t < firstNonSilence)) {
          firstNonSilence = t;
        }
      }
      const cue = resolveInitialCue({
        saved: cueInfo?.savedCuePoint ?? null,
        firstBeat: cueInfo?.firstBeatTime ?? null,
        firstNonSilence,
      });
      this.transport = {
        ...this.transport,
        cuePoint: this.clampTime(cue),
        playhead: this.clampTime(cue),
      };

      this.loadState = 'ready';
      this.emit();

      // Play pressed during the load: start now, from the cue.
      if (this.pendingPlay) {
        this.pendingPlay = false;
        this.dispatch({ type: 'play' });
      }
    } catch (err) {
      if (abort.signal.aborted) return;
      this.loadState = 'error';
      this.loadError = err instanceof Error ? err.message : String(err);
      this.pendingPlay = false;
      this.emit();
    }
  }

  // ── Transport interface ────────────────────────────────────────────────

  /** True while a load is in flight and play intent can be latched. */
  private isLoading(): boolean {
    return this.loadState === 'fetching' || this.loadState === 'decoding';
  }

  /** Arbiter tripwire (ADR 0013): start gestures on a non-audible surface
   * are warned no-ops — latching play against a suspended clock is the
   * two-clock drift bug (issue 08) waiting to resume. */
  private startBlocked(): boolean {
    if (this.port.mayStart?.() ?? true) return false;
    console.warn('[DeckEngine] start blocked: surface is not audible (ADR 0013)');
    return true;
  }

  play(): void {
    if (this.startBlocked()) return;
    if (this.isLoading()) {
      // Latch the intent; load() fires it when decode completes.
      if (!this.pendingPlay) {
        this.pendingPlay = true;
        this.emit();
      }
      return;
    }
    this.dispatch({ type: 'play' });
  }

  pause(): void {
    if (this.pendingPlay) {
      this.pendingPlay = false;
      this.emit();
      return;
    }
    this.dispatch({ type: 'pause' });
  }

  togglePlay(): void {
    const wouldStart = this.isLoading() ? !this.pendingPlay : !this.snapshot.playing;
    if (wouldStart && this.startBlocked()) return;
    if (this.isLoading()) {
      this.pendingPlay = !this.pendingPlay;
      this.emit();
      return;
    }
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

  /** A BPM edit landed for the loaded Track: keep beat-domain math (beat
   * jumps) honest without a re-Load. The engine learns bpm at Load
   * otherwise — editing used to leave jumps sized by the OLD tempo. */
  setTrackBpm(bpm: number | null): void {
    if (!this.trackInfo) return;
    this.trackInfo = { ...this.trackInfo, bpm };
    this.emit();
  }

  cueDown(): void {
    // Cue-down starts audio (hold-to-preview) — same tripwire as play.
    if (this.startBlocked()) return;
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
  // (EQ/filter/fader live on the Mixer's channel strip — ADR 0009. The deck
  // keeps only varispeed.)

  setPitch(percent: number): void {
    const clamped = Math.max(
      -this.pitchRangePercent,
      Math.min(this.pitchRangePercent, percent)
    );
    this.setRateComponents(clamped, this.bendPercent);
  }

  /**
   * Momentary tempo bend (Nudge): a rate multiplier stacked on pitch —
   * rate = (1 + pitch/100) × (1 + bend/100). setBend(0) releases, restoring
   * the exact pitch-only rate. Auto-cleared on Load. The ±2% UI amount is
   * the caller's constant (tempo.NUDGE_BEND_PERCENT); the engine takes any
   * percent.
   */
  setBend(percent: number): void {
    this.setRateComponents(this.pitchPercent, percent);
  }

  /**
   * Adopt new rate components and apply the composed rate to a live source.
   * Re-anchor the clock at the OLD rate first, then step the rate at the
   * same instant. An instant rate set (no smoothing) keeps the playhead
   * clock exact — a smoothed rate would drift against the anchor math.
   */
  private setRateComponents(pitchPercent: number, bendPercent: number): void {
    // No-op (and crucially: no emit) when nothing changes — repeat callers
    // (e.g. the transition editor re-applying tempo match on every model
    // change) must not trigger re-renders (issue 10).
    if (pitchPercent === this.pitchPercent && bendPercent === this.bendPercent) return;
    if (this.source && !this.source.stopped && this.audio) {
      const now = this.audio.ctx.currentTime;
      this.anchorPosition = this.getPlayhead(); // still at the old rate
      this.anchorCtxTime = now;
      this.pitchPercent = pitchPercent;
      this.bendPercent = bendPercent;
      this.source.node.playbackRate.setValueAtTime(this.currentRate(), now);
    } else {
      this.pitchPercent = pitchPercent;
      this.bendPercent = bendPercent;
    }
    this.emit();
  }

  // ── Reads ──────────────────────────────────────────────────────────────

  /** True if the deck's audio is audibly running (playing or any preview). */
  isAudioRunning(): boolean {
    return isAudioRunning(this.transport);
  }

  /** Current playhead in seconds. Cheap; safe to poll per animation frame. */
  getPlayhead(): number {
    if (this.source && !this.source.stopped && this.audio) {
      const elapsed =
        (this.audio.ctx.currentTime - this.anchorCtxTime) * this.currentRate();
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
   * Stop and release. Safe to keep using the engine afterwards — the audio
   * context belongs to the Mixer, which revives it on demand.
   */
  dispose(): void {
    this.loadAbort?.abort();
    this.stopAudio(this.getPlayhead());
    this.audio = null;
    this.listeners.clear();
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private dispatch(event: TransportEvent): void {
    if (!this.buffer) return;
    const synced = { ...this.transport, playhead: this.getPlayhead() };
    const [next, effects] = reduceTransport(synced, event);
    const cueChanged = next.cuePoint !== synced.cuePoint;
    this.transport = next;
    for (const effect of effects) {
      if (effect.type === 'start') this.startAudio(effect.at);
      else this.stopAudio(effect.at);
    }
    this.emit();

    // A cue-down that moved the cue is the user setting it — persistence hook.
    if (
      event.type === 'cue-down' &&
      cueChanged &&
      next.cuePoint !== null &&
      this.trackInfo
    ) {
      this.onCueSet?.(this.trackInfo.trackId, next.cuePoint);
    }
  }

  private startAudio(at: number): void {
    if (!this.buffer) return;
    const { ctx, input } = this.ensureAudio();
    if (ctx.state === 'suspended') {
      ctx.resume().catch((err) => {
        console.warn('[DeckEngine] AudioContext.resume() failed:', err);
      });
    }
    this.killCurrentSource();

    const offset = Math.max(0, Math.min(at, this.buffer.duration - 0.001));
    const node = ctx.createBufferSource();
    node.buffer = this.buffer;
    node.playbackRate.value = this.currentRate();

    // Declick fade-in envelope into this deck's mixer channel.
    const envelope = ctx.createGain();
    const now = ctx.currentTime;
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(1, now + DECLICK_S);
    envelope.connect(input);
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
    // An active source implies live audio access.
    if (this.audio) {
      const now = this.audio.ctx.currentTime;
      // Declick fade-out, then stop the source.
      active.envelope.gain.cancelScheduledValues(now);
      active.envelope.gain.setValueAtTime(active.envelope.gain.value, now);
      active.envelope.gain.linearRampToValueAtTime(0, now + DECLICK_S);
      try {
        active.node.stop(now + DECLICK_S * 1.5);
      } catch {
        // Source may never have started or already ended; nothing to do.
      }
    }
    this.source = null;
  }

  private currentRate(): number {
    return composeRate(this.pitchPercent, this.bendPercent);
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
      pendingPlay: this.pendingPlay,
      previewing: this.transport.previewing,
      hotCuePreviewSlot: this.transport.hotCuePreviewSlot,
      cuePoint: this.transport.cuePoint,
      pitchPercent: this.pitchPercent,
      bendPercent: this.bendPercent,
    };
  }

  private emit(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }
}
