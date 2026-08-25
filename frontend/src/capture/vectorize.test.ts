/**
 * Vectorizer (transition-takes 03, ADR 0020): raw Take slice → ordinary
 * seconds-based Transition draft. Idealization contract: continuous
 * gestures (Nudge, pitch riding) collapse into static alignment +
 * tempo-match; crossfader × channel-fader compose into per-deck fader
 * lanes; EQ/filter map to their lanes; untouched controls stay out.
 */
import { describe, expect, it } from 'vitest';
import { evalLane } from '../editor/mixModel';
import type { CaptureChannel, CaptureEvent, InitDeckState } from './events';
import { vectorizeTake } from './vectorize';

const deck = (over: Partial<InitDeckState> = {}): InitDeckState => ({
  trackId: 1,
  playing: true,
  fader: 1,
  trim: 0.5,
  eq: { low: 0.5, mid: 0.5, high: 0.5 },
  filter: 0,
  pitch: 0,
  ...over,
});

function init(
  outgoingChannel: CaptureChannel,
  t: number,
  over: Partial<{ decks: Record<CaptureChannel, InitDeckState>; crossfader: number }> = {}
): CaptureEvent {
  return {
    t,
    kind: 'init',
    outgoingChannel,
    decks: over.decks ?? { A: deck(), B: deck({ trackId: 2 }) },
    crossfader: over.crossfader ?? 0,
    crossfaderEnabled: true,
  };
}

const tick = (t: number, playheads: Partial<Record<CaptureChannel, number>>): CaptureEvent => ({
  t,
  kind: 'tick',
  playheads,
});

const control = (
  t: number,
  controlId: 'fader' | 'eqLow' | 'eqMid' | 'eqHigh' | 'filter' | 'crossfader',
  channel: CaptureChannel | null,
  value: number
): CaptureEvent => ({ t, kind: 'control', control: controlId, channel, value });

const pitch = (t: number, channel: CaptureChannel, value: number): CaptureEvent => ({
  t,
  kind: 'pitch',
  channel,
  value,
});

/** Window 100..120, outgoing A at 60s, incoming B at 8s. */
function baseInput(events: CaptureEvent[] = []) {
  return {
    events: [init('A', 100), tick(100, { A: 60, B: 8 }), ...events],
    windowStartS: 100,
    windowEndS: 120,
  };
}

const facts = { bpmA: 174, bpmB: 174 };

describe('anchors', () => {
  it('derives startSec/bInSec from playhead samples at the window start', () => {
    const draft = vectorizeTake(baseInput(), facts)!;
    expect(draft.outgoingChannel).toBe('A');
    expect(draft.transition.startSec).toBeCloseTo(60);
    expect(draft.transition.bInSec).toBeCloseTo(8);
    expect(draft.transition.durationSec).toBeCloseTo(20);
  });

  it('extrapolates from the nearest sample at the deck\'s own rate', () => {
    const input = {
      events: [
        init('A', 100, { decks: { A: deck(), B: deck({ trackId: 2, pitch: 4 }) } }),
        tick(99.5, { A: 59.5, B: 7 }),
      ],
      windowStartS: 100,
      windowEndS: 120,
    };
    const draft = vectorizeTake(input, facts)!;
    expect(draft.transition.startSec).toBeCloseTo(60);
    expect(draft.transition.bInSec).toBeCloseTo(7 + 0.5 * 1.04);
  });

  it('a hard cut (zero window) keeps anchors and has no lanes', () => {
    const input = { events: [init('A', 100), tick(100, { A: 60, B: 8 })], windowStartS: 100, windowEndS: 100 };
    const draft = vectorizeTake(input, facts)!;
    expect(draft.transition.durationSec).toBe(0);
    expect(draft.transition.startSec).toBeCloseTo(60);
    expect(Object.keys(draft.transition.lanes)).toEqual([]);
  });

  it('an incoming that starts mid-window back-projects to a negative entry anchor (lead gap)', () => {
    const input = {
      events: [
        init('A', 100),
        tick(100, { A: 60 }),
        // B starts playing 5s into the window, from its very top.
        { t: 105, kind: 'transport', channel: 'B', action: 'play', playhead: 0 } as CaptureEvent,
        tick(110, { A: 70, B: 5 }),
      ],
      windowStartS: 100,
      windowEndS: 120,
    };
    const tr = vectorizeTake(input, facts)!.transition;
    expect(tr.bInSec).toBeCloseTo(-5);
  });

  it('Nudge corrections fold into the commit-point alignment (read at window end)', () => {
    // B drifted and was nudged +0.2s mid-window; the settled alignment —
    // not the pre-correction start state — is the promoted anchor.
    const input = baseInput([
      tick(110, { A: 70, B: 18.2 }),
      tick(119, { A: 79, B: 27.2 }),
    ]);
    const tr = vectorizeTake(input, facts)!.transition;
    expect(tr.bInSec).toBeCloseTo(8.2);
  });

  it('returns null without an init head', () => {
    expect(vectorizeTake({ events: [tick(100, { A: 1 })], windowStartS: 100, windowEndS: 110 }, facts)).toBeNull();
  });
});

describe('crossfader composition (no crossfader lane — ADR 0010/0020)', () => {
  it('a crossfader flick becomes complementary fader-lane steps', () => {
    // Full A at open; flick to full B mid-window.
    const input = {
      events: [
        init('A', 100, { crossfader: -1 }),
        tick(100, { A: 60, B: 8 }),
        control(110, 'crossfader', null, 1),
      ],
      windowStartS: 100,
      windowEndS: 120,
    };
    const tr = vectorizeTake(input, facts)!.transition;
    expect(evalLane(tr.lanes.faderA!, 0.25)).toBeCloseTo(1);
    expect(evalLane(tr.lanes.faderA!, 0.75)).toBeCloseTo(0);
    expect(evalLane(tr.lanes.faderB!, 0.25)).toBeCloseTo(0);
    expect(evalLane(tr.lanes.faderB!, 0.75)).toBeCloseTo(1);
  });

  it('channel-fader moves land in the matching editor role even when B is outgoing', () => {
    const input = {
      events: [
        init('B', 100, { decks: { A: deck({ trackId: 7 }), B: deck({ trackId: 9 }) } }),
        tick(100, { A: 4, B: 90 }),
        control(110, 'fader', 'B', 0), // the OUTGOING deck fades out…
      ],
      windowStartS: 100,
      windowEndS: 120,
    };
    const tr = vectorizeTake(input, facts)!.transition;
    // …so the EDITOR's A-side fader lane carries the move.
    expect(evalLane(tr.lanes.faderA!, 0.25)).toBeCloseTo(1);
    expect(evalLane(tr.lanes.faderA!, 0.9)).toBeCloseTo(0);
    expect(vectorizeTake(input, facts)!.transition.startSec).toBeCloseTo(90);
    expect(vectorizeTake(input, facts)!.transition.bInSec).toBeCloseTo(4);
  });
});

describe('EQ and filter lanes', () => {
  it('maps EQ moves 1:1 and filter to the lane domain', () => {
    const input = baseInput([
      control(110, 'eqLow', 'A', 0), // bass kill on the outgoing
      control(115, 'filter', 'B', 0.5), // sweep on the incoming
    ]);
    const tr = vectorizeTake(input, facts)!.transition;
    expect(evalLane(tr.lanes.eqLowA!, 0.25)).toBeCloseTo(0.5);
    expect(evalLane(tr.lanes.eqLowA!, 0.75)).toBeCloseTo(0);
    expect(evalLane(tr.lanes.filterB!, 0.9)).toBeCloseTo(0.75);
  });

  it('untouched controls produce no lanes', () => {
    const tr = vectorizeTake(baseInput(), facts)!.transition;
    expect(tr.lanes.eqMidA).toBeUndefined();
    expect(tr.lanes.eqHighB).toBeUndefined();
    expect(tr.lanes.filterA).toBeUndefined();
  });

  it('the incoming fader lane is always drawn (its default ramp would lie)', () => {
    const tr = vectorizeTake(baseInput(), facts)!.transition;
    // B was up at open: a flat full lane, NOT the default 2s fade-in.
    expect(evalLane(tr.lanes.faderB!, 0)).toBeCloseTo(1);
    expect(evalLane(tr.lanes.faderB!, 0.05)).toBeCloseTo(1);
  });
});

describe('continuous gestures collapse (idealization)', () => {
  it('pitch riding and bends produce no lanes; tempo-match reflects the settled intent', () => {
    const events = [
      pitch(105, 'B', 1.0),
      pitch(112, 'B', 1.3),
      { t: 114, kind: 'bend' as const, channel: 'B' as const, value: 2 },
      pitch(118, 'B', 1.15),
    ];
    // 174 vs 172 needs ~+1.16% — the performer settled at 1.15: matched.
    const draft = vectorizeTake(baseInput(events), { bpmA: 174, bpmB: 172 })!;
    expect(draft.transition.tempoMatch).toBe(true);
    expect(Object.keys(draft.transition.lanes)).not.toContain('faderA'); // untouched
  });

  it('no beatmatching against a real BPM gap reads as tempoMatch off', () => {
    const draft = vectorizeTake(baseInput(), { bpmA: 174, bpmB: 150 })!;
    expect(draft.transition.tempoMatch).toBe(false);
  });
});

describe('discrete gestures become Jump events (issue 04)', () => {
  const transport = (
    t: number,
    channel: CaptureChannel,
    action: 'jumpBeats' | 'hotCue' | 'seek',
    playhead: number,
    detail?: number
  ): CaptureEvent => ({ t, kind: 'transport', channel, action, playhead, detail });

  it('an incoming beat jump back (doubled buildup) extracts a Jump event and leaves alignment honest', () => {
    // B rolling from 8; at mix 110 (x 0.5) a −8s beat jump: expected 18, landed 10.
    const input = baseInput([transport(110, 'B', 'jumpBeats', 10, -16)]);
    const tr = vectorizeTake(input, facts)!.transition;
    expect(tr.jumps).toEqual([{ x: 0.5, deltaSec: expect.closeTo(-8) }]);
    // bInSec back-projection subtracts the jump: B ends at 20 (10 + 10s),
    // so bInSec = 20 − 20 − (−8) = 8 — the pre-jump alignment.
    expect(tr.bInSec).toBeCloseTo(8);
  });

  it('a hot-cue press on the incoming deck extracts a Jump event', () => {
    // Expected 18 at mix 110; the pad lands B at its drop cue 64.
    const input = baseInput([transport(110, 'B', 'hotCue', 64, 4)]);
    const tr = vectorizeTake(input, facts)!.transition;
    expect(tr.jumps).toEqual([{ x: 0.5, deltaSec: expect.closeTo(46) }]);
  });

  it('outgoing-deck jumps are dropped (incoming-only, ADR 0020) but stay in the slice', () => {
    const input = baseInput([transport(110, 'A', 'jumpBeats', 40, -32)]);
    const draft = vectorizeTake(input, facts)!;
    expect(draft.transition.jumps).toBeUndefined();
    expect(draft.transition.startSec).toBeCloseTo(60); // anchor unaffected
  });

  it('chained jumps compute each delta against the post-previous-jump path', () => {
    const input = baseInput([
      transport(110, 'B', 'jumpBeats', 10, -16), // 18 → 10 (−8)
      transport(115, 'B', 'jumpBeats', 23, 16), // expected 15 → 23 (+8)
    ]);
    const tr = vectorizeTake(input, facts)!.transition;
    expect(tr.jumps).toEqual([
      { x: 0.5, deltaSec: expect.closeTo(-8) },
      { x: 0.75, deltaSec: expect.closeTo(8) },
    ]);
    expect(tr.bInSec).toBeCloseTo(8);
  });

  it('sub-noise deltas and plain seeks do not become Jump events', () => {
    const input = baseInput([
      transport(110, 'B', 'jumpBeats', 18.02, 0), // ≈ where it already was
      transport(114, 'B', 'seek', 30, undefined), // scrubbing, not a gesture
    ]);
    expect(vectorizeTake(input, facts)!.transition.jumps).toBeUndefined();
  });
});

describe('loop engagements collapse to repeated Jump events (looping 06)', () => {
  const loop = (
    t: number,
    channel: CaptureChannel,
    playhead: number,
    region: { start: number; end: number } | null
  ): CaptureEvent => ({ t, kind: 'loop', channel, playhead, region });

  const transport = (
    t: number,
    channel: CaptureChannel,
    action: 'jumpBeats' | 'hotCue',
    playhead: number
  ): CaptureEvent => ({ t, kind: 'transport', channel, action, playhead });

  it('a held loop vectorizes to ONE repeated Jump, not k jumps', () => {
    // B rolling from 8; loop [13, 15) engaged at 105 (playhead 13),
    // released at 112 — unwrapped 20, so 3 wraps of 2s.
    const input = baseInput([
      loop(105, 'B', 13, { start: 13, end: 15 }),
      loop(112, 'B', 14, null),
      tick(112, { A: 72, B: 14 }),
    ]);
    const tr = vectorizeTake(input, facts)!.transition;
    expect(tr.jumps).toHaveLength(1);
    const j = tr.jumps![0];
    // First wrap at t 107 → x 0.35; displacement = the loop length, back.
    expect(j.x).toBeCloseTo(0.35);
    expect(j.deltaSec).toBeCloseTo(-2);
    expect(j.count).toBe(3);
    // Alignment stays honest: repeats fold into the back-projection.
    expect(tr.bInSec).toBeCloseTo(8);
  });

  it('a loop still held at the window end counts wraps up to the end', () => {
    const input = baseInput([loop(110, 'B', 18, { start: 18, end: 20 })]);
    const tr = vectorizeTake(input, facts)!.transition;
    // Unwrapped at 120 = 28 → wraps at 20, 22, 24, 26, 28 → count 5.
    expect(tr.jumps).toHaveLength(1);
    expect(tr.jumps![0].deltaSec).toBeCloseTo(-2);
    expect(tr.jumps![0].count).toBe(5);
    expect(tr.jumps![0].x).toBeCloseTo(0.6);
  });

  it('a single wrap derives a plain backward Jump (no count field)', () => {
    const input = baseInput([
      loop(105, 'B', 13, { start: 13, end: 15 }),
      loop(108, 'B', 14, null), // unwrapped 16: one wrap
      tick(108, { A: 68, B: 14 }),
    ]);
    const tr = vectorizeTake(input, facts)!.transition;
    expect(tr.jumps).toEqual([{ x: expect.closeTo(0.35), deltaSec: expect.closeTo(-2) }]);
  });

  it('a loop released before its first wrap derives nothing', () => {
    const input = baseInput([
      loop(105, 'B', 13, { start: 13, end: 15 }),
      loop(106, 'B', 14, null),
    ]);
    expect(vectorizeTake(input, facts)!.transition.jumps).toBeUndefined();
  });

  it('outgoing-deck loops are dropped (incoming-only, ADR 0020)', () => {
    const input = baseInput([
      loop(105, 'A', 65, { start: 65, end: 67 }),
      loop(115, 'A', 66, null),
    ]);
    expect(vectorizeTake(input, facts)!.transition.jumps).toBeUndefined();
  });

  it('loop wraps and ordinary jumps coexist in the same Take', () => {
    const input = baseInput([
      loop(105, 'B', 13, { start: 13, end: 15 }),
      loop(112, 'B', 14, null),
      tick(112, { A: 72, B: 14 }),
      transport(115, 'B', 'hotCue', 64), // expected 17 → 64
    ]);
    const tr = vectorizeTake(input, facts)!.transition;
    expect(tr.jumps).toHaveLength(2);
    const [hotCue, looped] = [...tr.jumps!].sort((a, b) => a.deltaSec - b.deltaSec).reverse();
    expect(hotCue.deltaSec).toBeCloseTo(47);
    expect(looped.deltaSec).toBeCloseTo(-2);
    expect(looped.count).toBe(3);
  });

  it('scales wrap counting by the incoming deck\'s rate', () => {
    // B at +100% pitch (rate 2): loop [13, 15) engaged at 105; by 109.5
    // the unwrapped position is 13 + 4.5×2 = 22 → 4 crossings of the end.
    const input = {
      events: [
        init('A', 100, { decks: { A: deck(), B: deck({ trackId: 2, pitch: 100 }) } }),
        tick(100, { A: 60, B: 8 }),
        loop(105, 'B', 13, { start: 13, end: 15 }),
        loop(109.5, 'B', 14, null),
      ],
      windowStartS: 100,
      windowEndS: 120,
    };
    const tr = vectorizeTake(input, { bpmA: 174, bpmB: 87 })!.transition;
    expect(tr.jumps).toHaveLength(1);
    expect(tr.jumps![0].count).toBe(4);
    // First wrap after (15-13)/2 = 1s → t 106 → x 0.3.
    expect(tr.jumps![0].x).toBeCloseTo(0.3);
  });
});

describe('breakpoint simplification', () => {
  it('a dense drag stream simplifies to a sparse editable polyline', () => {
    const events: CaptureEvent[] = [];
    for (let i = 0; i <= 200; i++) {
      events.push(control(105 + (i / 200) * 10, 'fader', 'A', 1 - i / 200));
    }
    const tr = vectorizeTake(baseInput(events), facts)!.transition;
    expect(tr.lanes.faderA!.length).toBeLessThanOrEqual(8);
    expect(evalLane(tr.lanes.faderA!, 0.25)).toBeCloseTo(1, 1);
    expect(evalLane(tr.lanes.faderA!, 0.75)).toBeCloseTo(0, 1);
    expect(evalLane(tr.lanes.faderA!, 0.5)).toBeCloseTo(0.5, 1);
  });
});

// ── Mix-domain back-projection + beat-domain match bound (4dp 39) ────────
// The field bug: Last Time → Tornado VIP, a 50s double. A ran at −0.702%,
// B at −1.294% — a PERFECT match in mix domain (renormalized −0.596% ≡
// required 174/175.04) — but wall-domain back-projection at the required
// rate landed B's entry a full beat (0.345s) early.
describe('mix-domain alignment (4dp 39)', () => {
  const BPM_A = 174;
  const BPM_B = 175.04;
  const RATE_A = 1 - 0.702 / 100;
  const RATE_B = 1 - 1.294 / 100;

  function doublePitchedInput() {
    // Window 100..150 (50s wall). A at 60s, B enters at 8s; both pitched
    // from the init snapshot on; ticks ride the performed rates.
    const decks = {
      A: deck({ pitch: -0.702 }),
      B: deck({ trackId: 2, pitch: -1.294 }),
    };
    const events: CaptureEvent[] = [init('A', 100, { decks })];
    for (let t = 100; t <= 150; t += 5) {
      events.push(tick(t, { A: 60 + (t - 100) * RATE_A, B: 8 + (t - 100) * RATE_B }));
    }
    return { events, windowStartS: 100, windowEndS: 150 };
  }

  it('a match performed against a PITCHED outgoing renormalizes to tempoMatch', () => {
    const draft = vectorizeTake(doublePitchedInput(), { bpmA: BPM_A, bpmB: BPM_B })!;
    // Renormalized: RATE_B/RATE_A − 1 = −0.596% ≈ required — matched.
    expect(draft.transition.tempoMatch).toBe(true);
  });

  it('back-projects the matched entry in MIX seconds — the entry lands true', () => {
    const draft = vectorizeTake(doublePitchedInput(), { bpmA: BPM_A, bpmB: BPM_B })!;
    // The performed entry: B was at 8s when the window opened. The old
    // wall-domain projection put this at 8 − 0.345 (a beat early).
    expect(draft.transition.bInSec).toBeCloseTo(8, 1);
    // And the commit point stays exact: entry + durationSec × required
    // must land on B's performed end position.
    const durationSec = draft.transition.durationSec;
    const modelEnd = draft.transition.bInSec + durationSec * (BPM_A / BPM_B);
    expect(modelEnd).toBeCloseTo(8 + 50 * RATE_B, 1);
  });

  it('a sloppy match on a LONG window fails the beat-drift bound (no false match)', () => {
    // B held 1.0% off the required rate: within the 1.5% pitch tolerance,
    // but 0.5s of drift over 50s — force unmatched, keep the true entry.
    const decks = { A: deck(), B: deck({ trackId: 2, pitch: 1.0 }) };
    const rB = 1.01;
    const events: CaptureEvent[] = [init('A', 100, { decks })];
    for (let t = 100; t <= 150; t += 5) {
      events.push(tick(t, { A: 60 + (t - 100), B: 8 + (t - 100) * rB }));
    }
    const draft = vectorizeTake(
      { events, windowStartS: 100, windowEndS: 150 },
      { bpmA: 174, bpmB: 174 }
    )!;
    expect(draft.transition.tempoMatch).toBe(false);
    // Unmatched = start-anchored: the performed entry survives.
    expect(draft.transition.bInSec).toBeCloseTo(8, 1);
  });

  it('the same slop on a SHORT window still reads as matched (unchanged)', () => {
    const decks = { A: deck(), B: deck({ trackId: 2, pitch: 1.0 }) };
    const rB = 1.01;
    const events: CaptureEvent[] = [init('A', 100, { decks })];
    for (let t = 100; t <= 104; t += 1) {
      events.push(tick(t, { A: 60 + (t - 100), B: 8 + (t - 100) * rB }));
    }
    const draft = vectorizeTake(
      { events, windowStartS: 100, windowEndS: 104 },
      { bpmA: 174, bpmB: 174 }
    )!;
    // 1% × 4s = 0.04s drift < quarter-beat (0.086s): matched, as before.
    expect(draft.transition.tempoMatch).toBe(true);
  });
});

// ── Octave-equivalent tempo-match (grid-octave 168) ──────────────────────
// The field bug: Nebula (track 959) gridded at 87.51 but ridden at 175
// against 172-gridded Want It (take 1fae90e2): required read +96.6% and
// could never fire. Half/double grids are first-class in the library
// (dyadic-fold doctrine), so the grid ratio's dyadic folds 2r and r/2 are
// octave-equivalent matches; the fold nearest the performed ride is tested.
describe('octave-equivalent tempo-match (grid-octave 168)', () => {
  /** Both decks riding recorded pitches over window 100..(100+len);
   * ticks agree with the recorded baseline (no repair in play). */
  function riddenInput(pitchA: number, pitchB: number, len = 50) {
    const decks = { A: deck({ pitch: pitchA }), B: deck({ trackId: 2, pitch: pitchB }) };
    const rA = 1 + pitchA / 100;
    const rB = 1 + pitchB / 100;
    const events: CaptureEvent[] = [init('A', 100, { decks })];
    for (let t = 100; t <= 100 + len; t += 5) {
      events.push(tick(t, { A: 60 + (t - 100) * rA, B: 8 + (t - 100) * rB }));
    }
    return { events, windowStartS: 100, windowEndS: 100 + len };
  }

  it('a half-gridded INCOMING matches at the r/2 fold (track 959 field shape)', () => {
    // Nebula gridded 87.51, true 175: raw required +96.6%; the performed
    // renorm −1.73% sits on the r/2 fold's −1.72% — matched.
    const draft = vectorizeTake(riddenInput(1.78, 0.02, 55), { bpmA: 172, bpmB: 87.5069 })!;
    expect(draft.transition.tempoMatch).toBe(true);
    expect(draft.transition.bInSec).toBeCloseTo(8, 1);
    // Back-projection runs at the FOLDED ratio (≈0.983), not the raw grid
    // ratio (≈1.966): the commit point lands on B's performed end.
    const modelEnd =
      draft.transition.bInSec + draft.transition.durationSec * (0.5 * (172 / 87.5069));
    expect(modelEnd).toBeCloseTo(8 + 55 * 1.0002, 1);
  });

  it('a half-gridded OUTGOING matches at the 2r fold (track 821 field shape)', () => {
    // Everyday VIP gridded 87, ridden ~174 into 175-gridded FREE (take
    // c722e43d): raw required −50.3%; renorm −0.58% ≈ the 2r fold.
    const draft = vectorizeTake(riddenInput(2.36, 1.77, 90), { bpmA: 87, bpmB: 175.0056 })!;
    expect(draft.transition.tempoMatch).toBe(true);
  });

  it('a ride matching NO fold stays unmatched (folds are not a loophole)', () => {
    // r = 174/116 = 1.5: the canonical fold (r/2) still requires −25% —
    // a flat 0% ride is no octave-equivalent match.
    const draft = vectorizeTake(riddenInput(0, 0), { bpmA: 174, bpmB: 116 })!;
    expect(draft.transition.tempoMatch).toBe(false);
  });

  it('the drift bound reads B at the folded (fastest) BPM — no half-time discount', () => {
    // Under the r/2 fold B's true beat is DOUBLE the grid's: a 0.25%
    // residual over 50s (0.125s drift) passes a quarter-beat of the 87.5
    // grid (0.171s) but NOT of the true 175 (0.086s) — unmatched.
    const draft = vectorizeTake(riddenInput(0, -1.464), { bpmA: 172, bpmB: 87.5 })!;
    expect(draft.transition.tempoMatch).toBe(false);
  });
});

describe('lost pitch baseline repair (sets 166)', () => {
  // Slices captured before the recorder seeded pitch explicitly (the
  // sessions-18 fix) carry a FALSE zero baseline for any deck pitched
  // before the seed — the DJ rides sets at an elevated tempo, so the
  // standing pitch of BOTH decks is invisible to the slice. The playhead
  // samples are direct observations of the actual rate: when they
  // contradict the recorded baseline, the measurement wins.
  const RATE_A = 1.0172; // outgoing 175 ridden at ~178 (pitch never logged)
  const RATE_B = 1.023; // incoming 174 matched to it (pitch never logged)

  /** Damaged slice: init pitch 0/0 (the lie), ticks riding the performed
   * rates. Window 100..160; A at 60s, B at 8s at the open. */
  function damagedInput(over: { events?: CaptureEvent[]; endS?: number } = {}) {
    const endS = over.endS ?? 160;
    const events: CaptureEvent[] = [init('A', 100)];
    for (let t = 100; t <= endS; t += 1) {
      events.push(tick(t, { A: 60 + (t - 100) * RATE_A, B: 8 + (t - 100) * RATE_B }));
    }
    events.push(...(over.events ?? []));
    return { events, windowStartS: 100, windowEndS: endS };
  }

  it('repairs a false zero baseline from the playhead samples', () => {
    // required = 175/174 − 1 = +0.575%; performed ride = RATE_B/RATE_A −
    // 1 = +0.570%. With the recorded (false) baseline this read as a
    // 0.575% residual over 60s — unmatched, and the entry back-projected
    // ~1.4s late (4 beats). The measured rates restore the match.
    const draft = vectorizeTake(damagedInput(), { bpmA: 175, bpmB: 174 })!;
    expect(draft.transition.tempoMatch).toBe(true);
    expect(draft.transition.bInSec).toBeCloseTo(8, 1);
    // The window spans the outgoing's PERFORMED track seconds.
    expect(draft.transition.durationSec).toBeCloseTo(60 * RATE_A, 1);
  });

  it('trusts the recorded pitch when the samples agree (exactness kept)', () => {
    const decks = { A: deck({ pitch: 1.72 }), B: deck({ trackId: 2, pitch: 2.3 }) };
    const events: CaptureEvent[] = [init('A', 100, { decks })];
    for (let t = 100; t <= 160; t += 1) {
      events.push(tick(t, { A: 60 + (t - 100) * 1.0172, B: 8 + (t - 100) * 1.023 }));
    }
    const draft = vectorizeTake(
      { events, windowStartS: 100, windowEndS: 160 },
      { bpmA: 175, bpmB: 174 }
    )!;
    expect(draft.transition.tempoMatch).toBe(true);
    // durationSec computed from the RECORDED pitch, bit-exact.
    expect(draft.transition.durationSec).toBe(60 * 1.0172);
  });

  it('keeps the recorded baseline when samples are too sparse to measure', () => {
    // One tick = no pairs: the false baseline is unmeasurable — the
    // verdict stays what the recorded evidence says (unmatched here).
    const events: CaptureEvent[] = [
      init('A', 100),
      tick(100, { A: 60, B: 8 }),
      tick(160, { A: 60 + 60 * RATE_A, B: 8 + 60 * RATE_B }),
    ];
    const draft = vectorizeTake(
      { events, windowStartS: 100, windowEndS: 160 },
      { bpmA: 175, bpmB: 174 }
    )!;
    expect(draft.transition.tempoMatch).toBe(false);
  });

  it('measures the baseline only up to the first pitch event of the channel', () => {
    // The DJ corrects B's pitch mid-window: the recorded value governs
    // from the event on; the measured baseline covers the span before it.
    const draft = vectorizeTake(
      damagedInput({ events: [pitch(130, 'B', 2.3)] }),
      { bpmA: 175, bpmB: 174 }
    )!;
    expect(draft.transition.tempoMatch).toBe(true);
    expect(draft.transition.bInSec).toBeCloseTo(8, 1);
  });

  it('a discontinuity (jump) does not poison the measurement', () => {
    // A backward beat-jump mid-window: the pair spanning it is an
    // outlier; the median slope still reads the true rate.
    const events: CaptureEvent[] = [init('A', 100)];
    for (let t = 100; t <= 160; t += 1) {
      const jumped = t > 130 ? -5.517 : 0; // 16 beats at 174
      events.push(tick(t, { A: 60 + (t - 100) * RATE_A, B: 8 + (t - 100) * RATE_B + jumped }));
    }
    events.push({
      t: 130.5,
      kind: 'transport',
      channel: 'B',
      action: 'jumpBeats',
      playhead: 8 + 30.5 * RATE_B - 5.517,
      detail: -16,
    });
    const draft = vectorizeTake(
      { events, windowStartS: 100, windowEndS: 160 },
      { bpmA: 175, bpmB: 174 }
    )!;
    expect(draft.transition.tempoMatch).toBe(true);
  });
});

describe('assignment-aware fader lanes (4dp 39)', () => {
  it('a right-side outgoing deck composes the RIGHT crossfader gain', () => {
    // Relabeled pair: physical B→D, both on the crossfader's right half.
    // Crossfader hard LEFT kills both; the old role-based composition
    // gave role A (left) full gain instead.
    const decks = {
      A: deck({ assignment: 'right' }),
      B: deck({ trackId: 2, assignment: 'right' }),
    };
    const events: CaptureEvent[] = [
      init('A', 100, { decks }),
      tick(100, { A: 60, B: 8 }),
      control(110, 'crossfader', null, -1), // hard left: both roles killed
    ];
    const draft = vectorizeTake(
      { events, windowStartS: 100, windowEndS: 120 },
      { bpmA: 174, bpmB: 174 }
    )!;
    const faderA = draft.transition.lanes.faderA!;
    // After the crossfader slam, role A's effective fader lane hits 0 —
    // its deck sits on the right side.
    expect(evalLane(faderA, 1)).toBeCloseTo(0, 2);
  });

  it('a thru-routed deck ignores the crossfader entirely', () => {
    const decks = {
      A: deck({ assignment: 'thru' }),
      B: deck({ trackId: 2, assignment: 'right' }),
    };
    const events: CaptureEvent[] = [
      init('A', 100, { decks }),
      tick(100, { A: 60, B: 8 }),
      control(110, 'crossfader', null, 1), // hard right: A unaffected (thru)
    ];
    const draft = vectorizeTake(
      { events, windowStartS: 100, windowEndS: 120 },
      { bpmA: 174, bpmB: 174 }
    )!;
    // faderA never moved: no lane emitted for it at all (untouched + at
    // its resting default).
    expect(draft.transition.lanes.faderA).toBeUndefined();
  });
});
