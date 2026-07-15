export type CueButtonState = 'idle' | 'available' | 'held';
export type PlayButtonState = 'paused' | 'playing';

export function cueButtonState(input: {
  previewing: boolean;
  playing: boolean;
  loaded: boolean;
  hasCuePoint: boolean;
  atCuePoint: boolean;
}): CueButtonState {
  if (input.previewing) return 'held';
  if (input.hasCuePoint && (input.playing || (input.loaded && input.atCuePoint))) {
    return 'available';
  }
  return 'idle';
}

export function playButtonState(playing: boolean, pendingPlay: boolean): PlayButtonState {
  return playing || pendingPlay ? 'playing' : 'paused';
}
