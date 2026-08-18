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

/** Gross-desync threshold: a correcting seek fires only past THIS drift —
 * a genuine desync (a load that landed late, a stalled decode), never
 * normal playback jitter. Kept well above the wall-clock↔audio-clock skew
 * between the recorded ticks and live replay (which was making a 30 ms
 * corrector re-seek every second: the "off-beat then snaps back" jitter).
 * Once a deck is playing, it runs at the engine's true rate untouched. */
const RESYNC_THRESHOLD_S = 0.5;
/** Minimum spacing between corrective seeks per deck (no seek-thrash). */
const CORRECTION_COOLDOWN_S = 2;
/** Persistent-drift corrector (regression fix over the 0.5s deadband): the
 * gross threshold alone let REAL drift — accumulated pitch-bend nudges in
 * the original performance, engine rate imprecision — park in the
 * 0.35-0.5s band: audibly MORE THAN A BEAT out at higher BPMs, never
 * corrected. Sync innovations (engine − recorded playhead) are medianed
 * over this many ticks; one janky sample never seeks, a WINDOW agreeing on
 * drift past DRIFT_THRESHOLD_S does. */
const DRIFT_WINDOW = 5;
/** Rate inference (sessions 18): logs recorded before seed-pitch existed
 * carry no pitch event for decks pitched pre-session — replay at nominal
 * rate drifts ~pitch% forever and the corrector turns that into periodic
 * audible jumps. Estimate each playing deck's TRUE rate from its recorded
 * ticks and set the engine pitch to match: replay tempo becomes correct
 * and the drift source disappears. */
const RATE_WINDOW = 6;
const RATE_MIN_SAMPLES = 4;
/** Samples must fit the endpoint line within this — a step offset is
 * DRIFT for the median corrector, not a rate change. */
const RATE_FIT_TOL_S = 0.06;
/** Co-corrected decks skip negligible medians (a ~0 seek is a pointless
 * ramp). */
const COCORRECT_MIN_S = 0.02;
/** Coordinated SEEK tier (sessions 20): only a persistent median past
 * this still seeks — a late load's landing error, drained fast. Everything
 * smaller is the servo's job (inaudible rate bias, no jumps). */
const SEEK_MEDIAN_S = 0.2;
/** Phase servo (sessions 20): position error maps to a bounded micro-rate
 * bias — the mechanical analog of a DJ nudge. All the irreducible error
 * sources (start-latency stagger, keylock rate wander, unreplayed bends,
 * clock skew, estimator noise) drain continuously toward the shared log
 * reference — on every deck, so RELATIVE phase converges too. */
const SERVO_MAX_BIAS = 0.01; // ±1% rate (small errors — inaudible)
/** Large disparities get an AGGRESSIVE cap (a firm DJ nudge): draining
 * 0.15s at 1% took ~20s of audible half-sync — at 4% it's under 4s. */
const SERVO_MAX_BIAS_HI = 0.04;
const SERVO_HI_ERR_S = 0.1; // schedule up past this error
/** Start snap: decks do NOT all start in the same instant (engine
 * play/ramp latency differs per deck) — the first sync tick after a deck
 * (re)starts SEEKS any stagger away instead of leaving the servo to drain
 * it. A seek at playback start is not a mid-groove jump: nobody has an
 * established phase yet. */
const START_SNAP_S = 0.04;
const SERVO_GAIN_PER_S = 0.1; // full bias at 0.1s error
const SERVO_DEADBAND_S = 0.015; // no dither under estimator noise
const ERR_EMA_ALPHA = 0.4;
/** Base-rate blending (replaces stepped inference adjustments — the steps
 * wobbled decks independently and froze position errors in). */
const RATE_EMA_ALPHA = 0.3;
/** Skip setPitch churn below this delta (percent points). */
const PITCH_APPLY_MIN_PCT = 0.02;

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
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
  /** A seekTo's async load is in flight. Pause/resume are refused during
   * it: a pause landing between seekTo's pause-state snapshot and its
   * completion left `pausedAtOffset` set under status 'playing' — a
   * frozen playhead over rolling audio (the clock pins at the stale
   * offset), recoverable only by a pause/resume cycle. */
  private seeking = false;
  /** Monotonic seek generation: a newer seekTo supersedes an older one's
   * continuation (double-click while loading double-started the tick
   * loop — two cue appliers per frame). */
  private seekGen = 0;
  /** Per-deck phase anchors: expected trackTime = playhead +
   * (offset − anchor.offset) × rate. The continuous corrector holds every
   * playing deck to its anchor within PHASE_TOLERANCE_S — this is what
   * keeps a mid-blend start beatmatched (start-latency stagger and
   * tick-gap seeding errors get snapped out, rate-aware). */
  private anchors: Partial<Record<ChannelId, { offset: number; playhead: number; rate: number }>> =
    {};
  private lastCorrection: Partial<Record<ChannelId, number>> = {};
  /** Recent sync-cue innovations per deck (DRIFT_WINDOW ring). */
  private syncDrift: Partial<Record<ChannelId, number[]>> = {};
  /** Recorded (offset, playhead) samples per deck for rate inference
   * (RATE_WINDOW ring) — reset on any recorded discontinuity. */
  private rateBuf: Partial<Record<ChannelId, { off: number; ph: number }[]>> = {};
  /** Phase-servo state per deck (sessions 20): smoothed position error +
   * EMA-blended base rate. */
  private servo: Partial<Record<ChannelId, { errEma: number | null; rateEma: number }>> = {};
  /** Decks that (re)started and have not been start-snapped yet. */
  private unsettled: Partial<Record<ChannelId, boolean>> = {};
  /** Live servo activity per deck (rate-bias fraction + smoothed error
   * seconds) — the timeline info bar's readout polls this via the store. */
  private servoActivity: Partial<Record<ChannelId, { bias: number; err: number }>> = {};
  /** The RECORDED mixer state (what the night's log says), composed into
   * overlay lanes — never written to base during playback. */
  private recDecks: Record<
    ChannelId,
    { fader: number; trim: number; eq: { low: number; mid: number; high: number }; filter: number; assignment: CrossfaderAssignment }
  > = {
    A: { fader: 1, trim: 0.5, eq: { low: 0.5, mid: 0.5, high: 0.5 }, filter: 0, assignment: 'left' },
    B: { fader: 1, trim: 0.5, eq: { low: 0.5, mid: 0.5, high: 0.5 }, filter: 0, assignment: 'right' },
    C: { fader: 1, trim: 0.5, eq: { low: 0.5, mid: 0.5, high: 0.5 }, filter: 0, assignment: 'left' },
    D: { fader: 1, trim: 0.5, eq: { low: 0.5, mid: 0.5, high: 0.5 }, filter: 0, assignment: 'right' },
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

  /** Live per-deck servo activity — absent when idle. */
  getServoActivity(): Partial<Record<ChannelId, { bias: number; err: number }>> {
    return this.servoActivity;
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
    if (!this.active || this.seeking || this.pausedAtOffset !== null) return;
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
    if (!this.active || this.seeking || this.pausedAtOffset === null) return;
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
    const gen = ++this.seekGen;
    this.seeking = true;
    cancelAnimationFrame(this.raf);
    const wasPaused = this.pausedAtOffset !== null;
    this.pausedAtOffset = null;
    this.pausedDecks = [];
    this.self(() => {
      for (const d of ALL_DECKS) this.engines[d].pause();
    });
    this.plan = plan;
    this.cueIndex = 0;
    try {
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
      // Superseded by a newer seek: ITS continuation owns the restart —
      // finishing here too double-started the tick loop.
      if (gen !== this.seekGen) return;
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
    } finally {
      if (gen === this.seekGen) this.seeking = false;
    }
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
    this.syncDrift = {};
    this.rateBuf = {};
    this.servo = {};
    this.servoActivity = {};
    this.unsettled = {};
    for (const d of ALL_DECKS) {
      if (this.plan.seed.decks[d].playing) this.unsettled[d] = true;
    }
    for (const d of ALL_DECKS) {
      const s = seed.decks[d];
      const engine = this.engines[d];
      this.recDecks[d] = {
        fader: s.fader,
        trim: s.trim,
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
        trim: r.trim,
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
      // Where the deck SHOULD be, projected from its anchor at the deck's
      // own rate. A seek only fires on a GROSS desync — normal engine
      // playback jitter (and the recorded-tick↔audio-clock skew) never
      // crosses this, so steady playback is left completely alone.
      const expected = a.playhead + (elapsed - a.offset) * a.rate;
      const drift = Math.abs(engine.getPlayhead() - expected);
      if (drift <= RESYNC_THRESHOLD_S) continue;
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
        // lanes — including trim (sessions 15: trim is ridden as a
        // performance control, so a replay without it is audibly wrong).
        // PFL/master/cue stay the LIVE user's; crossfader moves recompose
        // every lane (its gain is folded in).
        if (cue.control === 'trim' && ch) {
          this.recDecks[ch].trim = v;
          this.applyLanes([ch]);
        } else if (cue.control === 'fader' && ch) {
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
        this.syncDrift[cue.channel] = [];
        delete this.rateBuf[cue.channel];
        this.unsettled[cue.channel] = true;
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
        this.syncDrift[cue.channel] = [];
        delete this.rateBuf[cue.channel];
        break;
      }
      case 'seek': {
        this.engines[cue.channel].seek(cue.playhead);
        this.syncDrift[cue.channel] = [];
        delete this.rateBuf[cue.channel];
        const prev = this.anchors[cue.channel];
        if (prev) this.anchors[cue.channel] = { ...prev, offset: cue.offsetS, playhead: cue.playhead };
        break;
      }
      case 'previewStart': {
        // Stab (sessions 12): audible preview via the machine-grade entry
        // point — quantize-free, cue points untouched. Anchored like play
        // for bookkeeping; the corrector skips non-playing decks, so a stab
        // runs uncorrected (they last seconds — drift is negligible).
        const engine = this.engines[cue.channel];
        engine.previewAt(cue.playhead);
        this.syncDrift[cue.channel] = [];
        delete this.rateBuf[cue.channel];
        const prev = this.anchors[cue.channel];
        this.anchors[cue.channel] = {
          offset: cue.offsetS,
          playhead: cue.playhead,
          rate: prev?.rate ?? 1 + (this.plan.seed.decks[cue.channel]?.pitch ?? 0) / 100,
        };
        break;
      }
      case 'previewEnd': {
        // Stop at the recorded return position. If the window opened
        // mid-stab (no matching previewStart), the engine no-ops — the v1
        // mid-window boundary: an already-open stab is skipped.
        this.engines[cue.channel].endPreview(cue.playhead);
        delete this.anchors[cue.channel];
        this.syncDrift[cue.channel] = [];
        delete this.rateBuf[cue.channel];
        break;
      }
      case 'pitch': {
        this.engines[cue.channel].setPitch(cue.value);
        this.syncDrift[cue.channel] = [];
        delete this.rateBuf[cue.channel];
        const sv = this.servo[cue.channel];
        if (sv) {
          sv.rateEma = 1 + cue.value / 100; // the cue IS the new base rate
          sv.errEma = null;
        }
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
          this.syncDrift[cue.channel] = [];
          delete this.rateBuf[cue.channel];
          delete this.servo[cue.channel];
          // Fire and forget — the played night's own timing gave the
          // decode time before the deck sounds; a slow load self-heals at
          // the next sync cue.
          void this.hooks.loadTrack(cue.channel, cue.trackId);
        }
        break;
      case 'sync': {
        // Ticks are the log's ~1 Hz truth samples. Three tiers (sessions
        // 18 + 20):
        //  - SERVO: EMA'd position error → bounded micro-rate bias on top
        //    of an EMA-blended base rate. Inaudible, continuous, drains
        //    every irreducible error source (start stagger, keylock rate
        //    wander, unreplayed bends, clock skew, estimator noise) on
        //    every deck toward the SHARED log reference — relative phase
        //    converges as a consequence. No seeks, no jumps.
        //  - COORDINATED SEEK: a persistent median past SEEK_MEDIAN_S (a
        //    late load landed far off) seeks ALL full-window decks in the
        //    same frame.
        //  - GROSS (> RESYNC_THRESHOLD_S): re-anchor; the frame corrector
        //    seeks (a stalled decode).
        const ticked: { d: ChannelId; ph: number }[] = [];
        for (const d of ALL_DECKS) {
          const ph = cue.playheads[d as CaptureDeck];
          if (ph === undefined) continue;
          const a = this.anchors[d];
          if (a === undefined) {
            const pitch = this.engines[d].getSnapshot().pitchPercent;
            this.anchors[d] = { offset: cue.offsetS, playhead: ph, rate: 1 + pitch / 100 };
            continue;
          }
          const snap = this.engines[d].getSnapshot();
          if (!snap.playing || snap.loadState !== 'ready') {
            this.syncDrift[d] = [];
            delete this.rateBuf[d];
            const idleSv = this.servo[d];
            if (idleSv) idleSv.errEma = null;
            delete this.servoActivity[d];
            continue;
          }
          const sv = (this.servo[d] ??= {
            errEma: null,
            rateEma: 1 + snap.pitchPercent / 100,
          });
          // Start snap (start-latency stagger): the deck just (re)started;
          // its first truth sample reveals how late the engine actually
          // began. Seek the stagger away NOW — the servo would audibly
          // half-sync for many seconds over what one inaudible-at-start
          // seek removes.
          if (this.unsettled[d]) {
            delete this.unsettled[d];
            const stagger = this.engines[d].getPlayhead() - ph;
            if (Math.abs(stagger) > START_SNAP_S && Math.abs(stagger) <= RESYNC_THRESHOLD_S) {
              const engine = this.engines[d];
              const target = engine.getPlayhead() - stagger;
              this.self(() => engine.seek(target));
              this.anchors[d] = { offset: cue.offsetS, playhead: ph, rate: sv.rateEma };
              this.syncDrift[d] = [];
              sv.errEma = null;
              continue;
            }
          }
          // Base rate: blend linear window fits of the RECORDED trajectory
          // (engine seeks/pitch writes never invalidate these samples).
          const rb = (this.rateBuf[d] ??= []);
          rb.push({ off: cue.offsetS, ph });
          if (rb.length > RATE_WINDOW) rb.shift();
          if (rb.length >= RATE_MIN_SAMPLES) {
            const first = rb[0];
            const last = rb[rb.length - 1];
            const dt = last.off - first.off;
            if (dt > 0.5) {
              const est = (last.ph - first.ph) / dt;
              const linear = rb.every(
                (p) => Math.abs(p.ph - (first.ph + (p.off - first.off) * est)) <= RATE_FIT_TOL_S
              );
              if (linear && est > 0.5 && est < 2) {
                sv.rateEma += RATE_EMA_ALPHA * (est - sv.rateEma);
              }
            }
          }
          const innovation = this.engines[d].getPlayhead() - ph;
          if (Math.abs(innovation) > RESYNC_THRESHOLD_S) {
            this.anchors[d] = { offset: cue.offsetS, playhead: ph, rate: sv.rateEma };
            this.syncDrift[d] = [];
            sv.errEma = null;
            continue;
          }
          sv.errEma =
            sv.errEma === null ? innovation : sv.errEma + ERR_EMA_ALPHA * (innovation - sv.errEma);
          // The servo: err ahead of the log → slow down; behind → speed up.
          const err = sv.errEma;
          // Error-scheduled cap: large disparities converge FIRMLY (4%),
          // small ones invisibly (1%).
          const cap = Math.abs(err) > SERVO_HI_ERR_S ? SERVO_MAX_BIAS_HI : SERVO_MAX_BIAS;
          const bias =
            Math.abs(err) < SERVO_DEADBAND_S
              ? 0
              : Math.max(-cap, Math.min(cap, -err * SERVO_GAIN_PER_S * (cap / SERVO_MAX_BIAS)));
          this.servoActivity[d] = { bias, err };
          const targetPitch = (sv.rateEma - 1) * 100 + bias * 100;
          if (Math.abs(targetPitch - snap.pitchPercent) > PITCH_APPLY_MIN_PCT) {
            const engine = this.engines[d];
            this.self(() => engine.setPitch(targetPitch));
          }
          // Anchors just feed the gross check now: track the log's truth.
          this.anchors[d] = { offset: cue.offsetS, playhead: ph, rate: sv.rateEma };
          const buf = (this.syncDrift[d] ??= []);
          buf.push(innovation);
          if (buf.length > DRIFT_WINDOW) buf.shift();
          ticked.push({ d, ph });
        }
        // Coordinated seek tier: ANY full-window median past SEEK_MEDIAN_S
        // (cooldown-gated) seeks EVERY full-window deck by its own median
        // this same frame — relative phase rides through.
        const trigger = ticked.some(({ d }) => {
          const buf = this.syncDrift[d];
          if (!buf || buf.length < DRIFT_WINDOW) return false;
          if (Math.abs(median(buf)) <= SEEK_MEDIAN_S) return false;
          const last = this.lastCorrection[d];
          return last === undefined || cue.offsetS - last >= CORRECTION_COOLDOWN_S;
        });
        if (trigger) {
          for (const { d } of ticked) {
            const buf = this.syncDrift[d];
            if (!buf || buf.length < DRIFT_WINDOW) continue;
            const med = median(buf);
            this.lastCorrection[d] = cue.offsetS;
            this.syncDrift[d] = [];
            const sv = this.servo[d];
            if (sv) sv.errEma = null;
            if (Math.abs(med) < COCORRECT_MIN_S) continue;
            const engine = this.engines[d];
            const target = engine.getPlayhead() - med;
            this.self(() => engine.seek(target));
          }
        }
        break;
      }
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
      if (!skip(`${d}.trim`) && lane.trim !== undefined) this.mixer.setTrim(d, lane.trim);
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
