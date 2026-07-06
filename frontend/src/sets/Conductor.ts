/**
 * Conductor (sets 04): the thin runtime driver that schedules a SetPlan
 * onto the shared Decks and Mixer — in MixPlayer's mold (ADR 0022), one
 * conductor over the same machinery. NOT a new Audible surface in the
 * ADR 0013 sense of owning different playback semantics: the performance
 * surface plays; any view showing the Decks visualizes the set (see
 * docs/adr/0024-set-playback-is-a-conductor-not-an-audible-surface.md).
 *
 * All playback semantics live in the pure planner (planStateAt); this
 * class only reconciles engines/mixer against the evaluated state per
 * animation frame, on the Mixer's audio clock.
 *
 * Lifecycle (imperative, not React-mounted — a Set keeps playing across
 * view switches): start → registerSurface('conductor') + claimAudible +
 * engageAutomation + gesture watchers; teardown mirrors it. Holding the
 * claim makes conducted playback invisible to Take capture for free (the
 * recorder gates on `audibleHolder() !== 'shared'`) and releasing it at
 * takeover re-seeds capture from live state — capture resumes.
 *
 * TAKEOVER: any manual deck/mixer gesture stops the Conductor entirely;
 * the Decks keep playing as they are (the user is live). Detection:
 * - Mixer: base-state setters notify subscribers; the Conductor writes
 *   only through the automation overlay (which never notifies), so any
 *   observed base-state change is a human.
 * - Decks: snapshot diffs (playing/pitch/bend/preview/keylock flips) and
 *   the additive transport-event tap (seek/beatjump/hotcue), filtered by
 *   a self-op guard around every conductor-initiated engine call.
 * Conductor transport (play/pause, row play buttons) is NOT a takeover
 * trigger — it routes through this class, under the guard.
 */
import {
  claimAudible,
  isAudible,
  registerSurface,
  releaseAudible,
  subscribeAudible,
  unregisterSurface,
} from '../playback/audibleSurface';
import type { DeckEngine, DeckSnapshot } from '../playback/DeckEngine';
import type { ChannelId, Mixer } from '../playback/mixer';
import {
  jumpCrossed,
  planStateAt,
  type PlanAutomation,
  type PlanState,
  type SetPlan,
} from './planner';

const DRIFT_TOLERANCE_S = 0.12;

/** How close to the decoded duration a self-parked playhead must sit to
 * count as the worklet running off the buffer (natural end). */
const NATURAL_END_TOLERANCE_S = 0.05;

const lerp = (a: number, b: number, p: number): number => a + (b - a) * p;

const lerpLanes = (from: PlanAutomation, to: PlanAutomation, p: number): PlanAutomation => ({
  fader: lerp(from.fader, to.fader, p),
  eq: {
    low: lerp(from.eq.low, to.eq.low, p),
    mid: lerp(from.eq.mid, to.eq.mid, p),
    high: lerp(from.eq.high, to.eq.high, p),
  },
  filter: lerp(from.filter, to.filter, p),
});

export type ConductorStopReason = 'ended' | 'stopped' | 'takeover' | 'displaced';

export interface ConductorAudio {
  mixer: Mixer;
  engines: Record<ChannelId, DeckEngine>;
}

export interface ConductorHooks {
  /** The deck provider's one Load path (ADR 0022), by track id. */
  loadTrack(deck: ChannelId, trackId: number): void;
  /** Warm the decoded-buffer cache for an upcoming entry (sets 14):
   * fetch + decode + putCachedBuffer, so the deck load at handover is a
   * near-instant cache hit. Fire-and-forget. */
  prefetch?(trackId: number): void;
  /** Conducting ended — exactly once, with why. */
  onStopped(reason: ConductorStopReason): void;
}

export class Conductor {
  readonly plan: SetPlan;
  private readonly mixer: Mixer;
  private readonly engines: Record<ChannelId, DeckEngine>;
  private readonly hooks: ConductorHooks;

  /** Surface claimed + watchers attached (between start and teardown). */
  private active = false;
  private playing = false;
  private stoppedFired = false;

  private mixTimeAtAnchor = 0;
  private anchorAudioTime = 0;
  private lastTickT = 0;
  private raf = 0;

  /** Re-entrancy guard: engine/mixer callbacks fired synchronously from
   * the Conductor's own calls are not user gestures. */
  private selfOps = 0;
  /** During takeover teardown the arbiter's release→silence() must NOT
   * pause the decks — the user is live on them. */
  private suppressSilence = false;
  /** Last load requested per deck (one request per target; the engine's
   * snapshot lags the async fetch). */
  private loadRequested: Record<ChannelId, number | null> = { A: null, B: null };
  /** Last entry index handed to the prefetch hook (sets 14). */
  private prefetchedIndex = -1;
  /** Last automation values written (the sounding mix) — written into
   * base mixer state at takeover so disengaging is inaudible. */
  private lastLanes: Record<ChannelId, PlanAutomation> | null = null;
  /** A seek landed: the next tick re-positions decks unconditionally
   * (sub-tolerance seeks must not be swallowed by the drift check). */
  private pendingHardSync = false;
  /** Pickup convergence (sets 16): mixer lanes ramp from the adopted
   * base values to the plan's, and the anchor decks' pitch eases to the
   * plan's rate, over a short tunable window — the mirror of takeover's
   * inaudible disengage. Anchor decks are never re-seeked mid-ramp. */
  private pickupRamp: {
    startAudio: number;
    durationSec: number;
    startLanes: Record<ChannelId, PlanAutomation>;
    /** Present only for the anchor (audible-at-pickup) decks. */
    startPitch: Partial<Record<ChannelId, number>>;
  } | null = null;

  private unsubs: (() => void)[] = [];
  private listeners = new Set<() => void>();
  /** Last evaluated activeEntryIndex (UI row highlight). */
  private activeEntryIndex = 0;

  constructor(plan: SetPlan, audio: ConductorAudio, hooks: ConductorHooks) {
    this.plan = plan;
    this.mixer = audio.mixer;
    this.engines = audio.engines;
    this.hooks = hooks;
  }

  // ── Reads ────────────────────────────────────────────────────────────

  isActive(): boolean {
    return this.active;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  getMixTime(): number {
    if (!this.playing) return this.mixTimeAtAnchor;
    return this.mixTimeAtAnchor + (this.mixer.now() - this.anchorAudioTime);
  }

  getActiveEntryIndex(): number {
    return this.activeEntryIndex;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ── Transport (Conductor controls — never takeover triggers) ─────────

  play(): void {
    if (this.playing) return;
    if (!this.active) this.activate();
    if (!this.active) return; // activation refused (registration raced)
    this.playing = true;
    this.anchorAudioTime = this.mixer.now();
    this.lastTickT = this.getMixTime();
    this.raf = requestAnimationFrame(this.tick);
    this.emit();
  }

  pause(): void {
    if (!this.playing) return;
    this.mixTimeAtAnchor = this.getMixTime();
    this.playing = false;
    this.pickupRamp = null; // a paused pickup finishes converging silently
    cancelAnimationFrame(this.raf);
    this.pauseDecks();
    this.emit();
  }

  togglePlay(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  /** Row play button: start at that track's planned entry. */
  playFromEntry(index: number): void {
    const entry = this.plan.entries[index];
    if (!entry) return;
    this.seek(entry.entryMixSec);
    if (!this.playing) this.play();
  }

  /**
   * Seek (sets 05): plan evaluation at a mix-time instant — legal into
   * the middle of a Transition and while paused (positions the decks and
   * the mixer without playing; the next play resumes from here). A
   * Conductor control, never a takeover trigger. Never stops playback.
   */
  seek(mixTime: number): void {
    const t = Math.max(0, Math.min(mixTime, Math.max(this.plan.totalSec - 0.001, 0)));
    this.mixTimeAtAnchor = t;
    this.anchorAudioTime = this.mixer.now();
    this.lastTickT = t;
    this.activeEntryIndex = planStateAt(this.plan, t).activeEntryIndex;
    // Playing: the next tick reconciles everything (drift check forced).
    this.pendingHardSync = true;
    if (this.active && !this.playing) this.reconcilePaused();
    this.emit();
  }

  /**
   * Pickup (sets 16): the inverse of takeover — adopt the live deck/mixer
   * state as mix instant `mixTime` and resume conducting from it. The
   * decision (instant, anchors, ramp start) comes from the pure predicate
   * (pickup.ts); this method only executes it:
   * - claims audibility WITHOUT silencing the shared decks (the anchors
   *   keep sounding; the claim alone re-gates capture, abandoning any
   *   in-flight Handover engagement);
   * - engages automation and immediately writes `startLanes` — the
   *   current base values with the crossfader folded in — so engaging is
   *   inaudible, then converges every control to the plan over `rampSec`;
   * - eases each anchor deck's pitch to the plan's rate (a Tempo return
   *   in a new costume) instead of snapping, and never re-seeks an anchor
   *   mid-ramp. The residual drift the ease accrues is |Δpitch|/100 ·
   *   rampSec/2 — sub-tolerance for realistic offsets; anything larger is
   *   corrected by the normal drift check after the ramp.
   * Fresh instances only (the store constructs one per pickup).
   */
  pickup(
    mixTime: number,
    opts: {
      rampSec: number;
      rampDecks: ChannelId[];
      startLanes: Record<ChannelId, PlanAutomation>;
    }
  ): void {
    if (this.active || this.playing) return;
    this.activate({ silencePrevious: false });
    if (!this.active) return;
    const t = Math.max(0, Math.min(mixTime, Math.max(this.plan.totalSec - 0.001, 0)));
    this.mixTimeAtAnchor = t;
    this.anchorAudioTime = this.mixer.now();
    this.lastTickT = t;
    this.activeEntryIndex = planStateAt(this.plan, t).activeEntryIndex;
    this.pendingHardSync = true; // silent decks position hard on the first tick
    const startPitch: Partial<Record<ChannelId, number>> = {};
    for (const deck of opts.rampDecks) {
      startPitch[deck] = this.engines[deck].getSnapshot().pitchPercent;
    }
    this.pickupRamp = {
      startAudio: this.mixer.now(),
      durationSec: Math.max(opts.rampSec, 0),
      startLanes: opts.startLanes,
      startPitch,
    };
    // Written in the same synchronous span as engageAutomation's
    // crossfader pin: both 50ms node ramps run together and the start
    // lanes reproduce the sounding gains, so the engage is inaudible.
    this.self(() => {
      this.mixer.setAutomation('A', opts.startLanes.A);
      this.mixer.setAutomation('B', opts.startLanes.B);
    });
    this.lastLanes = opts.startLanes;
    this.playing = true;
    this.raf = requestAnimationFrame(this.tick);
    this.emit();
  }

  /** Stop conducting (user stop or natural end): decks pause, the borrow
   * unwinds, capture resumes gated on 'shared'. */
  stop(reason: 'stopped' | 'ended' = 'stopped'): void {
    if (!this.active) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.pauseDecks();
    this.teardown({ release: true, disengage: true });
    this.fireStopped(reason);
  }

  // ── Borrow lifecycle ─────────────────────────────────────────────────

  private activate(opts: { silencePrevious?: boolean } = {}): void {
    registerSurface('conductor', {
      // Hardware transport mirrors the Conductor while it holds audibility
      // (ADR 0019); pads/jumps/jog are deliberately unregistered — those
      // gesture classes drop rather than mean something surprising.
      transport: { togglePlay: () => this.togglePlay() },
      transportState: {
        playing: () => this.playing,
        subscribe: (fn) => this.subscribe(fn),
      },
      silence: () => this.handleSilence(),
    });
    // Pauses the shared decks' free-running playback — except at pickup,
    // which adopts them live (silencePrevious: false).
    claimAudible('conductor', opts);
    if (!isAudible('conductor')) {
      unregisterSurface('conductor');
      return;
    }
    this.active = true;
    this.stoppedFired = false;
    this.mixer.engageAutomation();
    this.unsubs.push(
      this.watchMixer(),
      this.watchEngine('A'),
      this.watchEngine('B'),
      this.engines.A.addTransportEventListener(this.gestureTap),
      this.engines.B.addTransportEventListener(this.gestureTap),
      // Displaced by another claimant (the Transition editor): stand down
      // without releasing (only the holder may release) and leave the
      // decks/overlay to the new holder.
      subscribeAudible((holder) => {
        if (holder !== 'conductor' && this.active) {
          this.playing = false;
          cancelAnimationFrame(this.raf);
          this.teardown({ release: false, disengage: false });
          this.fireStopped('displaced');
        }
      })
    );
  }

  private teardown(opts: { release: boolean; disengage: boolean }): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    if (opts.disengage) this.mixer.disengageAutomation();
    if (opts.release && isAudible('conductor')) releaseAudible('conductor');
    unregisterSurface('conductor');
    this.active = false;
    this.emit();
  }

  /** Arbiter silence(): pause this surface's playback. Suppressed during
   * a takeover release — the user keeps the running decks. */
  private handleSilence(): void {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    if (this.suppressSilence) return;
    this.pauseDecks();
    this.emit();
  }

  /**
   * A manual deck/mixer gesture: stop conducting entirely; the Decks keep
   * playing as they are and the MIX keeps sounding as it did — the last
   * automation values are written into base mixer state first (sparing
   * whatever the user just moved), so the disengage reapply is inaudible.
   * All before the release flips capture's gate: the recorder re-seeds
   * from exactly what the user hears.
   */
  private takeover(touched?: ReadonlySet<string>): void {
    if (!this.active) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.self(() => this.syncBaseToAutomation(touched));
    this.suppressSilence = true;
    try {
      this.teardown({ release: true, disengage: true });
    } finally {
      this.suppressSilence = false;
    }
    this.fireStopped('takeover');
  }

  /** Write the sounding (automation) values into base mixer state, field
   * by field, skipping the `touched` fields the user's own gesture just
   * set (keys as in watchMixer: 'A.fader', 'B.eqLow', 'crossfader', …).
   * The automation crossfader is pinned neutral, so base gets 0. */
  private syncBaseToAutomation(touched?: ReadonlySet<string>): void {
    const skip = (key: string) => touched?.has(key) ?? false;
    const lanes = this.lastLanes;
    if (lanes) {
      for (const ch of ['A', 'B'] as const) {
        if (!skip(`${ch}.fader`)) this.mixer.setFader(ch, lanes[ch].fader);
        if (!skip(`${ch}.eqLow`)) this.mixer.setEq(ch, 'low', lanes[ch].eq.low);
        if (!skip(`${ch}.eqMid`)) this.mixer.setEq(ch, 'mid', lanes[ch].eq.mid);
        if (!skip(`${ch}.eqHigh`)) this.mixer.setEq(ch, 'high', lanes[ch].eq.high);
        if (!skip(`${ch}.filter`)) this.mixer.setFilter(ch, lanes[ch].filter);
      }
    }
    if (!skip('crossfader')) this.mixer.setCrossfader(0);
  }

  private pauseDecks(): void {
    this.self(() => {
      this.engines.A.pause();
      this.engines.B.pause();
    });
  }

  // ── Gesture watchers ─────────────────────────────────────────────────

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
      // Load-flow emits (conductor-initiated, async — outside the guard):
      // anything moving trackId/loadState is a Load, not a gesture. A load
      // completing while PAUSED finishes the parked seek (sets 05) — the
      // tick loop isn't running to do it.
      if (snap.trackId !== before.trackId || snap.loadState !== before.loadState) {
        if (!this.playing && snap.loadState === 'ready') this.reconcilePaused();
        return;
      }
      if (
        snap.playing !== before.playing ||
        snap.pitchPercent !== before.pitchPercent ||
        snap.bendPercent !== before.bendPercent ||
        snap.previewing !== before.previewing ||
        snap.hotCuePreviewSlot !== before.hotCuePreviewSlot ||
        snap.keyLock !== before.keyLock
      ) {
        // Natural end-of-track is the deck's OWN doing, not a gesture:
        // the worklet ran off the buffer and the engine parked itself at
        // the decoded duration (handleEnded). A hard-cut outgoing always
        // reaches this at its cut instant — and earlier, when the track's
        // metadata duration overstates the decoded audio — so treating it
        // as a takeover stopped the set instead of cutting to the
        // incoming (the "hard cuts never happen" bug).
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
      a: this.mixer.getChannelState('A'),
      b: this.mixer.getChannelState('B'),
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
      // The Conductor writes only setAutomation (never notifies), so any
      // changed base state is a human hand. Field-level diff: the touched
      // fields keep the user's values through the takeover base-sync.
      const touched = new Set<string>();
      for (const [ch, b, c] of [
        ['A', before.a, cur.a],
        ['B', before.b, cur.b],
      ] as const) {
        if (b === c) continue;
        if (b.fader !== c.fader) touched.add(`${ch}.fader`);
        if (b.eq.low !== c.eq.low) touched.add(`${ch}.eqLow`);
        if (b.eq.mid !== c.eq.mid) touched.add(`${ch}.eqMid`);
        if (b.eq.high !== c.eq.high) touched.add(`${ch}.eqHigh`);
        if (b.filter !== c.filter) touched.add(`${ch}.filter`);
        if (b.trim !== c.trim) touched.add(`${ch}.trim`);
        if (b.pfl !== c.pfl) touched.add(`${ch}.pfl`);
      }
      if (before.crossfader !== cur.crossfader) touched.add('crossfader');
      if (before.crossfaderEnabled !== cur.crossfaderEnabled) touched.add('crossfaderEnabled');
      if (before.master !== cur.master) touched.add('master');
      if (touched.size > 0) this.takeover(touched);
    });
  }

  // ── The drive loop ───────────────────────────────────────────────────

  private tick = (): void => {
    if (!this.playing) return;
    const t = this.getMixTime();
    if (t >= this.plan.totalSec) {
      this.stop('ended');
      return;
    }
    const state = planStateAt(this.plan, t);
    const readyA = this.ensureDeckTrack('A', state);
    const readyB = this.ensureDeckTrack('B', state);
    this.prefetchAhead(state);

    // Load latency (sets 14): never stall while music plays; never skip
    // while silent. The clock freezes ONLY when a deck that must be
    // audible is still loading and NOTHING else is sounding (cold-cache
    // ▶, a hard-cut instant with the incoming still loading — running
    // the clock there would skip the incoming's opening). While any deck
    // is sounding, the clock runs and the late deck joins at its plan
    // position when ready (syncDeck's seek-to-plan below).
    const missingA = state.decks.A.playing && !readyA;
    const missingB = state.decks.B.playing && !readyB;
    const anySounding =
      (state.decks.A.playing && readyA) || (state.decks.B.playing && readyB);
    if ((missingA || missingB) && !anySounding) {
      this.mixTimeAtAnchor = t;
      this.anchorAudioTime = this.mixer.now();
      // Frozen = silent by definition: park anything still sounding
      // (e.g. a hard-cut outgoing running past its cut instant).
      this.self(() => {
        for (const deck of ['A', 'B'] as const) {
          if (this.engines[deck].getSnapshot().playing) this.engines[deck].pause();
        }
      });
      this.raf = requestAnimationFrame(this.tick);
      return;
    }

    // A deck JOINING this tick (plan says play, engine not yet playing)
    // hard-syncs BOTH decks in this same task: worklet starts posted
    // together share their render-quantum boundary, so the decks' start
    // latencies cancel. Started apart, the latency difference is a
    // constant audible flam that the drift check can never see — the
    // playhead estimate is anchored at post time, so estimate-vs-plan
    // reads ~0 while the actual audio runs behind by each deck's own
    // start latency (the set-playback clash bug; pausing and resuming
    // "fixed" it by doing exactly this restart-together).
    const joining =
      (readyA &&
        state.decks.A.playing &&
        !this.engines.A.getSnapshot().playing &&
        !this.audioExhausted('A', state.decks.A.trackTime)) ||
      (readyB &&
        state.decks.B.playing &&
        !this.engines.B.getSnapshot().playing &&
        !this.audioExhausted('B', state.decks.B.trackTime));
    const hard =
      this.pendingHardSync || joining || jumpCrossed(this.plan, this.lastTickT, t);
    this.pendingHardSync = false;
    this.lastTickT = t;
    // Pickup convergence (sets 16): while the ramp runs, every mixer
    // control lerps from its adopted start value toward the (moving)
    // plan value — p→1 guarantees convergence.
    const p = this.rampProgress();
    const ramp = this.pickupRamp;
    const lanes = ramp
      ? {
          A: lerpLanes(ramp.startLanes.A, state.lanes.A, p),
          B: lerpLanes(ramp.startLanes.B, state.lanes.B, p),
        }
      : state.lanes;
    this.self(() => {
      if (readyA) this.syncDeck('A', state, hard, p);
      if (readyB) this.syncDeck('B', state, hard, p);
      this.mixer.setAutomation('A', lanes.A);
      this.mixer.setAutomation('B', lanes.B);
    });
    this.lastLanes = lanes;

    if (state.activeEntryIndex !== this.activeEntryIndex) {
      this.activeEntryIndex = state.activeEntryIndex;
      this.emit();
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  /** A paused seek (sets 05): position decks, pitch, and automation at
   * the seeked instant WITHOUT playing — waveforms show the target, and
   * play resumes exactly here. Loads still in flight finish the parking
   * via the watchEngine ready hook. */
  private reconcilePaused(): void {
    if (!this.active || this.playing) return;
    this.pickupRamp = null; // positions/lanes snap silently while paused
    const t = this.getMixTime();
    const state = planStateAt(this.plan, t);
    const readyA = this.ensureDeckTrack('A', state);
    const readyB = this.ensureDeckTrack('B', state);
    this.prefetchAhead(state);
    this.self(() => {
      for (const [deck, ready] of [
        ['A', readyA],
        ['B', readyB],
      ] as const) {
        if (!ready) continue;
        const engine = this.engines[deck];
        if (engine.getSnapshot().playing) engine.pause();
        engine.seek(state.decks[deck].trackTime);
        engine.setPitch(state.decks[deck].pitchPercent);
      }
      this.mixer.setAutomation('A', state.lanes.A);
      this.mixer.setAutomation('B', state.lanes.B);
    });
    this.lastLanes = state.lanes;
    if (state.activeEntryIndex !== this.activeEntryIndex) {
      this.activeEntryIndex = state.activeEntryIndex;
      this.emit();
    }
  }

  /** Prefetch one entry ahead (sets 14): while the decks hold entries k
   * and k+1, warm the decoded-buffer cache for k+2 — its deck load at
   * the handover becomes a near-instant cache hit, inside the grace
   * fade's headroom. One request per entry index. */
  private prefetchAhead(state: PlanState): void {
    if (!this.hooks.prefetch) return;
    const nextIdx =
      Math.max(state.decks.A.entryIndex ?? -1, state.decks.B.entryIndex ?? -1) + 1;
    if (nextIdx <= 0 || nextIdx >= this.plan.entries.length) return;
    if (this.prefetchedIndex === nextIdx) return;
    this.prefetchedIndex = nextIdx;
    this.hooks.prefetch(this.plan.entries[nextIdx].trackId);
  }

  /** Reconcile one deck's loaded track against the plan's occupant.
   * Returns readiness (loaded + decoded, right track). */
  private ensureDeckTrack(deck: ChannelId, state: PlanState): boolean {
    const desired = state.decks[deck];
    if (desired.trackId === null) return false;
    const snap = this.engines[deck].getSnapshot();
    if (snap.trackId !== desired.trackId) {
      if (this.loadRequested[deck] !== desired.trackId) {
        this.loadRequested[deck] = desired.trackId;
        this.hooks.loadTrack(deck, desired.trackId);
      }
      return false;
    }
    return snap.loadState === 'ready';
  }

  /** The plan wants this deck playing at/past its decoded buffer end but
   * the audio has already run out (self-parked at the end): nothing left
   * to play. True only in that dead zone — a target back inside the
   * buffer (a seek) still restarts normally. */
  private audioExhausted(deck: ChannelId, targetTrackTime: number): boolean {
    const snap = this.engines[deck].getSnapshot();
    return (
      !snap.playing &&
      snap.loadState === 'ready' &&
      snap.duration > 0 &&
      targetTrackTime >= snap.duration - NATURAL_END_TOLERANCE_S &&
      this.engines[deck].getPlayhead() >= snap.duration - NATURAL_END_TOLERANCE_S
    );
  }

  /** Pickup ramp progress ∈ [0,1] on the audio clock; clears the ramp
   * when it completes. 1 when no ramp is running. */
  private rampProgress(): number {
    const ramp = this.pickupRamp;
    if (!ramp) return 1;
    const p =
      ramp.durationSec <= 0 ? 1 : (this.mixer.now() - ramp.startAudio) / ramp.durationSec;
    if (p >= 1) {
      this.pickupRamp = null;
      return 1;
    }
    return p;
  }

  /** MixPlayer's reconcile: pause inactive, start + position active,
   * re-seek past the drift tolerance (or hard, on jump crossings).
   * `rampP` < 1 = pickup convergence: an anchor deck's pitch eases from
   * its adopted value to the plan's, and the anchor is never re-seeked
   * mid-ramp (seamless by construction — sets 16). */
  private syncDeck(deck: ChannelId, state: PlanState, hard: boolean, rampP = 1): void {
    const engine = this.engines[deck];
    const target = state.decks[deck];
    const snap: DeckSnapshot = engine.getSnapshot();
    const startPitch = this.pickupRamp?.startPitch[deck];
    const ramping = startPitch !== undefined && rampP < 1;
    if (!target.playing) {
      if (snap.playing) engine.pause();
      // Park at the planned position (entry point before, exit after) so
      // waveforms show where the set will pick the deck up.
      if (!snap.playing && Math.abs(engine.getPlayhead() - target.trackTime) > DRIFT_TOLERANCE_S) {
        engine.seek(target.trackTime);
      }
      return;
    }
    // The plan can outrun the decoded audio (a metadata duration that ran
    // long): the deck already ended and self-parked at its buffer end —
    // hold the park (silence, as planned-ish) instead of restarting it
    // into an instant re-'ended' every tick.
    if (this.audioExhausted(deck, target.trackTime)) return;
    engine.setPitch(ramping ? lerp(startPitch, target.pitchPercent, rampP) : target.pitchPercent);
    if (!snap.playing) {
      engine.seek(target.trackTime);
      engine.play();
      return;
    }
    if (ramping) return; // anchor: untouched while converging
    const drift = engine.getPlayhead() - target.trackTime;
    if (hard || Math.abs(drift) > DRIFT_TOLERANCE_S) {
      engine.seek(target.trackTime);
    }
  }

  // ── Internals ────────────────────────────────────────────────────────

  private self<T>(fn: () => T): T {
    this.selfOps++;
    try {
      return fn();
    } finally {
      this.selfOps--;
    }
  }

  private fireStopped(reason: ConductorStopReason): void {
    if (this.stoppedFired) return;
    this.stoppedFired = true;
    this.hooks.onStopped(reason);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
