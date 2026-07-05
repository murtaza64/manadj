/**
 * MixPlayer — the Transition editor's deterministic CONDUCTOR.
 *
 * Plays a two-track EditorMix over the SHARED Decks and Mixer (ADR 0022):
 * the two injected DeckEngines are the app's Decks, and lane values drive
 * the shared Mixer's automation overlay — user-facing mixer state is
 * never touched. MixPlayer owns no audio; the borrow lifecycle (claim
 * audibility, engage the overlay, checkpoint deck pitches) belongs to
 * TransitionEditor's mount effects.
 *
 * The mix timeline runs on the Mixer's AUDIO clock (issue 08): the decks'
 * playheads derive from the same ctx.currentTime, so mix time and deck time
 * cannot drift apart by construction. (The original wall-clock timeline
 * skewed against the audio clock — badly once a second context was alive —
 * and the drift corrector "fixed" the skew with audible re-seeks every few
 * hundred ms.) The corrector remains as a rare safety net.
 */

import type { DeckEngine } from '../playback/DeckEngine';
import type { Mixer } from '../playback/mixer';
import type { EditorMix } from './mixModel';
import {
  arrangementAt,
  jumpInstantSec,
  laneValuesAt,
  tempoMatchPitch,
} from './mixModel';

const DRIFT_TOLERANCE_S = 0.12;

export interface MixPlayerAudio {
  mixer: Mixer;
  engineA: DeckEngine;
  engineB: DeckEngine;
}

export class MixPlayer {
  /** Injected machinery (see header). Public: the editor's UI reads deck
   * snapshots and subscribes through these. */
  readonly mixer: Mixer;
  readonly engineA: DeckEngine;
  readonly engineB: DeckEngine;

  private mix: EditorMix;
  private bpm: { a: number | null; b: number | null } = { a: null, b: null };

  /** Deck mutes override the drawn fader lanes (applyLanes runs per tick,
   * so a plain one-shot fader write would be overwritten next frame). */
  private muted = { A: false, B: false };

  private playing = false;
  /** Previous tick's mix time — jump-crossing detection (see tick). */
  private lastTickT = 0;
  private mixTimeAtAnchor = 0;
  /** Audio-clock time (mixer.now()) at the anchor — NOT wall time. */
  private anchorAudioTime = 0;
  private raf = 0;
  private listeners = new Set<() => void>();

  // Routing/surface registration lives in TransitionEditor's mount
  // effects, NOT here (headphone-cue 06 follow-up): StrictMode
  // double-invokes state initializers (a zombie MixPlayer would stay
  // registered forever) and fires a spurious dispose on the kept instance
  // (constructor-paired unregistration would orphan it). Effects pair
  // setup/cleanup correctly.

  constructor(mix: EditorMix, audio: MixPlayerAudio) {
    this.mix = mix;
    this.mixer = audio.mixer;
    this.engineA = audio.engineA;
    this.engineB = audio.engineB;
  }

  // ── Deck state reads ─────────────────────────────────────────────────
  // Loading is NOT the conductor's job (ADR 0022): the editor Loads the
  // shared Decks through the deck provider's one load path; the conductor
  // reads what it needs from the engines it drives.

  private durations(): { a: number; b: number } {
    return {
      a: this.engineA.getSnapshot().duration,
      b: this.engineB.getSnapshot().duration,
    };
  }

  ready(): boolean {
    return (
      this.engineA.getSnapshot().loadState === 'ready' &&
      this.engineB.getSnapshot().loadState === 'ready'
    );
  }

  /**
   * Live-updated from the editor on every model change (including ~60/sec
   * during lane drags). No hard re-sync here: lane values apply on the next
   * tick, and structural moves are caught by the tick's drift tolerance —
   * a hard sync would restart both sources on every drag event.
   */
  setMix(mix: EditorMix): void {
    this.mix = mix;
    this.applyPitch();
    if (this.playing) this.syncDecks(this.getMixTime(), false);
  }

  /** B's playback rate under the current tempo-match setting. */
  getRateB(): number {
    return this.mix.transition.tempoMatch
      ? 1 + tempoMatchPitch(this.bpm.a, this.bpm.b) / 100
      : 1;
  }

  /** Update a track's BPM after an edit (recomputes tempo match). */
  setBpm(deck: 'A' | 'B', bpm: number | null): void {
    this.bpm[deck === 'A' ? 'a' : 'b'] = bpm;
    this.applyPitch();
    if (this.playing) this.syncDecks(this.getMixTime(), true);
    this.emit();
  }

  // ── Transport ────────────────────────────────────────────────────────

  getMixTime(): number {
    if (!this.playing) return this.mixTimeAtAnchor;
    return this.mixTimeAtAnchor + (this.mixer.now() - this.anchorAudioTime);
  }

  getMixDuration(): number {
    return arrangementAt(this.mix, 0, this.durations(), this.getRateB()).mixDuration;
  }

  getTrackTime(deck: 'A' | 'B'): number {
    const d = this.durations();
    const arr = arrangementAt(this.mix, this.getMixTime(), d, this.getRateB());
    return deck === 'A' ? Math.min(arr.aTrackTime, d.a) : Math.max(0, Math.min(arr.bTrackTime, d.b));
  }

  isPlaying(): boolean {
    return this.playing;
  }

  isMuted(deck: 'A' | 'B'): boolean {
    return this.muted[deck];
  }

  setMuted(deck: 'A' | 'B', on: boolean): void {
    this.muted[deck] = on;
    this.applyLanes(this.getMixTime());
    this.emit();
  }

  play(): void {
    if (!this.ready() || this.playing) return;
    this.playing = true;
    this.anchorAudioTime = this.mixer.now();
    this.applyPitch();
    // Apply lane values before audio starts so mid-transition playback
    // begins at the drawn gains, not the previous ones.
    this.applyLanes(this.getMixTime());
    this.lastTickT = this.getMixTime();
    this.syncDecks(this.getMixTime(), true);
    this.raf = requestAnimationFrame(this.tick);
    this.emit();
  }

  pause(): void {
    if (!this.playing) return;
    this.mixTimeAtAnchor = this.getMixTime();
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.engineA.pause();
    this.engineB.pause();
    this.emit();
  }

  seek(mixTime: number): void {
    const t = Math.max(0, Math.min(mixTime, this.getMixDuration()));
    this.mixTimeAtAnchor = t;
    this.lastTickT = t;
    this.anchorAudioTime = this.mixer.now();
    this.applyLanes(t);
    if (this.playing) {
      this.syncDecks(t, true);
    } else {
      // Park deck playheads so the waveforms show the seek target.
      const arr = arrangementAt(this.mix, t, this.durations(), this.getRateB());
      if (arr.aActive) this.engineA.seek(arr.aTrackTime);
      if (arr.bActive || t >= this.mix.transition.startSec) this.engineB.seek(Math.max(0, arr.bTrackTime));
    }
    this.emit();
  }

  togglePlay(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Stop conducting. Does NOT dispose the injected machinery — the
   * owner's lifecycle does (it may outlive this conductor). */
  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.listeners.clear();
  }

  // ── Internals ────────────────────────────────────────────────────────

  private tick = () => {
    if (!this.playing) return;
    const t = this.getMixTime();
    if (t >= this.getMixDuration()) {
      this.pause();
      return;
    }
    // Jump events (transition-takes 01): crossing an instant makes B's
    // arrangement position discontinuous. The drift corrector would catch
    // deltas past its tolerance anyway; the explicit crossing check makes
    // sub-tolerance jumps land too, exactly one hard sync per crossing.
    const tr = this.mix.transition;
    const crossed = (tr.jumps ?? []).some((j) => {
      const tj = jumpInstantSec(tr, j);
      return tj > this.lastTickT && tj <= t;
    });
    this.lastTickT = t;
    this.syncDecks(t, crossed);
    this.applyLanes(t);
    this.raf = requestAnimationFrame(this.tick);
  };

  /** Ensure each deck matches the arrangement at mix-time t. `hard` forces
   * exact re-positioning; otherwise re-seek only past the drift tolerance. */
  private syncDecks(t: number, hard: boolean): void {
    const arr = arrangementAt(this.mix, t, this.durations(), this.getRateB());
    this.syncDeck(this.engineA, arr.aActive, arr.aTrackTime, hard);
    this.syncDeck(this.engineB, arr.bActive, arr.bTrackTime, hard);
  }

  private syncDeck(
    engine: DeckEngine,
    active: boolean,
    trackTime: number,
    hard: boolean
  ): void {
    const snap = engine.getSnapshot();
    if (!active) {
      if (snap.playing) engine.pause();
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

  /** Lane values go through the Mixer's automation overlay (ADR 0022):
   * base mixer state — what the user's knobs show — is never touched, and
   * the overlay must be engaged by the editor session before play. */
  private applyLanes(t: number): void {
    const v = laneValuesAt(this.mix.transition, t);
    this.mixer.setAutomation('A', {
      fader: this.muted.A ? 0 : v.faderA,
      eq: { low: v.eqLowA, mid: v.eqMidA, high: v.eqHighA },
      filter: v.filterA * 2 - 1,
    });
    this.mixer.setAutomation('B', {
      fader: this.muted.B ? 0 : v.faderB,
      eq: { low: v.eqLowB, mid: v.eqMidB, high: v.eqHighB },
      filter: v.filterB * 2 - 1,
    });
  }

  private applyPitch(): void {
    this.engineB.setPitch(
      this.mix.transition.tempoMatch ? tempoMatchPitch(this.bpm.a, this.bpm.b) : 0
    );
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
