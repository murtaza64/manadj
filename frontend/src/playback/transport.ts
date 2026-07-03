/**
 * Pure transport/cue state machine for a Deck.
 *
 * No Web Audio, no DOM, no timers. The engine feeds events in (with the
 * playhead freshly synced from its clock) and interprets the returned
 * AudioEffects against the audio graph. Keeping this pure is the designated
 * testing seam if the Practice-view spike graduates (see PRD / ADR 0007).
 *
 * Semantics mirror the library player's cue behaviors
 * (frontend/src/contexts/AudioContext.tsx), reimplemented here per the
 * parallel-stack decision.
 */

export interface TransportState {
  /** Deck play state ("the deck is running"), distinct from audio audibly playing. */
  playing: boolean;
  /** Main-cue hold-to-preview in progress. */
  previewing: boolean;
  /** Hot cue slot currently held in preview, or null. */
  hotCuePreviewSlot: number | null;
  /** Main cue point in seconds, or null if unset. */
  cuePoint: number | null;
  /** Playhead in seconds. Authoritative while audio is stopped; the engine
   * syncs it from its clock before dispatching events. */
  playhead: number;
}

export type TransportEvent =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'toggle-play' }
  | { type: 'seek'; time: number }
  | { type: 'cue-down' }
  | { type: 'cue-up' }
  | { type: 'hot-cue-down'; slot: number; time: number | null }
  | { type: 'hot-cue-up'; slot: number; time: number | null }
  /** Audio reached the end of the buffer on its own. */
  | { type: 'ended' };

export type AudioEffect =
  /** (Re)start audio from `at` seconds. Restart-while-running implies a declicked stop+start. */
  | { type: 'start'; at: number }
  /** Stop audio; playhead rests at `at` seconds. Idempotent if audio already stopped. */
  | { type: 'stop'; at: number };

/** Tolerance for "playhead is at the cue point" (matches library player). */
const AT_CUE_EPSILON = 0.01;

export function initialTransportState(): TransportState {
  return {
    playing: false,
    previewing: false,
    hotCuePreviewSlot: null,
    cuePoint: null,
    playhead: 0,
  };
}

/** Audio should be audible iff any of these hold. */
export function isAudioRunning(s: TransportState): boolean {
  return s.playing || s.previewing || s.hotCuePreviewSlot !== null;
}

export function reduceTransport(
  s: TransportState,
  e: TransportEvent
): [TransportState, AudioEffect[]] {
  switch (e.type) {
    case 'play': {
      if (s.playing) return [s, []];
      const next = { ...s, playing: true };
      // If a preview already has audio running, the deck simply takes over
      // seamlessly; otherwise start from the playhead.
      return [next, isAudioRunning(s) ? [] : [{ type: 'start', at: s.playhead }]];
    }

    case 'pause': {
      if (!isAudioRunning(s) && !s.playing) return [s, []];
      return [
        { ...s, playing: false, previewing: false, hotCuePreviewSlot: null },
        [{ type: 'stop', at: s.playhead }],
      ];
    }

    case 'toggle-play':
      return reduceTransport(s, { type: s.playing ? 'pause' : 'play' });

    case 'seek': {
      const next = { ...s, playhead: e.time };
      return [next, isAudioRunning(s) ? [{ type: 'start', at: e.time }] : []];
    }

    case 'cue-down': {
      if (s.playing) {
        // Return to cue and pause the deck.
        if (s.cuePoint === null) return [s, []];
        return [
          {
            ...s,
            playing: false,
            previewing: false,
            hotCuePreviewSlot: null,
            playhead: s.cuePoint,
          },
          [{ type: 'stop', at: s.cuePoint }],
        ];
      }
      if (s.cuePoint !== null && Math.abs(s.playhead - s.cuePoint) < AT_CUE_EPSILON) {
        // Hold-to-preview from the cue point.
        return [{ ...s, previewing: true }, [{ type: 'start', at: s.cuePoint }]];
      }
      // Set the cue point at the current position.
      return [{ ...s, cuePoint: s.playhead }, []];
    }

    case 'cue-up': {
      if (!s.previewing) return [s, []];
      if (s.playing) {
        // Play was pressed during the preview: deck keeps running.
        return [{ ...s, previewing: false }, []];
      }
      const at = s.cuePoint ?? s.playhead;
      return [
        { ...s, previewing: false, playhead: at },
        [{ type: 'stop', at }],
      ];
    }

    case 'hot-cue-down': {
      if (e.time === null) return [s, []];
      if (s.playing) {
        // Jump and keep playing.
        return [{ ...s, playhead: e.time }, [{ type: 'start', at: e.time }]];
      }
      // Hold-to-preview from the hot cue.
      return [
        { ...s, hotCuePreviewSlot: e.slot, playhead: e.time },
        [{ type: 'start', at: e.time }],
      ];
    }

    case 'hot-cue-up': {
      if (e.time === null || s.hotCuePreviewSlot !== e.slot) return [s, []];
      if (s.playing) {
        // Play was pressed during the preview: deck keeps running.
        return [{ ...s, hotCuePreviewSlot: null }, []];
      }
      return [
        { ...s, hotCuePreviewSlot: null, playhead: e.time },
        [{ type: 'stop', at: e.time }],
      ];
    }

    case 'ended': {
      // Audio ran off the end of the buffer.
      if (s.previewing && s.cuePoint !== null) {
        return [
          { ...s, playing: false, previewing: false, hotCuePreviewSlot: null, playhead: s.cuePoint },
          [{ type: 'stop', at: s.cuePoint }],
        ];
      }
      return [
        { ...s, playing: false, previewing: false, hotCuePreviewSlot: null },
        [{ type: 'stop', at: s.playhead }],
      ];
    }
  }
}
