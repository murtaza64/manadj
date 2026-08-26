/**
 * Handover detector (transition-takes 02) — the glossary's Handover
 * definition as executable scenarios: clean blend, hard cut, cross-cut
 * folding, tease-and-bail, PFL invisibility, mid-blend session end,
 * chaining, deck-agnostic direction. Synthetic streams share the real
 * capture event format (the seam under test).
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_DETECTOR_PARAMS, DETECTOR_VERSION } from './events';
import type { CaptureDeck, CaptureEvent, DetectedTake } from './events';
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
    load(channel: CaptureDeck, trackId: number) {
      events.push({ t, kind: 'load', channel, trackId, bpm: 174 });
      return s;
    },
    play(channel: CaptureDeck) {
      events.push({ t, kind: 'transport', channel, action: 'play', playhead: 0 });
      return s;
    },
    pause(channel: CaptureDeck) {
      events.push({ t, kind: 'transport', channel, action: 'pause', playhead: 0 });
      return s;
    },
    fader(channel: CaptureDeck, value: number) {
      events.push({ t, kind: 'control', control: 'fader', channel, value });
      return s;
    },
    crossfader(value: number) {
      events.push({ t, kind: 'control', control: 'crossfader', channel: null, value });
      return s;
    },
    assignment(channel: CaptureDeck, side: 'left' | 'thru' | 'right') {
      events.push({
        t,
        kind: 'control',
        control: 'crossfaderAssignment',
        channel,
        value: side === 'left' ? -1 : side === 'right' ? 1 : 0,
      });
      return s;
    },
    tenure(edge: 'start' | 'end', holder = 'editor') {
      events.push({ t, kind: 'tenure', edge, holder });
      return s;
    },
    pfl(channel: CaptureDeck, on: boolean) {
      events.push({ t, kind: 'control', control: 'pfl', channel, value: on ? 1 : 0 });
      return s;
    },
    eq(channel: CaptureDeck, band: 'eqLow' | 'eqMid' | 'eqHigh', value: number) {
      events.push({ t, kind: 'control', control: band, channel, value });
      return s;
    },
    filter(channel: CaptureDeck, value: number) {
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

describe('entry onset (#178): the window starts at the entry gesture', () => {
  it('hot entry — fader standing, transport start later: onset at the play event', () => {
    const s = incumbentA();
    s.at(10).fader('B', 1); // fader standing, deck not yet playing
    s.at(13).play('B').advance(10).at(25).fader('A', 0).advance(HORIZON + 1);
    const { takes } = run(s.events());
    expect(takes).toHaveLength(1);
    expect(takes[0].windowStartS).toBe(13);
    expect(takes[0].windowEndS).toBe(25);
  });

  it('play-then-slam: backdates to the first sound, not the audibleGain crossing', () => {
    const s = incumbentA();
    // B starts silent (fader 0), then the fader slams up in steps: first
    // sound at 12 (gain ~5e-5), the audibleGain crossing at 12.6. The
    // Reflexion→Higher defect: windows opened at the crossing, clipping
    // the incoming's first 1–2 beats.
    s.at(11).play('B');
    s.at(12).fader('B', 0.01).at(12.3).fader('B', 0.2).at(12.6).fader('B', 0.5);
    s.advance(8).at(21).fader('A', 0).advance(HORIZON + 1);
    const { takes } = run(s.events());
    expect(takes).toHaveLength(1);
    expect(takes[0].windowStartS).toBe(12);
    expect(takes[0].windowEndS).toBe(21);
  });

  it('the backdate is capped at entryBackdateMaxS', () => {
    const s = incumbentA();
    // B whispers far below audibleGain for 10s (sounding clock open),
    // then slams to full: the window may reach back only the cap.
    s.at(10).play('B').fader('B', 0.05);
    s.advance(9);
    s.at(20).fader('B', 1).advance(5).at(26).fader('A', 0).advance(HORIZON + 1);
    const { takes } = run(s.events());
    expect(takes).toHaveLength(1);
    expect(takes[0].windowStartS).toBe(20 - DEFAULT_DETECTOR_PARAMS.entryBackdateMaxS);
  });

  it('crossfader-driven entry backdates to the crossfader gesture start', () => {
    const s = incumbentA();
    s.at(5).crossfader(-1); // hard left: B's side fully killed
    s.at(10).fader('B', 1).play('B'); // playing, fader up — still silent
    s.at(15).crossfader(-0.99); // the ride begins: first sound
    s.at(16).crossfader(0); // gain crosses audibleGain mid-ride
    s.advance(5).at(22).fader('A', 0).advance(HORIZON + 1);
    const { takes } = run(s.events());
    expect(takes).toHaveLength(1);
    expect(takes[0].windowStartS).toBe(15);
    expect(takes[0].windowEndS).toBe(22);
  });

  it('an overlap cannot predate the incumbent\'s own audibility', () => {
    // Both decks rise together out of silence: the incumbent (first to
    // cross) bounds the backdate.
    const s = script()
      .at(0).load('A', 1).load('B', 2)
      .fader('A', 0).fader('B', 0)
      .play('A').play('B').advance(3);
    s.at(10).fader('A', 0.01).fader('B', 0.01); // both first sound at 10
    s.at(11).fader('A', 1); // A crosses first: incumbent since 11
    s.at(12).fader('B', 1); // B crosses: onset floored at the incumbent's 11
    s.advance(5).at(18).fader('A', 0).advance(HORIZON + 1);
    const { takes } = run(s.events());
    expect(takes).toHaveLength(1);
    expect(takes[0].windowStartS).toBe(11);
  });
});

describe('hard cut', () => {
  it('a crossfader flick (zero overlap, same instant) is a Handover', () => {
    const s = incumbentA();
    s.at(5).crossfader(-1); // full A
    s.at(10).fader('B', 1); // B faded up but crossfader-killed, not yet playing
    s.at(20).crossfader(1).play('B'); // the flick: A killed, B in — same instant
    const { takes } = run(s.at(20).advance(HORIZON + 1).events());
    expect(takes).toHaveLength(1);
    // Cessation and onset coincide, so the window is that instant — the one
    // legitimately degenerate case (a literal same-frame flick).
    expect(takes[0].windowStartS).toBe(20);
    expect(takes[0].windowEndS).toBe(20);
    expect(takes[0].confidence).toBe(0.7);
  });

  it('cessation-then-onset within the cut gap spans the cut ramp, never zero-length (#138)', () => {
    // The Take-960 defect: a fader chop drops the outgoing, the incoming
    // arrives a beat later. The window must span the cut ramp (cessation →
    // incoming onset), not collapse to a single instant.
    const s = incumbentA();
    s.at(20).fader('A', 0).at(21).play('B').fader('B', 1).advance(HORIZON + 1);
    const { takes } = run(s.events());
    expect(takes).toHaveLength(1);
    expect(takes[0].windowStartS).toBe(20); // outgoing cessation
    expect(takes[0].windowEndS).toBe(21); // incoming onset
    expect(takes[0].windowEndS).toBeGreaterThan(takes[0].windowStartS);
  });

  it('a gap longer than the cut gap is silence between tracks, not a Handover', () => {
    const s = incumbentA();
    s.at(20).fader('A', 0).at(26).play('B').fader('B', 1).advance(HORIZON + 1);
    const { takes } = run(s.events());
    expect(takes).toHaveLength(0);
  });
});

describe('cut-window hygiene (#138 defect 1: never zero-length)', () => {
  it('a fader chop then the incoming a fraction later spans the ramp, not a point', () => {
    // The real repro (Take 960, session 19 @72572.5): the outgoing is
    // fader-chopped to silence, the incoming ramps up ~0.3s later. The
    // window must span that cut ramp.
    const s = incumbentA();
    s.at(20).fader('A', 0); // outgoing cessation
    s.at(20.3).play('B').fader('B', 1); // incoming onset within the cut gap
    s.advance(HORIZON + 1);
    const { takes } = run(s.events());
    expect(takes).toHaveLength(1);
    expect(takes[0].windowStartS).toBe(20);
    expect(takes[0].windowEndS).toBeCloseTo(20.3, 6);
    expect(takes[0].windowEndS).toBeGreaterThan(takes[0].windowStartS);
    expect(takes[0].confidence).toBe(0.7); // sub-second overlap tier
  });

  it('a deck-agnostic cut (B out, D in) also gets a non-degenerate window', () => {
    // Take 960 traded on B→D, not A→B — the fix is per unordered pair.
    const s = script().at(0).load('B', 191).load('D', 597).fader('D', 0).play('B').advance(10);
    s.at(20).fader('B', 0); // Under the Waves out
    s.at(20.3).play('D').fader('D', 1); // Sovereign in
    s.advance(HORIZON + 1);
    const { takes } = run(s.events());
    expect(takes).toHaveLength(1);
    expect(takes[0].outgoingTrackId).toBe(191);
    expect(takes[0].incomingTrackId).toBe(597);
    expect(takes[0].outgoingDeck).toBe('B');
    expect(takes[0].incomingDeck).toBe('D');
    expect(takes[0].windowEndS).toBeGreaterThan(takes[0].windowStartS);
  });
});

describe('one engagement, one Take per ordered pair (#138 defect 2)', () => {
  it('an outgoing flicker across the horizon settles the pair once, not twice', () => {
    // The real repro (session 19, Bangarang→Full Send twice): the outgoing
    // briefly re-departs and returns while the incoming stays; the machine
    // must not settle the same ordered pair a second time.
    const s = incumbentA();
    s.at(10).play('B').fader('B', 1); // engagement 1→2 opens
    s.at(20).fader('A', 0); // outgoing dips out...
    s.at(23).fader('A', 1); // ...and returns within the horizon (folds)
    s.at(30).fader('A', 0); // final cessation
    s.advance(HORIZON + 1);
    const { takes } = run(s.events());
    expect(takes).toHaveLength(1);
    expect(takes[0].outgoingTrackId).toBe(1);
    expect(takes[0].incomingTrackId).toBe(2);
    expect(takes[0].windowStartS).toBe(10);
    expect(takes[0].windowEndS).toBe(30);
  });

  it('a genuinely separate later re-mix of the same pair is NOT suppressed', () => {
    // The guard is horizon-scoped: a real second mix of the same ordered
    // pair, well past the settle horizon, is its own Handover.
    const s = incumbentA();
    // Take 1→2 #1: B mixes in, A out.
    s.at(10).play('B').fader('B', 1).at(20).fader('A', 0).advance(HORIZON + 1);
    // Re-establish track 1 as the floor: A fades back in, B out — a 2→1
    // Handover well past the horizon.
    s.at(60).fader('A', 1).at(70).fader('B', 0).advance(HORIZON + 1);
    // Take 1→2 #2: B mixes in again, A out.
    s.at(100).fader('B', 1).at(110).fader('A', 0).advance(HORIZON + 1);
    const { takes } = run(s.events());
    const oneToTwo = takes.filter((t) => t.outgoingTrackId === 1 && t.incomingTrackId === 2);
    expect(oneToTwo).toHaveLength(2);
    expect(oneToTwo[1].windowEndS - oneToTwo[0].windowEndS).toBeGreaterThan(HORIZON);
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
    expect(state.pairs.AB.incumbent).toBe('A'); // A still owns the floor
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
    expect(state.pairs.AB.incumbent).toBeNull();
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
    // ROLE-shaped init (4dp 10): 'A' is always the outgoing role; the
    // physical decks ride the stamp. This was a physical-B→A handover.
    expect(head.outgoingChannel).toBe('A');
    expect(head.physicalDecks).toEqual({ outgoing: 'B', incoming: 'A' });
    expect(head.decks.A.trackId).toBe(2); // outgoing role = physical B's track
    expect(head.decks.B.trackId).toBe(1); // incoming role = physical A's track
    expect(head.decks.B.fader).toBe(1); // reflects the fade-in at open
    expect(head.crossfader).toBe(0);
    expect(takes[0].outgoingDeck).toBe('B');
    expect(takes[0].incomingDeck).toBe('A');
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

// The >2-audible self-gate is RETIRED (four-deck-performance 37): the pair
// machine's survivor rule is pairwise-local, so a third audible deck — a
// double, a layer — no longer discards the in-flight engagement. The data
// behind the change: 101/102 real 3-audible stretches landed inside a
// blend and destroyed its Take (docs/research/three-deck-mixing-reality.md).
describe('third-deck audibility does not gate the pair machine (4dp 37)', () => {
  it('emits the A→B Take with a third deck audible over the whole blend — plus the liberal A→C sibling', () => {
    // A incumbent, C audible throughout, B blends in and A fades out.
    // The AB machine settles A→B (previously nuked by suspension); the AC
    // machine legitimately reads A-ceased-while-C-persisted as A→C too —
    // the glossary Handover rule is per ordered pair, deliberately
    // liberal. Grouping the siblings is 4dp 11.
    const s = script()
      .at(0)
      .load('A', 1)
      .load('B', 2)
      .load('C', 3)
      .fader('B', 0)
      .play('A')
      .play('C') // A + C audible
      .advance(10);
    s.at(10).play('B').fader('B', 1).advance(2); // A+B+C audible
    s.at(12).fader('A', 0).advance(HORIZON + 1);
    const { takes } = run(s.events());
    expect(takes).toHaveLength(2);
    const ab = takes.find((t) => t.incomingTrackId === 2)!;
    expect(ab.outgoingTrackId).toBe(1);
    expect(ab.outgoingDeck).toBe('A');
    expect(ab.incomingDeck).toBe('B');
    const ac = takes.find((t) => t.incomingTrackId === 3)!;
    expect(ac.outgoingTrackId).toBe(1);
    expect(ac.incomingDeck).toBe('C');
  });

  it('a layer entering AND leaving mid-blend leaves the engagement intact', () => {
    // The accent-over-blend case: C stabs in for 3s inside an A→B blend.
    const s = script()
      .at(0)
      .load('A', 1)
      .load('B', 2)
      .load('C', 3)
      .fader('B', 0)
      .play('A')
      .advance(10);
    s.at(10).play('B').fader('B', 1).advance(2); // engagement opens
    s.at(12).play('C').advance(3).at(15).pause('C'); // the layer
    s.at(16).fader('A', 0).advance(HORIZON + 1);
    const { takes } = run(s.events());
    expect(takes).toHaveLength(1);
    expect(takes[0].outgoingTrackId).toBe(1);
    expect(takes[0].incomingTrackId).toBe(2);
  });

  it('keeps every deck in the log; three audible does not suspend', () => {
    const s = script()
      .at(0)
      .load('A', 1)
      .load('B', 2)
      .load('C', 3)
      .play('A')
      .play('B')
      .play('C')
      .advance(2);
    const { state } = run(s.events());
    const loadedDecks = new Set(
      state.log.filter((e) => e.kind === 'load').map((e) => (e as { channel: string }).channel)
    );
    expect(loadedDecks).toEqual(new Set(['A', 'B', 'C']));
    expect(state.suspended).toBe(false);
  });

  it('a thru-routed audible third deck does not disturb the A→B verdict either', () => {
    const s = script()
      .at(0)
      .load('A', 1)
      .load('B', 2)
      .load('C', 3)
      .assignment('C', 'thru')
      .fader('B', 0)
      .play('A')
      .play('C')
      .advance(10);
    s.at(10).play('B').fader('B', 1).advance(2).at(12).fader('A', 0).advance(HORIZON + 1);
    const { takes } = run(s.events());
    // A→B plus the liberal A→C sibling (C persisted through A's cessation).
    expect(takes.some((t) => t.incomingTrackId === 2 && t.outgoingTrackId === 1)).toBe(true);
    expect(takes).toHaveLength(2);
  });
});

// Tenure markers (ADR 0033): a machine holding the shared surface suspends
// verdicts exactly as the old recorder surface gate did — the log records
// only THAT the surface was held.
describe('tenure markers (ADR 0033)', () => {
  it('suspends the pair machine between a tenure start and end', () => {
    const s = incumbentA();
    s.at(10).tenure('start'); // a machine takes the surface mid-run
    s.at(10).play('B').fader('B', 1).advance(2).at(12).fader('A', 0).advance(HORIZON + 1);
    s.at(21).tenure('end'); // surface returns — nothing settled while held
    const { takes, state } = run(s.events());
    expect(takes).toHaveLength(0);
    expect(state.suspended).toBe(false); // released
  });

  it('a Handover after the tenure ends is captured (re-seed)', () => {
    const s = script().at(0).load('A', 1).load('B', 2).fader('B', 0).play('A').advance(2);
    s.at(2).tenure('start').advance(5).at(7).tenure('end'); // machine held 2..7
    s.at(7).play('B').fader('B', 1).advance(2).at(9).fader('A', 0).advance(HORIZON + 1);
    const { takes } = run(s.events());
    expect(takes).toHaveLength(1);
    expect(takes[0].outgoingTrackId).toBe(1);
    expect(takes[0].incomingTrackId).toBe(2);
  });
});

// Per-pair machines beyond A/B (four-deck-performance 10): the D-era
// patterns from docs/research/three-deck-mixing-reality.md.
describe('pairwise machines across the four decks (4dp 10)', () => {
  it('a clean B→D handover settles a Take with role-relabeled slice + physical stamp', () => {
    const s = script()
      .at(0)
      .load('B', 5)
      .load('D', 7)
      .fader('D', 0)
      .play('B')
      .advance(10);
    s.at(10).play('D').fader('D', 1).advance(2);
    s.at(12).fader('B', 0).advance(HORIZON + 1);
    const { takes } = run(s.events());
    expect(takes).toHaveLength(1);
    expect(takes[0].outgoingTrackId).toBe(5);
    expect(takes[0].incomingTrackId).toBe(7);
    expect(takes[0].outgoingDeck).toBe('B');
    expect(takes[0].incomingDeck).toBe('D');
    // The slice is role-shaped: only role channels A (=B) and B (=D).
    const head = takes[0].events[0];
    if (head.kind !== 'init') throw new Error('slice must start with init');
    expect(head.physicalDecks).toEqual({ outgoing: 'B', incoming: 'D' });
    expect(head.decks.A.trackId).toBe(5);
    expect(head.decks.B.trackId).toBe(7);
    for (const ev of takes[0].events) {
      if ('channel' in ev && ev.channel !== null) {
        expect(['A', 'B']).toContain(ev.channel);
      }
      if (ev.kind === 'tick') {
        for (const ch of Object.keys(ev.playheads)) expect(['A', 'B']).toContain(ch);
      }
    }
  });

  it('a strict double-out (A+B → D) emits the liberal twin Takes A→D and B→D', () => {
    const s = script()
      .at(0)
      .load('A', 1)
      .load('B', 2)
      .load('D', 7)
      .fader('D', 0)
      .play('A')
      .play('B') // A + B both audible (the running double)
      .advance(10);
    s.at(10).play('D').fader('D', 1).advance(2); // D drops in
    s.at(12).fader('A', 0).fader('B', 0).advance(HORIZON + 1); // both out
    const { takes } = run(s.events());
    const pairs = takes.map((t) => `${t.outgoingDeck}>${t.incomingDeck}`).sort();
    expect(pairs).toContain('A>D');
    expect(pairs).toContain('B>D');
    for (const t of takes.filter((x) => x.incomingDeck === 'D')) {
      expect(t.incomingTrackId).toBe(7);
    }
  });

  it('a double collapsing back to its host emits nothing (the 76% case)', () => {
    // A hosts; D layers in for 30s and fades back out; A plays on.
    const s = script()
      .at(0)
      .load('A', 1)
      .load('D', 7)
      .fader('D', 0)
      .play('A')
      .advance(10);
    s.at(10).play('D').fader('D', 1).advance(30);
    s.at(40).fader('D', 0).advance(HORIZON + 2); // layer out; A persists
    const { takes } = run(s.events());
    expect(takes).toHaveLength(0);
  });

  it('a chained-double half-swap emits both ordered-pair verdicts (A→B and A→D)', () => {
    // A+D running double; B drops in; A leaves — B+D double continues.
    const s = script()
      .at(0)
      .load('A', 1)
      .load('B', 2)
      .load('D', 7)
      .fader('B', 0)
      .play('A')
      .advance(5);
    s.at(5).play('D').advance(20); // the A+D double (D default fader 1)
    s.at(25).play('B').fader('B', 1).advance(2);
    s.at(27).fader('A', 0).advance(HORIZON + 1); // half-swap: A out
    const { takes } = run(s.events());
    const pairs = takes.map((t) => `${t.outgoingDeck}>${t.incomingDeck}`).sort();
    expect(pairs).toEqual(['A>B', 'A>D']);
    const ad = takes.find((t) => t.incomingDeck === 'D')!;
    expect(ad.outgoingTrackId).toBe(1);
    expect(ad.incomingTrackId).toBe(7);
  });

  it('tenure suspends every pair machine', () => {
    const s = script()
      .at(0)
      .load('B', 5)
      .load('D', 7)
      .fader('D', 0)
      .play('B')
      .advance(5);
    s.at(5).tenure('start');
    s.at(5).play('D').fader('D', 1).advance(2).at(7).fader('B', 0).advance(HORIZON + 1);
    s.at(20).tenure('end');
    const { takes } = run(s.events());
    expect(takes).toHaveLength(0);
  });
});
