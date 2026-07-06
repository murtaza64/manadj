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
   * LOOP pad mode, base page (midi-performance-ops 02): each pad's light
   * plus the preset size it stands for — lit iff the active loop's length
   * equals `beats`, so off-ladder lengths (and no loop) show all dark.
   */
  loopPads: readonly LoopPadLamp[];
  /**
   * LOOP pad mode, shifted page. Only the BOUND pads appear (the Inpulse
   * binds 1..4); unbound pads are never written and stay dark.
   */
  loopPadsShifted: readonly LoopPadLamp[];
}

/** A LOOP-mode pad light: its address plus the preset size it represents. */
export type LoopPadLamp = LedAddress & { beats: number };

/** Device knowledge for Feedback: every light the app writes, per deck. */
export interface MappingFeedback {
  decks: Record<'A' | 'B', DeckFeedback>;
}

export interface Mapping {
  /** Case-sensitive substring matched against the MIDI input port's name. */
  portNameMatch: string;
  bindings: readonly Binding[];
  /** LED Feedback addresses; absent = no (mapped) lights on the device. */
  feedback?: MappingFeedback;
}
