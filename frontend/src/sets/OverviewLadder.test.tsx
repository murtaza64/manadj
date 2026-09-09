// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setFollowPlayback } from './conductorStore';
import { OverviewLadder } from './OverviewLadder';
import { planSet } from './planner';
import { getLadderView, setLadderView } from './setStore';

const conductor = vi.hoisted(() => ({ getMixTime: vi.fn<() => number>() }));
vi.mock('./conductorStore', () => ({
  getConductor: () => conductor,
  setFollowPlayback: vi.fn(),
}));
vi.mock('../waveform/useWaveformBlob', () => ({
  useWaveformBlob: () => ({ data: undefined }),
}));

const plan = planSet({
  entries: Array.from({ length: 12 }, (_, i) => ({ trackId: i + 1, pin: null })),
  tracks: Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [
      i + 1,
      { durationSec: 300, bpm: 120, hotCue1Sec: null },
    ]),
  ),
  transitionsByUuid: {},
  takesByUuid: {},
});

let root: Root;
let container: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>;
let now: number;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  frames = new Map();
  now = 1000;
  let nextFrameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrameId, callback);
    return nextFrameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  conductor.getMixTime.mockReset();
  vi.mocked(setFollowPlayback).mockClear();
  setLadderView(1, { zoom: 6, scrollLeft: 0 });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mountLadder() {
  act(() =>
    root.render(
      <OverviewLadder
        setId={1}
        plan={plan}
        tracks={new Map()}
        hotCuesByTrack={new Map()}
        conducting
        follow
        onSeek={(time) => conductor.getMixTime.mockReturnValue(time)}
      />,
    ),
  );
  const outer = container.firstElementChild!.firstElementChild as HTMLDivElement;
  const inner = outer.firstElementChild as HTMLDivElement;
  // One pixel per mix second; the viewport shows ten minutes of a one-hour Set.
  Object.defineProperties(outer, {
    clientWidth: { value: 600 },
    scrollWidth: { value: 3600 },
  });
  Object.defineProperty(inner, 'clientWidth', { value: 3600 });

  let pendingLeft: number | null = null;
  const scrollTo = vi.fn((options: ScrollToOptions) => {
    const left = Math.max(0, Math.min(3000, options.left ?? outer.scrollLeft));
    if (options.behavior === 'smooth') pendingLeft = left;
    else {
      pendingLeft = null;
      outer.scrollLeft = left;
      outer.dispatchEvent(new Event('scroll'));
    }
  });
  Object.defineProperty(outer, 'scrollTo', { value: scrollTo });

  function frame(time: number, elapsedMs = 16) {
    act(() => {
      now += elapsedMs;
      conductor.getMixTime.mockReturnValue(time);
      // A smooth request only sets a destination. Later frames make partial
      // progress, leaving the playhead offscreen while the browser animates.
      if (pendingLeft !== null) {
        const delta = pendingLeft - outer.scrollLeft;
        outer.scrollLeft += Math.sign(delta) * Math.min(100, Math.abs(delta));
        outer.dispatchEvent(new Event('scroll'));
        if (outer.scrollLeft === pendingLeft) {
          pendingLeft = null;
          outer.dispatchEvent(new Event('scrollend'));
        }
      }
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback(now);
    });
  }
  function interruptScroll(left: number) {
    act(() => {
      pendingLeft = null;
      outer.scrollLeft = left;
      outer.dispatchEvent(new Event('scroll'));
      outer.dispatchEvent(new Event('scrollend'));
    });
  }
  return { outer, scrollTo, frame, interruptScroll };
}

describe('OverviewLadder zoom', () => {
  it.each([
    { ctrlKey: true, metaKey: false, sensitivity: 0.01 },
    { ctrlKey: false, metaKey: true, sensitivity: 0.01 },
    { ctrlKey: false, metaKey: false, sensitivity: 0.002 },
  ])('uses $sensitivity sensitivity for ctrl=$ctrlKey meta=$metaKey', (modifiers) => {
    const { outer } = mountLadder();
    conductor.getMixTime.mockReturnValue(100);
    for (const deltaY of [-10, 10]) {
      const before = getLadderView(1)!.zoom;
      const event = new WheelEvent('wheel', { deltaY, ...modifiers, cancelable: true });
      act(() => outer.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(true);
      expect(getLadderView(1)!.zoom).toBeCloseTo(before * Math.exp(-deltaY * modifiers.sensitivity));
    }
    expect(getLadderView(1)!.zoom).toBeCloseTo(6);
    expect(setFollowPlayback).not.toHaveBeenCalled();
  });
});

describe('OverviewLadder follow playback', () => {
  it.each(['initial play', 'seek'] as const)(
    'centers a far-off %s once without repaging during the smooth pan',
    (action) => {
      const { outer, scrollTo, frame } = mountLadder();
      if (action === 'seek') {
        frame(100);
        expect(scrollTo).not.toHaveBeenCalled();
      }

      frame(2700);
      expect(scrollTo).toHaveBeenCalledTimes(1);
      expect(scrollTo).toHaveBeenLastCalledWith({ left: 2400, behavior: 'smooth' });
      expect(outer.scrollLeft).toBe(0);

      for (let i = 1; i <= 8; i++) frame(2700 + i * 0.016);
      expect(outer.scrollLeft).toBe(800);
      expect(scrollTo).toHaveBeenCalledTimes(1);
    },
  );

  it('lets a new explicit seek supersede an unfinished pan without repaging it', () => {
    const { outer, scrollTo, frame } = mountLadder();
    frame(100);
    frame(2700);
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ left: 2400, behavior: 'smooth' });
    expect(outer.scrollLeft).toBe(0);

    // Seek again before the first pan has reached its destination.
    frame(1500);
    expect(outer.scrollLeft).toBe(100);
    expect(scrollTo).toHaveBeenCalledTimes(2);
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 1200, behavior: 'smooth' });

    for (let i = 1; i <= 4; i++) frame(1500 + i * 0.016);
    expect(outer.scrollLeft).toBe(500);
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it('pages once through a slow pan exceeding 700ms, then pages again after scrollend', () => {
    const { outer, scrollTo, frame } = mountLadder();
    const scrollEnd = vi.fn();
    outer.addEventListener('scrollend', scrollEnd);
    frame(468);
    expect(scrollTo).not.toHaveBeenCalled();
    frame(470);
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({
      left: expect.closeTo(380, 6), behavior: 'smooth',
    });

    for (let i = 1; i <= 4; i++) frame(470 + i * 0.8, 800);
    expect(outer.scrollLeft).toBeCloseTo(380, 6);
    expect(scrollEnd).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(setFollowPlayback).not.toHaveBeenCalled();

    // Continuous playback crosses the next page boundary, not a seek jump.
    for (let time = 474; time <= 850; time += 2) frame(time);
    expect(scrollTo).toHaveBeenCalledTimes(2);
    expect(scrollTo).toHaveBeenLastCalledWith({
      left: expect.closeTo(760, 6), behavior: 'smooth',
    });
    expect(setFollowPlayback).not.toHaveBeenCalled();
  });

  it('disengages follow when native scrolling interrupts a pan before its destination', () => {
    const { outer, scrollTo, frame, interruptScroll } = mountLadder();
    frame(2700);
    frame(2700.016);
    expect(outer.scrollLeft).toBe(100);
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ left: 2400, behavior: 'smooth' });
    expect(setFollowPlayback).not.toHaveBeenCalled();

    interruptScroll(80);
    expect(setFollowPlayback).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('clamps a pan at the Set end without repeating unreachable or no-op requests', () => {
    const { outer, scrollTo, frame } = mountLadder();
    frame(3599);
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ left: 3000, behavior: 'smooth' });

    for (let i = 1; i <= 40; i++) frame(3599 + i * 0.016);
    expect(outer.scrollLeft).toBe(3000);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(setFollowPlayback).not.toHaveBeenCalled();
  });

  it.each([400, 650])('instantly cancels an unfinished pan for an in-viewport seek to %ss', (time) => {
    const { outer, scrollTo, frame } = mountLadder();
    frame(2700);
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ left: 2400, behavior: 'smooth' });

    // The next animation step puts the visible range at [100, 700].
    frame(time);
    expect(outer.scrollLeft).toBe(100);
    expect(scrollTo).toHaveBeenNthCalledWith(2, { left: 100, behavior: 'instant' });
    expect(scrollTo).toHaveBeenCalledTimes(2);
    expect(setFollowPlayback).not.toHaveBeenCalled();
  });
});
