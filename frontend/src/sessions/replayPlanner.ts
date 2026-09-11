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
 *   playhead SYNC cues (the drift corrector). Loop regions are explicit.
 * - scratch trajectories/releases grouped by loaded-track tenure for
 *   ahead-of-time audio-thread scheduling, independent of UI frames.
 *
 * Honesty notes: tenure markers in the log are skipped (replay itself is
 * a machine tenure; replaying someone else's gap replays silence, which
 * the seed's paused decks already express).
 */
import type { CrossfaderAssignment } from '../playback/crossfaderAssignmentStore';
import type { CaptureDeck, CaptureEvent } from '../capture/events';
import { ALL_DECKS, stateAt } from './timelineModel';
import { applyEvent, initialAudibilityState, deckScratchMotion, deckPlayheadAt } from '../capture/audibilityReducer';
import type { ScratchFrame, ScratchFilter } from '../playback/worklet/scratchMotion';

export interface ReplaySeedDeck {
  trackId: number | null;
  playhead: number;
  playing: boolean;
  scratch: ScratchFilter | null;
  slipMode: boolean;
  vinylMode: boolean;
  loop: { start: number; end: number } | null;
  pitch: number;
  fader: number;
  trim: number;
  eq: { low: number; mid: number; high: number };
  filter: number;
  assignment: CrossfaderAssignment;
  /** Per-stem enables at the start moment (stems #212). */
  stems: { vocals: boolean; drums: boolean; bass: boolean; other: boolean };
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
  | { offsetS: number; kind: 'scratchBegin' | 'scratchEnd'; channel: CaptureDeck; playhead: number }
  | { offsetS: number; kind: 'scratchMove'; channel: CaptureDeck; playhead: number; deltaSeconds: number; durationSeconds: number }
  /** A stab (sessions 12): previewStart launches preview audio at
   * `playhead`; previewEnd stops at its `playhead` (the recorded return
   * position). Executed via the engine's machine-grade preview entry point
   * — audible, quantize-free, cue points untouched. */
  | { offsetS: number; kind: 'previewStart' | 'previewEnd'; channel: CaptureDeck; playhead: number }
  | { offsetS: number; kind: 'pitch'; channel: CaptureDeck; value: number }
  | { offsetS: number; kind: 'load'; channel: CaptureDeck; trackId: number | null }
  | { offsetS: number; kind: 'loop'; channel: CaptureDeck; playhead: number; region: { start: number; end: number } | null }
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
  /** Per loaded-track tenure, with times relative to startT. */
  scratchSchedules: { channel: CaptureDeck; trackId: number; loadOffset: number; frames: ScratchFrame[]; endFrame: ScratchFrame | null }[];
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
            scratch: d.scratch ? { ...d.scratch } : null,
            slipMode: d.slipMode,
            vinylMode: d.vinylMode,
            loop: d.loop ? { ...d.loop } : null,
            pitch: d.pitch,
            fader: d.fader,
            trim: d.trim,
            eq: d.eq,
            filter: d.filter,
            assignment: d.assignment,
            stems: { ...d.stems },
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
  const scratchSchedules: ReplayPlan['scratchSchedules'] = [];
  const scope: Partial<Record<CaptureDeck, ReplayPlan['scratchSchedules'][number]>> = {};
  for (const channel of ALL_DECKS) {
    const d = seed.decks[channel];
    if (d.trackId === null) continue;
    const entry = { channel, trackId: d.trackId, loadOffset: 0, frames: [] as ScratchFrame[], endFrame: null };
    scope[channel] = entry;
    scratchSchedules.push(entry);
  }
  const reduced = initialAudibilityState();
  const hasScratch = events.some(e => e.kind === 'transport' && e.action.startsWith('scratch'));
  for (const e of events) {
    if (e.t > startT && e.kind === 'load' && scope[e.channel]) {
      const d = reduced.decks[e.channel];
      scope[e.channel]!.endFrame = { time: e.t - startT, position: deckPlayheadAt(d, e.t),
        playing: false, motion: null, loop: d.loop, rate: 1 + d.pitch / 100 };
    }
    applyEvent(reduced, e);
    if (e.t <= startT) continue;
    const offsetS = e.t - startT;
    if (e.kind === 'load') {
      const entry = e.trackId === null ? undefined : {
        channel: e.channel, trackId: e.trackId, loadOffset: offsetS, frames: [] as ScratchFrame[], endFrame: null,
      };
      scope[e.channel] = entry;
      if (entry) scratchSchedules.push(entry);
    }
    if ((e.kind === 'transport' && e.action.startsWith('scratch')) || (hasScratch &&
      (e.kind === 'loop' || (e.kind === 'transport' && ['play', 'pause', 'cue'].includes(e.action))))) {
      const d = reduced.decks[e.channel];
      const motion = d.scratch ? deckScratchMotion(d) : null;
      if (motion) motion.time = offsetS;
      scope[e.channel]?.frames.push({ time: offsetS, motion, position: d.playhead,
        playing: d.playing, loop: d.loop ? { ...d.loop } : null, rate: 1 + d.pitch / 100 });
    }
    switch (e.kind) {
      case 'control':
        cues.push({ offsetS, kind: 'control', control: e.control, channel: e.channel, value: e.value });
        break;
      case 'transport':
        // The log records post-action POSITIONS, not gestures: jumps and
        // hot cues replay as seeks; cue = stop at the position. Stabs
        // (previewStart/previewEnd, sessions 12) replay as audible previews
        // through the engine's machine-grade entry point.
        if (e.action === 'scratchBegin' || e.action === 'scratchEnd') {
          cues.push({ offsetS, kind: e.action, channel: e.channel, playhead: e.playhead });
        } else if (e.action === 'scratchMove') {
          cues.push({ offsetS, kind: 'scratchMove', channel: e.channel, playhead: e.playhead,
            deltaSeconds: e.deltaSeconds ?? 0, durationSeconds: e.durationSeconds ?? 0 });
        } else if (e.action === 'play') {
          cues.push({ offsetS, kind: 'play', channel: e.channel, playhead: e.playhead });
        } else if (e.action === 'pause' || e.action === 'cue') {
          cues.push({ offsetS, kind: 'pause', channel: e.channel, playhead: e.playhead });
        } else if (e.action === 'previewStart' || e.action === 'previewEnd') {
          cues.push({ offsetS, kind: e.action, channel: e.channel, playhead: e.playhead });
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
      case 'loop':
        cues.push({ offsetS, kind: 'loop', channel: e.channel, playhead: e.playhead, region: e.region });
        break;
      // bend is momentary by definition;
      // tenure markers and init snapshots never replay.
      default:
        break;
    }
  }

  for (const ch of ALL_DECKS) {
    const entry = scope[ch];
    const d = reduced.decks[ch];
    if (entry) entry.endFrame = { time: endT - startT, position: deckPlayheadAt(d, endT),
      playing: false, motion: null, loop: d.loop, rate: 1 + d.pitch / 100 };
  }

  const anythingToHear =
    trackIds.size > 0 &&
    (ALL_DECKS.some((ch) => seed.decks[ch].playing || seed.decks[ch].scratch !== null) ||
      // A stab-only window is audible too (sessions 12).
      cues.some((c) => c.kind === 'play' || c.kind === 'load' || c.kind === 'previewStart' || c.kind === 'scratchMove'));
  if (!anythingToHear) return { ok: false, reason: 'nothing-loaded' };

  return {
    ok: true,
    plan: { startT, endT, seed, cues, trackIds: [...trackIds], scratchSchedules },
  };
}
