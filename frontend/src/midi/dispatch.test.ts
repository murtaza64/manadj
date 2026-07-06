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
import { isQuantizeOn, setQuantize } from '../playback/quantizeStore';
import type { MidiAction } from './actions';
import type { Track } from '../types';
import {
  _resetMidiControlsForTests,
  deckControlsFor,
  registerBrowseSurface,
  registerDeckControls,
  registerFollowMacro,
  registerMixerControls,
} from './controlRegistry';
import { _resetGridChordForTests, dispatchMidiAction } from './dispatch';

const button = (
  control: 'transport' | 'cue',
  deck: ChannelId,
  edge: 'down' | 'up'
): MidiAction => ({ kind: 'button', edge, target: { control, deck } });

let calls: string[];
/** Whether the shared surface's fake decks report a running loop
 * (drives the loop-or-jump-size disambiguation tests). */
let sharedLoopActive: boolean;

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
    gridNudgeStep: (direction) => calls.push(`${deck}:gridNudge:${direction}`),
    gridSetDownbeat: () => calls.push(`${deck}:gridAnchor`),
    gridBpm: (change) => calls.push(`${deck}:gridBpm:${change}`),
    gridNudgeLocal: (offsetMs) => calls.push(`${deck}:gridLocal:${offsetMs}`),
    gridNudgeCommit: (offsetMs) => calls.push(`${deck}:gridCommit:${offsetMs}`),
    gridBpmAdjust: (deltaBpm) => calls.push(`${deck}:gridBpmAdjust:${deltaBpm}`),
    toggleKeyLock: () => calls.push(`${deck}:toggleKeyLock`),
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
  sharedLoopActive = false;
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
    jumps: {
      beatjump: (deck, direction) => deckControlsFor(deck)?.beatjump(direction),
    },
    jog: {
      rimTicks: (deck, ticks) => deckControlsFor(deck)?.jogTicks(ticks),
      touchTicks: (deck, ticks) => deckControlsFor(deck)?.jogTouchTicks(ticks),
      shiftRimTicks: (deck, ticks) => deckControlsFor(deck)?.jogSeekTicks(ticks),
    },
    loops: {
      toggleLoop: (deck) => calls.push(`shared:toggleLoop:${deck}`),
      loopPreset: (deck, beats) => calls.push(`shared:loopPreset:${deck}:${beats}`),
      resizeActiveLoop: (deck, change) => {
        if (!sharedLoopActive) return false;
        calls.push(`shared:resizeLoop:${deck}:${change}`);
        return true;
      },
    },
    silence: () => undefined,
  });
  registerSurface('editor', {
    // No cue handlers: CUE drops in the editor, like keyboard F.
    // No pads by default: tests that want the editor's pad semantics
    // re-register with a pads section (registerSurface overwrites).
    transport: { togglePlay: () => calls.push('editor:toggle') },
    silence: () => undefined,
  });
});

afterEach(() => {
  _resetAudibleSurfacesForTests();
  _resetMidiControlsForTests();
  _resetGridChordForTests();
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

describe('jumps route per audible surface (editor-midi 02)', () => {
  const jump = (deck: ChannelId, direction: 'back' | 'forward', edge: 'down' | 'up'): MidiAction => ({
    kind: 'button',
    edge,
    target: { control: 'beatjump', deck, direction },
  });

  function registerEditorWithJumps(): void {
    registerSurface('editor', {
      transport: { togglePlay: () => calls.push('editor:toggle') },
      jumps: {
        beatjump: (deck, direction) => calls.push(`editor:jump:${deck}:${direction}`),
      },
      silence: () => undefined,
    });
  }

  it('editor claimed with jumps: beatjump routes with deck and direction, down edge only', () => {
    registerFakeDeckControls('A');
    registerEditorWithJumps();
    claimAudible('editor');
    dispatchMidiAction(jump('A', 'back', 'down'));
    dispatchMidiAction(jump('B', 'forward', 'down'));
    dispatchMidiAction(jump('A', 'back', 'up'));
    expect(calls).toEqual(['editor:jump:A:back', 'editor:jump:B:forward']);
  });

  it('editor claimed without a jumps section: the class drops', () => {
    registerFakeDeckControls('A');
    claimAudible('editor');
    dispatchMidiAction(jump('A', 'forward', 'down'));
    expect(calls).toEqual([]);
  });

  it('beatjump-size stays registry-direct while the editor is audible (shared per-deck size)', () => {
    registerFakeDeckControls('A');
    registerEditorWithJumps();
    claimAudible('editor');
    dispatchMidiAction({
      kind: 'button',
      edge: 'down',
      target: { control: 'beatjump-size', deck: 'A', change: 'double' },
    });
    expect(calls).toEqual(['A:beatjumpSize:double']);
  });
});

describe('loops route per audible surface (midi-performance-ops 02)', () => {
  const preset = (deck: ChannelId, beats: number, edge: 'down' | 'up'): MidiAction => ({
    kind: 'button',
    edge,
    target: { control: 'loop-preset', deck, beats },
  });

  it('loop-preset routes to the audible loops handler with deck and size, down edge only', () => {
    dispatchMidiAction(preset('A', 8, 'down'));
    dispatchMidiAction(preset('B', 0.75, 'down'));
    dispatchMidiAction(preset('A', 8, 'up'));
    expect(calls).toEqual(['shared:loopPreset:A:8', 'shared:loopPreset:B:0.75']);
  });

  it('loop-toggle routes through the same loops section', () => {
    dispatchMidiAction({
      kind: 'button',
      edge: 'down',
      target: { control: 'loop-toggle', deck: 'B' },
    });
    expect(calls).toEqual(['shared:toggleLoop:B']);
  });

  it('editor claimed (no loops section): loop gestures drop', () => {
    claimAudible('editor');
    dispatchMidiAction(preset('A', 4, 'down'));
    dispatchMidiAction({
      kind: 'button',
      edge: 'down',
      target: { control: 'loop-toggle', deck: 'A' },
    });
    expect(calls).toEqual([]);
  });
});

describe('loop-or-jump-size overload (midi-performance-ops 03)', () => {
  const sizePress = (deck: ChannelId, change: 'halve' | 'double', edge: 'down' | 'up'): MidiAction => ({
    kind: 'button',
    edge,
    target: { control: 'loop-or-jump-size', deck, change },
  });

  it('resizes the running loop and never touches the beatjump size, per deck', () => {
    registerFakeDeckControls('A');
    registerFakeDeckControls('B');
    sharedLoopActive = true;
    dispatchMidiAction(sizePress('A', 'halve', 'down'));
    dispatchMidiAction(sizePress('B', 'double', 'down'));
    expect(calls).toEqual(['shared:resizeLoop:A:halve', 'shared:resizeLoop:B:double']);
  });

  it('keeps the beatjump-size meaning while no loop runs, per deck', () => {
    registerFakeDeckControls('A');
    registerFakeDeckControls('B');
    dispatchMidiAction(sizePress('A', 'halve', 'down'));
    dispatchMidiAction(sizePress('B', 'double', 'down'));
    expect(calls).toEqual(['A:beatjumpSize:halve', 'B:beatjumpSize:double']);
  });

  it('ignores the up edge in both states', () => {
    registerFakeDeckControls('A');
    dispatchMidiAction(sizePress('A', 'halve', 'up'));
    sharedLoopActive = true;
    dispatchMidiAction(sizePress('A', 'halve', 'up'));
    expect(calls).toEqual([]);
  });

  it('falls back to beatjump-size where the surface registers no loops (editor)', () => {
    registerFakeDeckControls('A');
    claimAudible('editor');
    dispatchMidiAction(sizePress('A', 'double', 'down'));
    expect(calls).toEqual(['A:beatjumpSize:double']);
  });
});

describe('jog routes per audible surface (editor-midi 04)', () => {
  const tick = (
    control: 'jog' | 'jog-touch' | 'jog-seek',
    deck: ChannelId,
    ticks: number
  ): MidiAction => ({ kind: 'relative', target: { control, deck }, ticks });

  function registerEditorWithJog(): void {
    registerSurface('editor', {
      transport: { togglePlay: () => calls.push('editor:toggle') },
      jog: {
        rimTicks: (deck, ticks) => calls.push(`editor:rim:${deck}:${ticks}`),
        touchTicks: (deck, ticks) => calls.push(`editor:touch:${deck}:${ticks}`),
        shiftRimTicks: (deck, ticks) => calls.push(`editor:shiftRim:${deck}:${ticks}`),
      },
      silence: () => undefined,
    });
  }

  it('editor claimed with jog: all three tiers route with deck and signed ticks', () => {
    registerFakeDeckControls('A');
    registerEditorWithJog();
    claimAudible('editor');
    dispatchMidiAction(tick('jog', 'A', 2));
    dispatchMidiAction(tick('jog-touch', 'B', -1));
    dispatchMidiAction(tick('jog-seek', 'A', 3));
    expect(calls).toEqual(['editor:rim:A:2', 'editor:touch:B:-1', 'editor:shiftRim:A:3']);
  });

  it('editor claimed without a jog section: the class drops', () => {
    registerFakeDeckControls('A');
    claimAudible('editor');
    dispatchMidiAction(tick('jog', 'A', 1));
    dispatchMidiAction(tick('jog-touch', 'A', 1));
    dispatchMidiAction(tick('jog-seek', 'A', 1));
    expect(calls).toEqual([]);
  });

  it('release restores shared jog routing (delegating to the deck controls)', () => {
    registerFakeDeckControls('B');
    registerEditorWithJog();
    claimAudible('editor');
    releaseAudible('editor');
    dispatchMidiAction(tick('jog', 'B', -3));
    expect(calls).toEqual(['B:jog:-3']);
  });
});

describe('grid-edit pads are registry-direct (midi-performance-ops 05, ADR 0019)', () => {
  const nudge = (deck: ChannelId, direction: 'earlier' | 'later', edge: 'down' | 'up'): MidiAction => ({
    kind: 'button',
    edge,
    target: { control: 'grid-nudge', deck, direction },
  });
  const anchor = (deck: ChannelId, edge: 'down' | 'up'): MidiAction => ({
    kind: 'button',
    edge,
    target: { control: 'grid-anchor', deck },
  });
  /** A full press: grow/shrink are chorded (the tap fires on the zero-tick
   * release); halve/double fire on the down edge and ignore the up. */
  const gridBpm = (deck: ChannelId, change: 'grow' | 'shrink' | 'halve' | 'double') => {
    dispatchMidiAction({ kind: 'button', edge: 'down', target: { control: 'grid-bpm', deck, change } });
    dispatchMidiAction({ kind: 'button', edge: 'up', target: { control: 'grid-bpm', deck, change } });
  };

  /** A tap: press and release with no jog ticks in between (issue 06 made
   * grid-nudge chorded — the step fires on the zero-tick release). */
  const tap = (deck: ChannelId, direction: 'earlier' | 'later') => {
    dispatchMidiAction(nudge(deck, direction, 'down'));
    dispatchMidiAction(nudge(deck, direction, 'up'));
  };

  it('nudge taps and anchor/bpm presses route to the deck controls', () => {
    registerFakeDeckControls('A');
    tap('A', 'earlier');
    tap('A', 'later');
    dispatchMidiAction(anchor('A', 'down'));
    dispatchMidiAction(anchor('A', 'up'));
    gridBpm('A', 'grow');
    gridBpm('A', 'shrink');
    gridBpm('A', 'halve');
    gridBpm('A', 'double');
    expect(calls).toEqual([
      'A:gridNudge:earlier',
      'A:gridNudge:later',
      'A:gridAnchor',
      'A:gridBpm:grow',
      'A:gridBpm:shrink',
      'A:gridBpm:halve',
      'A:gridBpm:double',
    ]);
  });

  it('grid targets act identically while the editor holds audibility (stored data, not gestures)', () => {
    registerFakeDeckControls('B');
    claimAudible('editor');
    tap('B', 'later');
    dispatchMidiAction(anchor('B', 'down'));
    gridBpm('B', 'double');
    expect(calls).toEqual(['B:gridNudge:later', 'B:gridAnchor', 'B:gridBpm:double']);
  });

  it('grid targets only reach their own deck', () => {
    registerFakeDeckControls('A');
    tap('B', 'earlier');
    dispatchMidiAction(anchor('B', 'down'));
    expect(calls).toEqual([]);
  });

  it('no registered deck controls: grid actions drop silently', () => {
    tap('A', 'earlier');
    dispatchMidiAction(anchor('A', 'down'));
    gridBpm('A', 'grow');
    expect(calls).toEqual([]);
  });
});

describe('spin-to-nudge chord (midi-performance-ops 06)', () => {
  const nudge = (deck: ChannelId, direction: 'earlier' | 'later', edge: 'down' | 'up'): MidiAction => ({
    kind: 'button',
    edge,
    target: { control: 'grid-nudge', deck, direction },
  });
  const tick = (
    control: 'jog' | 'jog-touch' | 'jog-seek',
    deck: ChannelId,
    ticks: number
  ): MidiAction => ({ kind: 'relative', target: { control, deck }, ticks });

  it('hold-and-spin: ticks apply locally, release commits the net — no jog meanings fire', () => {
    registerFakeDeckControls('A');
    dispatchMidiAction(nudge('A', 'later', 'down'));
    dispatchMidiAction(tick('jog', 'A', 3));
    dispatchMidiAction(tick('jog-touch', 'A', -1));
    dispatchMidiAction(nudge('A', 'later', 'up'));
    expect(calls).toEqual(['A:gridLocal:3', 'A:gridLocal:-1', 'A:gridCommit:2']);
  });

  it('a tap (zero ticks) still fires the discrete step', () => {
    registerFakeDeckControls('A');
    dispatchMidiAction(nudge('A', 'earlier', 'down'));
    dispatchMidiAction(nudge('A', 'earlier', 'up'));
    expect(calls).toEqual(['A:gridNudge:earlier']);
  });

  it('release restores plain jog instantly', () => {
    registerFakeDeckControls('A');
    dispatchMidiAction(nudge('A', 'later', 'down'));
    dispatchMidiAction(tick('jog', 'A', 1));
    dispatchMidiAction(nudge('A', 'later', 'up'));
    dispatchMidiAction(tick('jog', 'A', 2));
    dispatchMidiAction(tick('jog-touch', 'A', -2));
    expect(calls).toEqual(['A:gridLocal:1', 'A:gridCommit:1', 'A:jog:2', 'A:jogTouch:-2']);
  });

  it('the unarmed deck\u2019s jog is untouched mid-gesture (per-deck isolation)', () => {
    registerFakeDeckControls('A');
    registerFakeDeckControls('B');
    dispatchMidiAction(nudge('A', 'later', 'down'));
    dispatchMidiAction(tick('jog', 'B', 2));
    dispatchMidiAction(nudge('A', 'later', 'up'));
    // B's ticks pass through; A received zero ticks, so its release is a tap.
    expect(calls).toEqual(['B:jog:2', 'A:gridNudge:later']);
  });

  it('the interception happens BEFORE surface routing: an armed deck\u2019s ticks never reach the editor either', () => {
    registerFakeDeckControls('A');
    registerSurface('editor', {
      transport: { togglePlay: () => calls.push('editor:toggle') },
      jog: {
        rimTicks: (deck, ticks) => calls.push(`editor:rim:${deck}:${ticks}`),
        touchTicks: (deck, ticks) => calls.push(`editor:touch:${deck}:${ticks}`),
        shiftRimTicks: (deck, ticks) => calls.push(`editor:shiftRim:${deck}:${ticks}`),
      },
      silence: () => undefined,
    });
    claimAudible('editor');
    dispatchMidiAction(nudge('A', 'later', 'down'));
    dispatchMidiAction(tick('jog', 'A', 2));
    dispatchMidiAction(nudge('A', 'later', 'up'));
    dispatchMidiAction(tick('jog', 'A', 1));
    expect(calls).toEqual(['A:gridLocal:2', 'A:gridCommit:2', 'editor:rim:A:1']);
  });

  it('hold grow/shrink + spin: fine BPM adjust, one commit on release, jog suppressed', () => {
    registerFakeDeckControls('A');
    dispatchMidiAction({
      kind: 'button',
      edge: 'down',
      target: { control: 'grid-bpm', deck: 'A', change: 'shrink' },
    });
    dispatchMidiAction(tick('jog', 'A', 3));
    dispatchMidiAction(tick('jog-touch', 'A', -1));
    dispatchMidiAction({
      kind: 'button',
      edge: 'up',
      target: { control: 'grid-bpm', deck: 'A', change: 'shrink' },
    });
    dispatchMidiAction(tick('jog', 'A', 1)); // released: plain jog again
    // 2 net ticks × 0.01 BPM — the reducer accumulates integer ticks and
    // converts once at release, so the delta is exactly 2 × the rate.
    expect(calls).toEqual([`A:gridBpmAdjust:${2 * 0.01}`, 'A:jog:1']);
  });

  it('grow/shrink taps still fire the discrete step; halve/double stay plain taps', () => {
    registerFakeDeckControls('A');
    dispatchMidiAction({
      kind: 'button',
      edge: 'down',
      target: { control: 'grid-bpm', deck: 'A', change: 'grow' },
    });
    dispatchMidiAction({
      kind: 'button',
      edge: 'up',
      target: { control: 'grid-bpm', deck: 'A', change: 'grow' },
    });
    dispatchMidiAction({
      kind: 'button',
      edge: 'down',
      target: { control: 'grid-bpm', deck: 'A', change: 'halve' },
    });
    expect(calls).toEqual(['A:gridBpm:grow', 'A:gridBpm:halve']);
  });

  it('the shifted jog-seek stream stays surface-routed while armed (SHIFT is its own gesture)', () => {
    registerFakeDeckControls('A');
    dispatchMidiAction(nudge('A', 'later', 'down'));
    dispatchMidiAction(tick('jog-seek', 'A', 3));
    dispatchMidiAction(nudge('A', 'later', 'up'));
    // jog-seek is not a chord tick: it routes normally, and the release
    // (zero chord ticks received) is a tap.
    expect(calls).toEqual(['A:jogSeek:3', 'A:gridNudge:later']);
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
      load: () => undefined,
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
      load: () => undefined,
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

  it('LOAD routes the selected track to the browse surface load policy, down edge only (editor-midi 03)', () => {
    registerBrowseSurface({
      navigate: () => undefined,
      getSelectedTrack: () => track,
      load: (deck, t) => calls.push(`view:load:${deck}:${t.id}`),
    });
    dispatchMidiAction({ kind: 'button', edge: 'down', target: { control: 'load', deck: 'B' } });
    dispatchMidiAction({ kind: 'button', edge: 'up', target: { control: 'load', deck: 'B' } });
    expect(calls).toEqual(['view:load:B:42']);
  });

  it('LOAD policy is the VIEW\u2019s: a lock-refusing policy simply receives the call', () => {
    // Per-view policies (editor assign-to-pair, Performance lock, library
    // free replace) live in the registered handler — dispatch stays blind.
    let refused = 0;
    registerBrowseSurface({
      navigate: () => undefined,
      getSelectedTrack: () => track,
      load: () => {
        refused += 1; // e.g. Performance silently refusing a running deck
      },
    });
    dispatchMidiAction({ kind: 'button', edge: 'down', target: { control: 'load', deck: 'A' } });
    expect(refused).toBe(1);
    expect(calls).toEqual([]);
  });

  it('LOAD with no selection is a no-op', () => {
    registerBrowseSurface({
      navigate: () => undefined,
      getSelectedTrack: () => null,
      load: (deck, t) => calls.push(`view:load:${deck}:${t.id}`),
    });
    dispatchMidiAction({ kind: 'button', edge: 'down', target: { control: 'load', deck: 'A' } });
    expect(calls).toEqual([]);
  });

  it('the most recently mounted browse surface wins; unregister restores', () => {
    const moves: string[] = [];
    registerBrowseSurface({
      navigate: () => moves.push('first'),
      getSelectedTrack: () => null,
      load: () => undefined,
    });
    const unregister = registerBrowseSurface({
      navigate: () => moves.push('second'),
      getSelectedTrack: () => null,
      load: () => undefined,
    });
    dispatchMidiAction({ kind: 'relative', target: { control: 'selection-move' }, ticks: 1 });
    unregister();
    dispatchMidiAction({ kind: 'relative', target: { control: 'selection-move' }, ticks: 1 });
    expect(moves).toEqual(['second', 'first']);
  });
});

describe('quantize and key lock (midi-performance-ops 07)', () => {
  const quantize = (edge: 'down' | 'up'): MidiAction => ({
    kind: 'button',
    edge,
    target: { control: 'quantize' },
  });

  // The store is module-level: restore it even when an assertion fails
  // mid-test, so a red test can't cascade into unrelated ones.
  const initialQuantize = isQuantizeOn();
  afterEach(() => setQuantize(initialQuantize));

  it('Q flips the app-wide quantize store on the down edge only', () => {
    const before = isQuantizeOn();
    dispatchMidiAction(quantize('down'));
    expect(isQuantizeOn()).toBe(!before);
    dispatchMidiAction(quantize('up'));
    expect(isQuantizeOn()).toBe(!before);
  });

  it('quantize is deck-less: repeated presses from either hardware button flip the one state', () => {
    const before = isQuantizeOn();
    dispatchMidiAction(quantize('down'));
    dispatchMidiAction(quantize('down'));
    expect(isQuantizeOn()).toBe(before);
  });

  it('quantize bypasses the audible-surface arbiter (sticky state, ADR 0019)', () => {
    claimAudible('editor');
    const before = isQuantizeOn();
    dispatchMidiAction(quantize('down'));
    expect(isQuantizeOn()).toBe(!before);
  });

  it('SHIFT+Q toggles key lock on the addressed deck only, down edge only', () => {
    registerFakeDeckControls('A');
    registerFakeDeckControls('B');
    dispatchMidiAction({ kind: 'button', edge: 'down', target: { control: 'key-lock', deck: 'A' } });
    dispatchMidiAction({ kind: 'button', edge: 'up', target: { control: 'key-lock', deck: 'A' } });
    dispatchMidiAction({ kind: 'button', edge: 'down', target: { control: 'key-lock', deck: 'B' } });
    expect(calls).toEqual(['A:toggleKeyLock', 'B:toggleKeyLock']);
  });

  it('key lock stays registry-direct while the editor is audible', () => {
    registerFakeDeckControls('A');
    claimAudible('editor');
    dispatchMidiAction({ kind: 'button', edge: 'down', target: { control: 'key-lock', deck: 'A' } });
    expect(calls).toEqual(['A:toggleKeyLock']);
  });

  it('no registered deck controls: key lock drops silently', () => {
    dispatchMidiAction({ kind: 'button', edge: 'down', target: { control: 'key-lock', deck: 'A' } });
    expect(calls).toEqual([]);
  });
});

describe('assistant follow macro (midi-performance-ops 08)', () => {
  const press = (edge: 'down' | 'up'): MidiAction => ({
    kind: 'button',
    edge,
    target: { control: 'follow-macro' },
  });

  it('routes to the registered macro on the down edge only', () => {
    registerFollowMacro(() => calls.push('followMacro'));
    dispatchMidiAction(press('down'));
    dispatchMidiAction(press('up'));
    expect(calls).toEqual(['followMacro']);
  });

  it('bypasses the audible-surface arbiter (Follow means the same thing everywhere)', () => {
    registerFollowMacro(() => calls.push('followMacro'));
    claimAudible('editor');
    dispatchMidiAction(press('down'));
    expect(calls).toEqual(['followMacro']);
  });

  it('no registered macro: drops silently', () => {
    dispatchMidiAction(press('down'));
    expect(calls).toEqual([]);
  });

  it('unregister restores silence', () => {
    const unregister = registerFollowMacro(() => calls.push('followMacro'));
    unregister();
    dispatchMidiAction(press('down'));
    expect(calls).toEqual([]);
  });
});
