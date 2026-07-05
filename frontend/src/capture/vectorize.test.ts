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
