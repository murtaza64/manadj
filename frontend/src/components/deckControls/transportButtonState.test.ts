import { describe, expect, it } from 'vitest';
import { cueButtonState, playButtonState } from './transportButtonState';

describe('static screen transport state', () => {
  it('PLAY has only static paused and playing states', () => {
    expect(playButtonState(false, false)).toBe('paused');
    expect(playButtonState(true, false)).toBe('playing');
    expect(playButtonState(false, true)).toBe('playing');
  });

  it('CUE distinguishes idle, return-available, and held preview without a flash state', () => {
    expect(cueButtonState({ previewing: false, playing: false, loaded: true, hasCuePoint: false, atCuePoint: false })).toBe('idle');
    expect(cueButtonState({ previewing: false, playing: false, loaded: true, hasCuePoint: true, atCuePoint: false })).toBe('idle');
    expect(cueButtonState({ previewing: false, playing: false, loaded: true, hasCuePoint: true, atCuePoint: true })).toBe('available');
    expect(cueButtonState({ previewing: false, playing: true, loaded: true, hasCuePoint: true, atCuePoint: false })).toBe('available');
    expect(cueButtonState({ previewing: true, playing: false, loaded: true, hasCuePoint: true, atCuePoint: true })).toBe('held');
  });
});
