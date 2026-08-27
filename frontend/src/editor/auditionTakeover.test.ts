/**
 * Audition takeover (gh#186): the editors honor the Set Conductor's
 * takeover contract on deck-control movement. A base mixer gesture while
 * the editor holds audibility must stand the audition down (decks keep
 * sounding — standDown, never pause), land the sounding automation
 * values in base state (sparing the touched fields), disengage the
 * overlay, and release the claim.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Mixer } from '../playback/mixer';
import {
  _resetAudibleSurfacesForTests,
  audibleHolder,
  claimAudible,
  isAudible,
  registerSurface,
  releaseAudible,
  unregisterSurface,
} from '../playback/audibleSurface';
import { watchAuditionTakeover } from './auditionTakeover';

function setup(opts: { claim?: boolean } = {}) {
  _resetAudibleSurfacesForTests();
  const mixer = new Mixer();
  const silence = vi.fn();
  registerSurface('editor', { transport: { togglePlay: () => {} }, silence });
  if (opts.claim !== false) claimAudible('editor');
  const token = mixer.engageAutomation();
  const tokenRef = { current: token as symbol | null };
  const standDown = vi.fn();
  const cancelArm = vi.fn();
  const takeToken = vi.fn(() => {
    const t = tokenRef.current;
    tokenRef.current = null;
    return t;
  });
  const unsub = watchAuditionTakeover({
    mixer,
    surface: 'editor',
    standDown,
    cancelArm,
    takeToken,
  });
  return { mixer, silence, standDown, cancelArm, takeToken, tokenRef, unsub };
}

function fakeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  } as Storage;
}

// Minimal graph fake (the mixer.test.ts / routingStore.test.ts seam): the
// takeover's own base writes land AFTER the disengage, so the Mixer
// ensure()s a graph mid-test.
class FakeParam {
  value = 0;
  cancelScheduledValues(): void {}
  setValueAtTime(v: number): void {
    this.value = v;
  }
  linearRampToValueAtTime(v: number): void {
    this.value = v;
  }
  setTargetAtTime(v: number): void {
    this.value = v;
  }
}

class FakeNode {
  connect(destination: FakeNode): FakeNode {
    return destination;
  }
  disconnect(): void {}
}

class FakeAudioContext {
  currentTime = 0;
  state = 'running';
  destination = new FakeNode();

  private param(initial = 0): FakeParam {
    const p = new FakeParam();
    p.value = initial;
    return p;
  }

  createGain() {
    return Object.assign(new FakeNode(), { gain: this.param(1) });
  }
  createBiquadFilter() {
    return Object.assign(new FakeNode(), {
      type: 'lowpass',
      frequency: this.param(350),
      Q: this.param(1),
    });
  }
  createWaveShaper() {
    return Object.assign(new FakeNode(), { curve: null, oversample: 'none' });
  }
  createMediaStreamDestination() {
    return Object.assign(new FakeNode(), { stream: {} });
  }
  createConstantSource() {
    return Object.assign(new FakeNode(), { offset: this.param(1), start(): void {} });
  }
  createAnalyser() {
    return Object.assign(new FakeNode(), {
      fftSize: 2048,
      getFloatTimeDomainData: (): void => {},
    });
  }
  createChannelSplitter() {
    return new FakeNode();
  }
  createChannelMerger() {
    return new FakeNode();
  }
  async setSinkId(): Promise<void> {}
  async suspend(): Promise<void> {}
  async resume(): Promise<void> {}
  async close(): Promise<void> {}
}

describe('watchAuditionTakeover', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', fakeStorage());
    vi.stubGlobal('AudioContext', FakeAudioContext);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a fader move while holding stands the audition down and releases', () => {
    const { mixer, standDown, cancelArm } = setup();
    mixer.setAutomation('A', { fader: 0.7, eq: { low: 0.5, mid: 0.5, high: 0.5 }, filter: 0 });
    mixer.setFader('A', 0.2); // the human hand
    expect(standDown).toHaveBeenCalledTimes(1);
    expect(cancelArm).toHaveBeenCalledTimes(1);
    expect(audibleHolder()).toBe('shared');
    expect(mixer.isAutomationEngaged()).toBe(false);
  });

  it('lands the sounding automation values in base, sparing the touched field', () => {
    const { mixer } = setup();
    mixer.setAutomation('A', { fader: 0.7, eq: { low: 0.1, mid: 0.2, high: 0.3 }, filter: 0.4 });
    mixer.setAutomation('B', { fader: 0.6, eq: { low: 0.5, mid: 0.5, high: 0.5 }, filter: -0.5 });
    mixer.setFader('A', 0.25); // the gesture — A.fader is the user's now
    const a = mixer.getChannelState('A');
    const b = mixer.getChannelState('B');
    expect(a.fader).toBe(0.25); // spared — the user's own value
    expect(a.eq).toEqual({ low: 0.1, mid: 0.2, high: 0.3 });
    expect(a.filter).toBe(0.4);
    expect(b.fader).toBe(0.6);
    expect(b.filter).toBe(-0.5);
  });

  it('lands the pinned-neutral crossfader unless the gesture WAS the crossfader', () => {
    const { mixer } = setup();
    mixer.setAutomation('A', { fader: 1, eq: { low: 0.5, mid: 0.5, high: 0.5 }, filter: 0 });
    mixer.setCrossfader(0.8);
    // The crossfader gesture is spared: base keeps the user's position.
    expect(mixer.getCrossfader()).toBe(0.8);
    expect(audibleHolder()).toBe('shared');
  });

  it('a fader gesture lands crossfader neutral (the overlay pinned it)', () => {
    const { mixer } = setup();
    mixer.setAutomation('A', { fader: 1, eq: { low: 0.5, mid: 0.5, high: 0.5 }, filter: 0 });
    // Base crossfader sat off-center from before the claim.
    releaseAudible('editor');
    mixer.setCrossfader(-0.6);
    claimAudible('editor');
    mixer.setFader('B', 0.1);
    expect(mixer.getCrossfader()).toBe(0);
    expect(audibleHolder()).toBe('shared');
  });

  it('a trim lane lands its trim; a channel without lanes keeps base', () => {
    const { mixer } = setup();
    mixer.setAutomation('A', {
      fader: 1,
      eq: { low: 0.5, mid: 0.5, high: 0.5 },
      filter: 0,
      trim: 0.9,
    });
    mixer.setEq('B', 'low', 0.3); // gesture on B — no B lanes ever written
    expect(mixer.getChannelState('A').trim).toBe(0.9);
    expect(mixer.getChannelState('B').eq.low).toBe(0.3); // spared
    expect(mixer.getChannelState('B').fader).toBe(1); // untouched default
  });

  it('fires exactly once per gesture (its own base-sync writes are guarded)', () => {
    const { mixer, standDown, takeToken } = setup();
    mixer.setAutomation('A', { fader: 0.7, eq: { low: 0.1, mid: 0.2, high: 0.3 }, filter: 0.4 });
    mixer.setFader('A', 0.2);
    expect(standDown).toHaveBeenCalledTimes(1);
    expect(takeToken).toHaveBeenCalledTimes(1);
  });

  it('master and pfl are takeover triggers (Conductor parity)', () => {
    const first = setup();
    first.mixer.setMaster(0.3);
    expect(first.standDown).toHaveBeenCalledTimes(1);
    expect(audibleHolder()).toBe('shared');
    first.unsub();
    const second = setup();
    second.mixer.togglePfl('A');
    expect(second.standDown).toHaveBeenCalledTimes(1);
    second.unsub();
  });

  it('ignores gestures while not the holder — and still tracks last values', () => {
    const { mixer, standDown } = setup({ claim: false });
    mixer.setFader('A', 0.4);
    expect(standDown).not.toHaveBeenCalled();
    expect(isAudible('editor')).toBe(false);
    // Claim later: the pre-claim move must not read as a fresh gesture.
    claimAudible('editor');
    mixer.setFader('A', 0.4); // same value — no change, no takeover
    expect(standDown).not.toHaveBeenCalled();
    mixer.setFader('A', 0.5);
    expect(standDown).toHaveBeenCalledTimes(1);
  });

  it('release-silence lands on a stopped transport: standDown before silence', () => {
    const calls: string[] = [];
    _resetAudibleSurfacesForTests();
    const mixer = new Mixer();
    registerSurface('editor', {
      transport: { togglePlay: () => {} },
      silence: () => calls.push('silence'),
    });
    claimAudible('editor');
    const token = mixer.engageAutomation();
    watchAuditionTakeover({
      mixer,
      surface: 'editor',
      standDown: () => calls.push('standDown'),
      cancelArm: () => {},
      takeToken: () => token,
    });
    mixer.setFader('A', 0.4);
    expect(calls).toEqual(['standDown', 'silence']);
    unregisterSurface('editor');
  });
});
