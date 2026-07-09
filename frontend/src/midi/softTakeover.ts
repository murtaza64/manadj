/**
 * Soft takeover (pickup) for absolute hardware controls (midi-controller
 * 15, extended to every absolute target in 17).
 *
 * Software values move without the hardware (MATCH, deck reload, app
 * reload with faders parked anywhere, on-screen mouse moves), so a touch
 * of a mismatched hardware fader/knob would jump the parameter. Pickup
 * semantics: ignore hardware movement until the control reaches or
 * crosses the current software value, then latch and track normally.
 *
 * Pure per-control state machine (the tested seam); dispatch owns one
 * instance per physical control. Values are compared in the CONTROL'S OWN
 * domain (pitch: percent; mixer: the Mixer's 0..1 / -1..1 conventions),
 * so each tolerance reads in real units. Takeover always compares against
 * BASE state — never the automation overlay's values (ADR 0022).
 */

/**
 * Pickup tolerance for pitch, in percent. Half a 7-bit fader step over the
 * ±8% range is ~0.06%; 0.1% catches an exact-match latch on any fader
 * resolution while staying inaudible as a "close enough" snap. Crossing
 * detection covers everything coarser.
 */
export const PITCH_PICKUP_TOLERANCE = 0.1;

/** Pickup tolerance for unipolar (0..1) targets — about one 7-bit step
 * (1/127), so an exact-match latch is reachable on any knob resolution. */
export const UNIPOLAR_PICKUP_TOLERANCE = 0.01;

/** Pickup tolerance for bipolar (-1..1) targets — the unipolar step scaled
 * to the doubled range. */
export const BIPOLAR_PICKUP_TOLERANCE = 0.02;

/**
 * First-touch grace, as a multiple of the control's tolerance. MIDI is
 * silent until a control MOVES: a knob resting exactly at the software
 * value (the fresh-start case — hardware neutral, software at defaults)
 * only reports once the hand is already past it, so its first sample
 * would miss the tight tolerance and demand a wiggle back through the
 * value. A control's first-ever sample therefore latches within a wider
 * window. Strictly first-sample: after an external-change unlatch the
 * hardware is genuinely elsewhere, and the tight tolerance is the point.
 */
export const FIRST_TOUCH_GRACE_FACTOR = 5;

export class SoftTakeover {
  private latched = false;
  private lastHardware: number | null = null;
  private lastApplied: number | null = null;
  private readonly tolerance: number;
  private readonly firstTouchGrace: number;

  constructor(tolerance: number, firstTouchGrace: number = tolerance * FIRST_TOUCH_GRACE_FACTOR) {
    this.tolerance = tolerance;
    this.firstTouchGrace = firstTouchGrace;
  }

  /**
   * Fold one hardware sample against the current software value. Returns
   * true when the sample should apply (latched), false while waiting for
   * pickup.
   *
   * Latching: the hardware matches the software value within tolerance
   * (widened to the first-touch grace on the control's first-ever
   * sample), or crossed it since the previous sample (either direction).
   * Unlatching: the software value moved away from the last value this
   * control applied — an external change (MATCH, reload, Conductor) —
   * so the next mismatched hardware move cannot jump.
   */
  feed(hardware: number, software: number): boolean {
    if (
      this.latched &&
      this.lastApplied !== null &&
      Math.abs(software - this.lastApplied) > this.tolerance
    ) {
      this.latched = false;
    }
    const previous = this.lastHardware;
    this.lastHardware = hardware;
    if (!this.latched) {
      const window = previous === null ? this.firstTouchGrace : this.tolerance;
      const matched = Math.abs(hardware - software) <= window;
      const crossed =
        previous !== null &&
        ((previous < software && hardware > software) ||
          (previous > software && hardware < software));
      if (!matched && !crossed) return false;
      this.latched = true;
    }
    this.lastApplied = hardware;
    return true;
  }
}
