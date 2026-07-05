/**
 * Play guide model (play-guides PRD) — pure, under vitest.
 *
 * Glossary: Play guide — a derived, view-only marker in the Performance
 * view, one per saved Transition from the playing Track to the paused
 * Track, marking the instant to press play on the paused Deck so the pair
 * rides that Transition's alignment. Never stored, never editable.
 *
 * The projection is dynamic — it works wherever the incoming Track is
 * cued: given the paused Deck's playhead, the marker sits at the
 * outgoing-track time where that cued position coincides with the saved
 * trajectory,
 *
 *   aTime = startSec + (playheadB − bInSec) / r
 *
 * with r the Transition's saved tempo-match ratio (bpmA/bpmB when
 * tempoMatch, else 1). Actual pitch faders never move the marker; living
 * in A-track-time makes it correct under any outgoing-Deck pitch by
 * construction (it rides the waveform like any track-time landmark).
 */
import type { PairStore } from '../editor/pairStore';

export interface GuideDeck {
  trackId: number | null;
  playing: boolean;
  /** Current playhead, track seconds. */
  playhead: number;
  /** Base (track) BPM — pitch excluded. */
  bpm: number | null;
  /** Pitch fader percent (bend excluded — momentary). */
  pitchPercent: number;
}

export interface PlayGuide {
  uuid: string;
  name: string;
  favorite: boolean;
  /** The press-play instant, in the OUTGOING Track's seconds. */
  aTime: number;
  /** True when the press moment is already behind the playing playhead —
   * reported, not dropped (re-cueing the incoming Track brings it back). */
  missed: boolean;
  /** The pitch the paused Deck needs for the alignment to hold after the
   * press, when its current pitch would drift beyond tolerance. Null when
   * the pitch already matches (no warning) or the ratio is unknowable. */
  requiredPitchPercent: number | null;
}

/** How far the paused Deck's pitch may sit from the requirement before the
 * chip warns — one fader step (the fader quantizes to 0.1%). A tunable
 * heuristic, not part of the concept. */
export const PITCH_TOLERANCE_PERCENT = 0.1;

/** Float-noise guard for the tolerance boundary (0.1 is not exact). */
const TOLERANCE_EPS = 1e-9;

export interface PlayGuideFrame {
  /** Which Deck is the outgoing (playing) side. */
  outgoing: 'A' | 'B';
  /** The paused Deck — whose color the guide carries, and whose play
   * button the guide is about. */
  incoming: 'A' | 'B';
  guides: PlayGuide[];
}

/**
 * Where a guide sits across the Performance view's stacked waveforms, as a
 * fraction of the canvas width. The playing row pins its playhead at a
 * fixed screen fraction and scrolls TRACK seconds past it, so the guide's
 * offset is its track-time delta over the row's visible window. Linked
 * zoom makes the same x valid across both rows (one wall-clock screen
 * space) — the spanning line is one fraction, not two.
 */
export function guideScreenFraction(
  aTime: number,
  outgoingPlayhead: number,
  visibleTrackSeconds: number,
  playheadMarkerFraction: number
): number {
  return playheadMarkerFraction + (aTime - outgoingPlayhead) / visibleTrackSeconds;
}

/**
 * Compute the Play guides for the current Deck pair, as directional
 * frames. Appearance conditions (issue 01):
 * - both Decks playing → nothing (nothing to press);
 * - one playing, the other loaded and paused → that direction only;
 * - both paused (prep state) → both directions at once — either Deck could
 *   become the outgoing side; starting one prunes to the live direction.
 * A direction appears only when it has saved Transitions.
 */
export function computePlayGuides(
  store: PairStore,
  decks: { A: GuideDeck; B: GuideDeck }
): PlayGuideFrame[] {
  if (decks.A.playing && decks.B.playing) return [];
  const directions: Array<['A' | 'B', 'A' | 'B']> = decks.A.playing
    ? [['A', 'B']]
    : decks.B.playing
      ? [['B', 'A']]
      : [
          ['A', 'B'],
          ['B', 'A'],
        ];
  const frames: PlayGuideFrame[] = [];
  for (const [outgoing, incoming] of directions) {
    const frame = directionFrame(store, outgoing, incoming, decks[outgoing], decks[incoming]);
    if (frame) frames.push(frame);
  }
  return frames;
}

/** One direction's frame, or null when unloaded or nothing is saved. */
function directionFrame(
  store: PairStore,
  outgoing: 'A' | 'B',
  incoming: 'A' | 'B',
  out: GuideDeck,
  inc: GuideDeck
): PlayGuideFrame | null {
  if (out.trackId === null || inc.trackId === null) return null;

  const entry = store[`${out.trackId}:${inc.trackId}`];
  if (!entry || entry.items.length === 0) return null;

  const guides: PlayGuide[] = entry.items.map((item) => {
    const tr = item.transition;
    // The saved tempo-match ratio: B-track seconds per A-track second.
    // Unknowable without both BPMs — degrade to 1:1 (nothing else is
    // computable, and a BPM-less tempo match was never meaningful).
    const ratioKnown = !tr.tempoMatch || (!!out.bpm && !!inc.bpm);
    const r = tr.tempoMatch && out.bpm && inc.bpm ? out.bpm / inc.bpm : 1;
    const aTime = tr.startSec + (inc.playhead - tr.bInSec) / r;

    // Pitch is a PRECONDITION the guide surfaces, never enforces: for the
    // alignment to hold after the press, the incoming Deck's rate must be
    // r × the outgoing Deck's actual rate. Unknowable ratio → no warning
    // (a false one is worse than none).
    let requiredPitchPercent: number | null = null;
    if (ratioKnown) {
      const required = (r * (1 + out.pitchPercent / 100) - 1) * 100;
      if (Math.abs(inc.pitchPercent - required) > PITCH_TOLERANCE_PERCENT + TOLERANCE_EPS) {
        requiredPitchPercent = required;
      }
    }

    return {
      uuid: item.uuid,
      name: item.name,
      favorite: item.favorite ?? false,
      aTime,
      missed: aTime < out.playhead,
      requiredPitchPercent,
    };
  });
  return { outgoing, incoming, guides };
}
