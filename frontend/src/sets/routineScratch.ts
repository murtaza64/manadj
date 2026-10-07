/**
 * Scratch clips (#352): a recorded Vinyl gesture replayed as-is by the
 * audio thread, never reduced to position math.
 *
 * A clip is one slot's scratchBegin → scratchMove* → scratchEnd bracket
 * from the beat-stamped recording: every frame carries the post-input
 * position and platter filter (drive, rate), so the worklet reproduces
 * the motion between frames exactly as Session replay does
 * (DeckEngine.scheduleScratch). Position math (traces, arrangement) sees
 * only the clip's NET effect: the per-move samples stay out of the trace
 * (`isScratchMoveSample`), so the trace holds the pre-gesture motion up to
 * scratchBegin and lands on scratchEnd's recorded position. Players hand
 * the clip to the engine and stand off that deck while it runs.
 *
 * Tempo: frames live on the beat axis. At another tempo the gesture
 * stretches with the beat (k = mix seconds / recorded seconds) and the
 * filter rates scale by 1/k, so every frame still lands on its recorded
 * position.
 */
import type { ScratchFrame } from '../playback/worklet/scratchMotion';
import { scratchFilterAt, scratchPosition } from '../playback/worklet/scratchMotion';

type EventInput = Record<string, unknown>;

/** One recorded frame, beat-stamped (the routine recording's axis). */
export interface RecordedScratchFrame {
  beat: number;
  /** Capture audio clock (s), when the recording kept it — the gesture's
   * true timing, used for the tempo stretch factor. */
  audioTime?: number;
  position: number;
  /** Filter state after this frame; null = released (the landing). */
  filter: { drive: number; rate: number } | null;
  /** Deck transport running under the hand / after release. */
  playing: boolean;
}

/** A slot's recorded gesture in recording coordinates. */
export interface RecordedScratchClip {
  startBeat: number;
  endBeat: number;
  frames: RecordedScratchFrame[];
}

/** A clip placed on the mix axis, ready for DeckEngine.scheduleScratch
 * (frame times are MIX seconds; players map them onto the audio clock). */
export interface PlannedScratchClip {
  startMixSec: number;
  endMixSec: number;
  frames: ScratchFrame[];
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Per-move scratch samples are motion evidence, not trace samples: the
 * trace keeps scratchBegin (pre-gesture position) and scratchEnd (the
 * landing) and lets the clip carry everything between. */
export function isScratchMoveSample(e: EventInput): boolean {
  return e.kind === 'transport' && e.action === 'scratchMove';
}

/** Extract a slot's scratch clips from the slot-addressed beat-domain
 * recording.
 *
 * A clip runs until the deck is RUNNING again: a gesture released onto a
 * stopped deck keeps the clip open through the stopped stretch (cue and
 * hot-cue snaps while stopped become position frames) until the next play
 * or gesture — a scratch routine on a paused record is one clip, and the
 * transport between its gestures belongs to it. A clip still open at the
 * recording's end closes on its last frame. */
export function slotScratchClips(events: EventInput[], slot: number | string): RecordedScratchClip[] {
  const mine = events
    .filter((e) => e.slot === slot && (e.kind === 'transport' || e.kind === 'load') && num(e.beat) !== null)
    .sort((a, b) => (a.beat as number) - (b.beat as number));
  const clips: RecordedScratchClip[] = [];
  let playing: boolean | null = null;
  let open = null as RecordedScratchClip | null;
  /** A gesture is in progress (between begin and end) inside `open`. */
  let held = false;
  // Transport state before the first transport event: inferred from the
  // first play/pause that follows (a pause means it was rolling).
  const firstToggle = mine.find((e) => e.action === 'play' || e.action === 'pause' || e.action === 'cue');
  const initialPlaying = firstToggle ? firstToggle.action !== 'play' : true;
  const frameOf = (e: EventInput, filter: RecordedScratchFrame['filter']): RecordedScratchFrame | null => {
    const beat = num(e.beat);
    const position = num(e.playhead);
    if (beat === null || position === null) return null;
    const audioTime = num(e.audioTime);
    return { beat, position, filter, playing: playing ?? initialPlaying,
      ...(audioTime !== null ? { audioTime } : {}) };
  };
  const filterOf = (e: EventInput, fallback: { drive: number; rate: number }) => {
    const filter = e.filter as { drive?: unknown; rate?: unknown } | undefined;
    const drive = num(filter?.drive);
    const rate = num(filter?.rate);
    return drive !== null && rate !== null ? { drive, rate } : fallback;
  };
  const push = (f: RecordedScratchFrame | null): void => {
    if (f && open) {
      open.frames.push(f);
      open.endBeat = f.beat;
    }
  };
  const close = (): void => {
    if (!open) return;
    const last = open.frames[open.frames.length - 1];
    if (last.filter) push({ ...last, filter: null });
    clips.push(open);
    open = null;
    held = false;
  };
  const begin = (f: RecordedScratchFrame | null): void => {
    if (!f) return;
    if (open) push(f);
    else open = { startBeat: f.beat, endBeat: f.beat, frames: [f] };
    held = true;
  };
  for (const e of mine) {
    if (e.kind === 'load') {
      close();
      playing = null;
      continue;
    }
    const action = e.action;
    if (action === 'play') playing = true;
    else if (action === 'pause' || action === 'cue') playing = false;
    if (action === 'scratchBegin') {
      begin(frameOf(e, { drive: 0, rate: 0 }));
    } else if (action === 'scratchMove') {
      // No begin yet: a slice opening inside a held gesture (its
      // scratchBegin fell before the recording) — the first move opens.
      if (!held) begin(frameOf(e, filterOf(e, { drive: 0, rate: 0 })));
      else push(frameOf(e, filterOf(e, open!.frames[open!.frames.length - 1].filter ?? { drive: 0, rate: 0 })));
    } else if (action === 'scratchEnd' && held) {
      held = false;
      push(frameOf(e, null));
      if (playing ?? initialPlaying) close();
    } else if (open && (action === 'play' || action === 'pause' || action === 'cue')) {
      // Transport flips under the hand, or the stopped record starts.
      push(frameOf(e, held ? open.frames[open.frames.length - 1].filter : null));
      if (!held && action === 'play') close();
    } else if (open && !held) {
      // Cue/hot-cue/seek snaps on the stopped record between gestures.
      push(frameOf(e, null));
    }
  }
  close();
  return clips;
}

/**
 * Place a recorded clip on the mix axis. `beatShift`/`posShift` are the
 * slot's entry-offset and nudge edits (the clip rides its material);
 * `rateAfter` is the deck rate the trace resumes at after release.
 */
export function planScratchClip(
  clip: RecordedScratchClip,
  opts: { beatShift: number; posShift: number; beatOriginMixSec: number; secPerBeat: number; rateAfter: number }
): PlannedScratchClip {
  const mixAt = (beat: number) => opts.beatOriginMixSec + (beat + opts.beatShift) * opts.secPerBeat;
  const first = clip.frames[0];
  const last = clip.frames[clip.frames.length - 1];
  const mixSpan = (clip.endBeat - clip.startBeat) * opts.secPerBeat;
  const audioSpan = first.audioTime !== undefined && last.audioTime !== undefined
    ? last.audioTime - first.audioTime : 0;
  const k = mixSpan > 0 && audioSpan > 0 && mixSpan / audioSpan > 0.25 && mixSpan / audioSpan < 4
    ? mixSpan / audioSpan : 1;
  const frames: ScratchFrame[] = clip.frames.map((f) => {
    const time = mixAt(f.beat);
    const position = f.position + opts.posShift;
    return {
      time,
      position,
      playing: f.playing,
      loop: null,
      rate: opts.rateAfter,
      motion: f.filter
        ? { drive: f.filter.drive / k, rate: f.filter.rate / k, position, time,
          trackDuration: Infinity, loop: null }
        : null,
    };
  });
  return { startMixSec: mixAt(clip.startBeat), endMixSec: mixAt(clip.endBeat), frames };
}

/** The clip frames still ahead of mix time `t`, prefixed by the gesture's
 * reconstructed state AT `t` when `t` falls inside it (seek/start into a
 * running scratch). Times are mapped through `toAudio`. */
export function scratchFramesFrom(
  clip: PlannedScratchClip,
  t: number,
  toAudio: (mixSec: number) => number
): ScratchFrame[] {
  const out: ScratchFrame[] = [];
  let prev: ScratchFrame | null = null;
  for (const f of clip.frames) {
    if (f.time <= t) {
      prev = f;
      continue;
    }
    out.push(f);
  }
  if (prev?.motion && out.length > 0) {
    const filter = scratchFilterAt(prev.motion, t);
    const position = scratchPosition(prev.motion, t);
    out.unshift({ ...prev, time: t, position, motion: { ...prev.motion, ...filter, position, time: t } });
  }
  return out.map((f) => {
    const time = toAudio(f.time);
    return { ...f, time, motion: f.motion ? { ...f.motion, time } : null };
  });
}

/** The clip running (or about to, within `leadSec`) at mix time t. */
export function scratchClipAt(
  clips: readonly PlannedScratchClip[] | undefined,
  t: number,
  leadSec = 0
): PlannedScratchClip | null {
  for (const c of clips ?? []) {
    if (t >= c.startMixSec - leadSec && t < c.endMixSec) return c;
  }
  return null;
}
