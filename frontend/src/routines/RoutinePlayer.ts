/**
 * RoutinePlayer — the Routine editor's deterministic CONDUCTOR (gh#170).
 *
 * The MixPlayer pattern, slot-aware: plays a PlannedRoutine over the
 * SHARED Decks and Mixer (ADR 0022), driving each cast slot's allocated
 * deck through the replay engine's own evaluators (routineSlotStateAt /
 * slotLanesAt — the exact functions planStateAt defers to inside a Set's
 * Routine span, so the audition IS the Conductor's replay, minus the Set
 * around it). Owns no audio; the borrow lifecycle (claim audibility,
 * engage the overlay, checkpoint deck pitches) belongs to the editor
 * shell, mirrored here by the injected `audible` gate: while the editor
 * is not the audible surface this is a pure model — engines and Mixer
 * are never touched.
 *
 * Deck REUSE (gh#170 pass 2): allocation is concurrency-based — a deck
 * frees when its slot's recorded motion ends and later entries reuse it.
 * Every deck read is therefore OCCUPANCY-AWARE (slotOccupyingDeckAt):
 * the deck's verdict at time t belongs to its occupant at t, and an
 * occupant change mid-play issues the incoming track's load through the
 * injected hook (the Conductor's ensureDeckTrack idiom — one request per
 * target; the deck stays parked until it holds the right track).
 *
 * The mix clock rides the Mixer's audio clock (MixPlayer's invariant);
 * editor mix second 0 = Routine beat 0. Recorded discontinuities hard-
 * sync ONLY the jumping slot's deck (#161: an all-deck seek reads as an
 * audible hiccup); everything else reconciles under a drift tolerance
 * with pitch set to the trace's own re-anchored rate.
 */
import type { DeckEngine } from '../playback/DeckEngine';
import type { Mixer } from '../playback/mixer';
import {
  routineSlotStateAt,
  slotLanesAt,
  slotOccupyingDeckAt,
  type PlannedRoutine,
  type PlannedRoutineSlot,
  type RoutineDeck,
} from '../sets/routinePlan';

const DRIFT_TOLERANCE_S = 0.12;
const PITCH_EPS = 0.005;

/** Audition margin beyond the Routine window, in Routine beats (gh#190
 * item 5 — transition-editor parity: the pair editor auditions its whole
 * arrangement, not just the transition window). BEFORE the window the
 * window-open slots roll backward from their entry state; AFTER it the
 * exit slot's forced trailing motion extrapolates (the boundary
 * contract). Seeks and the transport clock both roam this range. */
export const AUDITION_MARGIN_BEATS = 32;

export interface RoutinePlayerAudio {
  mixer: Mixer;
  engines: Partial<Record<RoutineDeck, DeckEngine>>;
  /** May this conductor touch the shared engines/mixer right now? */
  audible?: () => boolean;
  /** Issue a shared-deck Load (the provider's one load path, ADR 0022).
   * Called when a deck's occupant needs a track the deck doesn't hold —
   * at most once per (deck, track) until the target changes. */
  loadTrack?: (deck: RoutineDeck, trackId: number) => void;
}

export class RoutinePlayer {
  readonly mixer: Mixer;
  private readonly engines: Partial<Record<RoutineDeck, DeckEngine>>;
  private readonly audible: () => boolean;
  private readonly loadTrack: ((deck: RoutineDeck, trackId: number) => void) | null;

  private routine: PlannedRoutine | null = null;

  private playing = false;
  private mixTimeAtAnchor = 0;
  private anchorAudioTime = 0;
  private lastTickT = 0;
  private raf = 0;
  private listeners = new Set<() => void>();
  private seekListeners = new Set<() => void>();
  /** Last pitch written per deck — engine writes only on real change. */
  private lastPitch: Partial<Record<RoutineDeck, number>> = {};
  /** Last load requested per deck (one request per target — the engine
   * snapshot lags the async fetch; the Conductor's idiom). */
  private loadRequested: Partial<Record<RoutineDeck, number>> = {};

  constructor(audio: RoutinePlayerAudio) {
    this.mixer = audio.mixer;
    this.engines = audio.engines;
    this.audible = audio.audible ?? (() => true);
    this.loadTrack = audio.loadTrack ?? null;
  }

  /** Swap the conducted Routine (open, tempo re-build, re-promotion).
   * Resets the transport to the span start. */
  setRoutine(routine: PlannedRoutine | null): void {
    this.pause();
    this.routine = routine;
    this.mixTimeAtAnchor = 0;
    this.lastTickT = 0;
    this.lastPitch = {};
    this.loadRequested = {};
    this.emit();
  }

  getRoutine(): PlannedRoutine | null {
    return this.routine;
  }

  /** Swap the conducted Routine IN PLACE (the MixPlayer setMix idiom):
   * live edits — lane drags, jump edits, re-builds of the same artifact —
   * must not reset the transport or pause a running audition. Lane
   * values apply on the next tick; structural trace moves land through
   * the drift check / jump scoping. */
  updateRoutine(routine: PlannedRoutine): void {
    this.routine = routine;
    const dur = this.getMixDuration();
    if (!this.playing && this.mixTimeAtAnchor > dur) this.mixTimeAtAnchor = dur;
    this.emit();
  }

  /** The decks this routine drives (allocated slots' decks, deduped —
   * reuse means fewer decks than slots). */
  drivenDecks(): RoutineDeck[] {
    const decks = new Set<RoutineDeck>();
    for (const s of this.routine?.slots ?? []) {
      if (s.deck !== null && this.engines[s.deck]) decks.add(s.deck);
    }
    return [...decks];
  }

  /** All allocated slots (label/marker consumers). */
  drivenSlots(): PlannedRoutineSlot[] {
    return (this.routine?.slots ?? []).filter((s) => s.deck !== null);
  }

  private engine(deck: RoutineDeck): DeckEngine | undefined {
    return this.engines[deck];
  }

  private occupantAt(deck: RoutineDeck, t: number): PlannedRoutineSlot | null {
    return this.routine ? slotOccupyingDeckAt(this.routine, deck, t) : null;
  }

  /** Slot state with the lead-in extension (gh#190 item 5): before the
   * window a slot that is rolling at the window open (slot 0 — the entry
   * boundary) rolls BACKWARD from its opening state at its own rate;
   * a pre-track-start position parks at 0 (the silent-lead rule). Past
   * the window end routineSlotStateAt already extrapolates (the exit
   * slot's trailing motion is forced by the build). */
  private slotStateAt(slot: PlannedRoutineSlot, t: number) {
    const r = this.routine!;
    if (t >= r.mixStartSec) return routineSlotStateAt(r, slot, t);
    // Sample just inside the window: AT the boundary the trace's first
    // point reads as parked (traceStateAt's beat <= first-point rule).
    const s0 = routineSlotStateAt(r, slot, r.mixStartSec + 1e-3);
    if (!s0.playing) return s0;
    const rate = 1 + s0.pitchPercent / 100;
    const pos = s0.trackTime + (t - r.mixStartSec) * rate;
    if (pos < 0) return { trackTime: 0, playing: false, pitchPercent: s0.pitchPercent };
    return { trackTime: pos, playing: true, pitchPercent: s0.pitchPercent };
  }

  /** Every driven deck holds its CURRENT occupant's track, decoded. */
  ready(): boolean {
    if (!this.routine) return false;
    const t = this.getMixTime();
    const decks = this.drivenDecks();
    if (decks.length === 0) return false;
    for (const deck of decks) {
      const occupant = this.occupantAt(deck, t);
      if (!occupant) continue;
      const engine = this.engine(deck);
      if (!engine) return false;
      const snap = engine.getSnapshot();
      if (snap.loadState !== 'ready' || snap.trackId !== occupant.trackId) return false;
    }
    return true;
  }

  /** The current occupants' (deck, trackId) targets — the shell's arm
   * issues these loads before the first play. */
  currentTargets(): { deck: RoutineDeck; trackId: number }[] {
    const t = this.getMixTime();
    return this.drivenDecks().flatMap((deck) => {
      const occupant = this.occupantAt(deck, t);
      return occupant ? [{ deck, trackId: occupant.trackId }] : [];
    });
  }

  // ── Transport ────────────────────────────────────────────────────────

  getMixTime(): number {
    if (!this.playing) return this.mixTimeAtAnchor;
    return this.mixTimeAtAnchor + (this.mixer.now() - this.anchorAudioTime);
  }

  getMixDuration(): number {
    return this.routine ? this.routine.mixEndSec - this.routine.mixStartSec : 0;
  }

  /** The audition margin in mix seconds (gh#190 item 5). */
  getMarginSec(): number {
    return this.routine ? AUDITION_MARGIN_BEATS * this.routine.secPerBeat : 0;
  }

  /** Current position on the Routine clock, in beats. */
  getBeat(): number {
    if (!this.routine) return 0;
    return (this.getMixTime() - this.routine.mixStartSec) / this.routine.secPerBeat;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  play(): void {
    if (!this.audible() || !this.ready() || this.playing || !this.routine) return;
    this.playing = true;
    this.anchorAudioTime = this.mixer.now();
    this.lastTickT = this.getMixTime();
    this.lastPitch = {};
    this.syncDecks(this.getMixTime(), true);
    this.applyLanes(this.getMixTime());
    this.raf = requestAnimationFrame(this.tick);
    this.emit();
  }

  /** Arbiter silence path — never gated on audible() (a displaced editor
   * must still pause its own decks). */
  pause(): void {
    if (!this.playing) return;
    this.mixTimeAtAnchor = this.getMixTime();
    this.playing = false;
    cancelAnimationFrame(this.raf);
    for (const deck of this.drivenDecks()) this.engine(deck)?.pause();
    this.emit();
  }

  /** Takeover stand-down (gh#186): stop conducting WITHOUT touching the
   * decks — they keep sounding as they are (the Conductor's takeover
   * contract, via auditionTakeover). */
  standDown(): void {
    if (!this.playing) return;
    this.mixTimeAtAnchor = this.getMixTime();
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.emit();
  }

  seek(mixTime: number): void {
    // The seekable range extends one margin beyond either boundary
    // (gh#190 item 5 — audition context around the window).
    const margin = this.getMarginSec();
    const t = Math.max(-margin, Math.min(mixTime, this.getMixDuration() + margin));
    this.mixTimeAtAnchor = t;
    this.lastTickT = t;
    this.anchorAudioTime = this.mixer.now();
    if (this.playing) {
      this.syncDecks(t, true);
      this.applyLanes(t);
    } else if (this.audible() && this.routine) {
      // Park deck playheads on the recorded positions — only while the
      // editor owns the Decks (a silent editor's scrub must not yank
      // Decks another surface is sounding).
      this.applyLanes(t);
      for (const deck of this.drivenDecks()) {
        const engine = this.engine(deck);
        const occupant = this.occupantAt(deck, t);
        if (!engine || !occupant) continue;
        if (!this.deckHoldsOccupant(engine, deck, occupant)) continue;
        const state = this.slotStateAt(occupant, t);
        engine.seek(Math.max(0, state.trackTime));
      }
    }
    for (const l of this.seekListeners) l();
    this.emit();
  }

  subscribeSeek(listener: () => void): () => void {
    this.seekListeners.add(listener);
    return () => this.seekListeners.delete(listener);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.listeners.clear();
    this.seekListeners.clear();
  }

  // ── Internals ────────────────────────────────────────────────────────

  private tick = () => {
    if (!this.playing) return;
    if (!this.audible()) {
      // Displacement backstop (MixPlayer's rule): losing the claim
      // mid-audition stops this conductor.
      this.pause();
      return;
    }
    const t = this.getMixTime();
    if (t >= this.getMixDuration() + this.getMarginSec()) {
      this.pause();
      return;
    }
    this.syncDecks(t, false);
    this.applyLanes(t);
    this.lastTickT = t;
    this.raf = requestAnimationFrame(this.tick);
  };

  /** The deck holds this occupant's track, decoded — issuing the load
   * through the hook when it doesn't (occupant changed at a reuse
   * boundary). One request per target. */
  private deckHoldsOccupant(
    engine: DeckEngine,
    deck: RoutineDeck,
    occupant: PlannedRoutineSlot
  ): boolean {
    const snap = engine.getSnapshot();
    if (snap.trackId === occupant.trackId) return snap.loadState === 'ready';
    if (this.loadTrack && this.loadRequested[deck] !== occupant.trackId) {
      this.loadRequested[deck] = occupant.trackId;
      this.loadTrack(deck, occupant.trackId);
    }
    return false;
  }

  private syncDecks(t: number, hard: boolean): void {
    if (!this.routine) return;
    for (const deck of this.drivenDecks()) {
      const engine = this.engine(deck);
      const occupant = this.occupantAt(deck, t);
      if (!engine || !occupant) continue;
      if (!this.deckHoldsOccupant(engine, deck, occupant)) {
        // Wrong/loading track (a reuse boundary in flight): keep the deck
        // silent rather than sounding the outgoing occupant's audio.
        if (engine.getSnapshot().playing) engine.pause();
        continue;
      }
      const state = this.slotStateAt(occupant, t);
      // Recorded discontinuity crossed since the last tick → hard-sync
      // THIS deck only (#161 per-deck jump scoping), and only within the
      // occupant's own tenure.
      const jumped =
        !hard &&
        occupant.jumpMixSecs.some((j) => j > this.lastTickT && j <= t);
      this.syncDeck(engine, deck, state.playing, state.trackTime, state.pitchPercent, hard || jumped);
    }
  }

  private syncDeck(
    engine: DeckEngine,
    deck: RoutineDeck,
    shouldPlay: boolean,
    trackTime: number,
    pitchPercent: number,
    hard: boolean
  ): void {
    const last = this.lastPitch[deck];
    if (last === undefined || Math.abs(last - pitchPercent) > PITCH_EPS) {
      engine.setPitch(pitchPercent);
      this.lastPitch[deck] = pitchPercent;
    }
    const snap = engine.getSnapshot();
    if (!shouldPlay) {
      if (snap.playing) engine.pause();
      // Park at the recorded position (a paused slot's playhead is still
      // the recording's truth — e.g. a silent lead sits at 0).
      if (hard || Math.abs(engine.getPlayhead() - trackTime) > DRIFT_TOLERANCE_S) {
        engine.seek(trackTime);
      }
      return;
    }
    if (!snap.playing) {
      engine.seek(trackTime);
      engine.play();
      return;
    }
    const drift = engine.getPlayhead() - trackTime;
    if (hard || Math.abs(drift) > DRIFT_TOLERANCE_S) {
      engine.seek(trackTime);
    }
  }

  /** Recorded slot lanes through the Mixer's automation overlay (ADR
   * 0022) — base mixer state never touched; dropped while not audible.
   * Occupancy-aware: the deck's lanes are its occupant's. */
  private applyLanes(t: number): void {
    if (!this.audible() || !this.routine) return;
    const beat = (t - this.routine.mixStartSec) / this.routine.secPerBeat;
    for (const deck of this.drivenDecks()) {
      const occupant = this.occupantAt(deck, t);
      if (!occupant) continue;
      const lanes = slotLanesAt(occupant, beat);
      this.mixer.setAutomation(deck, {
        fader: lanes.fader,
        eq: lanes.eq,
        filter: lanes.filter,
        // Channel trim (gh#190): the RECORDED trim lane + the slot
        // knob's offset (slotLanesAt folds both) — deterministic replay,
        // never the live user trim.
        trim: lanes.trim,
      });
    }
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
