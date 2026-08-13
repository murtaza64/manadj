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
import { audibleHolder, subscribeAudible } from '../playback/audibleSurface';
import type { AudibleSurfaceId } from '../playback/audibleSurface';
import { initialCaptureState, reduceCapture } from './detector';
import type { CaptureState } from './detector';
import type { CaptureControlId, CaptureEvent, DetectedTake } from './events';

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
  /** True while a non-shared surface (a machine) holds audibility. The
   * machine's own events are suppressed — the log records only that the
   * surface was held (tenure markers), never what was played (ADR 0033).
   * The >2-audible suspension is NOT here anymore: it moved into the
   * detector, which self-gates while the log keeps all four decks. */
  private surfaceGated = false;
  private lastChannel: Record<ChannelId, ChannelState>;
  private lastAssignment: Record<ChannelId, CrossfaderAssignment>;
  private lastCrossfader: number;
  private lastCrossfaderEnabled: boolean;
  private lastMaster: number;
  private lastDeck: Record<ChannelId, DeckSnapshot>;

  private readonly mixer: CaptureMixerSource;
  private readonly engines: Record<ChannelId, CaptureDeckSource>;
  private readonly onTake: (take: DetectedTake) => void;
  /** Session persistence sink (Sessions PRD, ADR 0033): every event the
   * recorder logs is streamed here beside the in-memory rolling log the
   * detector reads. Optional — tests that only exercise detection omit it. */
  private readonly onEvent?: (event: CaptureEvent, activatesSession: boolean) => void;
  private seeding = false;

  constructor(
    mixer: CaptureMixerSource,
    engines: Record<ChannelId, CaptureDeckSource>,
    onTake: (take: DetectedTake) => void,
    onEvent?: (event: CaptureEvent, activatesSession: boolean) => void
  ) {
    this.mixer = mixer;
    this.engines = engines;
    this.onTake = onTake;
    this.onEvent = onEvent;
    this.lastChannel = {
      A: mixer.getChannelState('A'),
      B: mixer.getChannelState('B'),
      C: mixer.getChannelState('C'),
      D: mixer.getChannelState('D'),
    };
    this.lastAssignment = {
      A: mixer.getCrossfaderAssignment('A'),
      B: mixer.getCrossfaderAssignment('B'),
      C: mixer.getCrossfaderAssignment('C'),
      D: mixer.getCrossfaderAssignment('D'),
    };
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

  /** Encode a crossfader assignment as the control value (ADR 0033). */
  private static assignmentValue(a: CrossfaderAssignment): number {
    return a === 'left' ? -1 : a === 'right' ? 1 : 0;
  }

  start(): void {
    const holder = audibleHolder();
    this.surfaceGated = holder !== 'shared';
    this.unsubs.push(subscribeAudible((h) => this.setSurfaceHolder(h)));
    this.unsubs.push(this.mixer.subscribe(() => this.diffMixer()));
    for (const ch of CHANNEL_IDS) {
      this.unsubs.push(this.engines[ch].subscribe(() => this.diffDeck(ch)));
    }
    // Detailed transport evidence (seek / jumpBeats / hotCue) for ALL FOUR
    // Decks (sessions 09): these gestures leave no snapshot diff, so a
    // handler is the only way they reach the Session log. C/D get exactly
    // the same handler as A/B — the pair-only boundary is the detector's
    // Take classification, never the whole-Session capture (ADR 0033).
    // `ch` is a physical CaptureDeck: identity is preserved on the event.
    for (const ch of CHANNEL_IDS) {
      this.engines[ch].setTransportEventHandler((e) =>
        this.feed({ t: this.now(), kind: 'transport', channel: ch, ...e })
      );
    }
    if (this.surfaceGated) {
      // Booting under a machine tenure: mark it open so the detector
      // suspends until the surface returns (its own state seeds on release).
      this.emitMarker({ t: this.now(), kind: 'tenure', edge: 'start', holder });
    } else {
      this.seed();
    }
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  /** Audibility handoff (ADR 0022, tenure markers ADR 0033). A machine
   * claiming the surface opens a tenure (its events are suppressed, the log
   * records only the hold); the surface returning closes it and re-seeds
   * the detector from current reality. The >2-audible suspension is gone —
   * the detector self-gates and the log stays whole. */
  private setSurfaceHolder(holder: AudibleSurfaceId): void {
    const gated = holder !== 'shared';
    if (gated === this.surfaceGated) return;
    if (gated) {
      // Bracket the machine's tenure: the marker rides the log (it is not
      // the machine's performance); the machine's own events are dropped
      // at feed() while surfaceGated.
      this.emitMarker({ t: this.now(), kind: 'tenure', edge: 'start', holder });
      this.surfaceGated = true;
    } else {
      this.surfaceGated = false;
      this.emitMarker({ t: this.now(), kind: 'tenure', edge: 'end', holder: 'shared' });
      this.seed(); // re-establish reality after the machine let go
    }
  }

  /**
   * Feed the detector the current reality: control positions, loaded
   * tracks, and running transports. Runs at start (boot restore may have
   * loaded tracks before the recorder existed) and on regaining
   * audibility (everything that moved while gated was dropped).
   */
  private seed(): void {
    this.seeding = true;
    const t = this.now();
    // All four decks unconditionally (ADR 0033): controls, assignments,
    // loaded tracks, running transports.
    for (const ch of CHANNEL_IDS) {
      const c = this.mixer.getChannelState(ch);
      for (const [control, read] of CaptureRecorder.CHANNEL_CONTROLS) {
        this.feed({ t, kind: 'control', control, channel: ch, value: read(c) });
      }
      const assignment = this.mixer.getCrossfaderAssignment(ch);
      this.lastAssignment[ch] = assignment;
      this.feed({
        t,
        kind: 'control',
        control: 'crossfaderAssignment',
        channel: ch,
        value: CaptureRecorder.assignmentValue(assignment),
      });
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
    for (const ch of CHANNEL_IDS) {
      const snap = this.engines[ch].getSnapshot();
      this.lastDeck[ch] = snap;
      this.lastChannel[ch] = this.mixer.getChannelState(ch);
      if (snap.trackId !== null) {
        this.feed({ t, kind: 'load', channel: ch, trackId: snap.trackId, bpm: snap.bpm });
      }
      if (snap.playing) {
        this.feed({ t, kind: 'transport', channel: ch, action: 'play', playhead: this.engines[ch].getPlayhead() });
      }
      if (snap.previewing) {
        // A CUE stab already held at seed time (boot/re-seed mid-hold, ADR
        // 0033): open its bracket so the log/timeline see the running preview.
        this.feed({
          t,
          kind: 'transport',
          channel: ch,
          action: 'previewStart',
          playhead: this.engines[ch].getPlayhead(),
        });
      }
    }
    this.lastCrossfader = this.mixer.getCrossfader();
    this.lastCrossfaderEnabled = this.mixer.getCrossfaderEnabled();
    this.lastMaster = this.mixer.getMaster();
    this.seeding = false;
  }

  dispose(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    // Clear the detailed transport handler on ALL FOUR Decks (sessions 09),
    // matching start()'s four-Deck installation.
    for (const ch of CHANNEL_IDS) {
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
    // Suppress a machine's own events while it holds the surface (ADR 0022):
    // the log records the tenure, never the machine's performance. The
    // >2-audible case no longer drops — the log is whole and the detector
    // self-gates (ADR 0033).
    if (this.surfaceGated) return;
    this.emitMarker(e);
  }

  /** Push an event to the detector AND the Session sink, bypassing the
   * surface gate — for tenure markers, which describe the hold itself and
   * must ride the log even while a machine holds the surface (ADR 0033). */
  private emitMarker(e: CaptureEvent): void {
    // Persist beside the detector's rolling log (ADR 0033): the Session
    // records all four decks; the detector reads the same stream and
    // self-gates over >2-audible stretches / machine tenures.
    const activatesSession =
      !this.seeding &&
      e.kind !== 'tenure' &&
      e.kind !== 'init' &&
      (e.kind !== 'tick' || Object.keys(e.playheads).length > 0);
    this.onEvent?.(e, activatesSession);
    const [next, takes] = reduceCapture(this.state, e);
    this.state = next;
    for (const take of takes) this.onTake(take);
  }

  private tick(): void {
    if (this.surfaceGated) return;
    const playheads: Partial<Record<ChannelId, number>> = {};
    for (const ch of CHANNEL_IDS) {
      // A previewing deck (CUE stab, ADR 0033) has a moving, audible
      // playhead just like a playing one — sample it so the stab's motion
      // rides the ~1 Hz ticks and the timeline can draw its waveform trace.
      if (this.lastDeck[ch].playing || this.lastDeck[ch].previewing) {
        playheads[ch] = this.engines[ch].getPlayhead();
      }
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
    // All four channels (ADR 0033): the log is whole; the detector counts
    // C/D audibility from these to self-gate.
    for (const ch of CHANNEL_IDS) {
      const prev = this.lastChannel[ch];
      const cur = this.mixer.getChannelState(ch);
      if (cur !== prev) {
        this.lastChannel[ch] = cur;
        for (const [control, read] of CaptureRecorder.CHANNEL_CONTROLS) {
          const value = read(cur);
          if (value !== read(prev)) this.feed({ t, kind: 'control', control, channel: ch, value });
        }
      }
      const assignment = this.mixer.getCrossfaderAssignment(ch);
      if (assignment !== this.lastAssignment[ch]) {
        this.lastAssignment[ch] = assignment;
        this.feed({
          t,
          kind: 'control',
          control: 'crossfaderAssignment',
          channel: ch,
          value: CaptureRecorder.assignmentValue(assignment),
        });
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
    // All four decks log their load/transport/pitch (ADR 0033): C/D activity
    // is evidence and drives the detector's >2-audible self-gate.
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
    if (cur.previewing !== prev.previewing) {
      // CUE stab (hold-to-preview, ADR 0033): audio runs and is
      // Master-audible while `previewing`, but `playing` never flips. Log
      // the stab as previewStart/previewEnd (with the moving playhead, which
      // the ~1 Hz tick also samples) so the timeline can render it and
      // replay can reproduce it. The detector ignores both edges — preview
      // is inert to detection v1 (deliberate; see detector.ts).
      this.feed({
        t,
        kind: 'transport',
        channel: ch,
        action: cur.previewing ? 'previewStart' : 'previewEnd',
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
