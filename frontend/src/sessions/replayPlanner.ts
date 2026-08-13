/**
 * Session replay planner (sessions 05, ADR 0033) — the PRD's single new
 * pure seam. From one Session's whole event log and a start moment T it
 * derives everything the replay driver executes, with no audio and no
 * side effects (prior art: the Set planner):
 *
 * - the SEED: full reconstructed state at T (tracks on decks, playheads
 *   analytically extrapolated between ticks, transport, pitch, mixer)
 * - the CUES: every event after T mapped to a fire-at offset — controls
 *   and pitch verbatim, transport normalized (seek-class actions become
 *   seeks; the log records positions, not gestures), ticks becoming
 *   playhead SYNC cues (the drift corrector — also what makes a held
 *   loop's wraps audible without a loop-region API: each pass re-seeks).
 *
 * Honesty notes: tenure markers in the log are skipped (replay itself is
 * a machine tenure; replaying someone else's gap replays silence, which
 * the seed's paused decks already express). Loop events are skipped for
 * v1 — the ~1 Hz sync cues reproduce the wrap within a second.
 */
import type { CrossfaderAssignment } from '../playback/crossfaderAssignmentStore';
import type { CaptureDeck, CaptureEvent } from '../capture/events';
import { ALL_DECKS, stateAt } from './timelineModel';

export interface ReplaySeedDeck {
  trackId: number | null;
  playhead: number;
  playing: boolean;
  pitch: number;
  fader: number;
  trim: number;
  eq: { low: number; mid: number; high: number };
  filter: number;
  assignment: CrossfaderAssignment;
}

export interface ReplaySeed {
  decks: Record<CaptureDeck, ReplaySeedDeck>;
  crossfader: number;
  crossfaderEnabled: boolean;
}

export type ReplayCue =
  | {
      offsetS: number;
      kind: 'control';
      control: string;
      channel: CaptureDeck | null;
      value: number;
    }
  | { offsetS: number; kind: 'play' | 'pause'; channel: CaptureDeck; playhead: number }
  | { offsetS: number; kind: 'seek'; channel: CaptureDeck; playhead: number }
  | { offsetS: number; kind: 'pitch'; channel: CaptureDeck; value: number }
  | { offsetS: number; kind: 'load'; channel: CaptureDeck; trackId: number | null }
  | { offsetS: number; kind: 'sync'; playheads: Partial<Record<CaptureDeck, number>> };

export interface ReplayPlan {
  /** Capture-clock start moment. */
  startT: number;
  /** Capture-clock log end — replay runs out here (duration = endT-startT). */
  endT: number;
  seed: ReplaySeed;
  /** Fire-at-offset cues, ordered by offset. */
  cues: ReplayCue[];
  /** Every track replay will need: seed decks now + future loads. */
  trackIds: number[];
}

export type PlanReplayResult =
  | { ok: true; plan: ReplayPlan }
  | { ok: false; reason: 'empty-log' | 'nothing-loaded' };

export function planReplay(events: CaptureEvent[], startT: number): PlanReplayResult {
  if (events.length === 0) return { ok: false, reason: 'empty-log' };
  const endT = events[events.length - 1].t;
  const state = stateAt(events, startT);

  const seed: ReplaySeed = {
    decks: Object.fromEntries(
      ALL_DECKS.map((ch) => {
        const d = state.decks[ch];
        return [
          ch,
          {
            trackId: d.trackId,
            playhead: d.playhead,
            playing: d.playing,
            pitch: d.pitch,
            fader: d.fader,
            trim: d.trim,
            eq: d.eq,
            filter: d.filter,
            assignment: d.assignment,
          },
        ];
      })
    ) as Record<CaptureDeck, ReplaySeedDeck>,
    crossfader: state.crossfader,
    crossfaderEnabled: state.crossfaderEnabled,
  };

  const trackIds = new Set<number>();
  for (const ch of ALL_DECKS) {
    const id = seed.decks[ch].trackId;
    if (id !== null) trackIds.add(id);
  }

  const cues: ReplayCue[] = [];
  for (const e of events) {
    if (e.t <= startT) continue;
    const offsetS = e.t - startT;
    switch (e.kind) {
      case 'control':
        cues.push({ offsetS, kind: 'control', control: e.control, channel: e.channel, value: e.value });
        break;
      case 'transport':
        // The log records post-action POSITIONS, not gestures: jumps and
        // hot cues replay as seeks; cue = stop at the position.
        if (e.action === 'play') {
          cues.push({ offsetS, kind: 'play', channel: e.channel, playhead: e.playhead });
        } else if (e.action === 'pause' || e.action === 'cue') {
          cues.push({ offsetS, kind: 'pause', channel: e.channel, playhead: e.playhead });
        } else {
          cues.push({ offsetS, kind: 'seek', channel: e.channel, playhead: e.playhead });
        }
        break;
      case 'pitch':
        cues.push({ offsetS, kind: 'pitch', channel: e.channel, value: e.value });
        break;
      case 'load':
        cues.push({ offsetS, kind: 'load', channel: e.channel, trackId: e.trackId });
        if (e.trackId !== null) trackIds.add(e.trackId);
        break;
      case 'tick':
        cues.push({ offsetS, kind: 'sync', playheads: e.playheads });
        break;
      // bend is momentary by definition; loop wraps ride the sync cues;
      // tenure markers and init snapshots never replay.
      default:
        break;
    }
  }

  const anythingToHear =
    trackIds.size > 0 &&
    (ALL_DECKS.some((ch) => seed.decks[ch].playing) ||
      cues.some((c) => c.kind === 'play' || c.kind === 'load'));
  if (!anythingToHear) return { ok: false, reason: 'nothing-loaded' };

  return {
    ok: true,
    plan: { startT, endT, seed, cues, trackIds: [...trackIds] },
  };
}
