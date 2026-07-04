import type { AbsoluteTarget, ButtonTarget, RelativeTarget } from './actions';

/**
 * Mapping schema (glossary: Mapping): the device-specific translation from
 * a Controller's physical controls to manadj actions. One typed module per
 * device model declares a port-name match and a list of bindings; controls
 * with no manadj counterpart are simply absent and do nothing.
 *
 * The schema already names every control type from the PRD (button /
 * absolute incl. 14-bit / relative, plus named modifiers) so later slices
 * add decoders without reshaping mapping files. This slice's translator
 * implements buttons only.
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
  /**
   * Active only while this named modifier (e.g. 'shift') is held. Whether
   * the Inpulse's SHIFT changes emitted messages in hardware or must be
   * tracked in software is decided in a later slice — until modifiers are
   * implemented, modifier-gated bindings never fire.
   */
  modifier?: string;
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
      }
    | { controlType: 'relative'; target: RelativeTarget }
  );

export interface Mapping {
  /** Case-sensitive substring matched against the MIDI input port's name. */
  portNameMatch: string;
  bindings: readonly Binding[];
}
