/**
 * Capture event vocabulary (transition-takes 02, ADR 0020).
 *
 * ONE format shared by the live tap (recorder) and the Handover detector —
 * synthetic streams in tests are the same shape as real capture, so the
 * detector's tests exercise the real seam. Events are timestamped on a
 * monotonic seconds clock (performance.now()/1000 in the recorder; the
 * audio clock is unusable — it freezes while the surface is displaced).
 *
 * The raw slice stored on a Take is a window of these events: the
 * evidence, not the verdict. Vectorization (issue 03) re-derives from it,
 * so the format errs toward completeness — controls, transport, pitch,
 * loads, and coarse periodic playhead samples.
 */

export type CaptureChannel = 'A' | 'B';

/** Mixer control ids. Channel-scoped except crossfader/-Enabled/master. */
export type CaptureControlId =
  | 'trim'
  | 'eqLow'
  | 'eqMid'
  | 'eqHigh'
  | 'filter'
  | 'fader'
  | 'pfl'
  | 'crossfader'
  | 'crossfaderEnabled'
  | 'master';

export type CaptureEvent =
  | {
      t: number;
      kind: 'control';
      control: CaptureControlId;
      /** null for the channel-less controls (crossfader, master, …). */
      channel: CaptureChannel | null;
      /** Control-native value (pfl/crossfaderEnabled encode booleans 0/1). */
      value: number;
    }
  | {
      t: number;
      kind: 'transport';
      channel: CaptureChannel;
      action: 'play' | 'pause' | 'seek' | 'jumpBeats' | 'hotCue' | 'cue';
      /** Deck track-time after the action (s). */
      playhead: number;
      /** Action-specific: beats for jumpBeats, slot for hotCue. */
      detail?: number;
    }
  | { t: number; kind: 'pitch' | 'bend'; channel: CaptureChannel; value: number }
  | { t: number; kind: 'load'; channel: CaptureChannel; trackId: number | null; bpm: number | null }
  /** Coarse periodic sample (~1 Hz): keeps alignment reconstructible and
   * drives time-based settlement in the detector. */
  | { t: number; kind: 'tick'; playheads: Partial<Record<CaptureChannel, number>> };

// ── Detection parameters (versioned — stamped on every Take) ────────────

/** Bump whenever detection semantics or defaults change: old Takes stay
 * attributable to the detector that produced them (issue 05 tuning). */
export const DETECTOR_VERSION = 1;

export interface DetectorParams {
  /** Master-bus gain (trim × channel fader × crossfader) below which a
   * playing deck counts as silent. */
  audibleGain: number;
  /** All three EQ bands at or below this = an EQ full-kill (silent). */
  eqKillBelow: number;
  /** |sweep filter| at or beyond this = filtered to silence. */
  filterKillBeyond: number;
  /** "Shortly after" (glossary Handover): max silence between the
   * outgoing's cessation and the incoming's onset for a hard cut. */
  cutGapMaxS: number;
  /** Settle horizon: the outgoing must stay silent this long before the
   * Handover completes; returns within it fold (cross-cuts). */
  settleHorizonS: number;
  /** Raw-slice padding either side of the Take window. */
  padS: number;
  /** Rolling-log retention while no engagement is open. */
  idleKeepS: number;
}

export const DEFAULT_DETECTOR_PARAMS: DetectorParams = {
  audibleGain: 0.05,
  eqKillBelow: 0.05,
  filterKillBeyond: 0.97,
  cutGapMaxS: 2,
  settleHorizonS: 8,
  padS: 2,
  idleKeepS: 30,
};

// ── Detected Takes ───────────────────────────────────────────────────────

/** A settled Handover, ready to persist. Times are on the capture clock;
 * the window is the engagement (glossary), the events its padded slice. */
export interface DetectedTake {
  outgoingTrackId: number;
  incomingTrackId: number;
  windowStartS: number;
  windowEndS: number;
  /** Crude v1 tiers: 0.9 blend / 0.7 hard cut / 0.5 mix ended mid-blend. */
  confidence: number;
  detectorVersion: number;
  params: DetectorParams;
  events: CaptureEvent[];
}
