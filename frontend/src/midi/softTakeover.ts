/**
 * Soft takeover (pickup) for absolute hardware controls (midi-controller 15).
 *
 * Jump semantics stay right for the mixer-class controls: the hardware
 * position is the authority there and the on-screen controls repaint to
 * follow it (midi-controller 09). Pitch is the exception — software pitch
 * moves without the fader (MATCH, a deck reload resetting to 0, the
 * Conductor's tempo-match), so a touch of a mismatched hardware fader
 * would jump the tempo audibly, mid-beatmatch. Pickup semantics: ignore
 * hardware movement until the fader reaches or crosses the current
 * software value, then latch and track normally.
 *
 * Pure per-control state machine (the tested seam); dispatch owns one
 * instance per pitch fader. Values are compared in the CONTROL'S OWN
 * domain (pitch: percent), so the tolerance reads in real units.
 */

/**
 * Pickup tolerance for pitch, in percent. Half a 7-bit fader step over the
 * ±8% range is ~0.06%; 0.1% catches an exact-match latch on any fader
 * resolution while staying inaudible as a "close enough" snap. Crossing
 * detection covers everything coarser.
 */
export const PITCH_PICKUP_TOLERANCE = 0.1;

export class SoftTakeover {
  private latched = false;
  private lastHardware: number | null = null;
  private lastApplied: number | null = null;
  private readonly tolerance: number;

  constructor(tolerance: number) {
    this.tolerance = tolerance;
  }

  /**
   * Fold one hardware sample against the current software value. Returns
   * true when the sample should apply (latched), false while waiting for
   * pickup.
   *
   * Latching: the hardware matches the software value within tolerance,
   * or crossed it since the previous sample (either direction).
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
      const matched = Math.abs(hardware - software) <= this.tolerance;
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
