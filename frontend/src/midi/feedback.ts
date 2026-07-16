import type { DeckFeedback, LedAddress, MappingFeedback, MeterAddress } from './mapping';
import { CHANNEL_IDS } from '../playback/mixer';
import type { ChannelId } from '../playback/mixer';
import { beatsBetween } from '../playback/quantize';
import { encodeMeterValue } from './levelMeter';

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
   * A Track is loaded (four-deck 31): gates the paused-transport flashes —
   * an empty Deck keeps PLAY and CUE dark (CDJ parity).
   */
  loaded: boolean;
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
  /**
   * The app-wide Quantize toggle (midi-performance-ops 07) — the second
   * non-deck input; both decks receive the same value, so the two Q lamps
   * mirror the one switch.
   */
  quantize: boolean;
  /** The Deck's Key Lock (engine snapshot state, midi-performance-ops 07)
   * — drives the SHIFT-layer Q lamp probe only. */
  keyLock: boolean;
  /**
   * The active loop's length in beats, or null when no loop runs
   * (midi-performance-ops 02) — drives the LOOP-mode pad lamps: the pad
   * whose preset equals this lights, per page; off-ladder lengths match
   * no pad and show all dark (the screen stays the truth).
   */
  loopBeats: number | null;
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
  /** Q button light — mirrors app-wide Quantize (midi-performance-ops 07). */
  quantize: boolean;
  /** SHIFT-layer Q light (the Key Lock lamp probe) — the Deck's Key Lock. */
  keyLock: boolean;
  /** Active loop length in beats or null — encodeDeckLeds lights the
   * LOOP-mode pad whose mapped preset equals it (exact dyadic equality;
   * lengths and presets are both exact binary fractions). */
  loopBeats: number | null;
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

export function blinkPhase(nowMs: number, intervalMs: number = BLINK_INTERVAL_MS): boolean {
  return Math.floor(nowMs / intervalMs) % 2 === 0;
}

/**
 * Paused-transport beat flash (four-deck 31), HALF-TIME: the cycle spans
 * two beats — lit through one beat, dark through the next — at the Deck's
 * effective BPM, phase-locked to its own Beatgrid, so four paused Decks
 * each pulse to their own Track, not to a shared wall interval. (Per-beat
 * cycling was hands-on rejected as frantic.) Gridless / unloaded /
 * BPM-less Decks use the fixed fallback.
 */
export const BEAT_FLASH_BEATS_PER_CYCLE = 2;
export const BEAT_FLASH_FALLBACK_PERIOD_MS = 1000; // 1 Hz — the old screen cadence

export function beatFlashPeriodMs(effectiveBpm: number | null): number {
  if (effectiveBpm === null || !Number.isFinite(effectiveBpm) || effectiveBpm <= 0) {
    return BEAT_FLASH_FALLBACK_PERIOD_MS;
  }
  return (60_000 / effectiveBpm) * BEAT_FLASH_BEATS_PER_CYCLE;
}

/** The paused playhead's position within the two-beat flash cycle, [0, 1)
 * — the phase anchor. 0 without a usable grid (fallback stays
 * epoch-anchored). */
export function beatFlashFraction(
  playheadSeconds: number,
  beatTimes: readonly number[] | null
): number {
  if (!beatTimes || beatTimes.length < 2) return 0;
  const beats = beatsBetween(beatTimes[0], playheadSeconds, beatTimes);
  const cycle = BEAT_FLASH_BEATS_PER_CYCLE;
  return (((beats % cycle) + cycle) % cycle) / cycle;
}

/** CSS-animation anchor for the on-screen flash: the negative delay (ms)
 * that puts a lit-then-dark keyframe pair at the same phase
 * beatFlashPhase computes — screen and Controller lamps agree. */
export function beatFlashAnimationDelayMs(
  nowMs: number,
  periodMs: number,
  beatFraction = 0
): number {
  return ((((nowMs / periodMs + beatFraction) % 1) + 1) % 1) * periodMs;
}

/** Lit for the first beat of each two-beat cycle; the lit edge lands where
 * the Deck's grid beats land relative to its paused playhead. */
export function beatFlashPhase(nowMs: number, periodMs: number, beatFraction = 0): boolean {
  return beatFlashAnimationDelayMs(nowMs, periodMs, beatFraction) / periodMs < 0.5;
}

/** The blink phases in play; all `true` when no clock is running. */
export interface BlinkPhases {
  /** ~2 Hz wall clock — PLAY while play is latched during a load. */
  pending: boolean;
  /** Beat-phased (beatFlashPhase) — paused PLAY and away-from-cue CUE.
   * Both lamps share the phase: on a CDJ they blink in step. */
  beatFlash: boolean;
}

const STEADY: BlinkPhases = { pending: true, beatFlash: true };

/**
 * Deck state → desired light states, per the CDJ lamp table (four-deck 31;
 * verified against the CDJ-2000NXS2 manual DRI1290A p.15/21/23, CDJ-3000
 * functional parity):
 *
 *   PLAY  lit while playing; FLASHES whenever paused (any pause, including
 *         paused at the cue and through a hold-to-preview — preview is
 *         pause-mode on a CDJ); pending-play keeps its distinct ~2 Hz
 *         wall-clock blink (a manadj state a CDJ does not have).
 *   CUE   lit paused AT the cue (stab armed); lit through hold-to-preview;
 *         lit during playback WITH a cue set (return available); FLASHES
 *         paused away from the cue — including with NO cue set (a cue is
 *         recordable here); dark while playing without a cue; dark unloaded.
 *
 * Pioneer documents no flash rate; manadj drives the paused flash at the
 * Deck's effective BPM phase-locked to its grid (beatFlashPhase), falling
 * back to 1 Hz. Phases only matter for the blinking states; solid/off
 * states ignore them. Editor-audibility keeps its own documented shape:
 * audibleTransportOverride suppresses every flash (PLAY mirrors the
 * holder's transport solid/dark; CUE stays dark).
 */
export function ledStates(input: DeckLedInput, phases: BlinkPhases = STEADY): DeckLedStates {
  const paused = !input.playing && !input.previewing;
  const pausedLoaded = paused && input.loaded;
  return {
    play: input.playing
      ? true
      : input.pendingPlay
        ? phases.pending
        : (pausedLoaded || input.previewing) && phases.beatFlash,
    cue: input.previewing
      ? true
      : input.playing
        ? input.hasCuePoint
        : pausedLoaded &&
          (input.hasCuePoint && input.atCuePoint ? true : phases.beatFlash),
    pfl: input.pfl,
    pads: Array.from({ length: PAD_COUNT }, (_, i) => input.assignedPads.has(i + 1)),
    gridPads: GRID_PAD_MAPPED.map((mapped) => mapped && input.hasBeatgrid),
    quantize: input.quantize,
    keyLock: input.keyLock,
    loopBeats: input.loopBeats,
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
    // Suppresses the paused-transport beat flash too (four-deck 31): an
    // editor-paused shared Deck shows PLAY dark, not flashing — the
    // holder's transport is a mirror, not a CDJ pause.
    loaded: false,
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
    ...deck.jumpPads,
    ...deck.gridPads,
    deck.quantize,
    ...(deck.keyLock ? [deck.keyLock] : []),
    ...(deck.keyLockShifted ? [deck.keyLockShifted] : []),
    ...deck.loopPads,
    ...deck.loopPadsShifted,
  ];
}

/** Desired light states for one deck → the full message set to send. */
export function encodeDeckLeds(
  feedback: MappingFeedback,
  deck: ChannelId,
  states: DeckLedStates
): readonly MidiMessage[] {
  const addresses = feedback.decks[deck];
  if (!addresses) return [];
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
    ...addresses.jumpPads.map((address) => encodeLed(address, false)),
    // Grid-edit layer. A Mapping may provide its own bound-pad mask; those
    // action pads share the deck's has-Beatgrid state rather than per-pad state.
    ...addresses.gridPads.map((address, i) =>
      encodeLed(
        address,
        addresses.gridPadMapped
          ? (addresses.gridPadMapped[i] ?? false) && states.gridPads.some(Boolean)
          : (states.gridPads[i] ?? false)
      )
    ),
    encodeLed(addresses.quantize, states.quantize),
    ...(addresses.keyLock ? [encodeLed(addresses.keyLock, states.keyLock)] : []),
    // The Key Lock lamp probe (midi-performance-ops 07): written only when
    // the mapping carries the shifted-Q address; absent = probe failed and
    // Key Lock is screen-only.
    ...(addresses.keyLockShifted ? [encodeLed(addresses.keyLockShifted, states.keyLock)] : []),
    // LOOP-mode pads (midi-performance-ops 02), both pages: lit iff the
    // active loop's length equals the pad's preset — no loop or an
    // off-ladder length lights nothing. Unbound shifted pads aren't in
    // the mapping and are never written.
    ...[...addresses.loopPads, ...addresses.loopPadsShifted].map((pad) =>
      encodeLed(pad, states.loopBeats === pad.beats)
    ),
  ];
}

/**
 * The assistant lamp's state (midi-performance-ops 08): lit iff any Deck
 * follows — mirrors the FilterBar, whatever caused the change (button
 * macro, screen toggles, playback spread/revoke).
 */
export function assistantLedLit(
  follows: Readonly<Partial<Record<ChannelId, boolean>>>
): boolean {
  return CHANNEL_IDS.some((deck) => follows[deck] === true);
}

/**
 * Assistant lamp state → messages. Empty when the mapping has no learned
 * assistant address (TODO(hardware-verify) in the mapping file).
 */
export function encodeAssistantLed(
  feedback: MappingFeedback,
  lit: boolean
): readonly MidiMessage[] {
  return feedback.assistant ? [encodeLed(feedback.assistant, lit)] : [];
}

const CONTROL_CHANGE = 0xb;

/**
 * A channel level meter's normalized position [0, 1] → its CC message.
 * Ordinary VU is capped below the device's red range; `peak` explicitly
 * enters red. This is the same split Mixxx's Pioneer mappings use between
 * `vu_meter` (scaled to 0x75) and `peak_indicator` (0x77).
 */
export function encodeMeter(
  address: MeterAddress,
  normalized: number,
  peak = false
): MidiMessage {
  const span = address.levelMaxValue - address.minValue;
  const value = peak
    ? address.peakValue
    : address.minValue + encodeMeterValue(normalized, span);
  return [(CONTROL_CHANGE << 4) | address.channel, address.number, value];
}

/**
 * A meter's dark (silent) message — its minValue. Sent on resync-to-silent
 * and in all-off so a detached/disposed device shows no residual level.
 */
export function meterOffMessage(address: MeterAddress): MidiMessage {
  return [(CONTROL_CHANGE << 4) | address.channel, address.number, address.minValue];
}

/**
 * Every mapped light dark AND every meter cleared — sent on detach and
 * dispose so stale state never lingers on the hardware.
 */
export function allOffMessages(feedback: MappingFeedback): readonly MidiMessage[] {
  return [
    ...CHANNEL_IDS.flatMap((deck) => {
      const addresses = feedback.decks[deck];
      return addresses ? deckAddresses(addresses).map((address) => encodeLed(address, false)) : [];
    }),
    ...encodeAssistantLed(feedback, false),
    ...CHANNEL_IDS.flatMap((channel) => {
      const meter = feedback.meters?.[channel];
      return meter ? [meterOffMessage(meter)] : [];
    }),
  ];
}
