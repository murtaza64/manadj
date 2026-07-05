/**
 * Mixer automation overlay (ADR 0022, editor-shared-decks 02).
 *
 * Two seams, per ADR 0002:
 * - No-graph paths run against a FORBIDDEN AudioContext (construction
 *   throws): overlay policy must never force-create a context
 *   (headphone-cue 06's zombie-context lesson).
 * - Graph-level invariants run against a recording fake AudioContext (the
 *   browser boundary is a true seam — precedent: routingStore.test.ts).
 *   Node identity is deliberately not asserted; invariants compare the
 *   MULTISET of all AudioParam values (engage→write→disengage must be a
 *   round trip) and equivalence between mixers (crossfader pin).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Mixer } from './mixer';
import { channelFaderToGain } from './mixerMath';
import type { AutomationChannelValues } from './mixer';

const values = (fader: number, eq: number, filter: number): AutomationChannelValues => ({
  fader,
  eq: { low: eq, mid: eq, high: eq },
  filter,
});

// ── Fakes ──────────────────────────────────────────────────────────────

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
  connect(): FakeNode {
    return this;
  }
  disconnect(): void {}
}

/** Records every AudioParam it creates, for multiset assertions. */
class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  params: FakeParam[] = [];
  currentTime = 0;
  state = 'running';
  destination = new FakeNode();

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  private param(initial = 0): FakeParam {
    const p = new FakeParam();
    p.value = initial;
    this.params.push(p);
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
  createDynamicsCompressor() {
    return Object.assign(new FakeNode(), {
      threshold: this.param(-24),
      knee: this.param(30),
      ratio: this.param(12),
      attack: this.param(0.003),
      release: this.param(0.25),
    });
  }
  createMediaStreamDestination() {
    return Object.assign(new FakeNode(), { stream: {} });
  }
  async setSinkId(): Promise<void> {}
  async suspend(): Promise<void> {
    this.state = 'suspended';
  }
  async resume(): Promise<void> {
    this.state = 'running';
  }
  async close(): Promise<void> {
    this.state = 'closed';
  }
}

function withFakeAudio(): typeof FakeAudioContext {
  FakeAudioContext.instances = [];
  vi.stubGlobal('AudioContext', FakeAudioContext);
  return FakeAudioContext;
}

function forbidAudio(): void {
  vi.stubGlobal(
    'AudioContext',
    class {
      constructor() {
        throw new Error('AudioContext must not be created by this path');
      }
    }
  );
}

/** Sorted param values of a fake context — the multiset fingerprint. */
function fingerprint(ctx: FakeAudioContext): number[] {
  return ctx.params.map((p) => p.value).sort((x, y) => x - y);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── No-graph policy paths (context creation forbidden) ─────────────────

describe('automation overlay — no side-effectful context creation', () => {
  it('engage/write/disengage with no graph never create a context', () => {
    forbidAudio();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const mixer = new Mixer();
    expect(mixer.isAutomationEngaged()).toBe(false);
    mixer.engageAutomation();
    expect(mixer.isAutomationEngaged()).toBe(true);
    mixer.setAutomation('A', values(0.2, 0.8, -0.5));
    mixer.disengageAutomation();
    expect(mixer.isAutomationEngaged()).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('automation writes never touch base state and never notify', () => {
    forbidAudio();
    const mixer = new Mixer();
    let notifications = 0;
    mixer.subscribe(() => {
      notifications += 1;
    });
    const before = mixer.getChannelState('A');
    mixer.engageAutomation();
    mixer.setAutomation('A', values(0.13, 0.9, 1));
    mixer.setAutomation('B', values(0.77, 0.1, -1));
    expect(mixer.getChannelState('A')).toBe(before); // reference equality
    expect(mixer.getCrossfader()).toBe(0);
    expect(notifications).toBe(0);
  });

  it('user setters while engaged update base state and notify without touching audio', () => {
    forbidAudio();
    const mixer = new Mixer();
    mixer.engageAutomation();
    let notifications = 0;
    mixer.subscribe(() => {
      notifications += 1;
    });
    mixer.setFader('A', 0.4);
    mixer.setEq('A', 'low', 0.9);
    mixer.setFilter('B', -0.3);
    mixer.setCrossfader(0.5);
    mixer.setCrossfaderEnabled(false);
    expect(mixer.getChannelState('A').fader).toBe(0.4);
    expect(mixer.getChannelState('A').eq.low).toBe(0.9);
    expect(mixer.getChannelState('B').filter).toBe(-0.3);
    expect(mixer.getCrossfader()).toBe(0.5);
    expect(mixer.getCrossfaderEnabled()).toBe(false);
    expect(notifications).toBe(5);
  });

  it('setAutomation while disengaged is a warned no-op', () => {
    forbidAudio();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const mixer = new Mixer();
    mixer.setAutomation('A', values(0, 0, 0));
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

// ── Read accessor for ghost indicators (sets 15) ────────────────────────

describe('automation overlay — getAutomation read accessor', () => {
  it('is null while disengaged and per-channel null before the first write', () => {
    forbidAudio();
    const mixer = new Mixer();
    expect(mixer.getAutomation('A')).toBeNull();
    expect(mixer.getAutomation('B')).toBeNull();
    mixer.engageAutomation();
    // Engaged but nothing written yet: nothing to ghost.
    expect(mixer.getAutomation('A')).toBeNull();
    expect(mixer.getAutomation('B')).toBeNull();
  });

  it('returns the written values per channel and null again after disengage', () => {
    forbidAudio();
    const mixer = new Mixer();
    mixer.engageAutomation();
    const a = values(0.2, 0.8, -0.5);
    mixer.setAutomation('A', a);
    expect(mixer.getAutomation('A')).toEqual(a);
    expect(mixer.getAutomation('B')).toBeNull(); // B never written
    mixer.disengageAutomation();
    expect(mixer.getAutomation('A')).toBeNull();
  });

  it('reads never notify and are insulated from base-state moves', () => {
    forbidAudio();
    const mixer = new Mixer();
    mixer.engageAutomation();
    const a = values(0.3, 0.6, 0.1);
    mixer.setAutomation('A', a);
    let notifications = 0;
    mixer.subscribe(() => {
      notifications += 1;
    });
    mixer.getAutomation('A');
    expect(notifications).toBe(0);
    // A user gesture mid-automation (takeover write) changes base state
    // only — the overlay's values are untouched.
    mixer.setFader('A', 0.99);
    expect(mixer.getAutomation('A')).toEqual(a);
    expect(mixer.getChannelState('A').fader).toBe(0.99);
  });
});

// ── Graph-level invariants (recording fake context) ────────────────────

describe('automation overlay — node ownership round trip', () => {
  it('engage → write → disengage restores every param to base state', () => {
    const Fake = withFakeAudio();
    const mixer = new Mixer();
    mixer.setFader('A', 0.42); // builds the graph (user setter, disengaged)
    mixer.setEq('B', 'mid', 0.7);
    mixer.setFilter('A', 0.25);
    const ctx = Fake.instances[0];
    const base = fingerprint(ctx);

    mixer.engageAutomation();
    mixer.setAutomation('A', values(1, 0.05, -0.9));
    mixer.setAutomation('B', values(0.01, 1, 0.9));
    expect(fingerprint(ctx)).not.toEqual(base); // automation audibly owns

    mixer.disengageAutomation();
    expect(fingerprint(ctx)).toEqual(base);
  });

  it('base-state knob moves while engaged land on disengage, not before', () => {
    const Fake = withFakeAudio();
    const mixer = new Mixer();
    mixer.now(); // build graph
    const ctx = Fake.instances[0];
    mixer.engageAutomation();
    mixer.setAutomation('A', values(1, 0.5, 0));
    const during = fingerprint(ctx);
    mixer.setFader('A', 0.11); // base write while engaged: no node change
    expect(fingerprint(ctx)).toEqual(during);
    mixer.disengageAutomation();
    // The knob move is now audible: some param carries its gain.
    expect(fingerprint(ctx)).toContain(channelFaderToGain(0.11));
  });

  it('pins the crossfader to neutral while engaged, stored position kept', () => {
    const Fake = withFakeAudio();
    const pinned = new Mixer();
    pinned.setCrossfader(-1); // hard left, then engage
    pinned.engageAutomation();
    const centered = new Mixer();
    centered.now(); // default crossfader (0), no overlay
    // Same construction order → comparable fingerprints: the pinned
    // mixer's graph must look exactly like a centered one.
    expect(fingerprint(Fake.instances[0])).toEqual(fingerprint(Fake.instances[1]));
    expect(pinned.getCrossfader()).toBe(-1);
    pinned.disengageAutomation();
    expect(fingerprint(Fake.instances[0])).not.toEqual(fingerprint(Fake.instances[1]));
  });

  it('graph revival while engaged restores automation ownership, not base state', () => {
    const Fake = withFakeAudio();
    const mixer = new Mixer();
    mixer.setFader('A', 0.42); // distinctive base value (builds the graph)
    mixer.engageAutomation();
    mixer.setAutomation('A', values(0.13, 0.5, 0));
    mixer.dispose();
    mixer.now(); // revives: second fake context
    const revived = Fake.instances[1];
    expect(revived).toBeDefined();
    expect(fingerprint(revived)).toContain(channelFaderToGain(0.13));
    expect(fingerprint(revived)).not.toContain(channelFaderToGain(0.42)); // base not applied
    expect(mixer.getChannelState('A').fader).toBe(0.42); // base untouched
  });
});
