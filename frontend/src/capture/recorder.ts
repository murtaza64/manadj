/**
 * Capture recorder (transition-takes 02) — the always-on tap.
 *
 * Web Audio / store glue, untested by policy (the detector behind it is
 * the tested seam). Subscribes to the shared Mixer and both DeckEngines,
 * diffs their immutable snapshots into CaptureEvents, adds ~1 Hz ticks
 * (playhead samples + the detector's settlement clock), feeds everything
 * through the pure reducer, and hands settled Takes to `onTake`.
 *
 * Everything is fed unconditionally — including the pauses the arbiter
 * issues when another surface takes audibility. Entering the editor
 * mid-blend therefore looks like "session ended mid-blend" and can emit a
 * low-confidence Take: a known false-positive class, kept deliberately
 * (the history is the tuning ground — glossary, ADR 0020).
 */
import type { DeckEngine, DeckSnapshot } from '../playback/DeckEngine';
import type { ChannelState, Mixer } from '../playback/mixer';
import { initialCaptureState, reduceCapture } from './detector';
import type { CaptureState } from './detector';
import type { CaptureChannel, CaptureControlId, CaptureEvent, DetectedTake } from './events';

const TICK_MS = 1000;

export class CaptureRecorder {
  private state: CaptureState = initialCaptureState();
  private unsubs: (() => void)[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastChannel: Record<CaptureChannel, ChannelState>;
  private lastCrossfader: number;
  private lastCrossfaderEnabled: boolean;
  private lastMaster: number;
  private lastDeck: Record<CaptureChannel, DeckSnapshot>;

  private readonly mixer: Mixer;
  private readonly engines: Record<CaptureChannel, DeckEngine>;
  private readonly onTake: (take: DetectedTake) => void;

  constructor(
    mixer: Mixer,
    engines: Record<CaptureChannel, DeckEngine>,
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
    this.unsubs.push(this.mixer.subscribe(() => this.diffMixer()));
    for (const ch of ['A', 'B'] as CaptureChannel[]) {
      this.unsubs.push(this.engines[ch].subscribe(() => this.diffDeck(ch)));
      this.engines[ch].setTransportEventHandler((e) =>
        this.feed({ t: this.now(), kind: 'transport', channel: ch, ...e })
      );
      // Seed the detector with the current reality (boot restore may have
      // loaded tracks before the recorder existed).
      const snap = this.lastDeck[ch];
      if (snap.trackId !== null) {
        this.feed({ t: this.now(), kind: 'load', channel: ch, trackId: snap.trackId, bpm: snap.bpm });
      }
      if (snap.playing) {
        this.feed({ t: this.now(), kind: 'transport', channel: ch, action: 'play', playhead: 0 });
      }
    }
    this.timer = setInterval(() => this.tick(), TICK_MS);
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
    const [next, takes] = reduceCapture(this.state, e);
    this.state = next;
    for (const take of takes) this.onTake(take);
  }

  private tick(): void {
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
