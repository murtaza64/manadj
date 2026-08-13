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
import { CaptureRecorder } from './recorder';
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

class FakeDeckSource implements CaptureDeckSource {
  private snapshot = emptySnapshot();
  private listeners = new Set<() => void>();

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
  setTransportEventHandler(): void {}

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
}

function surface() {
  return { transport: { togglePlay: () => undefined }, silence: () => undefined };
}

/** A rig: recorder over fakes, real detector, fake clock at second `t`.
 * `logged` captures the whole fed stream (the Session sink's input). */
function rig() {
  const mixer = new FakeMixerSource();
  const decks = {
    A: new FakeDeckSource(),
    B: new FakeDeckSource(),
    C: new FakeDeckSource(),
    D: new FakeDeckSource(),
  };
  const takes: DetectedTake[] = [];
  const logged: CaptureEvent[] = [];
  const recorder = new CaptureRecorder(
    mixer,
    decks,
    (take) => takes.push(take),
    (event) => logged.push(event)
  );
  return {
    mixer,
    decks,
    takes,
    logged,
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
