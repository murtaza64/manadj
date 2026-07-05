/**
 * MIDI dispatch routing (ADR 0013, gesture classes per ADR 0019):
 * transport-class gestures AND the promoted gesture classes (pads) go
 * through the audible surface — a class the holder didn't register drops,
 * like CUE on the editor. The shared surface's sections delegate to the
 * registered deck controls; everything else (mixer/pitch/PFL/beatjump-size)
 * stays registry-direct and drops silently when nothing is registered.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetAudibleSurfacesForTests,
  claimAudible,
  registerSurface,
  releaseAudible,
} from '../playback/audibleSurface';
import type { ChannelId } from '../playback/mixer';
import type { MidiAction } from './actions';
import type { Track } from '../types';
import {
  _resetMidiControlsForTests,
  deckControlsFor,
  registerBrowseSurface,
  registerDeckControls,
  registerMixerControls,
} from './controlRegistry';
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
    hotCueClear: (pad) => calls.push(`${deck}:hotCueClear:${pad}`),
    beatjump: (direction) => calls.push(`${deck}:beatjump:${direction}`),
    beatjumpSize: (change) => calls.push(`${deck}:beatjumpSize:${change}`),
    setPitch: (percent) => calls.push(`${deck}:setPitch:${percent}`),
    match: () => calls.push(`${deck}:match`),
    jogTicks: (ticks) => calls.push(`${deck}:jog:${ticks}`),
    jogTouchTicks: (ticks) => calls.push(`${deck}:jogTouch:${ticks}`),
    jogSeekTicks: (ticks) => calls.push(`${deck}:jogSeek:${ticks}`),
    load: (track) => calls.push(`${deck}:load:${track.id}`),
  });
}

function registerFakeMixerControls(): void {
  registerMixerControls({
    setTrim: (channel, value) => calls.push(`mixer:trim:${channel}:${value}`),
    setEq: (channel, band, value) => calls.push(`mixer:eq:${channel}:${band}:${value}`),
    setFilter: (channel, position) => calls.push(`mixer:filter:${channel}:${position}`),
    setFader: (channel, value) => calls.push(`mixer:fader:${channel}:${value}`),
    setCrossfader: (position) => calls.push(`mixer:crossfader:${position}`),
    setMaster: (value) => calls.push(`mixer:master:${value}`),
    togglePfl: (channel) => calls.push(`mixer:pfl:${channel}`),
    setCueLevel: (value) => calls.push(`mixer:cueLevel:${value}`),
    setCueMix: (value) => calls.push(`mixer:cueMix:${value}`),
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
    // Production wiring (ADR 0019): the shared surface's gesture classes
    // delegate to the registered deck controls.
    pads: {
      hotCueDown: (deck, pad) => deckControlsFor(deck)?.hotCueDown(pad),
      hotCueUp: (deck, pad) => deckControlsFor(deck)?.hotCueUp(pad),
      hotCueClear: (deck, pad) => deckControlsFor(deck)?.hotCueClear(pad),
    },
    silence: () => undefined,
    wake: () => undefined,
  });
  registerSurface('editor', {
    // No cue handlers: CUE drops in the editor, like keyboard F.
    // No pads by default: tests that want the editor's pad semantics
    // re-register with a pads section (registerSurface overwrites).
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

  it('hot cue clear fires on the down edge only (midi-controller 13)', () => {
    registerFakeDeckControls('A');
    dispatchMidiAction({
      kind: 'button',
      edge: 'down',
      target: { control: 'hot-cue-clear', deck: 'A', pad: 3 },
    });
    dispatchMidiAction({
      kind: 'button',
      edge: 'up',
      target: { control: 'hot-cue-clear', deck: 'A', pad: 3 },
    });
    expect(calls).toEqual(['A:hotCueClear:3']);
  });

  it('deck controls only affect their own deck', () => {
    registerFakeDeckControls('A');
    dispatchMidiAction(hotCue('B', 1, 'down'));
    expect(calls).toEqual([]);
  });
});

describe('pads route per audible surface (ADR 0019, editor-midi 01)', () => {
  const hotCue = (deck: ChannelId, pad: number, edge: 'down' | 'up'): MidiAction => ({
    kind: 'button',
    edge,
    target: { control: 'hot-cue', deck, pad },
  });
  const clear = (deck: ChannelId, pad: number): MidiAction => ({
    kind: 'button',
    edge: 'down',
    target: { control: 'hot-cue-clear', deck, pad },
  });

  /** An editor surface that registers pad gestures (issue 01's semantics
   * are the editor's business — dispatch only sees the section). Release
   * is deliberately absent: editor gestures are taps. */
  function registerEditorWithPads(): void {
    registerSurface('editor', {
      transport: { togglePlay: () => calls.push('editor:toggle') },
      pads: {
        hotCueDown: (deck, pad) => calls.push(`editor:padDown:${deck}:${pad}`),
        hotCueClear: (deck, pad) => calls.push(`editor:padClear:${deck}:${pad}`),
      },
      silence: () => undefined,
      wake: () => undefined,
    });
  }

  it('editor claimed with pads: down and clear route with deck and pad', () => {
    registerFakeDeckControls('A');
    registerEditorWithPads();
    claimAudible('editor');
    dispatchMidiAction(hotCue('A', 3, 'down'));
    dispatchMidiAction(hotCue('B', 8, 'down'));
    dispatchMidiAction(clear('B', 2));
    expect(calls).toEqual(['editor:padDown:A:3', 'editor:padDown:B:8', 'editor:padClear:B:2']);
  });

  it('editor pads without a release handler: the up edge drops (taps)', () => {
    registerEditorWithPads();
    claimAudible('editor');
    dispatchMidiAction(hotCue('A', 1, 'up'));
    expect(calls).toEqual([]);
  });

  it('editor claimed without a pads section: the whole class drops, like CUE', () => {
    registerFakeDeckControls('A');
    claimAudible('editor');
    dispatchMidiAction(hotCue('A', 1, 'down'));
    dispatchMidiAction(clear('A', 1));
    expect(calls).toEqual([]);
  });

  it('claim/release flips pad routing between surfaces', () => {
    registerFakeDeckControls('A');
    registerEditorWithPads();
    dispatchMidiAction(hotCue('A', 1, 'down'));
    claimAudible('editor');
    dispatchMidiAction(hotCue('A', 1, 'down'));
    releaseAudible('editor');
    dispatchMidiAction(hotCue('A', 1, 'down'));
    expect(calls).toEqual(['A:hotCueDown:1', 'editor:padDown:A:1', 'A:hotCueDown:1']);
  });
});

describe('mixer/pitch/match (midi-controller 04)', () => {
  it('MATCH fires on the down edge only', () => {
    registerFakeDeckControls('A');
    dispatchMidiAction({
      kind: 'button',
      edge: 'down',
      target: { control: 'match', deck: 'A' },
    });
    dispatchMidiAction({
      kind: 'button',
      edge: 'up',
      target: { control: 'match', deck: 'A' },
    });
    expect(calls).toEqual(['A:match']);
  });

  it('pitch rescales 0..1 to ±PITCH_RANGE_PERCENT', () => {
    registerFakeDeckControls('B');
    dispatchMidiAction({ kind: 'absolute', target: { control: 'pitch', deck: 'B' }, value: 0 });
    dispatchMidiAction({ kind: 'absolute', target: { control: 'pitch', deck: 'B' }, value: 0.5 });
    dispatchMidiAction({ kind: 'absolute', target: { control: 'pitch', deck: 'B' }, value: 1 });
    expect(calls).toEqual(['B:setPitch:-8', 'B:setPitch:0', 'B:setPitch:8']);
  });

  it('unipolar mixer targets pass the normalized value through', () => {
    registerFakeMixerControls();
    dispatchMidiAction({ kind: 'absolute', target: { control: 'trim', channel: 'A' }, value: 0.25 });
    dispatchMidiAction({
      kind: 'absolute',
      target: { control: 'eq', channel: 'B', band: 'mid' },
      value: 0.5,
    });
    dispatchMidiAction({
      kind: 'absolute',
      target: { control: 'channel-fader', channel: 'A' },
      value: 1,
    });
    dispatchMidiAction({ kind: 'absolute', target: { control: 'master' }, value: 0.75 });
    expect(calls).toEqual([
      'mixer:trim:A:0.25',
      'mixer:eq:B:mid:0.5',
      'mixer:fader:A:1',
      'mixer:master:0.75',
    ]);
  });

  it('bipolar mixer targets rescale to -1..1', () => {
    registerFakeMixerControls();
    dispatchMidiAction({ kind: 'absolute', target: { control: 'filter', channel: 'A' }, value: 0 });
    dispatchMidiAction({ kind: 'absolute', target: { control: 'crossfader' }, value: 0.5 });
    dispatchMidiAction({ kind: 'absolute', target: { control: 'crossfader' }, value: 1 });
    expect(calls).toEqual(['mixer:filter:A:-1', 'mixer:crossfader:0', 'mixer:crossfader:1']);
  });

  it('hardware center detents land on exactly zero (they sit a hair above 0.5)', () => {
    registerFakeDeckControls('A');
    registerFakeMixerControls();
    // 14-bit center: MSB 0x40, LSB 0x00 → 8192/16383; 7-bit center: 64/127.
    dispatchMidiAction({
      kind: 'absolute',
      target: { control: 'pitch', deck: 'A' },
      value: 8192 / 16383,
    });
    dispatchMidiAction({
      kind: 'absolute',
      target: { control: 'filter', channel: 'A' },
      value: 64 / 127,
    });
    expect(calls).toEqual(['A:setPitch:0', 'mixer:filter:A:0']);
  });

  it('no registered mixer: absolute actions drop silently', () => {
    dispatchMidiAction({ kind: 'absolute', target: { control: 'master' }, value: 1 });
    dispatchMidiAction({ kind: 'absolute', target: { control: 'pitch', deck: 'A' }, value: 1 });
    expect(calls).toEqual([]);
  });
});

describe('cue bus (headphone-cue 02)', () => {
  const pfl = (channel: ChannelId, edge: 'down' | 'up'): MidiAction => ({
    kind: 'button',
    edge,
    target: { control: 'pfl', channel },
  });

  it('PFL toggles the mixer surface per channel, on the down edge only', () => {
    registerFakeMixerControls();
    dispatchMidiAction(pfl('A', 'down'));
    dispatchMidiAction(pfl('A', 'up'));
    dispatchMidiAction(pfl('B', 'down'));
    expect(calls).toEqual(['mixer:pfl:A', 'mixer:pfl:B']);
  });

  it('PFL bypasses the audible-surface arbiter (works while the editor holds audio)', () => {
    registerFakeMixerControls();
    claimAudible('editor');
    dispatchMidiAction(pfl('A', 'down'));
    expect(calls).toEqual(['mixer:pfl:A']);
  });

  it('no registered mixer: PFL drops silently', () => {
    dispatchMidiAction(pfl('A', 'down'));
    expect(calls).toEqual([]);
  });

  it('cue-level and cue-mix pass the normalized value through (headphone-cue 03)', () => {
    registerFakeMixerControls();
    dispatchMidiAction({ kind: 'absolute', target: { control: 'cue-level' }, value: 0.5 });
    dispatchMidiAction({ kind: 'absolute', target: { control: 'cue-mix' }, value: 0.25 });
    expect(calls).toEqual(['mixer:cueLevel:0.5', 'mixer:cueMix:0.25']);
  });
});

describe('jog (midi-controller 03)', () => {
  it('jog ticks route to the deck controls signed', () => {
    registerFakeDeckControls('A');
    registerFakeDeckControls('B');
    dispatchMidiAction({ kind: 'relative', target: { control: 'jog', deck: 'A' }, ticks: 1 });
    dispatchMidiAction({ kind: 'relative', target: { control: 'jog', deck: 'B' }, ticks: -3 });
    expect(calls).toEqual(['A:jog:1', 'B:jog:-3']);
  });

  it('no registered deck controls: jog drops silently', () => {
    dispatchMidiAction({ kind: 'relative', target: { control: 'jog', deck: 'A' }, ticks: 1 });
    expect(calls).toEqual([]);
  });

  it('touch-surface ticks route separately from rim ticks (midi-controller 11)', () => {
    registerFakeDeckControls('A');
    dispatchMidiAction({ kind: 'relative', target: { control: 'jog', deck: 'A' }, ticks: 1 });
    dispatchMidiAction({ kind: 'relative', target: { control: 'jog-touch', deck: 'A' }, ticks: -2 });
    expect(calls).toEqual(['A:jog:1', 'A:jogTouch:-2']);
  });

  it('SHIFT+wheel routes to the fast-seek handler (midi-controller 12)', () => {
    registerFakeDeckControls('B');
    dispatchMidiAction({ kind: 'relative', target: { control: 'jog-seek', deck: 'B' }, ticks: 3 });
    expect(calls).toEqual(['B:jogSeek:3']);
  });
});

describe('browser (midi-controller 05)', () => {
  const track = { id: 42 } as Track;

  it('selection-move steps the browse surface once per tick, signed', () => {
    const moves: number[] = [];
    registerBrowseSurface({
      navigate: (delta) => moves.push(delta),
      getSelectedTrack: () => null,
    });
    dispatchMidiAction({ kind: 'relative', target: { control: 'selection-move' }, ticks: 2 });
    dispatchMidiAction({ kind: 'relative', target: { control: 'selection-move' }, ticks: -1 });
    expect(moves).toEqual([1, 1, -1]);
  });

  it('selection-move caps runaway tick bursts', () => {
    const moves: number[] = [];
    registerBrowseSurface({
      navigate: (delta) => moves.push(delta),
      getSelectedTrack: () => null,
    });
    dispatchMidiAction({ kind: 'relative', target: { control: 'selection-move' }, ticks: 100 });
    expect(moves.length).toBeLessThanOrEqual(8);
  });

  it('no browse surface: selection-move and load are no-ops', () => {
    registerFakeDeckControls('A');
    dispatchMidiAction({ kind: 'relative', target: { control: 'selection-move' }, ticks: 1 });
    dispatchMidiAction({ kind: 'button', edge: 'down', target: { control: 'load', deck: 'A' } });
    expect(calls).toEqual([]);
  });

  it('LOAD routes the selected track to the deck on the down edge only', () => {
    registerFakeDeckControls('A');
    registerFakeDeckControls('B');
    registerBrowseSurface({ navigate: () => undefined, getSelectedTrack: () => track });
    dispatchMidiAction({ kind: 'button', edge: 'down', target: { control: 'load', deck: 'B' } });
    dispatchMidiAction({ kind: 'button', edge: 'up', target: { control: 'load', deck: 'B' } });
    expect(calls).toEqual(['B:load:42']);
  });

  it('LOAD with no selection is a no-op', () => {
    registerFakeDeckControls('A');
    registerBrowseSurface({ navigate: () => undefined, getSelectedTrack: () => null });
    dispatchMidiAction({ kind: 'button', edge: 'down', target: { control: 'load', deck: 'A' } });
    expect(calls).toEqual([]);
  });

  it('the most recently mounted browse surface wins; unregister restores', () => {
    const moves: string[] = [];
    registerBrowseSurface({
      navigate: () => moves.push('first'),
      getSelectedTrack: () => null,
    });
    const unregister = registerBrowseSurface({
      navigate: () => moves.push('second'),
      getSelectedTrack: () => null,
    });
    dispatchMidiAction({ kind: 'relative', target: { control: 'selection-move' }, ticks: 1 });
    unregister();
    dispatchMidiAction({ kind: 'relative', target: { control: 'selection-move' }, ticks: 1 });
    expect(moves).toEqual(['second', 'first']);
  });
});
