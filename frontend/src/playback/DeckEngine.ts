/**
 * DeckEngine — framework-free playback engine for one Deck.
 *
 * Buffer-based Web Audio (ADR 0007): the whole track is fetched and decoded
 * into an AudioBuffer; seeks/cues/beatjumps are sample-accurate. The deck's
 * single audio source is a persistent dual-mode pull worklet (ADR 0018) —
 * the one-shot AudioBufferSourceNode path is retired. Starts, stops, and
 * stab restarts are declick splices inside the worklet; the engine keeps its
 * own playhead clock against AudioContext.currentTime, anchored at every
 * start and rate step.
 *
 * The deck does not own an AudioContext or any sound-shaping (ADR 0009): it
 * is constructed against a DeckAudioPort (the Mixer's channel input) and
 * keeps only transport and varispeed.
 *
 * Transport/cue semantics live in the pure reducer (transport.ts); this class
 * interprets its AudioEffects against its channel input.
 */

import { initialTransportState, isAudioRunning, reduceTransport } from './transport';
import type { TransportContext, TransportEvent, TransportState } from './transport';
import { isQuantizeOn } from './quantizeStore';
import { addBeats } from './quantize';
import { foldLoopPlayhead, projectLoopBeats } from './loop';
import type { LoopRegion, LoopResize } from './loop';
import type { DeckAudioPort } from './mixer';
import { DeckSourceNode } from './worklet/deckSourceNode';
import { getCachedBuffer, putCachedBuffer } from './bufferCache';
import { firstNonSilentTime, resolveInitialCue } from './cueDefaults';
import { MAX_PITCH_RANGE_PERCENT, composeRate } from './tempo';

export type LoadState = 'empty' | 'fetching' | 'decoding' | 'ready' | 'error';

/**
 * How far before track start the playhead may be parked (issue 07). A
 * backward beat jump near the head lands in this pre-start lead-in instead
 * of clamping to 0, preserving its beat distance; playback is silent across
 * it and enters the track on time. Bounded so a runaway gesture can't push
 * the playhead into an unbounded silent pre-roll — this is a musical lead-in.
 */
const MAX_LEAD_IN_SECONDS = 30;

/** A playhead discontinuity: seek, beat jump, or hot-cue jump. */
export interface DeckTransportGesture {
  action: 'seek' | 'jumpBeats' | 'hotCue';
  playhead: number;
  detail?: number;
}

export interface CueDefaultsInfo {
  /** Persisted Main cue, if any (CDJ memory-cue behavior). */
  savedCuePoint: number | null;
  /**
   * The Beatgrid's beat times in seconds, or null for gridless Tracks.
   * First beat is the cue-default fallback; the full grid feeds Quantize
   * math at gesture time (looping 01).
   */
  beatTimes: number[] | null;
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
  /** Key Lock (CONTEXT.md): while on, rate changes leave the Track's Key
   * unchanged (worklet stretch mode). Deck setting; survives Loads. */
  keyLock: boolean;
  /** Active loop (looping 03): the region the playhead wraps in, or null. */
  loop: LoopRegion | null;
  /** The active loop's displayed size (ADR 0027 §6): the seconds region
   * projected through the LIVE grid — `~N.N` after a re-tempo. Null when
   * no loop is active. */
  loopBeatsLabel: string | null;
  /** Pending auto-loop size in beats (survives Loads). */
  pendingLoopBeats: number;
  /** The loaded Track has a usable Beatgrid (auto-loop is inert without). */
  hasBeatgrid: boolean;
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
  /** Play pressed while loading — fires as soon as decode completes. */
  private pendingPlay = false;
  /** Loaded Track's Beatgrid beat times (null = gridless) — Quantize math. */
  private beatTimes: number[] | null = null;

  // ── Worklet source (ADR 0018) ────────────────────────────────────────
  /** The deck's single audio source, persistent per AudioContext. */
  private sourceNode: DeckSourceNode | null = null;
  /** In-flight DeckSourceNode.create (addModule is the one async step). */
  private sourceNodeCreating = false;
  /** Buffer whose samples were last handed to the worklet. */
  private loadedIntoWorklet: AudioBuffer | null = null;
  /** startId of the running voice; null while audio is stopped. Ended
   * messages carrying any other id are stale and ignored. */
  private runningStartId: number | null = null;
  private nextStartId = 1;
  /** Start requested before the node was ready (first play / ctx revival). */
  private pendingStartAt: number | null = null;

  // ── Pre-start lead-in (issue 07) ──────────────────────────────────────
  /** True while the deck is running from a negative (pre-track) position:
   * the clock counts up from the lead-in but no voice sounds yet. The
   * scheduled `beginStart(0)` at the t=0 crossing clears it. */
  private leadInActive = false;
  /** Pending timer that fires the real worklet start at the t=0 crossing.
   * Rescheduled on a rate change during the lead-in; cleared on any
   * stop/seek/dispose. */
  private leadInTimer: ReturnType<typeof setTimeout> | null = null;

  /** Clock anchor: playhead position (s) at ctx time `anchorCtxTime`. */
  private anchorPosition = 0;
  private anchorCtxTime = 0;

  private pitchPercent = 0;
  /** Momentary nudge multiplier on top of pitch; 0 when released. */
  private bendPercent = 0;
  /** Key Lock. Engine default is OFF (pure varispeed — the editor's private
   * decks keep today's behavior); the shared Decks' default-ON comes from
   * the persisted store at the DeckContext layer. */
  private keyLock = false;

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

  /**
   * Invoked on playhead DISCONTINUITIES (seek / beat jump / hot cue) —
   * the transport gestures invisible to snapshot diffs (playing/pitch
   * flips are; playhead moves aren't). The capture layer's tap
   * (transition-takes 02): raw-slice evidence for Take vectorization.
   * Same single-slot, engine-stays-API-ignorant contract as onCueSet.
   */
  private onTransportEvent: ((e: DeckTransportGesture) => void) | null = null;

  setTransportEventHandler(handler: typeof this.onTransportEvent): void {
    this.onTransportEvent = handler;
  }

  /** Additional discontinuity listeners (sets 04): the Conductor's
   * takeover tap rides beside capture's single slot — additive, so the
   * recorder's ownership of the slot above stays untouched. */
  private transportEventListeners = new Set<(e: DeckTransportGesture) => void>();

  addTransportEventListener(listener: (e: DeckTransportGesture) => void): () => void {
    this.transportEventListeners.add(listener);
    return () => this.transportEventListeners.delete(listener);
  }

  private fireTransportEvent(e: DeckTransportGesture): void {
    this.onTransportEvent?.(e);
    for (const listener of this.transportEventListeners) listener(e);
  }

  private readonly port: DeckAudioPort;

  constructor(port: DeckAudioPort) {
    this.port = port;
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

    // Reset the deck for the new track. Load clears the loop (a region
    // from the old Track can't haunt the new one) but the pending size is
    // a Deck preference and survives.
    this.stopAudio(0);
    this.transport = {
      ...initialTransportState(),
      pendingLoopBeats: this.transport.pendingLoopBeats,
    };
    this.buffer = null;
    this.beatTimes = null;
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
      this.beatTimes = cueInfo?.beatTimes ?? null;

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
        firstBeat: this.beatTimes?.[0] ?? null,
        firstNonSilence,
      });
      this.transport = {
        ...this.transport,
        cuePoint: this.clampTime(cue),
        playhead: this.clampTime(cue),
      };

      // Hand the samples to the worklet source ahead of the first start, so
      // a stab doesn't pay the channel-data copy. Cache-hit loads on a deck
      // with no node yet stay audio-free (the first start builds the node).
      if (this.sourceNode) {
        this.handOverIfStale(this.sourceNode);
      } else if (this.audio) {
        // The decode path already touched audio: warm the node too, so the
        // first play skips addModule latency.
        this.createSourceNode(this.audio.ctx);
      }

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

  play(): void {
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
    if (this.isLoading()) {
      this.pendingPlay = !this.pendingPlay;
      this.emit();
      return;
    }
    this.dispatch({ type: 'toggle-play' });
  }

  seek(seconds: number): void {
    if (!this.buffer) return;
    const time = this.clampPlayhead(seconds);
    this.fireTransportEvent({ action: 'seek', playhead: time });
    this.dispatch({ type: 'seek', time });
  }

  jumpBeats(beats: number): void {
    if (!this.buffer) return;
    const playhead = this.getPlayhead();
    let raw: number;
    if (this.beatTimes && this.beatTimes.length >= 2) {
      // Beat jump is beat-domain (ADR 0027 §5): displace via the live grid
      // — phase-preserving fractional beat coordinates, exact on variable
      // grids, immune to a stale bpm scalar. Same ≥2-beat guard as
      // auto-loop.
      raw = addBeats(playhead, beats, this.beatTimes);
    } else {
      // Gridless fallback: the bpm scalar. BPM-less tracks assume 120
      // (library-player parity): a usable jump beats a silently dead
      // control.
      const bpm = this.trackInfo?.bpm ?? 120;
      raw = playhead + beats * (60 / bpm);
    }
    const target = this.clampPlayhead(raw);
    this.fireTransportEvent({ action: 'jumpBeats', playhead: target, detail: beats });
    // Relative displacement, not a seek: an active loop translates with
    // the playhead (looping 04).
    this.dispatch({ type: 'jump', time: target });
  }

  /** A BPM edit landed for the loaded Track: keep beat-domain math (beat
   * jumps) honest without a re-Load. The engine learns bpm at Load
   * otherwise — editing used to leave jumps sized by the OLD tempo.
   * Addressed by trackId (like setBeatTimes): a late push for a previous
   * Load must not cross tracks (cue-quantize-bpm 02). */
  setTrackBpm(trackId: number, bpm: number | null): void {
    if (this.trackInfo?.trackId !== trackId) return;
    this.trackInfo = { ...this.trackInfo, bpm };
    this.emit();
  }

  /** The loaded Track's Beatgrid changed (BPM re-tempo, nudge, downbeat
   * mark — ADR 0016: BPM edits ARE grid operations): refresh the Quantize
   * grid without a re-Load. The load-time snapshot used to serve stale
   * beats to every transport placement gesture (cue-quantize-bpm 01).
   * Addressed by trackId so a late push for a previous track is ignored;
   * an empty grid means gridless. The Main cue is NOT re-resolved — cue
   * defaults are a load-time decision. */
  setBeatTimes(trackId: number, beatTimes: number[] | null): void {
    if (this.trackInfo?.trackId !== trackId) return;
    this.beatTimes = beatTimes && beatTimes.length > 0 ? beatTimes : null;
    this.emit(); // hasBeatgrid may have flipped
  }

  cueDown(): void {
    this.dispatch({ type: 'cue-down' });
  }

  cueUp(): void {
    this.dispatch({ type: 'cue-up' });
  }

  hotCueDown(slot: number, timeSeconds: number | null): void {
    if (!this.buffer) return;
    const time = timeSeconds === null ? null : this.clampTime(timeSeconds);
    this.dispatch({ type: 'hot-cue-down', slot, time });
    // Capture tap AFTER the reducer: a quantized trigger lands at cue +
    // intra-beat phase, not the raw cue time — the recorded evidence must
    // be the actual landing (Take vectorization measures jump deltas).
    if (time !== null) {
      this.fireTransportEvent({
        action: 'hotCue',
        playhead: this.transport.playhead,
        detail: slot,
      });
    }
  }

  hotCueUp(slot: number, timeSeconds: number | null): void {
    this.dispatch({ type: 'hot-cue-up', slot, time: timeSeconds });
  }

  /** Auto-loop engage/release (looping 03). Inert on gridless Tracks (the
   * reducer refuses to guess); the playhead never moves on engage. */
  toggleLoop(): void {
    this.dispatch({ type: 'loop-toggle' });
  }

  /** Resize — halve/double or absolute set-length (looping 04,
   * midi-performance-ops 01): pending size when idle, live resize while
   * looping. Works without a loaded Track — the pending size is a Deck
   * preference, like the beatjump size. */
  resizeLoop(change: LoopResize): void {
    if (!this.buffer) {
      const [next] = reduceTransport(
        this.transport,
        { type: 'loop-resize', change },
        this.transportContext()
      );
      if (next === this.transport) return;
      this.transport = next;
      this.emit();
      return;
    }
    this.dispatch({ type: 'loop-resize', change });
  }

  /** Resize the RUNNING loop only (midi-performance-ops 03): returns
   * false — touching nothing, not even the pending size — when no loop is
   * active, so the SHIFT+IN/OUT overload can fall back to its idle
   * beatjump-size meaning. */
  resizeActiveLoop(change: 'halve' | 'double'): boolean {
    if (!this.transport.loop) return false;
    this.resizeLoop(change);
    return true;
  }

  /** LOOP pad preset (midi-performance-ops 02): no loop → engage at the
   * playhead at `beats` (remembered as the pending size); same size →
   * release; different size → set-length resize in place. Works without a
   * loaded Track — the pending size is a Deck preference, like resize. */
  loopPreset(beats: number): void {
    if (!this.buffer) {
      const [next] = reduceTransport(
        this.transport,
        { type: 'loop-preset', beats },
        this.transportContext()
      );
      if (next === this.transport) return;
      this.transport = next;
      this.emit();
      return;
    }
    this.dispatch({ type: 'loop-preset', beats });
  }

  // ── Sound controls ─────────────────────────────────────────────────────
  // (EQ/filter/fader live on the Mixer's channel strip — ADR 0009. The deck
  // keeps only varispeed.)

  /** Varispeed. Range POLICY belongs to callers (ADR 0022): the
   * Performance fader/MIDI clamp to ±PITCH_RANGE_PERCENT, the editor's
   * tempo-match to its wider range; the engine only enforces the hard
   * ceiling. */
  setPitch(percent: number): void {
    const clamped = Math.max(
      -MAX_PITCH_RANGE_PERCENT,
      Math.min(MAX_PITCH_RANGE_PERCENT, percent)
    );
    this.setRateComponents(clamped, this.bendPercent);
  }

  /**
   * Key Lock toggle. Seamless mid-play: the worklet splices modes with an
   * internal crossfade at the audible position — the composed rate, the
   * playhead clock, and the anchor math are untouched.
   */
  setKeyLock(on: boolean): void {
    if (on === this.keyLock) return;
    this.keyLock = on;
    this.sourceNode?.setMode(on ? 'stretch' : 'resample');
    this.emit();
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
    if (this.runningStartId !== null && this.sourceNode && this.audio) {
      const now = this.audio.ctx.currentTime;
      this.anchorPosition = this.getPlayhead(); // still at the old rate
      this.anchorCtxTime = now;
      this.pitchPercent = pitchPercent;
      this.bendPercent = bendPercent;
      this.sourceNode.setRateAt(this.currentRate(), now);
    } else if (this.leadInActive && this.audio) {
      // Rate change mid-lead-in (issue 07): re-anchor the silent clock at
      // the old rate, adopt the new one, then re-time the pending frame-0
      // entry so it still lands exactly when the playhead reaches 0.
      this.anchorPosition = this.getPlayhead(); // still at the old rate
      this.anchorCtxTime = this.audio.ctx.currentTime;
      this.pitchPercent = pitchPercent;
      this.bendPercent = bendPercent;
      this.scheduleLeadInStart();
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

  /** Current playhead in seconds. Cheap; safe to poll per animation frame.
   * Reads the anchor clock while a voice runs OR during the pre-start
   * lead-in (issue 07) — the lead-in has no voice yet, but the clock still
   * counts up from the negative anchor through 0, driving the silent
   * scroll and the on-time entry. */
  getPlayhead(): number {
    if ((this.runningStartId !== null || this.leadInActive) && this.audio) {
      const elapsed =
        (this.audio.ctx.currentTime - this.anchorCtxTime) * this.currentRate();
      let position = this.anchorPosition + elapsed;
      // Active loop: fold the monotone clock into the region — the mirror
      // of the worklet's sample wrap, exact across many wraps (modulo). A
      // lead-in never has a loop (seek cancels it; a jump clamps its start
      // to >= 0), so the fold is inert there.
      const loop = this.transport.loop;
      if (loop) {
        position = foldLoopPlayhead(
          position,
          loop.start,
          Math.min(loop.end, this.buffer?.duration ?? loop.end),
          this.anchorPosition
        );
      }
      return this.clampPlayhead(position);
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
    // Keep the node cached for revival; just detach it from the graph.
    this.sourceNode?.disconnect();
    this.audio = null;
    this.listeners.clear();
  }

  // ── Internals ──────────────────────────────────────────────────────────

  /** Ambient Quantize facts, assembled fresh per dispatch (gesture time). */
  private transportContext(): TransportContext {
    return { quantize: isQuantizeOn(), beatTimes: this.beatTimes };
  }

  private dispatch(event: TransportEvent): void {
    if (!this.buffer) return;
    const synced = { ...this.transport, playhead: this.getPlayhead() };
    const [next, effects] = reduceTransport(synced, event, this.transportContext());
    const cueChanged = next.cuePoint !== synced.cuePoint;
    const loopChanged = next.loop !== synced.loop;
    this.transport = next;
    for (const effect of effects) {
      if (effect.type === 'start') this.startAudio(effect.at);
      else this.stopAudio(effect.at);
    }
    // Loop state is a live source property, not an AudioEffect: push
    // region changes to the worklet whether or not audio (re)started —
    // engage/release never restart the voice (that inaudibility is the
    // point).
    if (loopChanged) {
      // Re-anchor the clock at the audible position when loop state
      // changes WITHOUT an audio restart. getPlayhead's fold is defined by
      // the loop being folded into: releasing after k wraps would
      // otherwise expose the raw monotone clock — k loop lengths ahead of
      // the audio (a phantom "slip"); a live resize would fold a stale
      // anchor into the wrong region. `synced.playhead` is the audible
      // position under the OLD loop state, read this dispatch.
      if (
        this.runningStartId !== null &&
        this.audio &&
        !effects.some((e) => e.type === 'start' || e.type === 'stop')
      ) {
        this.anchorPosition = synced.playhead;
        this.anchorCtxTime = this.audio.ctx.currentTime;
      }
      this.syncLoopToSource();
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
    // Any (re)start supersedes a pending lead-in: a new start below either
    // replaces it (still negative) or crosses into the track (>= 0).
    this.clearLeadIn();
    const { ctx, input } = this.ensureAudio();
    if (ctx.state === 'suspended') this.resumeWithGestureRetry(ctx);
    // Pre-start lead-in (issue 07): the request targets a position before
    // the track. The lead-in is SILENT — retire any running voice (a
    // mid-play backward jump must not keep sounding the old position) and
    // clear a latched start, anchor the clock at the negative position NOW
    // so the playhead counts up through 0 (silent scroll), and schedule the
    // real frame-0 voice at the wall-clock instant the playhead reaches 0.
    if (at < 0) {
      this.pendingStartAt = null;
      if (this.runningStartId !== null) {
        this.sourceNode?.stop(); // worklet declick-fades internally
        this.runningStartId = null;
      }
      this.beginLeadIn(ctx, at);
      return;
    }
    if (this.sourceNode && this.sourceNode.ctx === ctx) {
      this.beginStart(this.sourceNode, input, at);
      return;
    }
    // No node yet, or the node belongs to a replaced context: (re)build
    // asynchronously and latch the start. A later stop clears the latch;
    // a later start replaces it.
    this.pendingStartAt = at;
    this.createSourceNode(ctx);
  }

  /** Enter the pre-start lead-in (issue 07): anchor the clock at the
   * negative position and schedule the frame-0 voice for the t=0 crossing.
   * Silent until then; the clock (getPlayhead) drives the UI's lead-in
   * scroll. Idempotent re-entry (a fresh negative seek mid-lead-in) just
   * re-anchors and reschedules. */
  private beginLeadIn(ctx: AudioContext, at: number): void {
    this.anchorPosition = at;
    this.anchorCtxTime = ctx.currentTime;
    this.leadInActive = true;
    this.scheduleLeadInStart();
  }

  /** (Re)arm the timer that fires the real frame-0 start when the playhead
   * crosses 0. The delay is the remaining lead-in in wall-clock seconds —
   * the negative distance divided by the composed rate. Recomputed from the
   * live clock so a rate change mid-lead-in re-times the entry exactly. */
  private scheduleLeadInStart(): void {
    if (this.leadInTimer !== null) {
      clearTimeout(this.leadInTimer);
      this.leadInTimer = null;
    }
    if (!this.leadInActive) return;
    const position = this.getPlayhead(); // clock read, still negative
    const rate = this.currentRate();
    const remainingWallMs = rate > 0 ? (-position / rate) * 1000 : 0;
    this.leadInTimer = setTimeout(() => {
      this.leadInTimer = null;
      if (!this.leadInActive || !this.buffer) return;
      this.leadInActive = false;
      // Enter the track at frame 0, on time: startAudio takes the normal
      // (non-negative) path from here, building the node if needed.
      this.startAudio(0);
    }, Math.max(0, remainingWallMs));
  }

  /** Cancel any pending lead-in (a stop, a fresh start, or dispose). */
  private clearLeadIn(): void {
    this.leadInActive = false;
    if (this.leadInTimer !== null) {
      clearTimeout(this.leadInTimer);
      this.leadInTimer = null;
    }
  }

  private stopAudio(at: number): void {
    this.pendingStartAt = null;
    // A stop during the lead-in cancels the scheduled entry: the deck rests
    // at its (possibly still-negative) pre-start position.
    this.clearLeadIn();
    if (this.runningStartId !== null) {
      // The worklet declick-fades internally (its stop splice).
      this.sourceNode?.stop();
      this.runningStartId = null;
    }
    this.transport = { ...this.transport, playhead: this.clampPlayhead(at) };
  }

  /** One pending gesture-retry at a time. */
  private gestureRetryInstalled = false;

  /**
   * Chrome's autoplay policy refuses resume() outside user activation — and
   * a MIDI message is NOT activation, so a hardware play against a fresh
   * (boot-restored) context leaves it suspended: the transport runs, the
   * audio doesn't. Retry on the next real gesture, guarded: audio must
   * still be wanted and the context unchanged.
   */
  private resumeWithGestureRetry(ctx: AudioContext): void {
    ctx.resume().catch((err) => {
      console.warn('[DeckEngine] AudioContext.resume() failed:', err);
    });
    if (this.gestureRetryInstalled || typeof window === 'undefined') return;
    this.gestureRetryInstalled = true;
    const retry = () => {
      this.gestureRetryInstalled = false;
      window.removeEventListener('pointerdown', retry, true);
      window.removeEventListener('keydown', retry, true);
      if (!isAudioRunning(this.transport)) return;
      if (this.audio?.ctx !== ctx || ctx.state !== 'suspended') return;
      void ctx.resume().catch(() => undefined);
    };
    window.addEventListener('pointerdown', retry, true);
    window.addEventListener('keydown', retry, true);
  }

  /** Issue the start against a ready node: hand samples over if this buffer
   * hasn't been yet, reconnect (the mixer may have rebuilt its strips), set
   * the rate, and anchor the playhead clock. All synchronous — MessagePort
   * ordering makes load-before-start safe. */
  private beginStart(node: DeckSourceNode, input: AudioNode, at: number): void {
    if (!this.buffer) return;
    this.handOverIfStale(node);
    // Re-assert the mode and loop region every start: covers a freshly
    // (re)built node and costs two ordered messages.
    node.setMode(this.keyLock ? 'stretch' : 'resample');
    this.syncLoopToSource(node);
    node.disconnect();
    node.connect(input);
    const now = node.ctx.currentTime;
    const offset = Math.max(0, Math.min(at, this.buffer.duration - 0.001));
    node.setRateAt(this.currentRate(), now);
    const startId = this.nextStartId++;
    node.start(Math.round(offset * this.buffer.sampleRate), startId);
    this.runningStartId = startId;
    this.anchorPosition = offset;
    this.anchorCtxTime = now;
  }

  /** Build the worklet node for `ctx` (addModule + construction — the one
   * async step; every command afterwards is synchronous). Fires a latched
   * start when it lands. */
  private createSourceNode(ctx: AudioContext): void {
    if (this.sourceNodeCreating) return;
    this.sourceNodeCreating = true;
    DeckSourceNode.create(ctx)
      .then((node) => {
        this.sourceNodeCreating = false;
        this.sourceNode?.disconnect();
        this.sourceNode = node;
        this.loadedIntoWorklet = null;
        node.onEnded = (startId) => this.handleEnded(startId);
        // Warm handover so the first stab doesn't pay the copy.
        this.handOverIfStale(node);
        const at = this.pendingStartAt;
        if (at === null) return;
        this.pendingStartAt = null;
        const audio = this.ensureAudio();
        if (audio.ctx !== ctx) {
          // The context was replaced while the node was building: rebuild.
          this.pendingStartAt = at;
          this.createSourceNode(audio.ctx);
          return;
        }
        this.beginStart(node, audio.input, at);
      })
      .catch((err) => {
        this.sourceNodeCreating = false;
        this.pendingStartAt = null;
        console.warn('[DeckEngine] worklet source creation failed:', err);
      });
  }

  /** Mirror the transport's loop region into the worklet source, converted
   * to track frames (end clamped to the track — wrap-vs-end-of-track
   * precedence stays consistent with getPlayhead's fold). */
  private syncLoopToSource(node: DeckSourceNode | null = this.sourceNode): void {
    if (!node || !this.buffer) return;
    const loop = this.transport.loop;
    if (!loop) {
      node.setLoop(null);
      return;
    }
    const sampleRate = this.buffer.sampleRate;
    node.setLoop({
      startFrames: Math.round(loop.start * sampleRate),
      endFrames: Math.round(Math.min(loop.end, this.buffer.duration) * sampleRate),
    });
  }

  /** Hand the loaded buffer's samples to the worklet unless it already has
   * them. Sole writer of `loadedIntoWorklet`. */
  private handOverIfStale(node: DeckSourceNode): void {
    if (!this.buffer || this.loadedIntoWorklet === this.buffer) return;
    node.loadTrack(this.buffer);
    this.loadedIntoWorklet = this.buffer;
  }

  /** The live voice ran off the end of the track (worklet message). */
  private handleEnded(startId: number): void {
    if (this.runningStartId !== startId) return; // raced a seek/stop
    this.runningStartId = null;
    // The clock can no longer be read from the source; rest the playhead
    // at the end of the track before reducing.
    this.transport = {
      ...this.transport,
      playhead: this.buffer?.duration ?? this.transport.playhead,
    };
    this.dispatch({ type: 'ended' });
  }

  private currentRate(): number {
    return composeRate(this.pitchPercent, this.bendPercent);
  }

  /** Clamp to real track time [0, duration] — the domain of cue points and
   * loop regions, which can never live before the track starts. */
  private clampTime(seconds: number): number {
    const duration = this.buffer?.duration ?? 0;
    return Math.max(0, Math.min(seconds, duration));
  }

  /** Clamp a PLAYHEAD placement (seek/beat jump/clock read) to
   * [-MAX_LEAD_IN_SECONDS, duration]: the playhead may sit in the pre-start
   * lead-in (issue 07) so a backward beat jump near the head preserves its
   * beat distance instead of collapsing to 0. Audio stays silent through the
   * negative region; the clock counts up through 0 into the track. The floor
   * bounds runaway math — a musical lead-in, not an infinite pre-roll. */
  private clampPlayhead(seconds: number): number {
    const duration = this.buffer?.duration ?? 0;
    return Math.max(-MAX_LEAD_IN_SECONDS, Math.min(seconds, duration));
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
      keyLock: this.keyLock,
      loop: this.transport.loop,
      loopBeatsLabel: this.transport.loop
        ? projectLoopBeats(this.transport.loop, this.beatTimes)
        : null,
      pendingLoopBeats: this.transport.pendingLoopBeats,
      hasBeatgrid: (this.beatTimes?.length ?? 0) >= 2,
    };
  }

  private emit(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }
}
