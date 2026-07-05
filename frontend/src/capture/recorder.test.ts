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
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaptureRecorder } from './recorder';
import type { CaptureDeckSource, CaptureMixerSource } from './recorder';
import { DEFAULT_DETECTOR_PARAMS } from './events';
import type { DetectedTake } from './events';
import type { ChannelState } from '../playback/mixer';
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
  private channels: Record<'A' | 'B', ChannelState> = { A: flatChannel(), B: flatChannel() };
  private crossfader = 0;
  private listeners = new Set<() => void>();

  getChannelState(ch: 'A' | 'B'): ChannelState {
    return this.channels[ch];
  }
  getCrossfader(): number {
    return this.crossfader;
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

  setFader(ch: 'A' | 'B', fader: number): void {
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
  };
}

class FakeDeckSource implements CaptureDeckSource {
  private snapshot = emptySnapshot();
  private listeners = new Set<() => void>();

  getSnapshot(): DeckSnapshot {
    return this.snapshot;
  }
  getPlayhead(): number {
    return 0;
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
}

function surface() {
  return { transport: { togglePlay: () => undefined }, silence: () => undefined };
}

/** A rig: recorder over fakes, real detector, fake clock at second `t`. */
function rig() {
  const mixer = new FakeMixerSource();
  const decks = { A: new FakeDeckSource(), B: new FakeDeckSource() };
  const takes: DetectedTake[] = [];
  const recorder = new CaptureRecorder(mixer, decks, (take) => takes.push(take));
  return { mixer, decks, takes, recorder, advance: (sec: number) => vi.advanceTimersByTime(sec * 1000) };
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
