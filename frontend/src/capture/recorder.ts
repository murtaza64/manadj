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
import type { ChannelState } from '../playback/mixer';
import { audibleHolder, subscribeAudible } from '../playback/audibleSurface';
import { initialCaptureState, reduceCapture } from './detector';
import type { CaptureState } from './detector';
import type { CaptureChannel, CaptureControlId, CaptureEvent, DetectedTake } from './events';

const TICK_MS = 1000;

/** What the recorder reads from the Mixer. */
export interface CaptureMixerSource {
  getChannelState(channel: CaptureChannel): ChannelState;
  getCrossfader(): number;
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
  private lastChannel: Record<CaptureChannel, ChannelState>;
  private lastCrossfader: number;
  private lastCrossfaderEnabled: boolean;
  private lastMaster: number;
  private lastDeck: Record<CaptureChannel, DeckSnapshot>;

  private readonly mixer: CaptureMixerSource;
  private readonly engines: Record<CaptureChannel, CaptureDeckSource>;
  private readonly onTake: (take: DetectedTake) => void;

  constructor(
    mixer: CaptureMixerSource,
    engines: Record<CaptureChannel, CaptureDeckSource>,
    onTake: (take: DetectedTake) => void
  ) {
    this.mixer = mixer;
    this.engines = engines;
    this.onTake = onTake;
    this.lastChannel = { A: mixer.getChannelState('A'), B: mixer.getChannelState('B') };
    this.lastCrossfader = mixer.getCrossfader();
    this.lastCrossfaderEnabled = mixer.getCrossfaderEnabled();
    this.lastMaster = mixer.getMaster();
    this.lastDeck = { A: engines.A.getSnapshot(), B: engines.B.getSnapshot() };
  }

  start(): void {
    this.gated = audibleHolder() !== 'shared';
    this.unsubs.push(subscribeAudible((holder) => this.setGated(holder !== 'shared')));
    this.unsubs.push(this.mixer.subscribe(() => this.diffMixer()));
    for (const ch of ['A', 'B'] as CaptureChannel[]) {
      this.unsubs.push(this.engines[ch].subscribe(() => this.diffDeck(ch)));
      this.engines[ch].setTransportEventHandler((e) =>
        this.feed({ t: this.now(), kind: 'transport', channel: ch, ...e })
      );
    }
    if (!this.gated) this.seed();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  /** Audibility flip (ADR 0022). Gaining the gate discards the in-flight
   * engagement; losing it re-seeds the detector from current reality. */
  private setGated(gated: boolean): void {
    if (gated === this.gated) return;
    this.gated = gated;
    if (gated) {
      this.state = initialCaptureState();
    } else {
      this.seed();
    }
  }

  /**
   * Feed the detector the current reality: control positions, loaded
   * tracks, and running transports. Runs at start (boot restore may have
   * loaded tracks before the recorder existed) and on regaining
   * audibility (everything that moved while gated was dropped).
   */
  private seed(): void {
    const t = this.now();
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

  private diffDeck(ch: CaptureChannel): void {
    const t = this.now();
    const prev = this.lastDeck[ch];
    const cur = this.engines[ch].getSnapshot();
    if (cur === prev) return;
    this.lastDeck[ch] = cur;
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
  }
}
