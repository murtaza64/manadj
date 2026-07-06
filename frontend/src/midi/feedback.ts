import type { DeckFeedback, LedAddress, MappingFeedback } from './mapping';

/**
 * The Feedback seam (midi-pad-leds PRD, ADR 0002): deck state in →
 * per-light on/off out (`ledStates`), and light states + a Mapping's
 * feedback section in → MIDI messages out (`encodeDeckLeds`). Pure — no
 * Web MIDI, no engine; the adapter and the feedback bridge are the
 * hands-on-verified glue around it.
 *
 * No diffing anywhere: callers recompute and resend a deck's full light
 * set on every relevant state change (a handful of lights is nothing),
 * which is also exactly what a connect/replug resync needs.
 */

/** Number of hot cue pads on the grid (slots 1..PAD_COUNT). */
export const PAD_COUNT = 8;

/** The slice of deck state Feedback reads. */
export interface DeckLedInput {
  playing: boolean;
  /** Play latched during a load (deck snapshot vocabulary). */
  pendingPlay: boolean;
  /** Hold-to-preview in progress (CUE held while paused). */
  previewing: boolean;
  /** A cue point is set on the loaded Track (snapshot cuePoint !== null). */
  hasCuePoint: boolean;
  /**
   * Paused with the playhead at the cue point — stab armed. Callers derive
   * it the same way the on-screen CUE button does (coarse playhead poll
   * against the snapshot's cuePoint).
   */
  atCuePoint: boolean;
  /**
   * Assigned hot cue slot numbers (1-based) of the loaded Track — from the
   * same query cache the on-screen pads render, so screen and hardware
   * cannot drift. Empty deck = empty set = all pads dark.
   */
  assignedPads: ReadonlySet<number>;
  /**
   * This channel feeds the Cue bus (Mixer channel state, headphone-cue 05)
   * — the one non-deck input; the bridge reads it off the Mixer's change
   * subscription like the on-screen PFL button.
   */
  pfl: boolean;
  /**
   * The loaded Track has a Beatgrid (midi-performance-ops 05) — from the
   * same beatgrid query the on-screen grid controls read, so lamp and
   * behavior cannot drift. Empty deck or gridless Track = false = grid
   * pads dark (and presses no-op).
   */
  hasBeatgrid: boolean;
}

/** Desired on/off per light of one deck. */
export interface DeckLedStates {
  play: boolean;
  cue: boolean;
  /** PFL button light — lit while the channel is cued (headphone-cue 05). */
  pfl: boolean;
  /** Pads 1..8 by index (index 0 = pad 1), HOTCUE base layer only. */
  pads: readonly boolean[];
  /** Grid-edit (SAMPLER) pads 1..8 by index (midi-performance-ops 05):
   * mapped pads lit steadily iff the Track has a Beatgrid; pad 3 (the one
   * unbound pad) dark always. */
  gridPads: readonly boolean[];
}

/** [status, data1, data2] — ready for MIDIOutput.send. */
export type MidiMessage = readonly [number, number, number];

/**
 * The app-driven blink clock (the device has no native blink). Phases are
 * derived from the clock (floor(now / interval) parity), so every deck and
 * every light agree regardless of when each started blinking — the same
 * epoch-anchoring trick as the on-screen CUE flash animation. `true` = lit.
 */
export const BLINK_INTERVAL_MS = 250; // pending-play PLAY blink, ~2 Hz
export const CUE_FLASH_INTERVAL_MS = 500; // CUE away-flash, 1 Hz — the screen's period

export function blinkPhase(nowMs: number, intervalMs: number = BLINK_INTERVAL_MS): boolean {
  return Math.floor(nowMs / intervalMs) % 2 === 0;
}

/** The two blink phases in play; both `true` when no clock is running. */
export interface BlinkPhases {
  /** ~2 Hz — PLAY while play is latched during a load. */
  pending: boolean;
  /** 1 Hz — CUE while paused away from the cue point (screen parity). */
  cueFlash: boolean;
}

const STEADY: BlinkPhases = { pending: true, cueFlash: true };

/**
 * Deck state → desired light states. Phases only matter for the blinking
 * states (pendingPlay PLAY, paused-away-from-cue CUE); solid/off states
 * ignore them.
 */
export function ledStates(input: DeckLedInput, phases: BlinkPhases = STEADY): DeckLedStates {
  const paused = !input.playing && !input.previewing;
  return {
    play: input.playing || (input.pendingPlay && phases.pending),
    // Solid when a stab is armed (paused at the cue), lit through a
    // hold-to-preview (the playhead runs away from the cue; previewing
    // keeps the light on), flashing when paused away from a set cue
    // (mirrors the on-screen CUE button), off while playing.
    cue:
      input.previewing ||
      (paused &&
        input.hasCuePoint &&
        (input.atCuePoint || phases.cueFlash)),
    pfl: input.pfl,
    pads: Array.from({ length: PAD_COUNT }, (_, i) => input.assignedPads.has(i + 1)),
    gridPads: GRID_PAD_MAPPED.map((mapped) => mapped && input.hasBeatgrid),
  };
}

/** Which grid-edit pads are bound (pad 3 is deliberately silent/dark). */
const GRID_PAD_MAPPED: readonly boolean[] = [
  true, // 1: grid-nudge earlier
  true, // 2: anchor
  false, // 3: unbound
  true, // 4: grid-nudge later
  true, // 5: shrink
  true, // 6: grow
  true, // 7: BPM halve
  true, // 8: BPM double
];

/**
 * Audibility-aware transport lights (editor-midi 05, ADR 0019): while a
 * non-shared surface holds audibility, PLAY mirrors the HOLDER's transport
 * (the editor reports its one mix transport for both decks) and every
 * shared-deck transport state is suppressed — CUE dark (no editor
 * meaning), no pending-blink, no away-from-cue flash. Pads and PFL pass
 * through: the editor mirrors its pair onto the shared decks, and the Cue
 * bus belongs to the shared Mixer regardless of audibility.
 */
export function audibleTransportOverride(
  input: DeckLedInput,
  holderPlaying: boolean
): DeckLedInput {
  return {
    ...input,
    playing: holderPlaying,
    pendingPlay: false,
    previewing: false,
    hasCuePoint: false,
    atCuePoint: false,
  };
}

const NOTE_ON = 0x9;

function encodeLed(address: LedAddress, lit: boolean): MidiMessage {
  return [(NOTE_ON << 4) | address.channel, address.number, lit ? address.onVelocity : 0x00];
}

function deckAddresses(deck: DeckFeedback): readonly LedAddress[] {
  return [
    deck.play,
    deck.cue,
    deck.pfl,
    ...deck.hotCuePads,
    ...deck.hotCuePadsShifted,
    ...deck.gridPads,
  ];
}

/** Desired light states for one deck → the full message set to send. */
export function encodeDeckLeds(
  feedback: MappingFeedback,
  deck: 'A' | 'B',
  states: DeckLedStates
): readonly MidiMessage[] {
  const addresses = feedback.decks[deck];
  return [
    encodeLed(addresses.play, states.play),
    encodeLed(addresses.cue, states.cue),
    encodeLed(addresses.pfl, states.pfl),
    ...addresses.hotCuePads.map((address, i) => encodeLed(address, states.pads[i] ?? false)),
    // The SHIFT layer mirrors the base layer (same hotcue_N_status source
    // in Mixxx), so pads stay lit while SHIFT is held — no shift tracking.
    ...addresses.hotCuePadsShifted.map((address, i) =>
      encodeLed(address, states.pads[i] ?? false)
    ),
    // Grid-edit (SAMPLER) layer (midi-performance-ops 05).
    ...addresses.gridPads.map((address, i) => encodeLed(address, states.gridPads[i] ?? false)),
  ];
}

/**
 * Every mapped light dark — sent on detach and dispose so stale state
 * never lingers on the hardware.
 */
export function allOffMessages(feedback: MappingFeedback): readonly MidiMessage[] {
  return (['A', 'B'] as const).flatMap((deck) =>
    deckAddresses(feedback.decks[deck]).map((address) => encodeLed(address, false))
  );
}
