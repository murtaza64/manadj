/**
 * Session replay driver (sessions 05, ADR 0033): plays a ReplayPlan
 * through the SHARED live decks — the same engine that made the sound.
 * The Conductor mold, all four decks:
 *
 * - claims the Audible surface as `'replay'` (a machine tenure: the
 *   recorder brackets it with tenure markers and suppresses the driver's
 *   own writes — replay is invisible to capture by construction)
 * - seeds decks + mixer from the plan, then fires cues at their offsets
 *   on the mixer's audio clock; ~1 Hz sync cues correct drift (and stand
 *   in for loop wraps)
 * - drives fader/EQ/filter through the mixer's AUTOMATION OVERLAY on all
 *   four decks — the Conductor's protocol exactly: base mixer state (the
 *   user's) is never touched during playback, the deck UI shows the
 *   replayed mix as automation GHOSTS (useAutomationGhost), and the
 *   recorded crossfader folds into the fader lanes (value·√xf, the
 *   pickupStartLanes precedent) since the overlay pins the crossfader
 *   neutral. Trim/PFL/master/cue stay the live user's — gain staging is
 *   not part of the performance record's reproduction (Conductor parity).
 *   On takeover the sounding lane values sync into base state (sparing
 *   the touched control), so the handover is audibly seamless
 * - yields to takeover: any manual deck/mixer gesture ends replay
 *   immediately (self-op guard exactly as the Conductor's), capture
 *   resumes on release
 */
import type { DeckEngine, DeckSnapshot } from '../playback/DeckEngine';
import type { ChannelId, Mixer } from '../playback/mixer';
import type { AutomationChannelValues } from '../playback/mixer';
import { channelCrossfaderGain } from '../playback/mixerMath';
import type { CrossfaderAssignment } from '../playback/crossfaderAssignmentStore';
import {
  claimAudible,
  isAudible,
  registerSurface,
  releaseAudible,
  sharedTransport,
  subscribeAudible,
  unregisterSurface,
} from '../playback/audibleSurface';
import type { CaptureDeck } from '../capture/events';
import { ALL_DECKS } from './timelineModel';
import type { ReplayCue, ReplayPlan } from './replayPlanner';

export type ReplayStopReason =
  | 'ended'
  | 'stopped'
  | 'takeover'
  | 'displaced'
  | 'load-failed';

export interface ReplayAudio {
  mixer: Mixer;
  engines: Record<ChannelId, DeckEngine>;
}

export type ReplayLiveStatus = 'loading' | 'playing' | 'paused';

export interface ReplayHooks {
  /** Resolve + load a track onto a shared deck (the provider's one Load
   * path). Resolves false when the track is missing from the library. */
  loadTrack(deck: ChannelId, trackId: number): Promise<boolean>;
  /** `cause` names the takeover trigger ("fader B", "D playing…") — a
   * hardware fader jittering at idle reads as a manual gesture (by
   * design: the human's gesture wins), and the cause makes that
   * diagnosable instead of mysterious. */
  onStopped(reason: ReplayStopReason, cause?: string): void;
  /** The DRIVER is authoritative for live status — it pushes every
   * transition (loading→playing→paused→…) so the store never has to
   * INFER status from a resolved promise (the source of the
   * playhead-freezes-but-audio-continues desync). Optional for tests. */
  onStatus?(status: ReplayLiveStatus): void;
}

/** Phase tolerance for the continuous corrector: past this, re-seek. Tight
 * enough to hold a beatmatch (~1/16 beat at 150 BPM), loose enough for
 * engine playhead-estimate noise. */
const PHASE_TOLERANCE_S = 0.03;
/** Minimum spacing between corrective seeks per deck (no seek-thrash). */
const CORRECTION_COOLDOWN_S = 0.8;
/** Seed loads must become ready within this budget. */
const LOAD_TIMEOUT_MS = 20000;
/** Natural end-of-track detection window (the Conductor's). */
const NATURAL_END_TOLERANCE_S = 1.5;

export class SessionReplayDriver {
  private plan: ReplayPlan;
  private readonly mixer: Mixer;
  private readonly engines: Record<ChannelId, DeckEngine>;
  private readonly hooks: ReplayHooks;

  private active = false;
  private started = false;
  private stoppedFired = false;
  private suppressSilence = false;
  private selfOps = 0;
  private raf = 0;
  private unsubs: (() => void)[] = [];
  private cueIndex = 0;
  private anchorAudioTime = 0;
  private loadRequested: Partial<Record<ChannelId, number | null>> = {};
  /** Paused (space): session time freezes; decks that were rolling wait. */
  private pausedAtOffset: number | null = null;
  private pausedDecks: ChannelId[] = [];
  /** Per-deck phase anchors: expected trackTime = playhead +
   * (offset − anchor.offset) × rate. The continuous corrector holds every
   * playing deck to its anchor within PHASE_TOLERANCE_S — this is what
   * keeps a mid-blend start beatmatched (start-latency stagger and
   * tick-gap seeding errors get snapped out, rate-aware). */
  private anchors: Partial<Record<ChannelId, { offset: number; playhead: number; rate: number }>> =
    {};
  private lastCorrection: Partial<Record<ChannelId, number>> = {};
  /** The RECORDED mixer state (what the night's log says), composed into
   * overlay lanes — never written to base during playback. */
  private recDecks: Record<
    ChannelId,
    { fader: number; eq: { low: number; mid: number; high: number }; filter: number; assignment: CrossfaderAssignment }
  > = {
    A: { fader: 1, eq: { low: 0.5, mid: 0.5, high: 0.5 }, filter: 0, assignment: 'left' },
    B: { fader: 1, eq: { low: 0.5, mid: 0.5, high: 0.5 }, filter: 0, assignment: 'right' },
    C: { fader: 1, eq: { low: 0.5, mid: 0.5, high: 0.5 }, filter: 0, assignment: 'left' },
    D: { fader: 1, eq: { low: 0.5, mid: 0.5, high: 0.5 }, filter: 0, assignment: 'right' },
  };
  private recCrossfader = 0;
  private recCrossfaderEnabled = true;
  private automationToken: symbol | null = null;
  /** Last lanes written — the takeover base-sync source (Conductor's
   * lastLanes idiom). */
  private lastLanes: Partial<Record<ChannelId, AutomationChannelValues>> = {};

  constructor(plan: ReplayPlan, audio: ReplayAudio, hooks: ReplayHooks) {
    this.plan = plan;
    this.mixer = audio.mixer;
    this.engines = audio.engines;
    this.hooks = hooks;
  }

  /** The session-clock moment replay is at, or null when not rolling —
   * drives the timeline's moving playhead. */
  nowT(): number | null {
    if (!this.active) return null;
    const offset = this.pausedAtOffset ?? this.elapsed();
    return this.plan.startT + Math.min(offset, this.plan.endT - this.plan.startT);
  }

  isPaused(): boolean {
    return this.active && this.pausedAtOffset !== null;
  }

  /** Claim, load, seed, roll. Resolves once rolling (or refused). */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    registerSurface('replay', {
      // Deck transport stays a deck-class gesture (the Conductor's
      // rationale, ADR 0024): pass through to the shared surface's own
      // handlers — the engine emit lands outside the self-op guard, so a
      // controller play IS a manual gesture → takeover.
      transport: {
        togglePlay: (deck) => sharedTransport()?.togglePlay(deck),
        cueDown: (deck) => sharedTransport()?.cueDown?.(deck),
        cueUp: (deck) => sharedTransport()?.cueUp?.(deck),
      },
      silence: () => this.handleSilence(),
    });
    claimAudible('replay');
    if (!isAudible('replay')) {
      unregisterSurface('replay');
      this.fireStopped('load-failed');
      return;
    }
    this.active = true;
    this.status('loading');
    // The Conductor's mixer protocol: own the fader/EQ/filter nodes via
    // the overlay; the user's base state stays theirs (and stays visible
    // under the ghost pointers).
    this.automationToken = this.mixer.engageAutomation();

    // Displacement (editor/conductor claims over us): stand down without
    // releasing — only the holder may release.
    this.unsubs.push(
      subscribeAudible((holder) => {
        if (holder !== 'replay' && this.active) {
          cancelAnimationFrame(this.raf);
          this.teardown({ release: false });
          this.fireStopped('displaced');
        }
      })
    );

    // Load every seed track and wait ready.
    const seedLoads = ALL_DECKS.filter((d) => this.plan.seed.decks[d].trackId !== null);
    const results = await Promise.all(
      seedLoads.map(async (d) => {
        const id = this.plan.seed.decks[d].trackId!;
        this.loadRequested[d] = id;
        const ok = await this.hooks.loadTrack(d, id);
        if (!ok) return false;
        return this.waitReady(d, id);
      })
    );
    if (!this.active) return; // displaced while loading
    if (results.some((ok) => !ok)) {
      this.teardown({ release: true });
      this.fireStopped('load-failed');
      return;
    }

    // Seed decks + mixer, then start the clock and watchers.
    this.self(() => this.applySeed());
    this.anchorAudioTime = this.mixer.now();
    this.cueIndex = 0;
    this.unsubs.push(
      this.watchMixer(),
      ...ALL_DECKS.map((d) => this.watchEngine(d)),
      ...ALL_DECKS.map((d) => this.engines[d].addTransportEventListener(this.gestureTap(d)))
    );
    this.status('playing');
    this.raf = requestAnimationFrame(this.tick);
  }

  /** UI stop: pause the decks, release, capture resumes. */
  stop(): void {
    if (!this.active) return;
    cancelAnimationFrame(this.raf);
    this.self(() => {
      for (const d of ALL_DECKS) this.engines[d].pause();
    });
    this.teardown({ release: true });
    this.fireStopped('stopped');
  }

  /** Space: freeze the session clock and park the rolling decks. The
   * surface stays claimed — pausing a replay is not a takeover. */
  pauseReplay(): void {
    if (!this.active || this.pausedAtOffset !== null) return;
    cancelAnimationFrame(this.raf);
    this.pausedAtOffset = this.elapsed();
    this.pausedDecks = ALL_DECKS.filter((d) => this.engines[d].getSnapshot().playing);
    this.self(() => {
      for (const d of this.pausedDecks) this.engines[d].pause();
    });
    this.status('paused');
  }

  /** Space again: re-anchor the clock and resume the parked decks. */
  resumeReplay(): void {
    if (!this.active || this.pausedAtOffset === null) return;
    this.anchorAudioTime = this.mixer.now() - this.pausedAtOffset;
    this.pausedAtOffset = null;
    this.self(() => {
      for (const d of this.pausedDecks) this.engines[d].play();
    });
    this.pausedDecks = [];
    this.status('playing');
    this.raf = requestAnimationFrame(this.tick);
  }

  /**
   * Click-to-seek during playback: swap to a plan for the new moment
   * WITHOUT releasing the surface (no tenure flapping, no capture leak).
   * Missing tracks refuse the seek and stop the replay cleanly.
   */
  async seekTo(plan: ReplayPlan): Promise<void> {
    if (!this.active) return;
    cancelAnimationFrame(this.raf);
    const wasPaused = this.pausedAtOffset !== null;
    this.pausedAtOffset = null;
    this.pausedDecks = [];
    this.self(() => {
      for (const d of ALL_DECKS) this.engines[d].pause();
    });
    this.plan = plan;
    this.cueIndex = 0;
    // Load anything the new seed needs that isn't already on its deck.
    const needed = ALL_DECKS.filter((d) => {
      const id = plan.seed.decks[d].trackId;
      return id !== null && this.engines[d].getSnapshot().trackId !== id;
    });
    const results = await Promise.all(
      needed.map(async (d) => {
        const id = plan.seed.decks[d].trackId!;
        this.loadRequested[d] = id;
        const ok = await this.hooks.loadTrack(d, id);
        return ok ? this.waitReady(d, id) : false;
      })
    );
    if (!this.active) return; // displaced/taken over while loading
    if (results.some((ok) => !ok)) {
      this.teardown({ release: true });
      this.fireStopped('load-failed');
      return;
    }
    this.self(() => this.applySeed());
    if (wasPaused) {
      // Stay paused at the new moment; decks are seeded but parked.
      this.pausedAtOffset = 0;
      this.pausedDecks = ALL_DECKS.filter((d) => plan.seed.decks[d].playing);
      this.self(() => {
        for (const d of this.pausedDecks) this.engines[d].pause();
      });
      this.status('paused');
      return;
    }
    this.anchorAudioTime = this.mixer.now();
    this.status('playing');
    this.raf = requestAnimationFrame(this.tick);
  }

  // ── Clock ──────────────────────────────────────────────────────────────

  private elapsed(): number {
    return this.mixer.now() - this.anchorAudioTime;
  }

  private tick = (): void => {
    if (!this.active) return;
    const elapsed = this.elapsed();
    const cues = this.plan.cues;
    try {
      while (this.cueIndex < cues.length && cues[this.cueIndex].offsetS <= elapsed) {
        this.self(() => this.applyCue(cues[this.cueIndex]));
        this.cueIndex += 1;
      }
      this.correctPhases(elapsed);
    } catch (err) {
      // A throw here would silently kill the rAF loop — the playhead
      // freezes with no state change (the worst failure mode). Stop
      // LOUDLY instead: decks pause, surface releases, capture resumes.
      console.error('[session-replay] cue application failed — stopping replay', err);
      this.self(() => {
        for (const d of ALL_DECKS) this.engines[d].pause();
      });
      this.teardown({ release: true });
      this.fireStopped('stopped', `internal error: ${err}`);
      return;
    }
    if (this.cueIndex >= cues.length && elapsed >= this.plan.endT - this.plan.startT) {
      // The log ran out: the night ended here.
      this.self(() => {
        for (const d of ALL_DECKS) this.engines[d].pause();
      });
      this.teardown({ release: true });
      this.fireStopped('ended');
      return;
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  // ── Application ────────────────────────────────────────────────────────

  private applySeed(): void {
    const { seed } = this.plan;
    this.anchors = {};
    this.lastCorrection = {};
    for (const d of ALL_DECKS) {
      const s = seed.decks[d];
      const engine = this.engines[d];
      this.recDecks[d] = {
        fader: s.fader,
        eq: { ...s.eq },
        filter: s.filter,
        assignment: s.assignment,
      };
      if (s.trackId !== null) {
        engine.setPitch(s.pitch);
        engine.seek(s.playhead);
        if (s.playing) {
          engine.play();
          this.anchors[d] = { offset: 0, playhead: s.playhead, rate: 1 + s.pitch / 100 };
        } else {
          engine.pause();
        }
      }
    }
    this.recCrossfader = seed.crossfader;
    this.recCrossfaderEnabled = seed.crossfaderEnabled;
    this.applyLanes(ALL_DECKS);
  }

  /** Compose the recorded state into overlay lanes: the recorded
   * crossfader's gain folds into the fader (value·√xf — fader gain is
   * value², pickupStartLanes precedent) because the overlay pins the
   * crossfader neutral. */
  private applyLanes(decks: readonly ChannelId[]): void {
    for (const d of decks) {
      const r = this.recDecks[d];
      const xfGain = channelCrossfaderGain(
        r.assignment,
        this.recCrossfaderEnabled ? this.recCrossfader : 0
      );
      const lane: AutomationChannelValues = {
        fader: Math.min(1, r.fader * Math.sqrt(xfGain)),
        eq: { ...r.eq },
        filter: r.filter,
      };
      this.lastLanes[d] = lane;
      this.mixer.setAutomation(d, lane);
    }
  }

  /** The continuous phase corrector: hold every playing deck to its
   * rate-aware anchor. Start-latency stagger and any seeding error get
   * snapped out within a frame; the cooldown prevents seek-thrash. */
  private correctPhases(elapsed: number): void {
    for (const d of ALL_DECKS) {
      const a = this.anchors[d];
      if (!a) continue;
      const engine = this.engines[d];
      const snap = engine.getSnapshot();
      if (!snap.playing || snap.loadState !== 'ready') continue;
      const expected = a.playhead + (elapsed - a.offset) * a.rate;
      const drift = Math.abs(engine.getPlayhead() - expected);
      if (drift <= PHASE_TOLERANCE_S) continue;
      const last = this.lastCorrection[d];
      if (last !== undefined && elapsed - last < CORRECTION_COOLDOWN_S) continue;
      this.lastCorrection[d] = elapsed;
      this.self(() => engine.seek(expected));
    }
  }

  private applyCue(cue: ReplayCue): void {
    switch (cue.kind) {
      case 'control': {
        const ch = cue.channel;
        const v = cue.value;
        // Overlay-owned params update the recorded state and recompose
        // lanes. Trim/PFL/master/cue stay the LIVE user's (gain staging is
        // not reproduced — Conductor parity); crossfader moves recompose
        // every lane (its gain is folded in).
        if (cue.control === 'fader' && ch) {
          this.recDecks[ch].fader = v;
          this.applyLanes([ch]);
        } else if (cue.control === 'eqLow' && ch) {
          this.recDecks[ch].eq = { ...this.recDecks[ch].eq, low: v };
          this.applyLanes([ch]);
        } else if (cue.control === 'eqMid' && ch) {
          this.recDecks[ch].eq = { ...this.recDecks[ch].eq, mid: v };
          this.applyLanes([ch]);
        } else if (cue.control === 'eqHigh' && ch) {
          this.recDecks[ch].eq = { ...this.recDecks[ch].eq, high: v };
          this.applyLanes([ch]);
        } else if (cue.control === 'filter' && ch) {
          this.recDecks[ch].filter = v;
          this.applyLanes([ch]);
        } else if (cue.control === 'crossfaderAssignment' && ch) {
          this.recDecks[ch].assignment = v < 0 ? 'left' : v > 0 ? 'right' : 'thru';
          this.applyLanes([ch]);
        } else if (cue.control === 'crossfader') {
          this.recCrossfader = v;
          this.applyLanes(ALL_DECKS);
        } else if (cue.control === 'crossfaderEnabled') {
          this.recCrossfaderEnabled = v !== 0;
          this.applyLanes(ALL_DECKS);
        }
        break;
      }
      case 'play': {
        const engine = this.engines[cue.channel];
        engine.seek(cue.playhead);
        engine.play();
        const prev = this.anchors[cue.channel];
        this.anchors[cue.channel] = {
          offset: cue.offsetS,
          playhead: cue.playhead,
          rate: prev?.rate ?? 1 + (this.plan.seed.decks[cue.channel]?.pitch ?? 0) / 100,
        };
        break;
      }
      case 'pause': {
        const engine = this.engines[cue.channel];
        engine.pause();
        engine.seek(cue.playhead);
        delete this.anchors[cue.channel];
        break;
      }
      case 'seek': {
        this.engines[cue.channel].seek(cue.playhead);
        const prev = this.anchors[cue.channel];
        if (prev) this.anchors[cue.channel] = { ...prev, offset: cue.offsetS, playhead: cue.playhead };
        break;
      }
      case 'pitch': {
        this.engines[cue.channel].setPitch(cue.value);
        // Re-anchor at the expected position under the OLD rate, then run
        // at the new one (rate changes bend the expected-position line).
        const prev = this.anchors[cue.channel];
        if (prev) {
          const at = prev.playhead + (cue.offsetS - prev.offset) * prev.rate;
          this.anchors[cue.channel] = { offset: cue.offsetS, playhead: at, rate: 1 + cue.value / 100 };
        }
        break;
      }
      case 'load':
        if (cue.trackId !== null) {
          this.loadRequested[cue.channel] = cue.trackId;
          delete this.anchors[cue.channel];
          // Fire and forget — the played night's own timing gave the
          // decode time before the deck sounds; a slow load self-heals at
          // the next sync cue.
          void this.hooks.loadTrack(cue.channel, cue.trackId);
        }
        break;
      case 'sync':
        // Ticks are the log's truth samples: re-anchor the phase corrector
        // (it does the seeking, rate-aware, with tolerance + cooldown).
        for (const d of ALL_DECKS) {
          const ph = cue.playheads[d as CaptureDeck];
          if (ph === undefined) continue;
          const prev = this.anchors[d];
          this.anchors[d] = { offset: cue.offsetS, playhead: ph, rate: prev?.rate ?? 1 };
        }
        break;
    }
  }

  // ── Load readiness ─────────────────────────────────────────────────────

  private waitReady(deck: ChannelId, trackId: number): Promise<boolean> {
    const engine = this.engines[deck];
    const ready = (s: DeckSnapshot) => s.trackId === trackId && s.loadState === 'ready';
    if (ready(engine.getSnapshot())) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        unsub();
        resolve(false);
      }, LOAD_TIMEOUT_MS);
      const unsub = engine.subscribe(() => {
        if (ready(engine.getSnapshot())) {
          clearTimeout(timer);
          unsub();
          resolve(true);
        }
      });
    });
  }

  // ── Takeover (the Conductor's three watchers, four decks) ─────────────

  private self<T>(fn: () => T): T {
    this.selfOps += 1;
    try {
      return fn();
    } finally {
      this.selfOps -= 1;
    }
  }

  private gestureTap(deck: ChannelId): () => void {
    return () => {
      if (this.selfOps === 0 && this.active) this.takeover(`${deck} transport gesture`);
    };
  }

  private watchEngine(deck: ChannelId): () => void {
    const engine = this.engines[deck];
    let prev = engine.getSnapshot();
    return engine.subscribe(() => {
      const snap = engine.getSnapshot();
      const before = prev;
      prev = snap;
      if (this.selfOps > 0 || !this.active) return;
      // Load-flow emits from our own async loads are not gestures; a
      // trackId we never requested is a FOREIGN load = takeover.
      if (snap.trackId !== before.trackId || snap.loadState !== before.loadState) {
        if (snap.trackId !== before.trackId && snap.trackId !== this.loadRequested[deck]) {
          this.takeover(`foreign load on ${deck}`);
        }
        return;
      }
      if (
        snap.playing !== before.playing ||
        snap.pitchPercent !== before.pitchPercent ||
        snap.bendPercent !== before.bendPercent ||
        snap.previewing !== before.previewing ||
        snap.keyLock !== before.keyLock
      ) {
        // Natural end-of-track is the deck's own doing, not a gesture.
        const naturalEnd =
          before.playing &&
          !snap.playing &&
          snap.pitchPercent === before.pitchPercent &&
          snap.bendPercent === before.bendPercent &&
          snap.keyLock === before.keyLock &&
          engine.getPlayhead() >= snap.duration - NATURAL_END_TOLERANCE_S;
        if (naturalEnd) return;
        const field = (['playing', 'pitchPercent', 'bendPercent', 'previewing', 'keyLock'] as const).find(
          (k) => snap[k] !== before[k]
        );
        this.takeover(`${deck} ${field ?? 'transport'} changed`);
      }
    });
  }

  private watchMixer(): () => void {
    const read = () => ({
      channels: ALL_DECKS.map((d) => this.mixer.getChannelState(d)),
      crossfader: this.mixer.getCrossfader(),
      crossfaderEnabled: this.mixer.getCrossfaderEnabled(),
      master: this.mixer.getMaster(),
    });
    let prev = read();
    return this.mixer.subscribe(() => {
      const cur = read();
      const before = prev;
      prev = cur;
      if (this.selfOps > 0 || !this.active) return;
      // Replay never writes base state during playback (overlay only) —
      // any base notify is a human hand. Field-level diff names the
      // trigger and builds the touched set the base-sync spares.
      const touched = new Set<string>();
      let cause: string | null = null;
      for (let i = 0; i < ALL_DECKS.length; i++) {
        const a = before.channels[i];
        const b = cur.channels[i];
        if (a === b) continue;
        const d = ALL_DECKS[i];
        if (a.fader !== b.fader) touched.add(`${d}.fader`);
        if (a.trim !== b.trim) touched.add(`${d}.trim`);
        if (a.filter !== b.filter) touched.add(`${d}.filter`);
        if (a.pfl !== b.pfl) touched.add(`${d}.pfl`);
        if (a.eq.low !== b.eq.low) touched.add(`${d}.eqLow`);
        if (a.eq.mid !== b.eq.mid) touched.add(`${d}.eqMid`);
        if (a.eq.high !== b.eq.high) touched.add(`${d}.eqHigh`);
        if (!cause && touched.size > 0) cause = `${d} ${[...touched][0].split('.')[1]}`;
      }
      if (cur.crossfader !== before.crossfader) {
        touched.add('crossfader');
        cause ??= 'crossfader';
      }
      if (cur.crossfaderEnabled !== before.crossfaderEnabled) {
        touched.add('crossfaderEnabled');
        cause ??= 'crossfader enable';
      }
      if (cur.master !== before.master) {
        touched.add('master');
        cause ??= 'master';
      }
      if (cause) this.takeover(cause, touched);
    });
  }

  /**
   * A manual gesture: replay stops; the decks keep playing exactly as the
   * replay left them (no state restore — the issue spec); the release
   * flips capture's gate so the recorder re-seeds from what the user
   * hears, and the live continuation is captured.
   */
  private takeover(cause: string, touched?: ReadonlySet<string>): void {
    if (!this.active) return;
    console.info(`[session-replay] takeover: ${cause}`);
    cancelAnimationFrame(this.raf);
    // Write the sounding lane values into base state (sparing the control
    // the user just grabbed) so the overlay disengage reapply is
    // inaudible — the decks hand over exactly as the replay left them.
    this.self(() => this.syncBaseToLanes(touched));
    this.suppressSilence = true;
    try {
      this.teardown({ release: true });
    } finally {
      this.suppressSilence = false;
    }
    this.fireStopped('takeover', cause);
  }

  private syncBaseToLanes(touched?: ReadonlySet<string>): void {
    const skip = (key: string) => touched?.has(key) ?? false;
    for (const d of ALL_DECKS) {
      const lane = this.lastLanes[d];
      if (!lane) continue;
      if (!skip(`${d}.fader`)) this.mixer.setFader(d, lane.fader);
      if (!skip(`${d}.eqLow`)) this.mixer.setEq(d, 'low', lane.eq.low);
      if (!skip(`${d}.eqMid`)) this.mixer.setEq(d, 'mid', lane.eq.mid);
      if (!skip(`${d}.eqHigh`)) this.mixer.setEq(d, 'high', lane.eq.high);
      if (!skip(`${d}.filter`)) this.mixer.setFilter(d, lane.filter);
    }
    // Lanes folded the crossfader in, so base neutral matches the sound.
    if (!skip('crossfader')) this.mixer.setCrossfader(0);
  }

  private handleSilence(): void {
    cancelAnimationFrame(this.raf);
    if (this.suppressSilence) return;
    this.self(() => {
      for (const d of ALL_DECKS) this.engines[d].pause();
    });
  }

  private teardown(opts: { release: boolean }): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.active = false;
    if (this.automationToken !== null) {
      // Owner-tokened (sets 25): ramps the nodes back to base state.
      this.mixer.disengageAutomation(this.automationToken);
      this.automationToken = null;
    }
    if (opts.release && isAudible('replay')) releaseAudible('replay');
    unregisterSurface('replay');
  }

  private fireStopped(reason: ReplayStopReason, cause?: string): void {
    if (this.stoppedFired) return;
    this.stoppedFired = true;
    this.hooks.onStopped(reason, cause);
  }

  private status(s: ReplayLiveStatus): void {
    this.hooks.onStatus?.(s);
  }
}
