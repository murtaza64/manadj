/**
 * MIDI dispatch routing (ADR 0013): transport-class gestures go through the
 * audible surface (gestures without a handler there are dropped — the editor
 * registers no cue handlers); pad-class gestures go to the registered deck
 * controls and drop silently when nothing is registered.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetAudibleSurfacesForTests,
  claimAudible,
  registerSurface,
} from '../playback/audibleSurface';
import type { ChannelId } from '../playback/mixer';
import type { MidiAction } from './actions';
import { _resetMidiControlsForTests, registerDeckControls } from './controlRegistry';
import { dispatchMidiAction } from './dispatch';

const button = (
  control: 'transport' | 'cue',
  deck: ChannelId,
  edge: 'down' | 'up'
): MidiAction => ({ kind: 'button', edge, target: { control, deck } });

let calls: string[];

function registerFakeDeckControls(deck: ChannelId): void {
  registerDeckControls(deck, {
    hotCueDown: (pad) => calls.push(`${deck}:hotCueDown:${pad}`),
    hotCueUp: (pad) => calls.push(`${deck}:hotCueUp:${pad}`),
    beatjump: (direction) => calls.push(`${deck}:beatjump:${direction}`),
    beatjumpSize: (change) => calls.push(`${deck}:beatjumpSize:${change}`),
  });
}

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

afterEach(() => {
  _resetAudibleSurfacesForTests();
  _resetMidiControlsForTests();
});

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

describe('pads (midi-controller 02)', () => {
  const hotCue = (deck: ChannelId, pad: number, edge: 'down' | 'up'): MidiAction => ({
    kind: 'button',
    edge,
    target: { control: 'hot-cue', deck, pad },
  });

  it('hot cue down/up route to the deck controls with the pad number', () => {
    registerFakeDeckControls('A');
    registerFakeDeckControls('B');
    dispatchMidiAction(hotCue('A', 1, 'down'));
    dispatchMidiAction(hotCue('A', 1, 'up'));
    dispatchMidiAction(hotCue('B', 8, 'down'));
    expect(calls).toEqual(['A:hotCueDown:1', 'A:hotCueUp:1', 'B:hotCueDown:8']);
  });

  it('beatjump fires on the down edge only', () => {
    registerFakeDeckControls('A');
    dispatchMidiAction({
      kind: 'button',
      edge: 'down',
      target: { control: 'beatjump', deck: 'A', direction: 'back' },
    });
    dispatchMidiAction({
      kind: 'button',
      edge: 'up',
      target: { control: 'beatjump', deck: 'A', direction: 'back' },
    });
    dispatchMidiAction({
      kind: 'button',
      edge: 'down',
      target: { control: 'beatjump', deck: 'A', direction: 'forward' },
    });
    expect(calls).toEqual(['A:beatjump:back', 'A:beatjump:forward']);
  });

  it('beatjump size halve/double fire on the down edge only', () => {
    registerFakeDeckControls('B');
    dispatchMidiAction({
      kind: 'button',
      edge: 'down',
      target: { control: 'beatjump-size', deck: 'B', change: 'halve' },
    });
    dispatchMidiAction({
      kind: 'button',
      edge: 'up',
      target: { control: 'beatjump-size', deck: 'B', change: 'double' },
    });
    expect(calls).toEqual(['B:beatjumpSize:halve']);
  });

  it('no registered deck controls: pad actions drop silently', () => {
    dispatchMidiAction(hotCue('A', 1, 'down'));
    dispatchMidiAction({
      kind: 'button',
      edge: 'down',
      target: { control: 'beatjump', deck: 'A', direction: 'back' },
    });
    expect(calls).toEqual([]);
  });

  it('deck controls only affect their own deck', () => {
    registerFakeDeckControls('A');
    dispatchMidiAction(hotCue('B', 1, 'down'));
    expect(calls).toEqual([]);
  });
});
