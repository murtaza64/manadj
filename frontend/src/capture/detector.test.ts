/**
 * Handover detector (transition-takes 02) — the glossary's Handover
 * definition as executable scenarios: clean blend, hard cut, cross-cut
 * folding, tease-and-bail, PFL invisibility, mid-blend session end,
 * chaining, deck-agnostic direction. Synthetic streams share the real
 * capture event format (the seam under test).
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_DETECTOR_PARAMS, DETECTOR_VERSION } from './events';
import type { CaptureChannel, CaptureEvent, DetectedTake } from './events';
import { initialCaptureState, reduceCapture } from './detector';
import type { CaptureState } from './detector';

/** Tiny stream DSL: absolute-time cursor, 1 Hz ticks via advance(). */
function script() {
  let t = 0;
  const events: CaptureEvent[] = [];
  const s = {
    at(sec: number) {
      t = sec;
      return s;
    },
    load(channel: CaptureChannel, trackId: number) {
      events.push({ t, kind: 'load', channel, trackId, bpm: 174 });
      return s;
    },
    play(channel: CaptureChannel) {
      events.push({ t, kind: 'transport', channel, action: 'play', playhead: 0 });
      return s;
    },
    pause(channel: CaptureChannel) {
      events.push({ t, kind: 'transport', channel, action: 'pause', playhead: 0 });
      return s;
    },
    fader(channel: CaptureChannel, value: number) {
      events.push({ t, kind: 'control', control: 'fader', channel, value });
      return s;
    },
    crossfader(value: number) {
      events.push({ t, kind: 'control', control: 'crossfader', channel: null, value });
      return s;
    },
    pfl(channel: CaptureChannel, on: boolean) {
      events.push({ t, kind: 'control', control: 'pfl', channel, value: on ? 1 : 0 });
      return s;
    },
    eq(channel: CaptureChannel, band: 'eqLow' | 'eqMid' | 'eqHigh', value: number) {
      events.push({ t, kind: 'control', control: band, channel, value });
      return s;
    },
    filter(channel: CaptureChannel, value: number) {
      events.push({ t, kind: 'control', control: 'filter', channel, value });
      return s;
    },
    advance(sec: number) {
      for (let i = 0; i < sec; i++) {
        t += 1;
        events.push({ t, kind: 'tick', playheads: {} });
      }
      return s;
    },
    events: () => events,
  };
  return s;
}

function run(events: CaptureEvent[]): { state: CaptureState; takes: DetectedTake[] } {
  let state = initialCaptureState();
  const takes: DetectedTake[] = [];
  for (const e of events) {
    const [next, emitted] = reduceCapture(state, e);
    state = next;
    takes.push(...emitted);
  }
  return { state, takes };
}

/** Track 1 playing audibly on A, track 2 loaded on B (silent: fader 0). */
function incumbentA() {
  return script().at(0).load('A', 1).load('B', 2).fader('B', 0).play('A').advance(10);
}

const HORIZON = DEFAULT_DETECTOR_PARAMS.settleHorizonS;

describe('clean blend', () => {
  it('emits exactly one directional Take once the outgoing settles silent', () => {
    const s = incumbentA();
    // t=10: B starts (inaudible), fades in over 12..14, A fades out at 20.
    s.at(10).play('B').at(12).fader('B', 1).advance(8).at(20).fader('A', 0).advance(HORIZON + 1);
    const { takes } = run(s.events());
    expect(takes).toHaveLength(1);
    const take = takes[0];
    expect(take.outgoingTrackId).toBe(1);
    expect(take.incomingTrackId).toBe(2);
    expect(take.windowStartS).toBe(12); // incoming's first audibility
    expect(take.windowEndS).toBe(20); // outgoing's final cessation
    expect(take.confidence).toBe(0.9);
    expect(take.detectorVersion).toBe(DETECTOR_VERSION);
  });

  it('slices the raw events to the padded window', () => {
    const s = incumbentA();
    s.at(10).play('B').at(12).fader('B', 1).advance(8).at(20).fader('A', 0).advance(HORIZON + 1);
    const { takes } = run(s.events());
    const { padS } = DEFAULT_DETECTOR_PARAMS;
    for (const ev of takes[0].events) {
      expect(ev.t).toBeGreaterThanOrEqual(12 - padS);
      expect(ev.t).toBeLessThanOrEqual(20 + padS);
    }
    // The decisive fader moves are in the slice.
    expect(takes[0].events.some((e) => e.kind === 'control' && e.control === 'fader' && e.channel === 'B')).toBe(true);
    expect(takes[0].events.some((e) => e.kind === 'control' && e.control === 'fader' && e.channel === 'A')).toBe(true);
  });

  it('the lazy handover (no fader work, A just ends) still counts', () => {
    const s = incumbentA();
    s.at(10).fader('B', 1).play('B').advance(20).at(30).pause('A').advance(HORIZON + 1);
    const { takes } = run(s.events());
    expect(takes).toHaveLength(1);
    expect(takes[0].windowStartS).toBe(10);
    expect(takes[0].windowEndS).toBe(30);
  });
});

describe('hard cut', () => {
  it('a crossfader flick (zero overlap) is a Handover', () => {
    const s = incumbentA();
    s.at(5).crossfader(-1); // full A
    s.at(10).fader('B', 1); // B faded up but crossfader-killed, not yet playing
    s.at(20).crossfader(1).play('B'); // the flick: A killed, B in — same instant
    const { takes } = run(s.at(20).advance(HORIZON + 1).events());
    expect(takes).toHaveLength(1);
    expect(takes[0].windowStartS).toBe(20);
    expect(takes[0].windowEndS).toBe(20);
    expect(takes[0].confidence).toBe(0.7);
  });

  it('cessation-then-onset within the cut gap is one Handover, anchored at the cut', () => {
    const s = incumbentA();
    s.at(20).fader('A', 0).at(21).play('B').fader('B', 1).advance(HORIZON + 1);
    const { takes } = run(s.events());
    expect(takes).toHaveLength(1);
    expect(takes[0].windowStartS).toBe(20);
    expect(takes[0].windowEndS).toBe(20);
  });

  it('a gap longer than the cut gap is silence between tracks, not a Handover', () => {
    const s = incumbentA();
    s.at(20).fader('A', 0).at(26).play('B').fader('B', 1).advance(HORIZON + 1);
    const { takes } = run(s.events());
    expect(takes).toHaveLength(0);
  });
});

describe('cross-cuts fold (dnb teases, double drops)', () => {
  it('outgoing returns within the horizon: one Take, window from the first trade', () => {
    const s = incumbentA();
    // B in at 10; cross-cut A out 12..14; A back; final A out at 20.
    s.at(10).play('B').fader('B', 1);
    s.at(12).crossfader(1).at(14).crossfader(0);
    s.at(20).fader('A', 0).advance(HORIZON + 1);
    const { takes } = run(s.events());
    expect(takes).toHaveLength(1);
    expect(takes[0].windowStartS).toBe(10);
    expect(takes[0].windowEndS).toBe(20);
  });

  it('a tease where the outgoing survives is no Handover at all', () => {
    const s = incumbentA();
    // B in for 3s, bailed back out; A plays on.
    s.at(10).play('B').fader('B', 1).at(13).fader('B', 0).advance(HORIZON + 2);
    const { state, takes } = run(s.events());
    expect(takes).toHaveLength(0);
    expect(state.incumbent).toBe('A'); // A still owns the floor
  });

  it('a tease that flows into the real mix is ONE Take including the tease', () => {
    const s = incumbentA();
    s.at(10).play('B').fader('B', 1).at(13).fader('B', 0); // tease
    s.at(16).fader('B', 1); // back within the horizon — folds
    s.at(24).fader('A', 0).advance(HORIZON + 1);
    const { takes } = run(s.events());
    expect(takes).toHaveLength(1);
    expect(takes[0].windowStartS).toBe(10);
    expect(takes[0].windowEndS).toBe(24);
  });
});

describe('kill-style mix-outs (audibility is more than the fader)', () => {
  it('an EQ full-kill mix-out registers as the outgoing cessation', () => {
    const s = incumbentA();
    s.at(10).play('B').fader('B', 1);
    s.at(20).eq('A', 'eqLow', 0).eq('A', 'eqMid', 0).eq('A', 'eqHigh', 0).advance(HORIZON + 1);
    const { takes } = run(s.events());
    expect(takes).toHaveLength(1);
    expect(takes[0].windowEndS).toBe(20);
  });

  it('a sweep filter ridden to its end silences the deck', () => {
    const s = incumbentA();
    s.at(10).play('B').fader('B', 1);
    s.at(20).filter('A', 1).advance(HORIZON + 1);
    const { takes } = run(s.events());
    expect(takes).toHaveLength(1);
    expect(takes[0].windowEndS).toBe(20);
  });

  it('a partial EQ cut is not a cessation', () => {
    const s = incumbentA();
    s.at(10).play('B').fader('B', 1);
    s.at(20).eq('A', 'eqLow', 0).advance(HORIZON + 1); // bass swap, mids/highs live
    const { takes } = run(s.events());
    expect(takes).toHaveLength(0);
  });
});

describe('hard-cut track attribution', () => {
  it('a Load onto the stopped deck within the cut gap cannot steal the outgoing slot', () => {
    const s = incumbentA();
    s.at(20).fader('A', 0); // A (track 1) ceases
    s.at(20.5).load('A', 99); // eager re-load inside the cut gap
    s.at(21).play('B').fader('B', 1).advance(HORIZON + 1);
    const { takes } = run(s.events());
    expect(takes).toHaveLength(1);
    expect(takes[0].outgoingTrackId).toBe(1);
    expect(takes[0].incomingTrackId).toBe(2);
  });
});

describe('a Load re-premises the deck (the rehearsal-reload bug)', () => {
  it('reloading both decks mid-blend ends the engagement: the next mix attributes the NEW pair', () => {
    // The sets-13 rehearsal bug (take db99d514): noodle a pair, then the
    // practice press reloads both decks and re-cues INSIDE the settle
    // horizon — the old engagement must not fold over the reload and
    // swallow the real mix under its stale pair snapshot.
    const s = script().at(0).load('A', 9).load('B', 171).play('A').advance(5);
    s.at(5).play('B').advance(10); // noodling: engagement 9→171 opens
    // Practice press (engine order: load, then transport pause).
    s.at(15).load('A', 609).pause('A').load('B', 780).pause('B');
    s.at(19).play('A').advance(9); // re-cued A back in UNDER the horizon
    s.at(29).play('B').advance(6); // the real mix: 780 in...
    s.at(35).pause('A').advance(HORIZON + 1); // ...609 out
    const { takes } = run(s.events());
    expect(takes).toHaveLength(1);
    expect(takes[0].outgoingTrackId).toBe(609);
    expect(takes[0].incomingTrackId).toBe(780);
    expect(takes[0].windowStartS).toBe(29);
    expect(takes[0].windowEndS).toBe(35);
  });

  it('reloading the INCOMING deck mid-blend bails that engagement; the replacement starts fresh', () => {
    const s = incumbentA();
    s.at(10).play('B').fader('B', 1); // engagement 1→2
    s.at(15).load('B', 3).pause('B'); // change of mind: bail via reload
    s.at(18).play('B'); // the replacement comes in (A still audible)
    s.at(25).fader('A', 0).advance(HORIZON + 1);
    const { takes } = run(s.events());
    expect(takes).toHaveLength(1);
    expect(takes[0].outgoingTrackId).toBe(1);
    expect(takes[0].incomingTrackId).toBe(3);
    expect(takes[0].windowStartS).toBe(18);
    expect(takes[0].windowEndS).toBe(25);
  });

  it('a Load after the outgoing ceased settles the completed Handover immediately (no lost Take)', () => {
    const s = incumbentA();
    s.at(10).play('B').fader('B', 1).at(20).fader('A', 0); // mix completes at 20
    s.at(24).load('A', 3); // eager next-track load INSIDE the horizon
    s.advance(HORIZON + 1);
    const { takes } = run(s.events());
    expect(takes).toHaveLength(1);
    expect(takes[0].outgoingTrackId).toBe(1);
    expect(takes[0].incomingTrackId).toBe(2);
    expect(takes[0].windowStartS).toBe(10);
    expect(takes[0].windowEndS).toBe(20);
  });
});

describe('what detection cannot see', () => {
  it('PFL previewing is invisible', () => {
    const s = incumbentA();
    s.at(10).play('B').pfl('B', true).advance(20).pfl('B', false).pause('B').advance(HORIZON + 1);
    const { takes } = run(s.events());
    expect(takes).toHaveLength(0);
  });

  it('a lone incumbent stopping with nothing incoming is not a Handover', () => {
    const s = incumbentA();
    s.at(20).pause('A').advance(HORIZON + 1);
    const { state, takes } = run(s.events());
    expect(takes).toHaveLength(0);
    expect(state.incumbent).toBeNull();
  });
});

describe('session ends mid-blend', () => {
  it('counts (weaker confidence) when the incoming was audible at the cessation', () => {
    const s = incumbentA();
    s.at(10).play('B').fader('B', 1).at(20).fader('A', 0).at(23).pause('B').advance(HORIZON + 1);
    const { takes } = run(s.events());
    expect(takes).toHaveLength(1);
    expect(takes[0].windowEndS).toBe(20);
    expect(takes[0].confidence).toBe(0.5);
  });
});

describe('direction and chaining', () => {
  it('direction is track-based and deck-agnostic (B can be the outgoing deck)', () => {
    const s = script().at(0).load('A', 1).load('B', 2).fader('A', 0).play('B').advance(10);
    s.at(10).play('A').fader('A', 1).at(20).fader('B', 0).advance(HORIZON + 1);
    const { takes } = run(s.events());
    expect(takes).toHaveLength(1);
    expect(takes[0].outgoingTrackId).toBe(2);
    expect(takes[0].incomingTrackId).toBe(1);
  });

  it('back-to-back handovers chain: the survivor is the next outgoing', () => {
    const s = incumbentA();
    s.at(10).play('B').fader('B', 1).at(20).fader('A', 0).advance(HORIZON + 1);
    // New track onto the freed deck, mix back.
    s.at(40).load('A', 3).play('A').fader('A', 1);
    s.at(50).fader('B', 0).advance(HORIZON + 1);
    const { takes } = run(s.events());
    expect(takes).toHaveLength(2);
    expect(takes[1].outgoingTrackId).toBe(2);
    expect(takes[1].incomingTrackId).toBe(3);
    expect(takes[1].windowStartS).toBe(40);
    expect(takes[1].windowEndS).toBe(50);
  });
});

describe('the slice init head (vectorization input, issue 03)', () => {
  it('every Take slice starts with engagement-open state and deck roles', () => {
    const s = script().at(0).load('A', 1).load('B', 2).fader('A', 0).play('B').advance(10);
    s.at(10).play('A').fader('A', 1).at(20).fader('B', 0).advance(HORIZON + 1);
    const { takes } = run(s.events());
    const head = takes[0].events[0];
    if (head.kind !== 'init') throw new Error('slice must start with init');
    expect(head.t).toBe(takes[0].windowStartS);
    expect(head.outgoingChannel).toBe('B'); // deck-agnostic roles
    expect(head.decks.B.trackId).toBe(2);
    expect(head.decks.A.fader).toBe(1); // reflects the fade-in at open
    expect(head.crossfader).toBe(0);
  });
});

describe('the rolling log', () => {
  it('is pruned while idle (bounded memory), kept through an engagement', () => {
    const s = incumbentA();
    s.advance(300); // 5 idle minutes of ticks
    const { state } = run(s.events());
    const span = state.log[state.log.length - 1].t - state.log[0].t;
    expect(span).toBeLessThanOrEqual(DEFAULT_DETECTOR_PARAMS.idleKeepS + 1);
  });
});
