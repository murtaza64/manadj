/**
 * PROTOTYPE (mix-editor) — throwaway. Delete or absorb after the verdict.
 *
 * Deterministic playback of a two-track ProtoMix on two DeckEngines fed into
 * the editor's own private Mixer (ADR 0009 one-graph architecture — a single
 * AudioContext, real channel strips, master bus + limiter; audio-isolated
 * from the shared decks by being a separate Mixer instance). Wall-clock mix
 * timeline, drift correction by re-seek only when off by > 120ms.
 */

import { DeckEngine } from '../playback/DeckEngine';
import { Mixer } from '../playback/mixer';
import { api } from '../api/client';
import type { ProtoMix } from './mixProtoModel';
import { arrangementAt, laneValuesAt, tempoMatchPitch } from './mixProtoModel';

const DRIFT_TOLERANCE_S = 0.12;

/** Diagnosis logging (?protoperf): every corrective action is an audible
 * artifact suspect — log which deck, why, and the numbers. Remove with the
 * other protoperf instrumentation. */
const DEBUG = new URLSearchParams(window.location.search).has('protoperf');

export interface MixProtoTrackInfo {
  id: number;
  bpm: number | null;
}

export class MixProtoPlayer {
  /** Editor-private mixer: own context/master/limiter (audio isolation). */
  readonly mixer = new Mixer();
  readonly engineA = new DeckEngine(this.mixer.portFor('A'));
  readonly engineB = new DeckEngine(this.mixer.portFor('B'));

  private mix: ProtoMix;
  private durations = { a: 0, b: 0 };
  private bpm: { a: number | null; b: number | null } = { a: null, b: null };

  private playing = false;
  private mixTimeAtAnchor = 0;
  private anchorWallMs = 0;
  private raf = 0;
  private listeners = new Set<() => void>();

  constructor(mix: ProtoMix) {
    this.mix = mix;
  }

  // ── Loading ──────────────────────────────────────────────────────────

  async loadTrack(deck: 'A' | 'B', info: MixProtoTrackInfo): Promise<void> {
    const engine = deck === 'A' ? this.engineA : this.engineB;
    this.bpm[deck === 'A' ? 'a' : 'b'] = info.bpm;
    await engine.load({
      trackId: info.id,
      audioUrl: api.tracks.audioUrl(info.id),
      bpm: info.bpm,
    });
    const snap = engine.getSnapshot();
    this.durations[deck === 'A' ? 'a' : 'b'] = snap.duration;
    this.emit();
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
  setMix(mix: ProtoMix): void {
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
    return this.mixTimeAtAnchor + (performance.now() - this.anchorWallMs) / 1000;
  }

  getMixDuration(): number {
    return arrangementAt(this.mix, 0, this.durations, this.getRateB()).mixDuration;
  }

  getTrackTime(deck: 'A' | 'B'): number {
    const arr = arrangementAt(this.mix, this.getMixTime(), this.durations, this.getRateB());
    return deck === 'A' ? Math.min(arr.aTrackTime, this.durations.a) : Math.max(0, Math.min(arr.bTrackTime, this.durations.b));
  }

  isPlaying(): boolean {
    return this.playing;
  }

  play(): void {
    if (!this.ready() || this.playing) return;
    this.playing = true;
    this.anchorWallMs = performance.now();
    this.applyPitch();
    // Apply lane values before audio starts so mid-transition playback
    // begins at the drawn gains, not the previous ones.
    this.applyLanes(this.getMixTime());
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
    this.anchorWallMs = performance.now();
    this.applyLanes(t);
    if (this.playing) {
      this.syncDecks(t, true);
    } else {
      // Park deck playheads so the waveforms show the seek target.
      const arr = arrangementAt(this.mix, t, this.durations, this.getRateB());
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

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.engineA.dispose();
    this.engineB.dispose();
    this.mixer.dispose();
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
    this.syncDecks(t, false);
    this.applyLanes(t);
    this.raf = requestAnimationFrame(this.tick);
  };

  /** Ensure each deck matches the arrangement at mix-time t. `hard` forces
   * exact re-positioning; otherwise re-seek only past the drift tolerance. */
  private syncDecks(t: number, hard: boolean): void {
    const arr = arrangementAt(this.mix, t, this.durations, this.getRateB());
    this.syncDeck('A', this.engineA, arr.aActive, arr.aTrackTime, hard);
    this.syncDeck('B', this.engineB, arr.bActive, arr.bTrackTime, hard);
  }

  private debugState(deck: 'A' | 'B', engine: DeckEngine): string {
    const snap = engine.getSnapshot();
    return (
      `deck=${deck} enginePlayhead=${engine.getPlayhead().toFixed(3)} ` +
      `pitch=${snap.pitchPercent} rateB=${this.getRateB().toFixed(4)} ` +
      `bpm=${this.bpm.a}/${this.bpm.b} dur=${this.durations.a.toFixed(1)}/${this.durations.b.toFixed(1)} ` +
      `loadState=${snap.loadState} playing=${snap.playing} pendingPlay=${snap.pendingPlay}`
    );
  }

  private syncDeck(
    deck: 'A' | 'B',
    engine: DeckEngine,
    active: boolean,
    trackTime: number,
    hard: boolean
  ): void {
    const snap = engine.getSnapshot();
    if (!active) {
      if (snap.playing) {
        if (DEBUG) console.log(`[protoperf] deactivate: ${this.debugState(deck, engine)}`);
        engine.pause();
      }
      return;
    }
    if (!snap.playing) {
      if (DEBUG) {
        console.log(
          `[protoperf] (re)start at ${trackTime.toFixed(3)}: ${this.debugState(deck, engine)}`
        );
      }
      engine.seek(trackTime);
      engine.play();
      return;
    }
    const drift = engine.getPlayhead() - trackTime;
    if (hard || Math.abs(drift) > DRIFT_TOLERANCE_S) {
      if (DEBUG && !hard) {
        console.log(
          `[protoperf] drift reseek ${drift.toFixed(3)}s → ${trackTime.toFixed(3)}: ` +
            this.debugState(deck, engine)
        );
      }
      engine.seek(trackTime);
    }
  }

  private applyLanes(t: number): void {
    const v = laneValuesAt(this.mix.transition, t);
    this.mixer.setFader('A', v.faderA);
    this.mixer.setFader('B', v.faderB);
    this.mixer.setEq('A', 'low', v.eqLowA);
    this.mixer.setEq('B', 'low', v.eqLowB);
    this.mixer.setEq('A', 'mid', v.eqMidA);
    this.mixer.setEq('B', 'mid', v.eqMidB);
    this.mixer.setEq('A', 'high', v.eqHighA);
    this.mixer.setEq('B', 'high', v.eqHighB);
    this.mixer.setFilter('A', v.filterA * 2 - 1);
    this.mixer.setFilter('B', v.filterB * 2 - 1);
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
