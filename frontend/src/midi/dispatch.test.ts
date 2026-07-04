/**
 * MIDI dispatch routes through the audible surface (midi-controller 07 /
 * ADR 0013) — never to decks directly, and gestures without a handler on
 * the audible surface are dropped (the editor registers no cue handlers).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetAudibleSurfacesForTests,
  claimAudible,
  registerSurface,
} from '../playback/audibleSurface';
import type { ChannelId } from '../playback/mixer';
import type { MidiAction } from './actions';
import { dispatchMidiAction } from './dispatch';

const button = (
  control: 'transport' | 'cue',
  deck: ChannelId,
  edge: 'down' | 'up'
): MidiAction => ({ kind: 'button', edge, target: { control, deck } });

let calls: string[];

beforeEach(() => {
  calls = [];
  registerSurface('shared', {
    transport: {
      togglePlay: (d) => calls.push(`shared:toggle:${d}`),
      cueDown: (d) => calls.push(`shared:cueDown:${d}`),
      cueUp: (d) => calls.push(`shared:cueUp:${d}`),
    },
    silence: () => undefined,
    wake: () => undefined,
  });
  registerSurface('editor', {
    // No cue handlers: CUE drops in the editor, like keyboard F.
    transport: { togglePlay: () => calls.push('editor:toggle') },
    silence: () => undefined,
    wake: () => undefined,
  });
});

afterEach(() => _resetAudibleSurfacesForTests());

describe('routing', () => {
  it('shared surface: transport and cue reach the shared handlers per deck', () => {
    dispatchMidiAction(button('transport', 'A', 'down'));
    dispatchMidiAction(button('cue', 'B', 'down'));
    dispatchMidiAction(button('cue', 'B', 'up'));
    expect(calls).toEqual(['shared:toggle:A', 'shared:cueDown:B', 'shared:cueUp:B']);
  });

  it('transport ignores the up edge', () => {
    dispatchMidiAction(button('transport', 'A', 'up'));
    expect(calls).toEqual([]);
  });

  it('editor claimed: PLAY (either deck) routes to the mix transport', () => {
    claimAudible('editor');
    dispatchMidiAction(button('transport', 'A', 'down'));
    dispatchMidiAction(button('transport', 'B', 'down'));
    expect(calls).toEqual(['editor:toggle', 'editor:toggle']);
  });

  it('editor claimed: CUE is dropped (no handler)', () => {
    claimAudible('editor');
    dispatchMidiAction(button('cue', 'A', 'down'));
    dispatchMidiAction(button('cue', 'A', 'up'));
    expect(calls).toEqual([]);
  });

  it('no registered holder: actions drop silently (boot-order edge)', () => {
    _resetAudibleSurfacesForTests();
    dispatchMidiAction(button('transport', 'A', 'down'));
    expect(calls).toEqual([]);
  });
});
