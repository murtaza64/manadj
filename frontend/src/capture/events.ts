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

/**
 * The pair-machine channel: the phase-1 Handover detector and everything
 * downstream of a Take (its `init` snapshot, vectorization, the drafted
 * Transition) are an ordered A/B pair. A Take slice only ever contains A/B
 * events (ADR 0032 phase-1).
 */
export type CaptureChannel = 'A' | 'B';

/**
 * A physical deck in the log (Sessions PRD, ADR 0033). The Session records
 * ALL FOUR decks unconditionally — the log is whole, so a detector that
 * doesn't yet exist (phase-2 multi-deck, Cameo) can re-analyze old
 * Sessions. The A/B pair machine ignores C/D for its verdicts but counts
 * them for the >2-audible self-gate.
 */
export type CaptureDeck = 'A' | 'B' | 'C' | 'D';

/** Mixer control ids. Channel-scoped except crossfader/-Enabled/master.
 * `crossfaderAssignment` encodes a deck's crossfader side so the log alone
 * reconstructs audibility for all four decks (left=-1, thru=0, right=1). */
export type CaptureControlId =
  | 'trim'
  | 'eqLow'
  | 'eqMid'
  | 'eqHigh'
  | 'filter'
  | 'fader'
  | 'pfl'
  | 'crossfaderAssignment'
  | 'crossfader'
  | 'crossfaderEnabled'
  | 'master';

export type CaptureEvent =
  | {
      t: number;
      kind: 'control';
      control: CaptureControlId;
      /** null for the channel-less controls (crossfader, master, …). */
      channel: CaptureDeck | null;
      /** Control-native value (pfl/crossfaderEnabled encode booleans 0/1;
       * crossfaderAssignment encodes left=-1/thru=0/right=1). */
      value: number;
    }
  | {
      t: number;
      kind: 'transport';
      channel: CaptureDeck;
      /** `previewStart`/`previewEnd` bracket a stab (hold-to-preview from
       * the main cue — sessions 10 — or a hot cue — sessions 11):
       * Master-audible when the fader is up, but a preview flag flips, not
       * `playing` (ADR 0033). The log records the stab so the timeline can
       * render it and replay can reproduce it; the phase-1 pair detector
       * ignores both edges — preview audibility is inert to detection v1
       * (deliberate; a follow-up grill revisits it). A hot-cue stab ALSO
       * logs its launch `hotCue` gesture (handler tap, after the start
       * edge). */
      action: 'play' | 'pause' | 'seek' | 'jumpBeats' | 'hotCue' | 'cue' | 'previewStart' | 'previewEnd';
      /** Deck track-time after the action (s). */
      playhead: number;
      /** Action-specific: beats for jumpBeats, slot for hotCue, slot for a
       * hot-cue stab's previewStart (absent on a main-cue stab). */
      detail?: number;
    }
  | { t: number; kind: 'pitch' | 'bend'; channel: CaptureDeck; value: number }
  /** Active-loop state change (looping 06): engage/resize carry the new
   * region, release/cancel/Load-clear carry null. Evidence for collapsing
   * a held loop into one repeated Jump event at vectorization. */
  | {
      t: number;
      kind: 'loop';
      channel: CaptureDeck;
      /** Deck playhead at the change (s). */
      playhead: number;
      /** The region after the change (track seconds), or null. */
      region: { start: number; end: number } | null;
    }
  | { t: number; kind: 'load'; channel: CaptureDeck; trackId: number | null; bpm: number | null }
  /** Coarse periodic sample (~1 Hz): keeps alignment reconstructible and
   * drives time-based settlement in the detector. */
  | { t: number; kind: 'tick'; playheads: Partial<Record<CaptureDeck, number>> }
  /** Audible-surface tenure marker (Sessions PRD, ADR 0033): a machine
   * (Transition-editor audition, Conductor, Session replay) held the shared
   * surface. `start` opens the hold, its end closes it — the log records
   * THAT the surface was held, never what the machine played. The pair
   * detector treats a tenure hold exactly as the old surface gate did. */
  | { t: number; kind: 'tenure'; edge: 'start' | 'end'; holder: string }
  /** Synthetic slice head (never in the live stream): the detector stamps
   * the engagement-open state into every Take slice, so vectorization
   * (issue 03) starts from known controls instead of assumed defaults —
   * and knows which physical deck was the outgoing one. Always the A/B
   * pair — a Take is a pair artifact (ADR 0032 phase-1). */
  | {
      t: number;
      kind: 'init';
      outgoingChannel: CaptureChannel;
      decks: Record<CaptureChannel, InitDeckState>;
      crossfader: number;
      crossfaderEnabled: boolean;
    };

/** One deck's state at engagement open (init event). */
export interface InitDeckState {
  trackId: number | null;
  playing: boolean;
  fader: number;
  trim: number;
  eq: { low: number; mid: number; high: number };
  filter: number;
  pitch: number;
}

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
