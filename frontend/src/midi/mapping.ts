import type { AbsoluteTarget, ButtonTarget, RelativeTarget } from './actions';

/**
 * Mapping schema (glossary: Mapping): the device-specific translation from
 * a Controller's physical controls to manadj actions. One typed module per
 * device model declares a port-name match and a list of bindings; controls
 * with no manadj counterpart are simply absent and do nothing.
 *
 * The schema names every control type from the PRD (button / absolute incl.
 * 14-bit / relative). No modifier layer: the Inpulse's SHIFT turned out to
 * be hardware-layered (shifted controls emit distinct messages), so shifted
 * functions are just more bindings.
 */

export interface MessageMatcher {
  /** 'note' matches both note-on and note-off statuses. */
  message: 'note' | 'cc';
  /** MIDI channel, 0-based (the status byte's low nibble). */
  channel: number;
  /** Note number or CC number (the first data byte). */
  number: number;
}

interface BindingBase {
  match: MessageMatcher;
}

export type Binding = BindingBase &
  (
    | { controlType: 'button'; target: ButtonTarget }
    | {
        controlType: 'absolute';
        target: AbsoluteTarget;
        bits: 7 | 14;
        /** For 14-bit values: the CC number carrying the LSB (MSB is `match.number`). */
        lsbNumber?: number;
        /** Hardware runs opposite the app's direction — the translator emits
         * 1 − value. DJ pitch faders are the canonical case (fader down =
         * faster, but the raw CC grows upward). */
        invert?: boolean;
      }
    | { controlType: 'relative'; target: RelativeTarget }
  );

/**
 * One light's address (glossary: Feedback). Lights on this class of device
 * are set by note-on: status 0x9<channel>, note `number`, velocity =
 * `onVelocity` for lit / 0x00 for dark.
 */
export interface LedAddress {
  /** MIDI channel, 0-based (the note-on status byte's low nibble). */
  channel: number;
  /** Note number (the first data byte). */
  number: number;
  /** Velocity meaning "lit" (device-specific; boolean lights). */
  onVelocity: number;
}

/** The LED addresses Feedback drives for one deck. */
export interface DeckFeedback {
  play: LedAddress;
  cue: LedAddress;
  /** The channel's PFL button light (headphone-cue 05). */
  pfl: LedAddress;
  /**
   * Pads 1..8 by index, HOTCUE base-layer addresses ONLY — pad modes are
   * note-isolated on this class of device; other modes' lights are never
   * written.
   */
  hotCuePads: readonly LedAddress[];
  /**
   * Pads 1..8 by index, HOTCUE SHIFT-layer addresses (SHIFT is
   * hardware-layered: the shifted pads are separate lights). Feedback
   * mirrors the same assigned/empty state onto them, so pads stay lit
   * while SHIFT is held (e.g. showing which slots SHIFT+pad can clear).
   */
  hotCuePadsShifted: readonly LedAddress[];
  /**
   * The deck's Q button light (midi-performance-ops 07) — mirrors the ONE
   * app-wide Quantize state: both decks' Q lamps and the TopBar toggle
   * always agree.
   */
  quantize: LedAddress;
  /**
   * The SHIFT-layer Q address (channel+3, same note) — a PROBE
   * (midi-performance-ops 07): if the hardware drives a lamp there, it
   * shows the Deck's KEY LOCK while SHIFT is held; if not, the writes are
   * inert, Key Lock stays screen-only, and the base Q lamp remains
   * quantize-only (one lamp never tells two truths). Optional so a failed
   * probe is recorded by deleting the address.
   */
  keyLockShifted?: LedAddress;
}

/** Device knowledge for Feedback: every light the app writes, per deck. */
export interface MappingFeedback {
  decks: Record<'A' | 'B', DeckFeedback>;
  /**
   * The assistant button's light (midi-performance-ops 08) — lit iff any
   * Deck follows (mirrors the FilterBar). One button, so it lives beside
   * the decks. Optional: absent until the address is hardware-learned.
   */
  assistant?: LedAddress;
}

export interface Mapping {
  /** Case-sensitive substring matched against the MIDI input port's name. */
  portNameMatch: string;
  bindings: readonly Binding[];
  /** LED Feedback addresses; absent = no (mapped) lights on the device. */
  feedback?: MappingFeedback;
}
