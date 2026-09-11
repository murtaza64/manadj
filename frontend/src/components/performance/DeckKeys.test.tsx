// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelId } from '../../playback/mixer';
import { KeepAliveView } from '../../contexts/KeepAliveView';
import { DeckKeys } from './DeckKeys';
import { DECK_KEYS } from './performanceKeys';
import { mouseSeekDelta } from './mouseControl';
import { resetMouseJogSettings, setMouseJogSettings } from './mouseJogSettings';

const engine = vi.hoisted(() => ({
  jumpBeats: vi.fn(), setBend: vi.fn(), cueUp: vi.fn(), cueDown: vi.fn(),
  togglePlay: vi.fn(), toggleLoop: vi.fn(),
  getSnapshot: vi.fn(), getPlayhead: vi.fn(), seek: vi.fn(), subscribe: vi.fn(),
  beginScratch: vi.fn(), scratchMove: vi.fn(), endScratch: vi.fn(), addTransportEventListener: vi.fn(),
}));
const fixture = vi.hoisted(() => ({
  deck: 'A' as ChannelId,
  trackId: 7,
  snapshot: { playing: false, loadState: 'ready', bendPercent: 0, scratching: false, vinylMode: true },
  channel: { filter: 0, eq: { high: 0.5, mid: 0.5, low: 0.5 }, fader: 0.5 },
  listener: () => {},
  transportListener: vi.fn<(event: { action: string }) => void>(),
}));
const hotCues = vi.hoisted(() => ({ enabled: true, down: vi.fn(), up: vi.fn(), walk: vi.fn() }));
const mixer = vi.hoisted(() => ({
  getChannelState: vi.fn(), setEq: vi.fn(), setFilter: vi.fn(), setFader: vi.fn(),
}));
vi.mock('../../hooks/useMixer', () => ({ useMixer: () => mixer }));
vi.mock('../../settings/persistedSettings', () => ({ writeSetting: vi.fn(), removeSetting: vi.fn() }));
vi.mock('../../hooks/useDeck', () => ({
  useDeck: () => ({ deck: fixture.deck, engine, loadedTrack: { id: fixture.trackId }, beatjumpBeats: 32 }),
  useDeckReady: () => fixture.snapshot.loadState === 'ready',
  useDeckSnapshot: () => true,
}));
vi.mock('../../hooks/useHotCueActions', () => ({
  useHotCueActions: () => ({ ...hotCues }),
}));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  vi.resetAllMocks();
  resetMouseJogSettings();
  fixture.deck = 'A';
  fixture.trackId = 7;
  fixture.snapshot = { playing: false, loadState: 'ready', bendPercent: 0, scratching: false, vinylMode: true };
  fixture.channel = { filter: 0, eq: { high: 0.5, mid: 0.5, low: 0.5 }, fader: 0.5 };
  engine.getSnapshot.mockImplementation(() => fixture.snapshot);
  engine.getPlayhead.mockReturnValue(30);
  engine.setBend.mockImplementation(value => { fixture.snapshot.bendPercent = value; });
  engine.subscribe.mockImplementation((listener) => {
    fixture.listener = listener;
    return vi.fn();
  });
  engine.addTransportEventListener.mockImplementation(listener => {
    fixture.transportListener = listener;
    return vi.fn();
  });
  engine.beginScratch.mockImplementation(() => {
    if (fixture.snapshot.loadState !== 'ready' || !fixture.snapshot.vinylMode) return;
    fixture.snapshot.scratching = true;
    fixture.listener();
  });
  engine.endScratch.mockImplementation(() => {
    fixture.snapshot.scratching = false;
    fixture.transportListener({ action: 'scratchEnd' });
    fixture.listener();
  });
  mixer.getChannelState.mockImplementation(() => fixture.channel);
  mixer.setFilter.mockImplementation((_deck, value) => { fixture.channel.filter = value; });
  mixer.setFader.mockImplementation((_deck, value) => { fixture.channel.fader = value; });
  mixer.setEq.mockImplementation((_deck, band: 'high' | 'mid' | 'low', value) => {
    fixture.channel.eq[band] = value;
  });
  Object.defineProperty(document, 'pointerLockElement', { configurable: true, value: null });
  Object.defineProperty(HTMLElement.prototype, 'requestPointerLock', { configurable: true, value: vi.fn(function (this: HTMLElement) {
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, value: this });
    document.dispatchEvent(new Event('pointerlockchange'));
  }) });
  document.exitPointerLock = vi.fn(() => {
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, value: null });
    document.dispatchEvent(new Event('pointerlockchange'));
  });
});

it('retained Performance view does not handle Export beat-jump keys', () => {
  const root = createRoot(document.createElement('div'));
  const render = (active: boolean) => act(() => root.render(
    <KeepAliveView active={active}><DeckKeys /></KeepAliveView>
  ));
  const key = (value: string) => act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true }));
  });
  try {
    render(true);
    key('s');
    expect(engine.jumpBeats.mock.calls).toEqual([[32]]);
    key(DECK_KEYS.A.cue);
    expect(engine.cueDown).toHaveBeenCalledTimes(1);
    engine.cueUp.mockClear();
    render(false);
    expect(engine.cueUp).toHaveBeenCalledTimes(1);
    act(() => document.dispatchEvent(new KeyboardEvent('keyup', { key: DECK_KEYS.A.cue, bubbles: true })));
    expect(engine.cueUp).toHaveBeenCalledTimes(1);
    engine.jumpBeats.mockClear();
    key('s');
    key('a');
    expect(engine.jumpBeats).not.toHaveBeenCalled();
    render(true);
    key('a');
    expect(engine.jumpBeats.mock.calls).toEqual([[-32]]);
    render(false);
    render(true);
    engine.jumpBeats.mockClear();
    key('s');
    expect(engine.jumpBeats.mock.calls).toEqual([[32]]);
  } finally {
    act(() => root.unmount());
  }
});

describe('mouse-key gestures and cue walking', () => {
  let root: ReturnType<typeof createRoot>;
  let mouseX = 0;
  let mouseY = 0;
  const render = (active = true, enabled = true) => act(() => root.render(
    <KeepAliveView active={active}><DeckKeys enabled={enabled} /></KeepAliveView>
  ));
  const key = (value: string, options: KeyboardEventInit = {}, type = 'keydown', target: EventTarget = document) => {
    const event = new KeyboardEvent(type, { key: value, bubbles: true, cancelable: true, ...options });
    act(() => { target.dispatchEvent(event); });
    return event;
  };
  const move = (x: number, y: number, options: MouseEventInit = {}) => act(() => {
    if (vi.isFakeTimers()) vi.advanceTimersByTime(16);
    const event = new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true, ...options });
    Object.defineProperties(event, { movementX: { value: x - mouseX }, movementY: { value: y - mouseY } });
    mouseX = x; mouseY = y;
    document.dispatchEvent(event);
  });

  beforeEach(() => { root = createRoot(document.createElement('div')); mouseX = 0; mouseY = 0; });
  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it('releases owned cue, pad and pointer gestures when library takes focus', () => {
    render(); move(100, 100);
    key('f'); key('z'); key('q'); key('t', { shiftKey: true }); move(130, 100);
    expect(engine.cueDown).toHaveBeenCalledOnce();
    expect(hotCues.down).toHaveBeenCalledWith(1);
    render(true, false);
    expect(engine.cueUp).toHaveBeenCalledOnce();
    expect(hotCues.up).toHaveBeenCalledExactlyOnceWith(1);
    expect(fixture.snapshot.scratching).toBe(false);
    mixer.setFilter.mockClear(); engine.seek.mockClear();
    move(200, 100); key('d'); key('a'); key('z', {}, 'keyup'); key('f', {}, 'keyup');
    expect(mixer.setFilter).not.toHaveBeenCalled();
    expect(engine.seek).not.toHaveBeenCalled();
    expect(engine.togglePlay).not.toHaveBeenCalled();
    expect(engine.jumpBeats).not.toHaveBeenCalled();
    expect(hotCues.up).toHaveBeenCalledTimes(1);
    expect(engine.cueUp).toHaveBeenCalledTimes(1);
    render(true, true); key('d'); expect(engine.togglePlay).toHaveBeenCalledOnce();
  });

  it('guards cue-walking behind a modal as well as ordinary transport', () => {
    render();
    const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog');
    document.body.append(dialog);
    try {
      key('a', { metaKey: true }); key('s', { metaKey: true }); key('d');
      expect(hotCues.walk).not.toHaveBeenCalled();
      expect(engine.togglePlay).not.toHaveBeenCalled();
    } finally { dialog.remove(); }
  });

  it.each(['A', 'B', 'C', 'D'] as const)('maps all knobs and the fader to focused deck %s', (deck) => {
    fixture.deck = deck;
    render();
    const keys = DECK_KEYS[deck === 'A' || deck === 'C' ? 'A' : 'B'];
    let y = 500;
    move(200, y);
    for (const band of ['filter', 'high', 'mid', 'low'] as const) {
      expect(key(keys.knobs[band]).defaultPrevented).toBe(true);
      move(200, y -= 36);
      if (band === 'filter') expect(mixer.setFilter).toHaveBeenLastCalledWith(deck, 0.2);
      else expect(mixer.setEq).toHaveBeenLastCalledWith(deck, band, 0.6);
      key(keys.knobs[band], {}, 'keyup');
    }
    key(keys.fader);
    move(200, y + 36);
    expect(mixer.setFader).toHaveBeenLastCalledWith(deck, 0.4);
    key(keys.fader, {}, 'keyup');
    expect(engine.setBend).not.toHaveBeenCalled();
    expect(engine.toggleLoop).not.toHaveBeenCalled();
  });

  it('clamps at both stops and reverses without an overshoot dead zone', () => {
    vi.useFakeTimers();
    render();
    move(100, 500);
    key('q'); key('w'); key('g');
    move(100, 0);
    expect(fixture.channel).toMatchObject({ filter: 1, eq: { high: 1 }, fader: 1 });
    move(100, 36);
    expect(fixture.channel).toMatchObject({ filter: 0.8, eq: { high: 0.9 }, fader: 0.9 });
    move(100, 1000);
    expect(fixture.channel).toMatchObject({ filter: 0, eq: { high: 0.5 }, fader: 0 });
    act(() => vi.advanceTimersByTime(160));
    move(100, 2000);
    expect(fixture.channel).toMatchObject({ filter: -1, eq: { high: 0 }, fader: 0 });
  });

  it('does not change a value at lock acquisition or stop a hold on rerender/repeat', () => {
    render();
    move(400, 400);
    key('q');
    expect(mixer.setFilter).not.toHaveBeenCalled();
    render();
    key('q', { repeat: true });
    move(400, 364);
    expect(mixer.setFilter).toHaveBeenLastCalledWith('A', 0.2);
  });

  it('uses either axis for knobs, without doubling diagonals; jog stays horizontal', () => {
    render(); move(100, 100);
    key('q'); move(136, 100);
    expect(fixture.channel.filter).toBeCloseTo(0.2);
    move(172, 64);
    expect(fixture.channel.filter).toBeCloseTo(0.4);
    key('q', {}, 'keyup'); key('t'); move(172, 50);
    expect(engine.seek).not.toHaveBeenCalled();
  });

  it.each([-1, 1])('hard-stops EQ and filter from side %s through continuous motion and reversal', (sign) => {
    vi.useFakeTimers();
    render(); move(200, 100);
    fixture.channel.eq.high = 0.5 + sign * 0.04;
    fixture.channel.filter = sign * 0.08;
    key('w'); key('q');
    let x = 200 - sign * 8;
    move(x, 100);
    expect(fixture.channel.eq.high).toBe(0.5);
    expect(fixture.channel.filter).toBe(0);
    for (let i = 0; i < 40; i++) {
      move(x -= sign, 100);
      expect(fixture.channel.eq.high).toBe(0.5);
      expect(fixture.channel.filter).toBe(0);
    }
    move(x -= sign * 1000, 100);
    move(x += sign * 2000, 100);
    expect(fixture.channel.eq.high).toBe(0.5);
    expect(fixture.channel.filter).toBe(0);
  });

  it.each([159, 160, 240])('uses the uncapped %sms motion gap to release the notch on the same hold', (gap) => {
    vi.useFakeTimers();
    fixture.channel.eq.high = 0.8;
    fixture.channel.filter = 0.6;
    render(); move(200, 100); key('w'); key('q');
    move(0, 100);
    expect(fixture.channel.eq.high).toBe(0.5);
    expect(fixture.channel.filter).toBe(0);
    act(() => vi.advanceTimersByTime(gap - 16));
    move(-1, 100);
    const steps = gap >= 160 ? 1 : 0;
    expect(fixture.channel.eq.high).toBeCloseTo(0.5 - steps / 360);
    expect(fixture.channel.filter).toBeCloseTo(-steps * 2 / 360);
    for (let i = 2; i <= 8; i++) {
      move(-i, 100);
      expect(fixture.channel.eq.high).toBeCloseTo(0.5 - steps * i / 360);
      expect(fixture.channel.filter).toBeCloseTo(-steps * i * 2 / 360);
    }
    move(-7, 100);
    expect(fixture.channel.eq.high).toBe(0.5);
    expect(fixture.channel.filter).toBe(0);
  });

  it('ignores zero-delta events when measuring the motion pause', () => {
    vi.useFakeTimers(); fixture.channel.eq.high = 0.8;
    render(); move(200, 100); key('w'); move(0, 100);
    act(() => vi.advanceTimersByTime(128));
    move(0, 100); move(1, 100);
    expect(fixture.channel.eq.high).toBeCloseTo(0.5 + 1 / 360);
  });

  it.each([-1, 1])('starts a new hold at center without retaining the latch (%s)', (sign) => {
    vi.useFakeTimers();
    fixture.channel.eq.high = 0.8; fixture.channel.filter = 0.6;
    render(); move(200, 100); key('w'); key('q'); move(0, 100);
    key('w', {}, 'keyup'); key('q', {}, 'keyup'); key('w'); key('q');
    for (let i = 1; i <= 10; i++) {
      move(sign * i, 100);
      expect(fixture.channel.eq.high).toBeCloseTo(0.5 + sign * i / 360);
      expect(fixture.channel.filter).toBeCloseTo(sign * i * 2 / 360);
    }
  });

  it('replaces the baseline and latch after external adjustments during a hold', () => {
    vi.useFakeTimers();
    fixture.channel.eq.high = 0.8; fixture.channel.filter = 0.6;
    render(); move(200, 100); key('w'); key('q'); move(0, 100);
    fixture.channel.eq.high = 0.51; fixture.channel.filter = 0.02;
    move(1, 100);
    expect(fixture.channel.eq.high).toBeCloseTo(0.51 + 1 / 360);
    expect(fixture.channel.filter).toBeCloseTo(0.02 + 2 / 360);
    fixture.channel.eq.high = 0.5; fixture.channel.filter = 0;
    move(2, 100);
    expect(fixture.channel.eq.high).toBeCloseTo(0.5 + 1 / 360);
    expect(fixture.channel.filter).toBeCloseTo(2 / 360);
    fixture.channel.eq.high = 0.8;
    move(3, 100);
    expect(fixture.channel.eq.high).toBeCloseTo(0.8 + 1 / 360);
  });

  it('does not snap channel faders at the midpoint', () => {
    render(); move(200, 100);
    fixture.channel.fader = 0.49;
    key('g'); move(201, 100);
    expect(fixture.channel.fader).toBeCloseTo(0.49 + 1 / 360);
  });

  it.each(['A', 'B', 'C', 'D'] as const)('double-taps invert mixer controls on deck %s', (deck) => {
    vi.useFakeTimers(); fixture.deck = deck; render();
    const keys = DECK_KEYS[deck === 'A' || deck === 'C' ? 'A' : 'B'];
    const doubleTap = (k: string) => {
      key(k); key(k, {}, 'keyup');
      act(() => vi.advanceTimersByTime(100));
      key(k); key(k, {}, 'keyup');
    };
    for (const band of ['high', 'mid', 'low'] as const) {
      fixture.channel.eq[band] = 0.48;
      doubleTap(keys.knobs[band]);
      expect(mixer.setEq).toHaveBeenLastCalledWith(deck, band, 0);
      fixture.channel.eq[band] = 0.02;
      doubleTap(keys.knobs[band]);
      expect(mixer.setEq).toHaveBeenLastCalledWith(deck, band, 0.5);
    }
    for (const value of [-1, -0.02, 0, 0.02, 1]) {
      fixture.channel.filter = value;
      doubleTap(keys.knobs.filter);
      expect(mixer.setFilter).toHaveBeenLastCalledWith(deck, 0);
    }
    fixture.channel.fader = 0.96;
    doubleTap(keys.fader);
    expect(mixer.setFader).toHaveBeenLastCalledWith(deck, 0);
    fixture.channel.fader = 0.04;
    doubleTap(keys.fader);
    expect(mixer.setFader).toHaveBeenLastCalledWith(deck, 1);
  });

  it('does not invert on repeat, a slow pair of taps, a long hold, or a regrip-and-drag', () => {
    vi.useFakeTimers(); render(); move(100, 100);
    key('w'); key('w', { repeat: true }); key('w', {}, 'keyup');
    expect(mixer.setEq).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(400));
    key('w'); key('w', {}, 'keyup');
    expect(mixer.setEq).not.toHaveBeenCalled();
    key('w'); act(() => vi.advanceTimersByTime(300)); key('w', {}, 'keyup');
    expect(mixer.setEq).not.toHaveBeenCalled();
    key('w'); key('w', {}, 'keyup');
    key('w'); move(136, 100); key('w', {}, 'keyup');
    expect(mixer.setEq.mock.calls).toEqual([['A', 'high', 0.6]]);
    key('w'); key('w', {}, 'keyup');
    expect(mixer.setEq).toHaveBeenCalledTimes(1);
  });

  it('keeps double taps per key and clears them on cancellation', () => {
    vi.useFakeTimers(); render();
    key('w'); key('w', {}, 'keyup'); key('e'); key('e', {}, 'keyup');
    expect(mixer.setEq).not.toHaveBeenCalled();
    act(() => { window.dispatchEvent(new Event('blur')); });
    key('w'); key('w', {}, 'keyup');
    expect(mixer.setEq).not.toHaveBeenCalled();
  });

  it.each(['A', 'B', 'C', 'D'] as const)('seeks paused deck %s in both directions', (deck) => {
    vi.useFakeTimers();
    fixture.deck = deck;
    render(); move(100, 100);
    const jog = DECK_KEYS[deck === 'A' || deck === 'C' ? 'A' : 'B'].jog;
    key(jog); move(200, 100);
    expect(engine.seek).toHaveBeenLastCalledWith(30 + mouseSeekDelta(100, 16));
    move(150, 100);
    expect(engine.seek).toHaveBeenLastCalledWith(30 + mouseSeekDelta(-50, 16));
    key(jog, {}, 'keyup'); move(300, 100);
    expect(engine.seek).toHaveBeenCalledTimes(2);
    expect(engine.setBend).not.toHaveBeenCalled();
  });

  it('bends playing audio, springs back when motion stops, and releases on keyup', () => {
    vi.useFakeTimers(); fixture.snapshot.playing = true;
    render(); move(100, 100); key('t'); move(150, 100);
    act(() => vi.advanceTimersByTime(25));
    expect(fixture.snapshot.bendPercent).toBeGreaterThan(0);
    expect(fixture.snapshot.bendPercent).toBeLessThan(0.2);
    expect(engine.seek).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(600));
    expect(engine.setBend).toHaveBeenLastCalledWith(0);
    move(100, 100);
    act(() => vi.advanceTimersByTime(25));
    expect(fixture.snapshot.bendPercent).toBeLessThan(0);
    expect(fixture.snapshot.bendPercent).toBeGreaterThan(-0.2);
    key('t', { metaKey: true }, 'keyup');
    expect(engine.setBend).toHaveBeenLastCalledWith(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels pending bend ticks on pause, then seeks during the same hold', () => {
    vi.useFakeTimers(); fixture.snapshot.playing = true;
    render(); move(100, 100); key('t'); move(150, 100);
    fixture.snapshot.playing = false;
    act(() => fixture.listener());
    act(() => vi.advanceTimersByTime(100));
    expect(engine.setBend).not.toHaveBeenCalled();
    move(200, 100);
    expect(engine.seek).toHaveBeenLastCalledWith(30 + mouseSeekDelta(50, 100));
  });

  it.each(['A', 'B', 'C', 'D'] as const)('Shift+jog holds and moves the platter on deck %s', deck => {
    vi.useFakeTimers(); fixture.deck = deck; render(); move(100, 100);
    const jog = DECK_KEYS[deck === 'A' || deck === 'C' ? 'A' : 'B'].jog;
    key(jog, { shiftKey: true });
    expect(engine.beginScratch).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1000));
    expect(document.querySelector('.keyboard-pointer-row strong')?.textContent).toBe(`${deck} SCRATCH READY`);
    expect(engine.endScratch).not.toHaveBeenCalled();
    move(150, 100); move(130, 100);
    expect(engine.beginScratch).toHaveBeenCalledOnce();
    expect(engine.scratchMove.mock.calls).toEqual([[0.1, 0.1], [-0.04, 0.016]]);
    expect(engine.seek).not.toHaveBeenCalled();
    expect(engine.setBend).not.toHaveBeenCalled();
    expect(document.querySelector('.keyboard-pointer-row strong')?.textContent).toBe(`${deck} SCRATCH`);
    key(jog, { metaKey: true }, 'keyup');
    expect(engine.endScratch).toHaveBeenCalledOnce();
    expect(fixture.snapshot.scratching).toBe(false);
    expect(document.pointerLockElement).toBeNull();
  });

  it('Shift switches a held jog between rim and platter without releasing the pointer', () => {
    vi.useFakeTimers(); fixture.snapshot.playing = true;
    render(); move(100, 100); key('t'); move(150, 100);
    act(() => vi.advanceTimersByTime(25));
    expect(fixture.snapshot.bendPercent).toBeGreaterThan(0);
    key('Shift', { shiftKey: true });
    expect(fixture.snapshot.bendPercent).toBe(0);
    expect(fixture.snapshot.playing).toBe(true);
    expect(engine.beginScratch).not.toHaveBeenCalled();
    key('Shift', { shiftKey: true, repeat: true });
    expect(engine.beginScratch).not.toHaveBeenCalled();
    move(180, 100);
    expect(engine.beginScratch).toHaveBeenCalledOnce();
    expect(engine.scratchMove).toHaveBeenCalledOnce();
    key('Shift', {}, 'keyup');
    expect(engine.endScratch).toHaveBeenCalledOnce();
    expect(document.pointerLockElement).not.toBeNull();
    move(200, 100);
    act(() => vi.advanceTimersByTime(25));
    expect(fixture.snapshot.bendPercent).toBeGreaterThan(0);
    expect(engine.scratchMove).toHaveBeenCalledTimes(1);
    key('t', {}, 'keyup');
    expect(fixture.snapshot.bendPercent).toBe(0);
  });

  it.each(['escape', 'blur', 'focus', 'view', 'layer', 'load', 'transport', 'engine end', 'unmount'])(
    'releases owned scratch on %s and never restarts from stale mouse movement', reason => {
      vi.useFakeTimers(); fixture.snapshot.playing = true;
      render(); move(100, 100); key('t', { shiftKey: true });
      move(110, 100);
      engine.scratchMove.mockClear();
      const input = document.createElement('input');
      document.body.append(input);
      if (reason === 'escape') key('Escape');
      if (reason === 'blur') act(() => { window.dispatchEvent(new Event('blur')); });
      if (reason === 'focus') act(() => input.focus());
      if (reason === 'view') render(false);
      if (reason === 'layer') { fixture.deck = 'C'; render(); }
      if (reason === 'load') { fixture.snapshot.loadState = 'fetching'; act(() => fixture.listener()); }
      if (reason === 'transport') act(() => fixture.transportListener({ action: 'jumpBeats' }));
      if (reason === 'engine end') { fixture.snapshot.scratching = false; act(() => fixture.listener()); }
      if (reason === 'unmount') act(() => root.render(null));
      expect(engine.endScratch).toHaveBeenCalledTimes(reason === 'engine end' ? 0 : 1);
      expect(fixture.snapshot.scratching).toBe(false);
      key('t', { shiftKey: true, repeat: true }); move(150, 100);
      act(() => vi.advanceTimersByTime(500));
      expect(engine.scratchMove).not.toHaveBeenCalled();
      expect(engine.seek).not.toHaveBeenCalled();
      expect(fixture.snapshot.bendPercent).toBe(0);
      input.remove();
    }
  );

  it('respects Vinyl off and never releases a foreign platter hold', () => {
    render(); move(100, 100); fixture.snapshot.vinylMode = false;
    key('t', { shiftKey: true }); move(150, 100);
    expect(engine.beginScratch).not.toHaveBeenCalled();
    expect(engine.seek).toHaveBeenCalledOnce();
    key('t', {}, 'keyup'); engine.seek.mockClear();
    fixture.snapshot.vinylMode = true; fixture.snapshot.scratching = true;
    key('t', { shiftKey: true }); move(200, 100); key('t', {}, 'keyup');
    expect(engine.beginScratch).not.toHaveBeenCalled();
    expect(engine.scratchMove).not.toHaveBeenCalled();
    expect(engine.endScratch).not.toHaveBeenCalled();
    expect(engine.seek).not.toHaveBeenCalled();
  });

  it('Shift+jog preserves playback until the first horizontal movement', () => {
    vi.useFakeTimers(); fixture.snapshot.playing = true;
    render(); move(100, 100); key('t', { shiftKey: true });
    act(() => vi.advanceTimersByTime(1000));
    move(100, 120);
    expect(fixture.snapshot.playing).toBe(true);
    expect(fixture.snapshot.scratching).toBe(false);
    expect(engine.beginScratch).not.toHaveBeenCalled();
    expect(engine.seek).not.toHaveBeenCalled();
    key('t', {}, 'keyup');
    expect(engine.endScratch).not.toHaveBeenCalled();
  });

  it('applies live tuning without releasing or recreating the held jog', () => {
    vi.useFakeTimers(); fixture.snapshot.playing = true;
    render(); move(100, 100); key('t');
    const lock = document.pointerLockElement;
    let x = 100;
    for (let i = 0; i < 40; i++) move(x += 4, 100);
    const before = fixture.snapshot.bendPercent;
    act(() => setMouseJogSettings({ sensitivity: 6 }));
    render();
    for (let i = 0; i < 40; i++) move(x += 4, 100);
    expect(fixture.snapshot.bendPercent).toBeGreaterThan(before * 5);
    expect(document.pointerLockElement).toBe(lock);
    expect(engine.beginScratch).not.toHaveBeenCalled();
    key('t', {}, 'keyup');
    expect(fixture.snapshot.bendPercent).toBe(0);
  });

  it('leaves external cue/bend state untouched on layout or view changes', () => {
    render();
    fixture.deck = 'C'; render();
    render(false);
    expect(engine.cueUp).not.toHaveBeenCalled();
    expect(engine.setBend).not.toHaveBeenCalled();
  });

  it('resets on-screen nudge bends on blur even without a keyboard jog', () => {
    render();
    act(() => { window.dispatchEvent(new Event('blur')); });
    expect(engine.setBend).toHaveBeenLastCalledWith(0);
  });

  it('disarms mouse gestures on a same-track reload', () => {
    render(); move(100, 100); key('q'); key('t');
    fixture.snapshot.loadState = 'fetching';
    act(() => fixture.listener());
    fixture.snapshot.loadState = 'ready';
    act(() => fixture.listener());
    move(150, 50); move(200, 0);
    expect(engine.seek).not.toHaveBeenCalled();
    expect(mixer.setFilter).not.toHaveBeenCalled();
  });

  it('keeps adjusting when the cursor crosses an unfocused text field', () => {
    render(); move(100, 100); key('q');
    const input = document.createElement('input');
    document.body.append(input);
    act(() => {
      const event = new MouseEvent('mousemove', { clientX: 100, clientY: 100, bubbles: true });
      Object.defineProperties(event, { movementX: { value: 0 }, movementY: { value: -36 } });
      input.dispatchEvent(event);
    });
    expect(mixer.setFilter).toHaveBeenLastCalledWith('A', 0.2);
    input.remove();
  });

  it.each(['blur', 'hidden view', 'focus', 'layer', 'track', 'reload', 'modifier', 'escape', 'keyup', 'unmount'])(
    'releases all mouse holds on %s', (reason) => {
    vi.useFakeTimers(); fixture.snapshot.playing = true;
    fixture.channel.filter = -0.1;
    render(); move(100, 100); key('q'); key('t'); move(150, 85);
    expect(fixture.channel.filter).toBe(0);
    act(() => vi.advanceTimersByTime(25));
    const input = document.createElement('input');
    document.body.append(input);
    if (reason === 'blur') act(() => { window.dispatchEvent(new Event('blur')); });
    if (reason === 'hidden view') render(false);
    if (reason === 'focus') act(() => input.focus());
    if (reason === 'layer') { fixture.deck = 'C'; render(); }
    if (reason === 'track') { fixture.trackId = 8; render(); }
    if (reason === 'reload') {
      fixture.snapshot.loadState = 'fetching';
      act(() => fixture.listener());
      fixture.snapshot.loadState = 'ready';
      act(() => fixture.listener());
    }
    if (reason === 'modifier') key('Meta', { metaKey: true });
    if (reason === 'escape') key('Escape');
    if (reason === 'keyup') { key('q', {}, 'keyup', input); key('t', {}, 'keyup', input); }
    if (reason === 'unmount') act(() => root.render(null));
    expect(engine.setBend).toHaveBeenLastCalledWith(0);
    act(() => vi.advanceTimersByTime(1));
    expect(vi.getTimerCount()).toBe(0);
    mixer.setFilter.mockClear();
    key('q', { repeat: true });
    move(150, 50); move(150, 0);
    expect(mixer.setFilter).not.toHaveBeenCalled();
    input.remove();
    render(); key('q'); move(151, 0);
    expect(fixture.channel.filter).toBeCloseTo(2 / 360);
  });

  it.each([{ metaKey: true }, { ctrlKey: true }, { altKey: true }])('ignores modifier mouse holds: %j', (modifier) => {
    render(); move(100, 100);
    key('q', modifier); key('t', modifier); move(150, 50);
    expect(mixer.setFilter).not.toHaveBeenCalled();
    expect(engine.seek).not.toHaveBeenCalled();
  });

  it('ignores text entry but allows mixer setup without a ready track', () => {
    fixture.snapshot.loadState = 'fetching';
    render(); move(100, 100);
    const input = document.createElement('input');
    document.body.append(input);
    key('q', {}, 'keydown', input); key('a', { metaKey: true }, 'keydown', input);
    move(150, 50);
    expect(mixer.setFilter).not.toHaveBeenCalled();
    expect(hotCues.walk).not.toHaveBeenCalled();
    key('q'); key('t'); move(150, 14);
    expect(mixer.setFilter).toHaveBeenLastCalledWith('A', 0.2);
    expect(engine.seek).not.toHaveBeenCalled();
    input.remove();
  });

  it.each(['A', 'B', 'C', 'D'] as const)('walks hotcues on %s with Cmd, without beatjump fallthrough or repeat', (deck) => {
    fixture.deck = deck; render();
    const keys = DECK_KEYS[deck === 'A' || deck === 'C' ? 'A' : 'B'];
    expect(key(keys.jumpBack, { metaKey: true }).defaultPrevented).toBe(true);
    expect(key(keys.jumpForward, { metaKey: true }).defaultPrevented).toBe(true);
    key(keys.jumpForward, { metaKey: true, repeat: true });
    expect(hotCues.walk.mock.calls).toEqual([['prev'], ['next']]);
    expect(engine.jumpBeats).not.toHaveBeenCalled();
  });

  it('claims cue chords while playing, but walks only while paused and active', () => {
    fixture.snapshot.playing = true; render();
    expect(key('a', { metaKey: true }).defaultPrevented).toBe(true);
    expect(hotCues.walk).not.toHaveBeenCalled();
    fixture.snapshot.playing = false; render(false);
    expect(key('a', { metaKey: true }).defaultPrevented).toBe(false);
    expect(hotCues.walk).not.toHaveBeenCalled();
    render();
    key('a', { ctrlKey: true }); key('a', { metaKey: true, altKey: true });
    key('a', { metaKey: true, shiftKey: true });
    expect(hotCues.walk).not.toHaveBeenCalled();
  });
});
