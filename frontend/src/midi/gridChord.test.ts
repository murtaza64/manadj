/**
 * The grid-edit chord reducer seam (midi-performance-ops 06; PRD testing
 * decisions — prior art: playback/transport.test.ts). Pure events-in /
 * commands-out: tap-vs-hold discrimination (zero-tick), sign from spin
 * direction, accumulation into one commit, suppression of normal jog
 * meanings while armed, per-deck isolation. No timers anywhere.
 */
import { describe, expect, it } from 'vitest';
import {
  GRID_SPIN_BPM_PER_TICK,
  GRID_SPIN_NUDGE_MS_PER_TICK,
  initialGridChordState,
  reduceGridChord,
  shiftBeatgrid,
} from './gridChord';
import type { GridChordCommand, GridChordEvent, GridChordState } from './gridChord';
import type { BeatgridResponse } from '../types';

const down = (deck: 'A' | 'B', direction: 'earlier' | 'later'): GridChordEvent => ({
  type: 'pad-down',
  deck,
  direction,
});
const up = (deck: 'A' | 'B', direction: 'earlier' | 'later'): GridChordEvent => ({
  type: 'pad-up',
  deck,
  direction,
});
const ticks = (deck: 'A' | 'B', n: number, stream: 'rim' | 'touch' = 'rim'): GridChordEvent => ({
  type: 'jog-ticks',
  deck,
  stream,
  ticks: n,
});
const bpmDown = (deck: 'A' | 'B', op: 'grow' | 'shrink'): GridChordEvent => ({
  type: 'bpm-pad-down',
  deck,
  op,
});
const bpmUp = (deck: 'A' | 'B', op: 'grow' | 'shrink'): GridChordEvent => ({
  type: 'bpm-pad-up',
  deck,
  op,
});

/** Fold an event sequence, as dispatch does; returns every emitted command. */
function run(events: GridChordEvent[], from?: GridChordState): [GridChordState, GridChordCommand[]] {
  let state = from ?? initialGridChordState();
  const commands: GridChordCommand[] = [];
  for (const event of events) {
    const [next, emitted] = reduceGridChord(state, event);
    state = next;
    commands.push(...emitted);
  }
  return [state, commands];
}

describe('tap (zero ticks received)', () => {
  it('press and release with no ticks fires the discrete step, pad direction preserved', () => {
    const [, commands] = run([down('A', 'earlier'), up('A', 'earlier')]);
    expect(commands).toEqual([{ type: 'tap-step', deck: 'A', direction: 'earlier' }]);
    const [, later] = run([down('B', 'later'), up('B', 'later')]);
    expect(later).toEqual([{ type: 'tap-step', deck: 'B', direction: 'later' }]);
  });

  it('arming alone emits nothing (no command until release or ticks)', () => {
    const [, commands] = run([down('A', 'later')]);
    expect(commands).toEqual([]);
  });
});

describe('hold and spin', () => {
  it('each tick batch emits a per-tick local nudge at the fine rate', () => {
    const [, commands] = run([down('A', 'later'), ticks('A', 3), ticks('A', -1)]);
    expect(commands).toEqual([
      { type: 'local-nudge', deck: 'A', offsetMs: 3 * GRID_SPIN_NUDGE_MS_PER_TICK },
      { type: 'local-nudge', deck: 'A', offsetMs: -1 * GRID_SPIN_NUDGE_MS_PER_TICK },
    ]);
  });

  it('release commits the accumulated net offset in exactly one command', () => {
    const [, commands] = run([
      down('A', 'later'),
      ticks('A', 3),
      ticks('A', 2),
      ticks('A', -1),
      up('A', 'later'),
    ]);
    expect(commands.filter((c) => c.type === 'commit')).toEqual([
      { type: 'commit', deck: 'A', offsetMs: 4 * GRID_SPIN_NUDGE_MS_PER_TICK },
    ]);
  });

  it('sign follows the spin direction, not the held pad', () => {
    // Holding the EARLIER pad but spinning clockwise still nudges later.
    const [, commands] = run([down('A', 'earlier'), ticks('A', 5), up('A', 'earlier')]);
    expect(commands.filter((c) => c.type === 'commit')).toEqual([
      { type: 'commit', deck: 'A', offsetMs: 5 * GRID_SPIN_NUDGE_MS_PER_TICK },
    ]);
    const [, ccw] = run([down('A', 'later'), ticks('A', -4), up('A', 'later')]);
    expect(ccw.filter((c) => c.type === 'commit')).toEqual([
      { type: 'commit', deck: 'A', offsetMs: -4 * GRID_SPIN_NUDGE_MS_PER_TICK },
    ]);
  });

  it('touch-stream ticks nudge exactly like rim ticks while armed', () => {
    const [, commands] = run([down('A', 'later'), ticks('A', 2, 'touch'), up('A', 'later')]);
    expect(commands).toEqual([
      { type: 'local-nudge', deck: 'A', offsetMs: 2 },
      { type: 'commit', deck: 'A', offsetMs: 2 },
    ]);
  });

  it('any tick makes the gesture a hold: a zero-net spin is no tap and no commit', () => {
    const [, commands] = run([down('A', 'later'), ticks('A', 2), ticks('A', -2), up('A', 'later')]);
    expect(commands.filter((c) => c.type === 'tap-step')).toEqual([]);
    expect(commands.filter((c) => c.type === 'commit')).toEqual([]);
  });

  it('release disarms: no second commit from further releases or ticks', () => {
    const [state, commands] = run([down('A', 'later'), ticks('A', 2), up('A', 'later')]);
    const [, after] = run([up('A', 'later'), ticks('A', 3)], state);
    expect(commands.filter((c) => c.type === 'commit')).toHaveLength(1);
    expect(after).toEqual([{ type: 'pass-jog', deck: 'A', stream: 'rim', ticks: 3 }]);
  });
});

describe('suppression of normal jog meanings', () => {
  it('unarmed ticks pass through with their stream preserved', () => {
    const [, commands] = run([ticks('A', 2), ticks('A', -1, 'touch')]);
    expect(commands).toEqual([
      { type: 'pass-jog', deck: 'A', stream: 'rim', ticks: 2 },
      { type: 'pass-jog', deck: 'A', stream: 'touch', ticks: -1 },
    ]);
  });

  it('armed ticks never pass through — no Nudge, no seek', () => {
    const [, commands] = run([down('A', 'later'), ticks('A', 1), ticks('A', 1, 'touch')]);
    expect(commands.filter((c) => c.type === 'pass-jog')).toEqual([]);
  });

  it('release restores pass-through instantly', () => {
    const [, commands] = run([down('A', 'later'), ticks('A', 1), up('A', 'later'), ticks('A', 1)]);
    expect(commands[commands.length - 1]).toEqual({
      type: 'pass-jog',
      deck: 'A',
      stream: 'rim',
      ticks: 1,
    });
  });
});

describe('per-deck isolation', () => {
  it('arming deck A leaves deck B jog untouched', () => {
    const [, commands] = run([down('A', 'later'), ticks('B', 2)]);
    expect(commands).toEqual([{ type: 'pass-jog', deck: 'B', stream: 'rim', ticks: 2 }]);
  });

  it('both decks chord independently, each committing its own net', () => {
    const [, commands] = run([
      down('A', 'later'),
      down('B', 'earlier'),
      ticks('A', 2),
      ticks('B', -3),
      up('A', 'later'),
      up('B', 'earlier'),
    ]);
    expect(commands.filter((c) => c.type === 'commit')).toEqual([
      { type: 'commit', deck: 'A', offsetMs: 2 },
      { type: 'commit', deck: 'B', offsetMs: -3 },
    ]);
  });
});

describe('grow/shrink bpm chord (hold-to-jog, in-session 2026-07-06)', () => {
  it('a tap fires the discrete grow/shrink step, pad op preserved', () => {
    const [, commands] = run([bpmDown('A', 'grow'), bpmUp('A', 'grow')]);
    expect(commands).toEqual([{ type: 'bpm-tap', deck: 'A', op: 'grow' }]);
    const [, shrink] = run([bpmDown('B', 'shrink'), bpmUp('B', 'shrink')]);
    expect(shrink).toEqual([{ type: 'bpm-tap', deck: 'B', op: 'shrink' }]);
  });

  it('ticks accumulate silently (no client-side re-tempo) and commit once on release', () => {
    const [, commands] = run([
      bpmDown('A', 'shrink'),
      ticks('A', 3),
      ticks('A', -1, 'touch'),
      bpmUp('A', 'shrink'),
    ]);
    expect(commands).toEqual([
      { type: 'bpm-commit', deck: 'A', deltaBpm: 2 * GRID_SPIN_BPM_PER_TICK },
    ]);
  });

  it('sign follows the spin (clockwise = BPM up), not the held pad', () => {
    // Holding GROW (BPM down) but spinning clockwise still raises BPM.
    const [, commands] = run([bpmDown('A', 'grow'), ticks('A', 5), bpmUp('A', 'grow')]);
    expect(commands).toEqual([
      { type: 'bpm-commit', deck: 'A', deltaBpm: 5 * GRID_SPIN_BPM_PER_TICK },
    ]);
    const [, ccw] = run([bpmDown('A', 'shrink'), ticks('A', -4), bpmUp('A', 'shrink')]);
    expect(ccw).toEqual([
      { type: 'bpm-commit', deck: 'A', deltaBpm: -4 * GRID_SPIN_BPM_PER_TICK },
    ]);
  });

  it('any tick makes it a hold: a zero-net spin is no tap and no commit', () => {
    const [, commands] = run([
      bpmDown('A', 'grow'),
      ticks('A', 2),
      ticks('A', -2),
      bpmUp('A', 'grow'),
    ]);
    expect(commands).toEqual([]);
  });

  it('suppresses normal jog meanings while armed; release restores them', () => {
    const [, commands] = run([
      bpmDown('A', 'shrink'),
      ticks('A', 1),
      bpmUp('A', 'shrink'),
      ticks('A', 1),
    ]);
    expect(commands).toEqual([
      { type: 'bpm-commit', deck: 'A', deltaBpm: GRID_SPIN_BPM_PER_TICK },
      { type: 'pass-jog', deck: 'A', stream: 'rim', ticks: 1 },
    ]);
  });

  it('one chord per deck: a nudge pad is ignored while bpm-armed and vice versa', () => {
    const [, commands] = run([
      bpmDown('A', 'grow'),
      down('A', 'later'), // ignored — bpm chord owns the gesture
      ticks('A', 2),
      up('A', 'later'), // stray release of the ignored pad: swallowed
      bpmUp('A', 'grow'),
    ]);
    expect(commands).toEqual([
      { type: 'bpm-commit', deck: 'A', deltaBpm: 2 * GRID_SPIN_BPM_PER_TICK },
    ]);
    const [, reverse] = run([
      down('A', 'later'),
      bpmDown('A', 'grow'), // ignored — nudge chord owns the gesture
      ticks('A', 3),
      bpmUp('A', 'grow'), // swallowed
      up('A', 'later'),
    ]);
    expect(reverse).toEqual([
      { type: 'local-nudge', deck: 'A', offsetMs: 3 },
      { type: 'commit', deck: 'A', offsetMs: 3 },
    ]);
  });

  it('decks chord independently across kinds', () => {
    const [, commands] = run([
      down('A', 'later'),
      bpmDown('B', 'shrink'),
      ticks('A', 2),
      ticks('B', 4),
      up('A', 'later'),
      bpmUp('B', 'shrink'),
    ]);
    expect(commands).toEqual([
      { type: 'local-nudge', deck: 'A', offsetMs: 2 },
      { type: 'commit', deck: 'A', offsetMs: 2 },
      { type: 'bpm-commit', deck: 'B', deltaBpm: 4 * GRID_SPIN_BPM_PER_TICK },
    ]);
  });
});

describe('second-pad edge cases', () => {
  it('the arming pad owns the gesture: a second pad-down is ignored', () => {
    const [, commands] = run([
      down('A', 'later'),
      down('A', 'earlier'), // ignored
      ticks('A', 2),
      up('A', 'earlier'), // the ignored pad's stray release: swallowed
      ticks('A', 1), // gesture continues
      up('A', 'later'),
    ]);
    expect(commands).toEqual([
      { type: 'local-nudge', deck: 'A', offsetMs: 2 },
      { type: 'local-nudge', deck: 'A', offsetMs: 1 },
      { type: 'commit', deck: 'A', offsetMs: 3 },
    ]);
  });

  it('a stray release with nothing armed is swallowed without state change', () => {
    const s = initialGridChordState();
    const [next, commands] = reduceGridChord(s, up('A', 'later'));
    expect(next).toBe(s);
    expect(commands).toEqual([]);
  });
});

describe('shiftBeatgrid (the optimistic local apply)', () => {
  const response: BeatgridResponse = {
    id: 1,
    track_id: 7,
    origin: 'edited',
    anchor_time: null,
    data: {
      tempo_changes: [
        {
          start_time: 0.5,
          bpm: 120,
          time_signature_num: 4,
          time_signature_den: 4,
          bar_position: 1,
        },
        {
          start_time: 60.5,
          bpm: 150,
          time_signature_num: 4,
          time_signature_den: 4,
          bar_position: 1,
        },
      ],
      beat_times: [0.5, 1.0, 1.5],
      downbeat_times: [0.5],
    },
    created_at: '',
    updated_at: '',
  };

  it('translates every tempo change, beat and downbeat rigidly', () => {
    const shifted = shiftBeatgrid(response, 25);
    expect(shifted.data.tempo_changes.map((tc) => tc.start_time)).toEqual([0.525, 60.525]);
    expect(shifted.data.beat_times).toEqual([0.525, 1.025, 1.525]);
    expect(shifted.data.downbeat_times).toEqual([0.525]);
    // Variable structure preserved (never flattened).
    expect(shifted.data.tempo_changes.map((tc) => tc.bpm)).toEqual([120, 150]);
  });

  it('does not mutate the input', () => {
    shiftBeatgrid(response, -10);
    expect(response.data.beat_times).toEqual([0.5, 1.0, 1.5]);
  });
});
