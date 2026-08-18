/**
 * Detector ↔ timeline agreement (architecture-deepening 01).
 *
 * Both the Handover detector and the Session timeline derive from ONE
 * audibility reducer (capture/audibilityReducer.ts), so on the same event
 * stream — under the same params — detector verdict windows and timeline
 * audibility bands must agree: an engagement opens at the incoming deck's
 * band start, and the window closes at the outgoing deck's band end. This
 * suite pins that invariant, including under NON-default params (the old
 * timeline hardcoded DEFAULT_DETECTOR_PARAMS and would diverge from a
 * tuned detector — the live bug this refactor fixed).
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_DETECTOR_PARAMS } from '../capture/events';
import type { CaptureDeck, CaptureEvent, DetectedTake, DetectorParams } from '../capture/events';
import { initialCaptureState, reduceCapture } from '../capture/detector';
import { deriveTimeline } from './timelineModel';

function detect(events: CaptureEvent[], params?: DetectorParams): DetectedTake[] {
  let state = initialCaptureState(params);
  const takes: DetectedTake[] = [];
  for (const e of events) {
    const [next, emitted] = reduceCapture(state, e);
    state = next;
    takes.push(...emitted);
  }
  return takes;
}

/** Every Take's window must land on the timeline's band edges: the
 * incoming deck has an audible band starting at windowStartS, the
 * outgoing deck one ending at windowEndS — same events, same params. */
function expectAgreement(events: CaptureEvent[], params?: DetectorParams): DetectedTake[] {
  const takes = detect(events, params);
  const model = deriveTimeline(events, params);
  for (const take of takes) {
    const inSpans = model.decks[take.incomingDeck].audibleSpans;
    const outSpans = model.decks[take.outgoingDeck].audibleSpans;
    expect(inSpans.some((sp) => sp.start === take.windowStartS)).toBe(true);
    expect(outSpans.some((sp) => sp.end === take.windowEndS)).toBe(true);
  }
  return takes;
}

const HORIZON = DEFAULT_DETECTOR_PARAMS.settleHorizonS;

/** Fader-blend stream: incumbent `out` from t=0; `inc` enters (play +
 * fader up) at t=10; `out` mixes out at t=20 via `mixOut`; tail ticks. */
function blendStream(
  out: CaptureDeck,
  inc: CaptureDeck,
  mixOut: (t: number) => CaptureEvent[],
  endT = 20 + HORIZON + 20
): CaptureEvent[] {
  const evs: CaptureEvent[] = [
    { t: 0, kind: 'load', channel: out, trackId: 1, bpm: 174 },
    { t: 0, kind: 'load', channel: inc, trackId: 2, bpm: 174 },
    { t: 0, kind: 'control', control: 'fader', channel: inc, value: 0 },
    { t: 0, kind: 'transport', channel: out, action: 'play', playhead: 0 },
    { t: 10, kind: 'transport', channel: inc, action: 'play', playhead: 0 },
    { t: 10, kind: 'control', control: 'fader', channel: inc, value: 1 },
    ...mixOut(20),
  ];
  for (let t = 21; t <= endT; t++) evs.push({ t, kind: 'tick', playheads: {} });
  return evs;
}

describe('detector verdict windows agree with timeline audibility bands', () => {
  it('clean fader blend under default params: window = band edges', () => {
    const events = blendStream('A', 'B', (t) => [
      { t, kind: 'control', control: 'fader', channel: 'A', value: 0 },
    ]);
    const takes = expectAgreement(events);
    expect(takes).toHaveLength(1);
    expect(takes[0].windowStartS).toBe(10);
    expect(takes[0].windowEndS).toBe(20);
  });

  it('cross-pair blend (B→D) agrees too', () => {
    const events = blendStream('B', 'D', (t) => [
      { t, kind: 'control', control: 'fader', channel: 'B', value: 0 },
    ]);
    const takes = expectAgreement(events);
    expect(takes).toHaveLength(1);
    expect(takes[0].outgoingDeck).toBe('B');
    expect(takes[0].incomingDeck).toBe('D');
  });

  it('tuned params: an EQ mix-out below the tuned kill threshold agrees under the SAME params', () => {
    // eqKillBelow tuned 0.05 → 0.2: setting all bands to 0.15 IS a kill.
    const tuned: DetectorParams = { ...DEFAULT_DETECTOR_PARAMS, eqKillBelow: 0.2 };
    const eqOut = (t: number): CaptureEvent[] => [
      { t, kind: 'control', control: 'eqLow', channel: 'A', value: 0.15 },
      { t, kind: 'control', control: 'eqMid', channel: 'A', value: 0.15 },
      { t, kind: 'control', control: 'eqHigh', channel: 'A', value: 0.15 },
    ];
    const events = blendStream('A', 'B', eqOut);
    const takes = expectAgreement(events, tuned);
    expect(takes).toHaveLength(1);
    expect(takes[0].windowEndS).toBe(20);

    // The regression this refactor fixed: bands derived under the OLD
    // hardcoded defaults do NOT close at the tuned verdict's window end —
    // 0.15 is above the default kill threshold, so default-params bands
    // keep A audible past t=20. Params must thread through.
    const defaultBands = deriveTimeline(events).decks.A.audibleSpans;
    expect(defaultBands.some((sp) => sp.end === takes[0].windowEndS)).toBe(false);
  });

  it('tenure suspension agrees: no verdicts and no bands beneath a hold', () => {
    const events: CaptureEvent[] = [
      { t: 0, kind: 'load', channel: 'A', trackId: 1, bpm: 174 },
      { t: 0, kind: 'load', channel: 'B', trackId: 2, bpm: 174 },
      { t: 0, kind: 'control', control: 'fader', channel: 'B', value: 0 },
      { t: 0, kind: 'transport', channel: 'A', action: 'play', playhead: 0 },
      { t: 5, kind: 'tenure', edge: 'start', holder: 'editor' },
      // The whole blend happens under the hold.
      { t: 10, kind: 'transport', channel: 'B', action: 'play', playhead: 0 },
      { t: 10, kind: 'control', control: 'fader', channel: 'B', value: 1 },
      { t: 20, kind: 'control', control: 'fader', channel: 'A', value: 0 },
      { t: 40, kind: 'tenure', edge: 'end', holder: 'shared' },
      { t: 60, kind: 'tick', playheads: {} },
    ];
    const takes = detect(events);
    expect(takes).toHaveLength(0);
    const model = deriveTimeline(events);
    // A's band closes at the hold's start; nothing is audible beneath it.
    expect(model.decks.A.audibleSpans).toEqual([{ start: 0, end: 5 }]);
    // B's band opens only when the surface returns (B is still audible).
    expect(model.decks.B.audibleSpans).toEqual([{ start: 40, end: 60 }]);
    expect(model.tenures).toEqual([{ start: 5, end: 40, holder: 'editor', open: false }]);
  });
});
