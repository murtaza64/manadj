import type { RepeatSettings, RepeatState } from './beatFxRepeatKernel';

export const BEAT_FX_REPEAT_PROCESSOR = 'beat-fx-repeat-processor';

/** Times are AudioContext seconds; the processor converts to frames. */
export type BeatFxRepeatCommand =
  | { type: 'state'; state: RepeatState; time: number }
  | { type: 'clock'; time: number; beat: number | null; beatSeconds: number }
  | { type: 'settings'; settings: RepeatSettings };
