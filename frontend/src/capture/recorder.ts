/**
 * Capture recorder (transition-takes 02) — the always-on tap.
 *
 * Subscribes to the shared Mixer and both DeckEngines, diffs their
 * immutable snapshots into CaptureEvents, adds ~1 Hz ticks (playhead
 * samples + the detector's settlement clock), feeds everything through
 * the pure reducer, and hands settled Takes to `onTake`.
 *
 * Gated on audibility (ADR 0022, editor-shared-decks 03): a Take is
 * performance evidence — playback while the SHARED surface is audible
 * (glossary). The Transition editor now conducts these same Decks and
 * Mixer, and its auditions (drift-sync seeks, lane crossfades) look
 * exactly like performed Handovers. While a non-shared surface holds
 * audibility the recorder drops events early (at feed, not at the sink)
 * and DISCARDS any in-flight engagement — a half-detected Handover
 * interrupted by entering the editor is not a performance. On regaining
 * audibility it re-seeds the detector from current reality.
 *
 * The sources are narrow read interfaces (the true seam, ADR 0002): the
 * real Mixer/DeckEngine satisfy them structurally, and tests drive the
 * gate with scripted fakes plus the real detector.
 */
import type { DeckSnapshot } from '../playback/DeckEngine';
import { CHANNEL_IDS } from '../playback/mixer';
import type { ChannelId, ChannelState } from '../playback/mixer';
import type { CrossfaderAssignment } from '../playback/crossfaderAssignmentStore';
import { channelCrossfaderGain, channelFaderToGain, trimToGain } from '../playback/mixerMath';
import { audibleHolder, subscribeAudible } from '../playback/audibleSurface';
import { initialCaptureState, reduceCapture } from './detector';
import type { CaptureState } from './detector';
import { DEFAULT_DETECTOR_PARAMS } from './events';
import type { CaptureChannel, CaptureControlId, CaptureEvent, DetectedTake } from './events';

const TICK_MS = 1000;

/** What the recorder reads from the Mixer. */
export interface CaptureMixerSource {
  getChannelState(channel: ChannelId): ChannelState;
  getCrossfader(): number;
  getCrossfaderAssignment(channel: ChannelId): CrossfaderAssignment;
  getCrossfaderEnabled(): boolean;
  getMaster(): number;
  subscribe(listener: () => void): () => void;
}

/** What the recorder reads from a Deck's engine. */
export interface CaptureDeckSource {
  getSnapshot(): DeckSnapshot;
  getPlayhead(): number;
  subscribe(listener: () => void): () => void;
  setTransportEventHandler(
    handler:
      | ((e: { action: 'seek' | 'jumpBeats' | 'hotCue'; playhead: number; detail?: number }) => void)
      | null
  ): void;
}

export class CaptureRecorder {
  private state: CaptureState = initialCaptureState();
  private unsubs: (() => void)[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  /** True while a non-shared surface holds audibility: drop everything. */
  private gated = false;
  private surfaceGated = false;
  private multiDeckGated = false;
  private lastChannel: Record<CaptureChannel, ChannelState>;
  private lastCrossfader: number;
  private lastCrossfaderEnabled: boolean;
  private lastMaster: number;
  private lastDeck: Record<ChannelId, DeckSnapshot>;

  private readonly mixer: CaptureMixerSource;
  private readonly engines: Record<ChannelId, CaptureDeckSource>;
  private readonly onTake: (take: DetectedTake) => void;

  constructor(
    mixer: CaptureMixerSource,
    engines: Record<ChannelId, CaptureDeckSource>,
    onTake: (take: DetectedTake) => void
  ) {
    this.mixer = mixer;
    this.engines = engines;
    this.onTake = onTake;
    this.lastChannel = { A: mixer.getChannelState('A'), B: mixer.getChannelState('B') };
    this.lastCrossfader = mixer.getCrossfader();
    this.lastCrossfaderEnabled = mixer.getCrossfaderEnabled();
    this.lastMaster = mixer.getMaster();
    this.lastDeck = {
      A: engines.A.getSnapshot(),
      B: engines.B.getSnapshot(),
      C: engines.C.getSnapshot(),
      D: engines.D.getSnapshot(),
    };
  }

  start(): void {
    this.surfaceGated = audibleHolder() !== 'shared';
    this.multiDeckGated = this.tooManyAudibleDecks();
    this.gated = this.surfaceGated || this.multiDeckGated;
    this.unsubs.push(subscribeAudible((holder) => this.setSurfaceGated(holder !== 'shared')));
    this.unsubs.push(this.mixer.subscribe(() => this.diffMixer()));
    for (const ch of CHANNEL_IDS) {
      this.unsubs.push(this.engines[ch].subscribe(() => this.diffDeck(ch)));
    }
    for (const ch of ['A', 'B'] as CaptureChannel[]) {
      this.engines[ch].setTransportEventHandler((e) =>
        this.feed({ t: this.now(), kind: 'transport', channel: ch, ...e })
      );
    }
    if (!this.gated) this.seed();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  /** Audibility flip (ADR 0022). Gaining the gate discards the in-flight
   * engagement; losing it re-seeds the detector from current reality. */
  private setSurfaceGated(gated: boolean): void {
    this.surfaceGated = gated;
    this.applyGate();
  }

  private updateMultiDeckGate(): void {
    this.multiDeckGated = this.tooManyAudibleDecks();
    this.applyGate();
  }

  private applyGate(): void {
    const gated = this.surfaceGated || this.multiDeckGated;
    if (gated === this.gated) return;
    this.gated = gated;
    if (gated) {
      this.state = initialCaptureState();
    } else {
      this.seed();
    }
  }

  /** Phase-1 safety: the detector remains the existing A/B pair machine.
   * A third Master-audible Deck discards and suspends the engagement until
   * multi-Deck pair machines land in issue 10. */
  private tooManyAudibleDecks(): boolean {
    return CHANNEL_IDS.filter((deck) => this.deckAudible(deck)).length > 2;
  }

  private deckAudible(deck: ChannelId): boolean {
    if (!this.engines[deck].getSnapshot().playing) return false;
    const state = this.mixer.getChannelState(deck);
    const { audibleGain, eqKillBelow, filterKillBeyond } = DEFAULT_DETECTOR_PARAMS;
    if (
      state.eq.low <= eqKillBelow &&
      state.eq.mid <= eqKillBelow &&
      state.eq.high <= eqKillBelow
    ) {
      return false;
    }
    if (Math.abs(state.filter) >= filterKillBeyond) return false;
    const xfGain = channelCrossfaderGain(
      this.mixer.getCrossfaderAssignment(deck),
      this.mixer.getCrossfaderEnabled() ? this.mixer.getCrossfader() : 0
    );
    return trimToGain(state.trim) * channelFaderToGain(state.fader) * xfGain >= audibleGain;
  }

  /**
   * Feed the detector the current reality: control positions, loaded
   * tracks, and running transports. Runs at start (boot restore may have
   * loaded tracks before the recorder existed) and on regaining
   * audibility (everything that moved while gated was dropped).
   */
  private seed(): void {
    const t = this.now();
    for (const ch of CHANNEL_IDS) this.lastDeck[ch] = this.engines[ch].getSnapshot();
    for (const ch of ['A', 'B'] as CaptureChannel[]) {
      const c = this.mixer.getChannelState(ch);
      for (const [control, read] of CaptureRecorder.CHANNEL_CONTROLS) {
        this.feed({ t, kind: 'control', control, channel: ch, value: read(c) });
      }
    }
    this.feed({ t, kind: 'control', control: 'crossfader', channel: null, value: this.mixer.getCrossfader() });
    this.feed({
      t,
      kind: 'control',
      control: 'crossfaderEnabled',
      channel: null,
      value: this.mixer.getCrossfaderEnabled() ? 1 : 0,
    });
    this.feed({ t, kind: 'control', control: 'master', channel: null, value: this.mixer.getMaster() });
    for (const ch of ['A', 'B'] as CaptureChannel[]) {
      const snap = this.engines[ch].getSnapshot();
      this.lastDeck[ch] = snap;
      this.lastChannel[ch] = this.mixer.getChannelState(ch);
      if (snap.trackId !== null) {
        this.feed({ t, kind: 'load', channel: ch, trackId: snap.trackId, bpm: snap.bpm });
      }
      if (snap.playing) {
        this.feed({ t, kind: 'transport', channel: ch, action: 'play', playhead: this.engines[ch].getPlayhead() });
      }
    }
    this.lastCrossfader = this.mixer.getCrossfader();
    this.lastCrossfaderEnabled = this.mixer.getCrossfaderEnabled();
    this.lastMaster = this.mixer.getMaster();
  }

  dispose(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    for (const ch of ['A', 'B'] as CaptureChannel[]) {
      this.engines[ch].setTransportEventHandler(null);
    }
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** Monotonic capture clock, seconds. NOT the audio clock — that freezes
   * while the surface is displaced. */
  private now(): number {
    return performance.now() / 1000;
  }

  private feed(e: CaptureEvent): void {
    if (this.gated) return; // drop early, not at the sink (ADR 0022)
    const [next, takes] = reduceCapture(this.state, e);
    this.state = next;
    for (const take of takes) this.onTake(take);
  }

  private tick(): void {
    if (this.gated) return;
    const playheads: Partial<Record<CaptureChannel, number>> = {};
    for (const ch of ['A', 'B'] as CaptureChannel[]) {
      if (this.lastDeck[ch].playing) playheads[ch] = this.engines[ch].getPlayhead();
    }
    this.feed({ t: this.now(), kind: 'tick', playheads });
  }

  /** Per-channel controls, table-driven: [control id, value reader]. */
  private static readonly CHANNEL_CONTROLS: [
    Exclude<CaptureControlId, 'crossfader' | 'crossfaderEnabled' | 'master'>,
    (c: ChannelState) => number,
  ][] = [
    ['fader', (c) => c.fader],
    ['trim', (c) => c.trim],
    ['eqLow', (c) => c.eq.low],
    ['eqMid', (c) => c.eq.mid],
    ['eqHigh', (c) => c.eq.high],
    ['filter', (c) => c.filter],
    ['pfl', (c) => (c.pfl ? 1 : 0)],
  ];

  private diffMixer(): void {
    this.updateMultiDeckGate();
    const t = this.now();
    for (const ch of ['A', 'B'] as CaptureChannel[]) {
      const prev = this.lastChannel[ch];
      const cur = this.mixer.getChannelState(ch);
      if (cur === prev) continue;
      this.lastChannel[ch] = cur;
      for (const [control, read] of CaptureRecorder.CHANNEL_CONTROLS) {
        const value = read(cur);
        if (value !== read(prev)) this.feed({ t, kind: 'control', control, channel: ch, value });
      }
    }
    const xf = this.mixer.getCrossfader();
    if (xf !== this.lastCrossfader) {
      this.lastCrossfader = xf;
      this.feed({ t, kind: 'control', control: 'crossfader', channel: null, value: xf });
    }
    const xfOn = this.mixer.getCrossfaderEnabled();
    if (xfOn !== this.lastCrossfaderEnabled) {
      this.lastCrossfaderEnabled = xfOn;
      this.feed({ t, kind: 'control', control: 'crossfaderEnabled', channel: null, value: xfOn ? 1 : 0 });
    }
    const master = this.mixer.getMaster();
    if (master !== this.lastMaster) {
      this.lastMaster = master;
      this.feed({ t, kind: 'control', control: 'master', channel: null, value: master });
    }
  }

  private diffDeck(ch: ChannelId): void {
    const t = this.now();
    const prev = this.lastDeck[ch];
    const cur = this.engines[ch].getSnapshot();
    if (cur === prev) return;
    this.lastDeck[ch] = cur;
    this.updateMultiDeckGate();
    if (ch !== 'A' && ch !== 'B') return;
    if (cur.trackId !== prev.trackId) {
      this.feed({ t, kind: 'load', channel: ch, trackId: cur.trackId, bpm: cur.bpm });
    }
    if (cur.playing !== prev.playing) {
      this.feed({
        t,
        kind: 'transport',
        channel: ch,
        action: cur.playing ? 'play' : 'pause',
        playhead: this.engines[ch].getPlayhead(),
      });
    }
    if (cur.pitchPercent !== prev.pitchPercent) {
      this.feed({ t, kind: 'pitch', channel: ch, value: cur.pitchPercent });
    }
    if (cur.bendPercent !== prev.bendPercent) {
      this.feed({ t, kind: 'bend', channel: ch, value: cur.bendPercent });
    }
    if (cur.loop !== prev.loop) {
      // Loop engage/resize/translate/release (looping 06): the wraps
      // themselves are inaudible to snapshot diffs — vectorization derives
      // them from the region + rate.
      this.feed({
        t,
        kind: 'loop',
        channel: ch,
        playhead: this.engines[ch].getPlayhead(),
        region: cur.loop ? { start: cur.loop.start, end: cur.loop.end } : null,
      });
    }
  }
}
