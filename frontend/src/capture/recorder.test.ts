/**
 * Capture recorder — the audibility gate (ADR 0022, editor-shared-decks
 * 03). The detector is the pure seam (detector.test.ts); these tests
 * drive the RECORDER with scripted source fakes (its narrow read
 * interfaces are the true seam, ADR 0002) plus the real detector and the
 * real arbiter, and assert what reaches `onTake`:
 * - a clean blend performed while 'shared' is audible → one Take
 * - the same blend while the editor holds audibility → nothing
 * - audibility lost mid-engagement → the engagement is discarded
 * - a blend performed after regaining audibility → one Take (re-seed)
 * - the Conductor's Pickup claim (sets 16): mid-engagement → no Take;
 *   after settle → the completed Take is preserved
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { CaptureRecorder } from './recorder';
import { SessionSink } from './sessionSink';
import type { CaptureDeckSource, CaptureMixerSource } from './recorder';
import { DEFAULT_DETECTOR_PARAMS } from './events';
import type { CaptureEvent, DetectedTake } from './events';
import type { ChannelId, ChannelState } from '../playback/mixer';
import { DEFAULT_CROSSFADER_ASSIGNMENTS } from '../playback/crossfaderAssignmentStore';
import type { DeckSnapshot } from '../playback/DeckEngine';
import {
  _resetAudibleSurfacesForTests,
  claimAudible,
  registerSurface,
  releaseAudible,
} from '../playback/audibleSurface';

// For the real-SessionSink provenance seam (sessions 11): the sink's I/O is
// mocked; everything else in this file never touches the api.
vi.mock('../api/client', () => ({
  api: {
    sessions: {
      recover: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({}),
      appendChunk: vi.fn().mockResolvedValue({}),
      end: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock('../api/queryClient', () => ({
  queryClient: { invalidateQueries: vi.fn().mockResolvedValue(undefined) },
}));

const HORIZON = DEFAULT_DETECTOR_PARAMS.settleHorizonS;

function flatChannel(): ChannelState {
  return { trim: 0.5, eq: { low: 0.5, mid: 0.5, high: 0.5 }, filter: 0, fader: 1, pfl: false };
}

class FakeMixerSource implements CaptureMixerSource {
  private channels: Record<ChannelId, ChannelState> = {
    A: flatChannel(),
    B: flatChannel(),
    C: flatChannel(),
    D: flatChannel(),
  };
  private crossfader = 0;
  private listeners = new Set<() => void>();

  getChannelState(ch: ChannelId): ChannelState {
    return this.channels[ch];
  }
  getCrossfader(): number {
    return this.crossfader;
  }
  getCrossfaderAssignment(ch: ChannelId) {
    return DEFAULT_CROSSFADER_ASSIGNMENTS[ch];
  }
  getCrossfaderEnabled(): boolean {
    return true;
  }
  getMaster(): number {
    return 1;
  }
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setFader(ch: ChannelId, fader: number): void {
    this.channels[ch] = { ...this.channels[ch], fader };
    for (const fn of this.listeners) fn();
  }
}

function emptySnapshot(): DeckSnapshot {
  return {
    loadState: 'empty',
    loadError: null,
    trackId: null,
    bpm: null,
    duration: 300,
    playing: false,
    pendingPlay: false,
    previewing: false,
    hotCuePreviewSlot: null,
    cuePoint: null,
    pitchPercent: 0,
    bendPercent: 0,
    keyLock: false,
    loop: null,
    loopBeatsLabel: null,
    pendingLoopBeats: 4,
    hasBeatgrid: false,
  };
}

type TransportGesture = { action: 'seek' | 'jumpBeats' | 'hotCue'; playhead: number; detail?: number };

class FakeDeckSource implements CaptureDeckSource {
  private snapshot = emptySnapshot();
  private listeners = new Set<() => void>();
  /** The recorder-owned detailed transport handler slot (sessions 09):
   * stored so tests can fire seek/jumpBeats/hotCue gestures and assert
   * installation/cleanup on every deck. */
  transportHandler: ((e: TransportGesture) => void) | null = null;

  getSnapshot(): DeckSnapshot {
    return this.snapshot;
  }
  getPlayhead(): number {
    return this.playhead;
  }
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  setTransportEventHandler(handler: ((e: TransportGesture) => void) | null): void {
    this.transportHandler = handler;
  }
  /** A handler-only transport gesture (leaves no snapshot diff). */
  fireTransport(e: TransportGesture): void {
    this.transportHandler?.(e);
  }

  private mutate(patch: Partial<DeckSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const fn of this.listeners) fn();
  }
  load(trackId: number): void {
    this.mutate({ trackId, bpm: 174, loadState: 'ready' });
  }
  play(): void {
    this.mutate({ playing: true });
  }
  pause(): void {
    this.mutate({ playing: false });
  }
  /** Mock playhead (sessions 10): ticks and transport events sample it. */
  private playhead = 0;
  /** Move the (mock) playhead so ticks and transport events sample it. */
  seek(playhead: number): void {
    this.playhead = playhead;
  }
  /** A CUE stab (hold-to-preview, ADR 0033): audio runs and is audible, but
   * `playing` never flips — only `previewing`. */
  previewStart(): void {
    this.mutate({ previewing: true });
  }
  previewEnd(): void {
    this.mutate({ previewing: false });
  }
  /** A hot-cue stab (sessions 11): the held slot flips, not `playing`. */
  hotCuePreview(slot: number): void {
    this.mutate({ hotCuePreviewSlot: slot });
  }
  hotCuePreviewEnd(): void {
    this.mutate({ hotCuePreviewSlot: null });
  }
}

function surface() {
  return { transport: { togglePlay: () => undefined }, silence: () => undefined };
}

/** A rig: recorder over fakes, real detector, fake clock at second `t`.
 * `logged` captures the whole fed stream (the Session sink's input);
 * `activated` the per-event activation flags (Master-audibility, sessions
 * 11); `splits` counts onSplit firings (`onSplit` returns `splitResult`,
 * mimicking SessionSink.split()'s had-a-row answer). */
function rig(onTake?: (take: DetectedTake) => void) {
  const mixer = new FakeMixerSource();
  const decks = {
    A: new FakeDeckSource(),
    B: new FakeDeckSource(),
    C: new FakeDeckSource(),
    D: new FakeDeckSource(),
  };
  const takes: DetectedTake[] = [];
  const logged: CaptureEvent[] = [];
  const activated: boolean[] = [];
  const splits: number[] = [];
  const result = { splitResult: true };
  const recorder = new CaptureRecorder(
    mixer,
    decks,
    (take) => {
      takes.push(take);
      onTake?.(take);
    },
    (event, activatesSession) => {
      logged.push(event);
      activated.push(activatesSession);
    },
    () => {
      splits.push(performance.now() / 1000);
      return result.splitResult;
    }
  );
  return {
    mixer,
    decks,
    takes,
    logged,
    activated,
    splits,
    result,
    recorder,
    advance: (sec: number) => vi.advanceTimersByTime(sec * 1000),
  };
}

/** Incumbent setup + the detector-tested clean blend (detector.test.ts):
 * A audible, B loaded silent; B starts, fades in, A fades out, settle. */
function performBlend(r: ReturnType<typeof rig>): void {
  r.decks.A.load(1);
  r.decks.B.load(2);
  r.mixer.setFader('B', 0);
  r.decks.A.play();
  r.advance(10);
  r.decks.B.play();
  r.advance(2);
  r.mixer.setFader('B', 1);
  r.advance(8);
  r.mixer.setFader('A', 0);
  r.advance(HORIZON + 1);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
  _resetAudibleSurfacesForTests();
  registerSurface('shared', surface());
  registerSurface('editor', surface());
});

afterEach(() => {
  vi.useRealTimers();
  _resetAudibleSurfacesForTests();
});

describe('capture gate (ADR 0022)', () => {
  it('a clean blend while shared is audible emits one Take', () => {
    const r = rig();
    r.recorder.start();
    performBlend(r);
    expect(r.takes).toHaveLength(1);
    expect(r.takes[0].outgoingTrackId).toBe(1);
    expect(r.takes[0].incomingTrackId).toBe(2);
    r.recorder.dispose();
  });

  it('a third audible Deck suspends the verdict but the log stays whole (ADR 0033)', () => {
    const r = rig();
    r.recorder.start();
    r.decks.A.load(1);
    r.decks.B.load(2);
    r.decks.C.load(3);
    r.mixer.setFader('B', 0);
    r.decks.A.play();
    r.decks.C.play();
    r.advance(10);
    r.decks.B.play();
    r.mixer.setFader('B', 1); // A+B+C become Master-audible
    r.advance(2);
    r.mixer.setFader('A', 0);
    r.advance(HORIZON + 1);
    // Detector self-gates over >2 audible: no Take.
    expect(r.takes).toHaveLength(0);
    // But the log is whole — deck C's activity was NOT dropped (no deck-count
    // gating in the fed stream): its load and play both reached the sink.
    expect(
      r.logged.some((e) => e.kind === 'load' && e.channel === 'C' && e.trackId === 3)
    ).toBe(true);
    expect(
      r.logged.some((e) => e.kind === 'transport' && e.channel === 'C' && e.action === 'play')
    ).toBe(true);
    r.recorder.dispose();
  });

  it('a machine claiming the surface brackets a tenure marker; releasing closes it', () => {
    const r = rig();
    r.recorder.start();
    claimAudible('editor');
    const start = r.logged.filter((e) => e.kind === 'tenure' && e.edge === 'start');
    expect(start).toHaveLength(1);
    expect(start[0].kind === 'tenure' && start[0].holder).toBe('editor');
    releaseAudible('editor');
    expect(r.logged.some((e) => e.kind === 'tenure' && e.edge === 'end')).toBe(true);
    r.recorder.dispose();
  });

  it("suppresses the machine's own events between tenure start and end", () => {
    const r = rig();
    r.recorder.start();
    claimAudible('editor');
    const afterClaimLen = r.logged.length; // includes the tenure-start marker
    // The machine drives the decks; none of this should reach the log.
    r.decks.A.load(1);
    r.decks.A.play();
    r.mixer.setFader('A', 0.3);
    r.advance(3);
    const duringTenure = r.logged.slice(afterClaimLen);
    expect(duringTenure).toHaveLength(0); // machine's events all dropped
    releaseAudible('editor');
    r.recorder.dispose();
  });

  it('the same blend while the editor holds audibility emits nothing', () => {
    const r = rig();
    r.recorder.start();
    claimAudible('editor');
    performBlend(r);
    expect(r.takes).toHaveLength(0);
    r.recorder.dispose();
  });

  it('losing audibility mid-engagement discards the take', () => {
    const r = rig();
    r.recorder.start();
    r.decks.A.load(1);
    r.decks.B.load(2);
    r.mixer.setFader('B', 0);
    r.decks.A.play();
    r.advance(10);
    r.decks.B.play();
    r.advance(2);
    r.mixer.setFader('B', 1); // blend under way: engagement in flight
    r.advance(3);
    claimAudible('editor'); // editor interrupts mid-blend
    r.mixer.setFader('A', 0); // the "handover" completes while gated
    r.advance(HORIZON + 1);
    releaseAudible('editor');
    r.advance(HORIZON + 1); // nothing settles: the engagement was discarded
    expect(r.takes).toHaveLength(0);
    r.recorder.dispose();
  });

  it('a blend performed after regaining audibility is captured (re-seed)', () => {
    const r = rig();
    r.recorder.start();
    claimAudible('editor');
    // Loads and fader moves land while gated — dropped, but re-seeded.
    r.decks.A.load(1);
    r.decks.B.load(2);
    r.mixer.setFader('B', 0);
    r.advance(5);
    releaseAudible('editor');
    r.decks.A.play();
    r.advance(10);
    r.decks.B.play();
    r.advance(2);
    r.mixer.setFader('B', 1);
    r.advance(8);
    r.mixer.setFader('A', 0);
    r.advance(HORIZON + 1);
    expect(r.takes).toHaveLength(1);
    expect(r.takes[0].outgoingTrackId).toBe(1);
    expect(r.takes[0].incomingTrackId).toBe(2);
    r.recorder.dispose();
  });

  // Pickup (sets 16) capture rule: the Conductor's claim is the gate
  // flip, so picking up mid-Handover abandons the in-flight engagement
  // (finishing a mix by machine forfeits the Take)…
  it('a Conductor claim mid-engagement (pickup) yields no Take', () => {
    const r = rig();
    registerSurface('conductor', surface());
    r.recorder.start();
    r.decks.A.load(1);
    r.decks.B.load(2);
    r.mixer.setFader('B', 0);
    r.decks.A.play();
    r.advance(10);
    r.decks.B.play();
    r.advance(2);
    r.mixer.setFader('B', 1); // blend under way: engagement in flight
    r.advance(3);
    // Pickup's exact claim: adopt the decks live (no silence) mid-blend.
    claimAudible('conductor', { silencePrevious: false });
    r.mixer.setFader('A', 0); // the Conductor finishes the handover
    r.advance(HORIZON + 1);
    expect(r.takes).toHaveLength(0);
    r.recorder.dispose();
  });

  // …while a pickup AFTER the settle horizon keeps the completed Take.
  it('a Conductor claim after settle (post-settle pickup) preserves the Take', () => {
    const r = rig();
    registerSurface('conductor', surface());
    r.recorder.start();
    performBlend(r); // settles: one Take emitted
    expect(r.takes).toHaveLength(1);
    claimAudible('conductor', { silencePrevious: false }); // pickup after the fact
    r.advance(HORIZON + 1);
    expect(r.takes).toHaveLength(1); // nothing lost, nothing added
    r.recorder.dispose();
  });

  it('starting while the editor is audible stays silent until release', () => {
    claimAudible('editor');
    const r = rig();
    r.decks.A.load(1);
    r.decks.B.load(2);
    r.mixer.setFader('B', 0);
    r.recorder.start();
    performBlend(r); // all gated
    expect(r.takes).toHaveLength(0);
    // Back to a coherent incumbent-A setup — still gated, so none of this
    // reset choreography reaches the detector either.
    r.decks.A.pause();
    r.decks.B.pause();
    r.mixer.setFader('A', 1);
    r.mixer.setFader('B', 0);
    releaseAudible('editor');
    performBlend(r); // re-seeded reality: same blend now counts
    expect(r.takes).toHaveLength(1);
    r.recorder.dispose();
  });
});

// ── Four-deck transport parity (sessions 09) ──────────────────────────────
// C/D Session evidence must match A/B: the detailed transport handler
// (seek / jumpBeats / hotCue — handler-only gestures that leave no
// snapshot diff) installs on ALL FOUR decks, feeds physical-deck-true
// events, and clears on dispose. The pair-only boundary is the detector's
// Take classification, never the whole-Session log.

describe('four-deck transport parity (sessions 09)', () => {
  const DECKS = ['A', 'B', 'C', 'D'] as const;

  it('installs the detailed transport handler on all four decks, and clears it on dispose', () => {
    const r = rig();
    for (const d of DECKS) expect(r.decks[d].transportHandler).toBeNull();
    r.recorder.start();
    for (const d of DECKS) expect(r.decks[d].transportHandler).toBeTypeOf('function');
    r.recorder.dispose();
    for (const d of DECKS) expect(r.decks[d].transportHandler).toBeNull();
  });

  it('a C seek / D jumpBeats / C hotCue land in the log with the same shape as on A', () => {
    const r = rig();
    r.recorder.start();
    const before = r.logged.length;

    r.decks.A.fireTransport({ action: 'seek', playhead: 41.5 });
    r.decks.C.fireTransport({ action: 'seek', playhead: 41.5 });
    r.decks.D.fireTransport({ action: 'jumpBeats', playhead: 88.25, detail: 32 });
    r.decks.C.fireTransport({ action: 'hotCue', playhead: 120.125, detail: 3 });

    const fed = r.logged.slice(before).filter((e) => e.kind === 'transport');
    expect(fed).toHaveLength(4);
    const [aSeek, cSeek, dJump, cCue] = fed as Extract<CaptureEvent, { kind: 'transport' }>[];
    // Physical identity preserved; C's event is A's event with channel C.
    expect(aSeek).toMatchObject({ action: 'seek', channel: 'A', playhead: 41.5 });
    expect(cSeek).toMatchObject({ action: 'seek', channel: 'C', playhead: 41.5 });
    const { channel: chA, ...restA } = aSeek;
    const { channel: chC, ...restC } = cSeek;
    expect(chA).toBe('A');
    expect(chC).toBe('C');
    expect(restC).toEqual(restA); // identical shape and precision
    expect(dJump).toMatchObject({ action: 'jumpBeats', channel: 'D', playhead: 88.25, detail: 32 });
    expect(cCue).toMatchObject({ action: 'hotCue', channel: 'C', playhead: 120.125, detail: 3 });
    r.recorder.dispose();
  });

  it('C/D handler gestures respect the surface gate like A/B (machine tenure)', () => {
    const r = rig();
    r.recorder.start();
    claimAudible('editor');
    const before = r.logged.length;
    r.decks.C.fireTransport({ action: 'seek', playhead: 10 });
    r.decks.D.fireTransport({ action: 'hotCue', playhead: 20, detail: 1 });
    // Nothing but the tenure marker rode the log while gated.
    expect(r.logged.slice(before).filter((e) => e.kind === 'transport')).toHaveLength(0);
    releaseAudible('editor');
    r.recorder.dispose();
  });

  it('D snapshot evidence (load/play/pitch) still reaches the log', () => {
    const r = rig();
    r.recorder.start();
    const before = r.logged.length;
    r.decks.D.load(77);
    r.decks.D.play();
    const fed = r.logged.slice(before);
    expect(fed.some((e) => e.kind === 'load' && e.channel === 'D' && e.trackId === 77)).toBe(true);
    expect(
      fed.some((e) => e.kind === 'transport' && e.channel === 'D' && e.action === 'play')
    ).toBe(true);
    r.recorder.dispose();
  });
});

// ── CUE-stab capture (sessions 10, ADR 0033) ──────────────────────────────
// A CUE stab (hold-to-preview) plays audio and is Master-audible, but sets
// `previewing`, not `playing`. Before this, a stab left ZERO trace in the
// Session log (diffDeck watched only `playing`; ticks sampled only playing
// decks). Now the recorder brackets it with previewStart/previewEnd (with
// the deck's playhead) and ticks sample previewing decks. Detection stays
// byte-identical — the detector ignores the preview edges (see detector.ts).

describe('cue-stab capture (sessions 10)', () => {
  const DECKS = ['A', 'B', 'C', 'D'] as const;

  it('brackets a stab with previewStart/previewEnd carrying the playhead', () => {
    const r = rig();
    r.recorder.start();
    r.decks.A.load(1);
    const before = r.logged.length;
    r.decks.A.seek(30); // cue point
    r.decks.A.previewStart(); // cue-down: hold-to-preview
    r.decks.A.seek(31.5); // audio runs forward while held
    r.decks.A.previewEnd(); // cue-up: released
    const fed = r.logged
      .slice(before)
      .filter((e): e is Extract<CaptureEvent, { kind: 'transport' }> => e.kind === 'transport');
    expect(fed).toHaveLength(2);
    expect(fed[0]).toMatchObject({ action: 'previewStart', channel: 'A', playhead: 30 });
    expect(fed[1]).toMatchObject({ action: 'previewEnd', channel: 'A', playhead: 31.5 });
    r.recorder.dispose();
  });

  it("never emits play/pause for a stab (previewing, not playing)", () => {
    const r = rig();
    r.recorder.start();
    r.decks.B.load(2);
    const before = r.logged.length;
    r.decks.B.previewStart();
    r.decks.B.previewEnd();
    const actions = r.logged
      .slice(before)
      .filter((e): e is Extract<CaptureEvent, { kind: 'transport' }> => e.kind === 'transport')
      .map((e) => e.action);
    expect(actions).toEqual(['previewStart', 'previewEnd']);
    expect(actions).not.toContain('play');
    expect(actions).not.toContain('pause');
    r.recorder.dispose();
  });

  it("ticks sample a previewing deck's playhead (the stab's moving playhead rides the ~1 Hz ticks)", () => {
    const r = rig();
    r.recorder.start();
    r.decks.C.load(3);
    r.decks.C.seek(40);
    r.decks.C.previewStart();
    const before = r.logged.length;
    r.decks.C.seek(41); // audio advances during the hold
    r.advance(1); // one ~1 Hz tick
    const ticks = r.logged
      .slice(before)
      .filter((e): e is Extract<CaptureEvent, { kind: 'tick' }> => e.kind === 'tick');
    expect(ticks.length).toBeGreaterThanOrEqual(1);
    expect(ticks.some((e) => e.playheads.C === 41)).toBe(true);
    r.decks.C.previewEnd();
    r.recorder.dispose();
  });

  it("a stab respects the machine-tenure gate exactly like playing decks", () => {
    const r = rig();
    r.recorder.start();
    claimAudible('editor');
    const before = r.logged.length;
    // The machine drives a preview while it holds the surface: nothing but
    // the tenure marker rides the log.
    r.decks.A.previewStart();
    r.decks.A.seek(12);
    r.advance(2); // ticks are suppressed while gated
    r.decks.A.previewEnd();
    const fed = r.logged
      .slice(before)
      .filter((e) => e.kind === 'transport' || e.kind === 'tick');
    expect(fed).toHaveLength(0);
    releaseAudible('editor');
    r.recorder.dispose();
  });

  it('captures stabs on all four decks (A/B/C/D parity)', () => {
    const r = rig();
    r.recorder.start();
    for (const d of DECKS) r.decks[d].load(10);
    const before = r.logged.length;
    for (const d of DECKS) {
      r.decks[d].previewStart();
      r.decks[d].previewEnd();
    }
    const fed = r.logged
      .slice(before)
      .filter((e): e is Extract<CaptureEvent, { kind: 'transport' }> => e.kind === 'transport');
    for (const d of DECKS) {
      expect(fed.some((e) => e.channel === d && e.action === 'previewStart')).toBe(true);
      expect(fed.some((e) => e.channel === d && e.action === 'previewEnd')).toBe(true);
    }
    r.recorder.dispose();
  });

  it('a stab does NOT trip the detector (detection byte-identical): no Take, and a real blend still settles', () => {
    const r = rig();
    r.recorder.start();
    // A stab of the incoming deck during an otherwise clean incumbent —
    // audible, but inert to detection v1.
    r.decks.A.load(1);
    r.decks.B.load(2);
    r.mixer.setFader('B', 0);
    r.decks.A.play();
    r.advance(5);
    r.decks.B.previewStart(); // tease the incoming with a stab
    r.advance(1);
    r.decks.B.previewEnd();
    r.advance(HORIZON + 1);
    expect(r.takes).toHaveLength(0); // the stab alone is not a Take
    // The real blend that follows still settles into exactly one Take.
    r.decks.B.play();
    r.advance(2);
    r.mixer.setFader('B', 1);
    r.advance(8);
    r.mixer.setFader('A', 0);
    r.advance(HORIZON + 1);
    expect(r.takes).toHaveLength(1);
    expect(r.takes[0].outgoingTrackId).toBe(1);
    expect(r.takes[0].incomingTrackId).toBe(2);
    r.recorder.dispose();
  });
});

// ── Ten-minute silence split + audible-only activation (sessions 11) ──────
// A Session ends after ten continuous minutes with no Master-audible Deck
// (tenure = non-performance = inactivity), and a row only ever OPENS on a
// Master-audible instant: loads, cueing, control setup, and tenures buffer
// as context (activatesSession=false) but never create a row.

describe('audible-only activation (sessions 11)', () => {
  it('silent setup — loads, seeks, cue stabs, control moves, tenure — never activates', () => {
    const r = rig();
    r.recorder.start();
    r.decks.A.load(1);
    r.decks.A.seek(30);
    r.decks.A.fireTransport({ action: 'seek', playhead: 30 });
    r.decks.B.load(2);
    r.mixer.setFader('B', 0.3);
    r.decks.A.previewStart(); // CUE stab: the audibility definition ignores preview
    r.advance(2);
    r.decks.A.previewEnd();
    claimAudible('editor');
    r.advance(2);
    releaseAudible('editor');
    r.advance(5);
    expect(r.activated.length).toBeGreaterThan(0);
    expect(r.activated.some(Boolean)).toBe(false);
    r.recorder.dispose();
  });

  it('the first Master-audible instant activates, on that exact event', () => {
    const r = rig();
    r.recorder.start();
    r.decks.A.load(1);
    expect(r.activated.some(Boolean)).toBe(false);
    r.decks.A.play(); // fader up, trim centered: Master-audible
    const idx = r.activated.findIndex(Boolean);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(r.logged[idx]).toMatchObject({ kind: 'transport', action: 'play', channel: 'A' });
    r.recorder.dispose();
  });

  it('playing into a killed channel does not activate; opening the fader does', () => {
    const r = rig();
    r.recorder.start();
    r.decks.A.load(1);
    r.mixer.setFader('A', 0);
    r.decks.A.play();
    r.advance(5);
    expect(r.activated.some(Boolean)).toBe(false);
    r.mixer.setFader('A', 1); // the first Master-audible instant
    expect(r.activated[r.activated.length - 1]).toBe(true);
    r.recorder.dispose();
  });
});

describe('ten-minute silence split (sessions 11)', () => {
  /** Silence B (the blend's survivor) and return the pause instant. */
  function goSilent(r: ReturnType<typeof rig>): void {
    r.decks.B.pause();
  }

  it('9:59 of continuous silence does not split; 10:00 does — exactly once', () => {
    const r = rig();
    r.recorder.start();
    performBlend(r);
    goSilent(r);
    r.advance(599);
    expect(r.splits).toHaveLength(0);
    r.advance(2);
    expect(r.splits).toHaveLength(1);
    // Dormant: continued silence never fires again, and no further split.
    r.advance(3600);
    expect(r.splits).toHaveLength(1);
    r.recorder.dispose();
  });

  it('a Master-audible blip before the threshold resets the full ten-minute clock', () => {
    const r = rig();
    r.recorder.start();
    performBlend(r);
    goSilent(r);
    r.advance(590);
    r.decks.B.play(); // audible again just before the threshold
    r.advance(1);
    r.decks.B.pause();
    r.advance(598);
    expect(r.splits).toHaveLength(0); // full clock restarted at the pause
    r.advance(3);
    expect(r.splits).toHaveLength(1);
    r.recorder.dispose();
  });

  it('machine tenure counts as inactivity: ten gated minutes split the Session', () => {
    const r = rig();
    r.recorder.start();
    r.decks.A.load(1);
    r.decks.A.play(); // performance, then the editor takes the surface
    r.advance(5);
    claimAudible('editor');
    r.advance(599);
    expect(r.splits).toHaveLength(0);
    r.advance(2);
    expect(r.splits).toHaveLength(1);
    // The next Session's buffered context re-marks the still-open hold.
    const tenureStarts = r.logged.filter((e) => e.kind === 'tenure' && e.edge === 'start');
    expect(tenureStarts.length).toBe(2);
    releaseAudible('editor');
    r.recorder.dispose();
  });

  it('no engagement spans the boundary; a post-split blend is detected fresh with the new pair', () => {
    const r = rig();
    r.recorder.start();
    performBlend(r); // Take 1: 1 → 2
    expect(r.takes).toHaveLength(1);
    goSilent(r);
    r.advance(601);
    expect(r.splits).toHaveLength(1);
    expect(r.takes).toHaveLength(1); // nothing settled across the boundary
    // Live performance resumes: a fresh blend on fresh tracks. (A had kept
    // playing into its killed fader — stop it before re-cueing, as a real
    // Load would.)
    r.decks.A.pause();
    r.decks.A.load(3);
    r.decks.B.load(4);
    r.mixer.setFader('A', 1);
    r.mixer.setFader('B', 0);
    r.decks.A.play();
    r.advance(10);
    r.decks.B.play();
    r.advance(2);
    r.mixer.setFader('B', 1);
    r.advance(8);
    r.mixer.setFader('A', 0);
    r.advance(HORIZON + 1);
    expect(r.takes).toHaveLength(2);
    expect(r.takes[1].outgoingTrackId).toBe(3);
    expect(r.takes[1].incomingTrackId).toBe(4);
    r.recorder.dispose();
  });

  it('a rowless split (silence from boot) does not reset or re-seed the detector', () => {
    const r = rig();
    r.result.splitResult = false; // the sink had no row open
    r.recorder.start();
    r.advance(601);
    expect(r.splits).toHaveLength(1); // the clock fired…
    // …but nothing re-seeded: no seed control burst after the boot seed.
    const seeds = r.logged.filter(
      (e) => e.kind === 'control' && e.control === 'crossfader'
    );
    expect(seeds).toHaveLength(1); // boot seed only
    r.recorder.dispose();
  });
});

describe('split Take provenance (sessions 11, real SessionSink)', () => {
  it('a post-split blend persists a new Session row and stamps its Takes with the new uuid', async () => {
    const sink = new SessionSink();
    sink.start();
    const uuids: (string | null)[] = [];
    const mixer = new FakeMixerSource();
    const decks = {
      A: new FakeDeckSource(),
      B: new FakeDeckSource(),
      C: new FakeDeckSource(),
      D: new FakeDeckSource(),
    };
    // DeckContext's exact wiring (minus persistTake's HTTP): the settle-time
    // sink uuid is the Take's provenance stamp.
    const recorder = new CaptureRecorder(
      mixer,
      decks,
      () => uuids.push(sink.currentSessionUuid),
      (event, activatesSession) => sink.record(event, activatesSession),
      () => sink.split()
    );
    recorder.start();
    const r = {
      mixer,
      decks,
      advance: (sec: number) => vi.advanceTimersByTime(sec * 1000),
    } as ReturnType<typeof rig>;
    performBlend(r); // Take 1 in Session 1
    expect(uuids).toHaveLength(1);
    const firstUuid = uuids[0];
    expect(firstUuid).not.toBeNull();
    decks.B.pause();
    r.advance(601); // the split: Session 1 ends, dormant
    expect(sink.currentSessionUuid).toBeNull();
    // Live again: Session 2 opens lazily on the first audible instant.
    decks.A.pause();
    decks.A.load(3);
    decks.B.load(4);
    mixer.setFader('A', 1);
    mixer.setFader('B', 0);
    decks.A.play();
    r.advance(10);
    decks.B.play();
    r.advance(2);
    mixer.setFader('B', 1);
    r.advance(8);
    mixer.setFader('A', 0);
    r.advance(HORIZON + 1);
    expect(uuids).toHaveLength(2);
    expect(uuids[1]).not.toBeNull();
    expect(uuids[1]).not.toBe(firstUuid);
    // Drain the sink's serialized write chain (recover → create → the idle
    // period's ~120 timer flushes → end → create) — microtasks only.
    for (let i = 0; i < 2000; i += 1) await Promise.resolve();
    // Two persisted Session rows; the old one ended at the split.
    expect(api.sessions.create).toHaveBeenCalledTimes(2);
    expect(api.sessions.end).toHaveBeenCalledExactlyOnceWith(firstUuid);
    recorder.dispose();
    sink.stop();
  });
});

// ── Hot-cue stab capture (sessions 11) ────────────────────────────────────
// Hold-to-preview from a HOT CUE flips `hotCuePreviewSlot`, not `playing`
// (and not `previewing`). The recorder derives ONE preview flag from both,
// so hot-cue stabs get the same previewStart/previewEnd brackets — with
// `detail` carrying the slot — plus tick playhead coverage. The launch also
// logs its `hotCue` gesture via the handler tap, AFTER the start edge.

describe('hot-cue stab capture (sessions 11)', () => {
  const DECKS = ['A', 'B', 'C', 'D'] as const;

  it('brackets a hot-cue stab with previewStart (detail = slot) and previewEnd', () => {
    const r = rig();
    r.recorder.start();
    r.decks.A.load(1);
    const before = r.logged.length;
    r.decks.A.seek(64); // the hot cue's position
    r.decks.A.hotCuePreview(3); // hot-cue-down: hold-to-preview
    r.decks.A.seek(66); // audio runs forward while held
    r.decks.A.hotCuePreviewEnd(); // hot-cue-up: released
    const fed = r.logged
      .slice(before)
      .filter((e): e is Extract<CaptureEvent, { kind: 'transport' }> => e.kind === 'transport');
    expect(fed).toHaveLength(2);
    expect(fed[0]).toMatchObject({ action: 'previewStart', channel: 'A', playhead: 64, detail: 3 });
    expect(fed[1]).toMatchObject({ action: 'previewEnd', channel: 'A', playhead: 66 });
    expect(fed[1].detail).toBeUndefined();
    r.recorder.dispose();
  });

  it('the launch hotCue gesture rides the log after the start edge (stream shape)', () => {
    // The engine fires the handler tap AFTER the reducer (snapshot flip):
    // the recorder passes both through synchronously in that order.
    const r = rig();
    r.recorder.start();
    r.decks.B.load(2);
    const before = r.logged.length;
    r.decks.B.seek(64);
    r.decks.B.hotCuePreview(1); // snapshot flip → previewStart
    r.decks.B.fireTransport({ action: 'hotCue', playhead: 64, detail: 1 }); // handler tap
    const actions = r.logged
      .slice(before)
      .filter((e): e is Extract<CaptureEvent, { kind: 'transport' }> => e.kind === 'transport')
      .map((e) => e.action);
    expect(actions).toEqual(['previewStart', 'hotCue']);
    r.decks.B.hotCuePreviewEnd();
    r.recorder.dispose();
  });

  it("ticks sample a hot-cue-previewing deck's playhead", () => {
    const r = rig();
    r.recorder.start();
    r.decks.C.load(3);
    r.decks.C.seek(80);
    r.decks.C.hotCuePreview(2);
    const before = r.logged.length;
    r.decks.C.seek(81); // audio advances during the hold
    r.advance(1);
    const ticks = r.logged
      .slice(before)
      .filter((e): e is Extract<CaptureEvent, { kind: 'tick' }> => e.kind === 'tick');
    expect(ticks.some((e) => e.playheads.C === 81)).toBe(true);
    r.decks.C.hotCuePreviewEnd();
    r.recorder.dispose();
  });

  it('play-takeover during a hold emits ONE edge pair (start at hold, end at release)', () => {
    // Engine semantics: play during a preview takes over without restarting
    // audio; the preview flag clears only on release. The derived flag must
    // not emit extra edges at the takeover.
    const r = rig();
    r.recorder.start();
    r.decks.D.load(4);
    const before = r.logged.length;
    r.decks.D.hotCuePreview(1); // hold
    r.decks.D.play(); // takeover: playing flips, slot still held
    r.decks.D.hotCuePreviewEnd(); // release: deck keeps playing
    const actions = r.logged
      .slice(before)
      .filter((e): e is Extract<CaptureEvent, { kind: 'transport' }> => e.kind === 'transport')
      .map((e) => e.action);
    expect(actions).toEqual(['previewStart', 'play', 'previewEnd']);
    r.recorder.dispose();
  });

  it('a hot-cue stab respects the machine-tenure gate', () => {
    const r = rig();
    r.recorder.start();
    claimAudible('editor');
    const before = r.logged.length;
    r.decks.A.hotCuePreview(2);
    r.advance(2);
    r.decks.A.hotCuePreviewEnd();
    const fed = r.logged
      .slice(before)
      .filter((e) => e.kind === 'transport' || e.kind === 'tick');
    expect(fed).toHaveLength(0);
    releaseAudible('editor');
    r.recorder.dispose();
  });

  it('captures hot-cue stabs on all four decks', () => {
    const r = rig();
    r.recorder.start();
    for (const d of DECKS) r.decks[d].load(10);
    const before = r.logged.length;
    for (const d of DECKS) {
      r.decks[d].hotCuePreview(5);
      r.decks[d].hotCuePreviewEnd();
    }
    const fed = r.logged
      .slice(before)
      .filter((e): e is Extract<CaptureEvent, { kind: 'transport' }> => e.kind === 'transport');
    for (const d of DECKS) {
      expect(fed.some((e) => e.channel === d && e.action === 'previewStart' && e.detail === 5)).toBe(
        true
      );
      expect(fed.some((e) => e.channel === d && e.action === 'previewEnd')).toBe(true);
    }
    r.recorder.dispose();
  });
});
