/**
 * Capture-spine benchmark (performance-hardening 02) — the synthetic
 * crossfader sweep the issue calls for. NOT part of the test suite
 * (`vitest bench` only): it compares the old per-event path (the pure
 * `reduceCapture` wrapper — deep clone + O(n) log copy per event, the
 * pre-02 recorder cost profile) against the new recorder path
 * (`reduceCaptureInto` on the owned state — in-place, ring-buffer log).
 *
 * Run: cd frontend && npx vitest bench --run src/capture/captureSpine.bench.ts
 *
 * Scenario: a busy passage — two decks Master-audible with an engagement
 * held open (the log's retention pinned, so it grows with the passage,
 * the worst case for per-event log copies) while the crossfader is ridden
 * at MIDI rate. Both decks stay audible throughout (the sweep oscillates
 * inside the audible band), so nothing settles and the machines stay hot.
 */
import { bench, describe } from 'vitest';
import { initialCaptureState, reduceCapture, reduceCaptureInto } from './detector';
import type { CaptureState } from './detector';
import type { CaptureEvent } from './events';

/** Open a busy passage: A incumbent, B blended in (engagement open). */
function warmupEvents(): CaptureEvent[] {
  return [
    { t: 0, kind: 'load', channel: 'A', trackId: 1, bpm: 174 },
    { t: 0, kind: 'load', channel: 'B', trackId: 2, bpm: 174 },
    { t: 0, kind: 'control', control: 'fader', channel: 'B', value: 0 },
    { t: 0, kind: 'transport', channel: 'A', action: 'play', playhead: 0 },
    { t: 5, kind: 'transport', channel: 'B', action: 'play', playhead: 0 },
    { t: 6, kind: 'control', control: 'fader', channel: 'B', value: 1 },
  ];
}

/** A crossfader ride: `perSec` moves/sec for `seconds`, oscillating within
 * [-0.5, 0.5] (both decks stay audible; nothing settles), with the ~1 Hz
 * ticks the live recorder interleaves. */
function sweepEvents(seconds: number, perSec: number): CaptureEvent[] {
  const events: CaptureEvent[] = [];
  for (let s = 0; s < seconds; s++) {
    const t0 = 10 + s;
    events.push({ t: t0, kind: 'tick', playheads: { A: t0, B: t0 } });
    for (let i = 0; i < perSec; i++) {
      const t = t0 + i / perSec;
      const value = 0.5 * Math.sin((2 * Math.PI * (s * perSec + i)) / 64);
      events.push({ t, kind: 'control', control: 'crossfader', channel: null, value });
    }
  }
  return events;
}

const WARMUP = warmupEvents();
// 30 s passage at 100 crossfader events/sec = 3 000 sweep events + ticks.
const SWEEP = sweepEvents(30, 100);

function freshState(): CaptureState {
  const s = initialCaptureState();
  for (const e of WARMUP) reduceCaptureInto(s, e);
  return s;
}

describe('crossfader sweep through the capture spine (30s @ 100 ev/s, engagement open)', () => {
  bench('old path: pure reduceCapture (deep clone + log copy per event)', () => {
    let state = freshState();
    for (const e of SWEEP) {
      const [next] = reduceCapture(state, e);
      state = next;
    }
  });

  bench('new path: reduceCaptureInto on owned state (in-place, ring log)', () => {
    const state = freshState();
    for (const e of SWEEP) reduceCaptureInto(state, e);
  });
});
