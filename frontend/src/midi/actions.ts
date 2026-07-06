import type { ChannelId } from '../playback/mixer';

/**
 * The closed action vocabulary a Mapping binds hardware controls to (PRD:
 * midi-controller). A Controller adds no new capabilities — every target
 * here corresponds to an existing on-screen or keyboard action. Targets are
 * grouped by control shape:
 *
 * - Button targets fire down/up edges (the translator derives edges from
 *   note on/off).
 * - Absolute targets carry a normalized 0..1 position (7- or 14-bit on the
 *   wire; later slice).
 * - Relative targets carry signed ticks (encoders/jogs; later slice).
 *
 * This slice implements handlers only for `transport` and `cue`; the rest
 * of the vocabulary exists so later slices and mapping files add bindings
 * without reshaping these types.
 */

export type EqBand = 'low' | 'mid' | 'high';

export type ButtonTarget =
  | { control: 'transport'; deck: ChannelId }
  | { control: 'cue'; deck: ChannelId }
  | { control: 'hot-cue'; deck: ChannelId; pad: number }
  | { control: 'hot-cue-clear'; deck: ChannelId; pad: number }
  | { control: 'beatjump'; deck: ChannelId; direction: 'back' | 'forward' }
  | { control: 'beatjump-size'; deck: ChannelId; change: 'halve' | 'double' }
  /** Auto-loop engage/release (looping 03) — loops gesture class; no
   * hardware binding yet (loop-section mapping is follow-up MIDI work). */
  | { control: 'loop-toggle'; deck: ChannelId }
  | { control: 'match'; deck: ChannelId }
  | { control: 'load'; deck: ChannelId }
  /** PFL toggle (headphone-cue 02) — mixer-facing, hence `channel`. */
  | { control: 'pfl'; channel: ChannelId }
  /** LOOP pad mode (midi-performance-ops 02) — loops gesture class. The
   * target carries the pad's preset size in beats: no loop → engage at
   * the playhead; same size → release; different size → resize in place. */
  | { control: 'loop-preset'; deck: ChannelId; beats: number }
  /** SHIFT+IN/OUT (midi-performance-ops 03): state-disambiguated overload.
   * While the deck has an active loop it resizes the loop (loops gesture
   * class); idle it changes the beatjump size, exactly like the dedicated
   * `beatjump-size` target (which stays in the vocabulary for devices
   * without the overload). */
  | { control: 'loop-or-jump-size'; deck: ChannelId; change: 'halve' | 'double' };

export type AbsoluteTarget =
  | { control: 'pitch'; deck: ChannelId }
  | { control: 'trim'; channel: ChannelId }
  | { control: 'eq'; channel: ChannelId; band: EqBand }
  | { control: 'filter'; channel: ChannelId }
  | { control: 'channel-fader'; channel: ChannelId }
  | { control: 'crossfader' }
  | { control: 'master' }
  /** Cue bus volume — the hardware headphone-level knob (headphone-cue 03). */
  | { control: 'cue-level' }
  /** Cue/mix blend. No control on this device; bindable for others. */
  | { control: 'cue-mix' };

export type RelativeTarget =
  | { control: 'jog'; deck: ChannelId }
  /** The jog's touch surface: a denser tick stream for fine paused seeks. */
  | { control: 'jog-touch'; deck: ChannelId }
  /** The jog's SHIFT layer: deliberate velocity-accelerated fast seek. */
  | { control: 'jog-seek'; deck: ChannelId }
  | { control: 'selection-move' };

/** A domain action emitted by the translator, dispatched by thin glue. */
export type MidiAction =
  | { kind: 'button'; target: ButtonTarget; edge: 'down' | 'up' }
  | { kind: 'absolute'; target: AbsoluteTarget; value: number }
  | { kind: 'relative'; target: RelativeTarget; ticks: number };
