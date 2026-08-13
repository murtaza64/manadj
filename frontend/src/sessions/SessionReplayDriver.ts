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
 * - writes BASE mixer state (not the automation overlay): replay is a
 *   replay of the mixer itself, and takeover hands the decks over exactly
 *   as the replay left them — no state restore (issue spec)
 * - yields to takeover: any manual deck/mixer gesture ends replay
 *   immediately (self-op guard exactly as the Conductor's), capture
 *   resumes on release
 */
import type { DeckEngine, DeckSnapshot } from '../playback/DeckEngine';
import type { ChannelId, Mixer } from '../playback/mixer';
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

export interface ReplayHooks {
  /** Resolve + load a track onto a shared deck (the provider's one Load
   * path). Resolves false when the track is missing from the library. */
  loadTrack(deck: ChannelId, trackId: number): Promise<boolean>;
  onStopped(reason: ReplayStopReason): void;
}

/** How far an engine playhead may drift from a sync cue before a re-seek. */
const SYNC_TOLERANCE_S = 0.35;
/** Seed loads must become ready within this budget. */
const LOAD_TIMEOUT_MS = 20000;
/** Natural end-of-track detection window (the Conductor's). */
const NATURAL_END_TOLERANCE_S = 1.5;

export class SessionReplayDriver {
  private readonly plan: ReplayPlan;
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

  constructor(plan: ReplayPlan, audio: ReplayAudio, hooks: ReplayHooks) {
    this.plan = plan;
    this.mixer = audio.mixer;
    this.engines = audio.engines;
    this.hooks = hooks;
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
      ...ALL_DECKS.map((d) => this.engines[d].addTransportEventListener(this.gestureTap))
    );
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

  // ── Clock ──────────────────────────────────────────────────────────────

  private elapsed(): number {
    return this.mixer.now() - this.anchorAudioTime;
  }

  private tick = (): void => {
    if (!this.active) return;
    const elapsed = this.elapsed();
    const cues = this.plan.cues;
    while (this.cueIndex < cues.length && cues[this.cueIndex].offsetS <= elapsed) {
      this.self(() => this.applyCue(cues[this.cueIndex]));
      this.cueIndex += 1;
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
    for (const d of ALL_DECKS) {
      const s = seed.decks[d];
      const engine = this.engines[d];
      this.mixer.setTrim(d, s.trim);
      this.mixer.setEq(d, 'low', s.eq.low);
      this.mixer.setEq(d, 'mid', s.eq.mid);
      this.mixer.setEq(d, 'high', s.eq.high);
      this.mixer.setFilter(d, s.filter);
      this.mixer.setFader(d, s.fader);
      this.mixer.setCrossfaderAssignment(d, s.assignment);
      if (s.trackId !== null) {
        engine.setPitch(s.pitch);
        engine.seek(s.playhead);
        if (s.playing) engine.play();
        else engine.pause();
      }
    }
    this.mixer.setCrossfader(seed.crossfader);
    this.mixer.setCrossfaderEnabled(seed.crossfaderEnabled);
  }

  private applyCue(cue: ReplayCue): void {
    switch (cue.kind) {
      case 'control': {
        const ch = cue.channel;
        const v = cue.value;
        if (cue.control === 'fader' && ch) this.mixer.setFader(ch, v);
        else if (cue.control === 'trim' && ch) this.mixer.setTrim(ch, v);
        else if (cue.control === 'eqLow' && ch) this.mixer.setEq(ch, 'low', v);
        else if (cue.control === 'eqMid' && ch) this.mixer.setEq(ch, 'mid', v);
        else if (cue.control === 'eqHigh' && ch) this.mixer.setEq(ch, 'high', v);
        else if (cue.control === 'filter' && ch) this.mixer.setFilter(ch, v);
        else if (cue.control === 'pfl' && ch) this.mixer.setPfl(ch, v !== 0);
        else if (cue.control === 'crossfaderAssignment' && ch)
          this.mixer.setCrossfaderAssignment(ch, v < 0 ? 'left' : v > 0 ? 'right' : 'thru');
        else if (cue.control === 'crossfader') this.mixer.setCrossfader(v);
        else if (cue.control === 'crossfaderEnabled') this.mixer.setCrossfaderEnabled(v !== 0);
        else if (cue.control === 'master') this.mixer.setMaster(v);
        break;
      }
      case 'play': {
        const engine = this.engines[cue.channel];
        engine.seek(cue.playhead);
        engine.play();
        break;
      }
      case 'pause': {
        const engine = this.engines[cue.channel];
        engine.pause();
        engine.seek(cue.playhead);
        break;
      }
      case 'seek':
        this.engines[cue.channel].seek(cue.playhead);
        break;
      case 'pitch':
        this.engines[cue.channel].setPitch(cue.value);
        break;
      case 'load':
        if (cue.trackId !== null) {
          this.loadRequested[cue.channel] = cue.trackId;
          // Fire and forget — the played night's own timing gave the
          // decode time before the deck sounds; a slow load self-heals at
          // the next sync cue.
          void this.hooks.loadTrack(cue.channel, cue.trackId);
        }
        break;
      case 'sync':
        for (const d of ALL_DECKS) {
          const ph = cue.playheads[d as CaptureDeck];
          if (ph === undefined) continue;
          const engine = this.engines[d];
          const snap = engine.getSnapshot();
          if (snap.loadState !== 'ready') continue;
          if (Math.abs(engine.getPlayhead() - ph) > SYNC_TOLERANCE_S) engine.seek(ph);
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

  private gestureTap = (): void => {
    if (this.selfOps === 0 && this.active) this.takeover();
  };

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
          this.takeover();
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
        this.takeover();
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
      // Replay writes base state itself, but only inside self() — any
      // notify that lands here is a human hand.
      const changed =
        JSON.stringify(cur.channels) !== JSON.stringify(before.channels) ||
        cur.crossfader !== before.crossfader ||
        cur.crossfaderEnabled !== before.crossfaderEnabled ||
        cur.master !== before.master;
      if (changed) this.takeover();
    });
  }

  /**
   * A manual gesture: replay stops; the decks keep playing exactly as the
   * replay left them (no state restore — the issue spec); the release
   * flips capture's gate so the recorder re-seeds from what the user
   * hears, and the live continuation is captured.
   */
  private takeover(): void {
    if (!this.active) return;
    cancelAnimationFrame(this.raf);
    this.suppressSilence = true;
    try {
      this.teardown({ release: true });
    } finally {
      this.suppressSilence = false;
    }
    this.fireStopped('takeover');
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
    if (opts.release && isAudible('replay')) releaseAudible('replay');
    unregisterSurface('replay');
  }

  private fireStopped(reason: ReplayStopReason): void {
    if (this.stoppedFired) return;
    this.stoppedFired = true;
    this.hooks.onStopped(reason);
  }
}
