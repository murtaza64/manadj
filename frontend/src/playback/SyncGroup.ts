import type { DeckEngine } from './DeckEngine';
import { audibleHolder, subscribeAudible } from './audibleSurface';
import { CHANNEL_IDS, type ChannelId } from './mixer';
import { isQuantizeOn } from './quantizeStore';
import {
  bpmMatch, effectiveBpm, nearestPlayingTempoReference, PITCH_RANGE_PERCENT,
  type BpmMatchResult,
} from './tempo';

export type SyncStatus = 'off' | 'synced' | 'out-of-lock' | 'waiting';
export interface SyncSnapshot {
  tempo: number | null;
  decks: Record<ChannelId, SyncStatus>;
}

/** Performer tempo policy; engine pitch remains the actuator for machine playback. */
export class SyncGroup {
  private tempo: number | null = null;
  private ratios = new Map<ChannelId, number>();
  private listeners = new Set<() => void>();
  private matchListeners = new Set<(deck: ChannelId) => void>();
  subscribeMatch = (listener: (deck: ChannelId) => void): (() => void) => {
    this.matchListeners.add(listener);
    return () => { this.matchListeners.delete(listener); };
  };
  private applying = false;
  private snapshot: SyncSnapshot = {
    tempo: null, decks: { A: 'off', B: 'off', C: 'off', D: 'off' },
  };

  private engines: Record<ChannelId, DeckEngine>;

  constructor(engines: Record<ChannelId, DeckEngine>) {
    this.engines = engines;
  }

  getSnapshot = (): SyncSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /** Reattach on effect mount: StrictMode disposal clears engine listeners. */
  start(): () => void {
    const stops = CHANNEL_IDS.map(deck => {
      let previous = this.engines[deck].getSnapshot();
      return this.engines[deck].subscribe(() => {
        const next = this.engines[deck].getSnapshot();
        const changed = next.bpm !== previous.bpm || next.trackId !== previous.trackId
          || next.loadState !== previous.loadState;
        previous = next;
        if (this.applying || !changed || !this.ratios.has(deck)) return;
        if (this.validBpm(next.bpm) && this.tempo !== null) {
          this.ratios.set(deck, this.ratioFor(next.bpm, this.tempo));
        }
        this.apply();
      });
    });
    const clearForMachine = () => {
      if (audibleHolder() === 'shared') return;
      this.ratios.clear();
      this.tempo = null;
      this.publish();
    };
    stops.push(subscribeAudible(clearForMachine));
    clearForMachine();
    return () => stops.forEach(stop => stop());
  }

  private validBpm(bpm: number | null): bpm is number {
    return bpm !== null && Number.isFinite(bpm) && bpm > 0;
  }

  private ratioFor(bpm: number, tempo: number): number {
    return [1, 2, 0.5].reduce((best, ratio) =>
      Math.abs(tempo * ratio / bpm - 1) < Math.abs(tempo * best / bpm - 1) ? ratio : best);
  }

  private reference(deck: ChannelId, groupedOnly = false) {
    const own = this.engines[deck].getSnapshot();
    const decks = Object.fromEntries(CHANNEL_IDS.map(id => {
      const s = this.engines[id].getSnapshot();
      return [id, {
        playing: s.loadState === 'ready' && s.playing && !s.scratching
          && (!groupedOnly || this.snapshot.decks[id] === 'synced'),
        bpm: this.validBpm(s.bpm) ? s.bpm : null,
        pitchPercent: s.pitchPercent,
      }];
    })) as Parameters<typeof nearestPlayingTempoReference>[2];
    return nearestPlayingTempoReference(deck, effectiveBpm(own.bpm ?? 0, own.pitchPercent), decks);
  }

  launchReference(deck: ChannelId) {
    const reference = this.reference(deck, this.ratios.has(deck));
    return reference ? this.engines[reference.deck].asLaunchReference() : null;
  }

  toggle(deck: ChannelId): BpmMatchResult | null {
    if (audibleHolder() !== 'shared') return null;
    if (this.ratios.delete(deck)) {
      if (!this.ratios.size) this.tempo = null;
      this.publish();
      return null;
    }
    const own = this.engines[deck].getSnapshot();
    if (own.loadState !== 'ready' || !this.validBpm(own.bpm)) return null;
    const reference = this.reference(deck, this.tempo !== null);
    const tempo = this.tempo ?? reference?.effectiveBpm ?? effectiveBpm(own.bpm, own.pitchPercent);
    const result = bpmMatch(own.bpm, tempo);
    if (result.kind !== 'match') return result;
    this.tempo = tempo;
    this.ratios.set(deck, this.ratioFor(own.bpm, tempo));
    this.apply();
    if (reference) this.snap(deck, reference.deck);
    return result;
  }

  setPitch(deck: ChannelId, percent: number): void {
    if (!Number.isFinite(percent)) return;
    const own = this.engines[deck].getSnapshot();
    if (own.loadState !== 'ready') return;
    const pitch = Math.max(-PITCH_RANGE_PERCENT, Math.min(PITCH_RANGE_PERCENT, percent));
    const ratio = this.ratios.get(deck);
    if (audibleHolder() !== 'shared' || ratio === undefined || !this.validBpm(own.bpm)) {
      this.engines[deck].setPitch(pitch);
      return;
    }
    this.tempo = effectiveBpm(own.bpm, pitch) / ratio;
    this.apply();
  }

  match(deck: ChannelId): BpmMatchResult | null {
    if (audibleHolder() !== 'shared') return null;
    const own = this.engines[deck].getSnapshot();
    if (own.loadState !== 'ready' || !this.validBpm(own.bpm)) return null;
    const reference = this.reference(deck);
    if (!reference) return null;
    const result = bpmMatch(own.bpm, reference.effectiveBpm);
    if (result.kind === 'match') {
      this.setPitch(deck, result.pitchPercent);
      this.snap(deck, reference.deck);
      this.matchListeners.forEach(listener => listener(deck));
    }
    return result;
  }

  private snap(deck: ChannelId, referenceDeck: ChannelId): void {
    if (!isQuantizeOn()) return;
    const reference = this.engines[referenceDeck].asLaunchReference();
    if (!reference) return;
    const own = this.engines[deck].getSnapshot();
    const peer = this.engines[referenceDeck].getSnapshot();
    if (!this.validBpm(own.bpm) || !this.validBpm(peer.bpm)) return;
    const ownRatio = this.ratios.get(deck);
    const peerRatio = this.ratios.get(referenceDeck);
    const ratio = ownRatio !== undefined && peerRatio !== undefined
      ? ownRatio / peerRatio
      : this.ratioFor(effectiveBpm(own.bpm, own.pitchPercent), effectiveBpm(peer.bpm, peer.pitchPercent));
    this.engines[deck].alignBeatPhase(reference, ratio);
  }

  private apply(): void {
    if (this.tempo === null || this.applying) return;
    this.applying = true;
    try {
      for (const [deck, ratio] of this.ratios) {
        const s = this.engines[deck].getSnapshot();
        if (s.loadState !== 'ready' || !this.validBpm(s.bpm)) continue;
        const pitch = (this.tempo * ratio / s.bpm - 1) * 100;
        this.engines[deck].setPitch(Math.max(-PITCH_RANGE_PERCENT, Math.min(PITCH_RANGE_PERCENT, pitch)));
      }
    } finally {
      this.applying = false;
    }
    this.publish();
  }

  private publish(): void {
    const decks = { A: 'off', B: 'off', C: 'off', D: 'off' } as Record<ChannelId, SyncStatus>;
    for (const [deck, ratio] of this.ratios) {
      const s = this.engines[deck].getSnapshot();
      decks[deck] = s.loadState !== 'ready' || !this.validBpm(s.bpm) ? 'waiting'
        : Math.abs((this.tempo! * ratio / s.bpm - 1) * 100) > PITCH_RANGE_PERCENT + 1e-6
          ? 'out-of-lock' : 'synced';
    }
    if (this.snapshot.tempo === this.tempo
      && CHANNEL_IDS.every(deck => this.snapshot.decks[deck] === decks[deck])) return;
    this.snapshot = { tempo: this.tempo, decks };
    for (const listener of this.listeners) listener();
  }
}
