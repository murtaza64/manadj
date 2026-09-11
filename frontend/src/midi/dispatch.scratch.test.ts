import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetAudibleSurfacesForTests, claimAudible, registerSurface, unregisterSurface,
} from '../playback/audibleSurface';
import type { SurfaceJog } from '../playback/audibleSurface';
import type { ChannelId } from '../playback/mixer';
import { dispatchMidiAction, forgetHardwareState } from './dispatch';
import { JogController } from './jog';
import { GRV6_JOG_CALIBRATION as calibration } from './jogCalibration';
import { DDJ_GRV6 } from './mappings/ddjGrv6';
import { initialDecoderState, translateMidiMessage } from './translator';

describe('surface-routed GRV6 contact lifecycle', () => {
  let decoder = initialDecoderState();
  let jog: SurfaceJog;
  let controller: JogController;
  let active: boolean;
  const begin = vi.fn();
  const move = vi.fn();
  const end = vi.fn();
  const bend = vi.fn();
  const rate = vi.fn(() => 0);

  const message = (status: number, number: number, value: number) => {
    const result = translateMidiMessage([status, number, value], decoder, DDJ_GRV6);
    decoder = result.state;
    result.actions.forEach(dispatchMidiAction);
  };
  const touch = (held: boolean, shifted = false) => message(0x90, shifted ? 103 : 54, held ? 127 : 0);
  const ticks = (number = 34) => message(0xb0, number, 44);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    decoder = initialDecoderState();
    active = false;
    rate.mockReturnValue(0);
    begin.mockImplementation(() => { active = true; });
    end.mockImplementation(() => { active = false; });
    controller = new JogController({
      isPlaying: () => true, getPlayhead: () => 60, seek: vi.fn(), setBend: bend,
      scratch: { isActive: () => active, vinylMode: () => true, begin, move, end, rate },
    });
    jog = {
      rimTicks: vi.fn((_deck, n, profile, off) => controller.onTicks(n, undefined, calibration, profile, off)),
      touchTicks: vi.fn((_deck, n, profile) => controller.onTouchTicks(n, undefined, calibration, profile)),
      shiftRimTicks: vi.fn((_deck, n) => controller.onSeekTicks(n, undefined, calibration)),
      touch: vi.fn((_deck, held) => controller.onTouch(held)),
      cancel: vi.fn(() => controller.cancel()),
    };
    registerSurface('shared', { transport: { togglePlay: vi.fn() }, jog, silence: vi.fn() });
    registerSurface('editor', { transport: { togglePlay: vi.fn() }, silence: vi.fn() });
  });

  afterEach(() => {
    forgetHardwareState();
    controller.dispose();
    _resetAudibleSurfacesForTests();
    vi.useRealTimers();
  });

  it('routes edges and movement through the holder and drops touch on unsupported surfaces', () => {
    touch(true);
    ticks();
    expect(jog.touch).toHaveBeenCalledWith('A', true);
    expect(begin).toHaveBeenCalledOnce();
    expect(move).toHaveBeenCalledOnce();
    claimAudible('editor');
    expect(active).toBe(false);
    touch(false);
    touch(true);
    ticks();
    expect(begin).toHaveBeenCalledOnce();
    expect(move).toHaveBeenCalledOnce();
  });

  it('pins release/cancel to the original recipient when the holder changes', () => {
    const editorTouch = vi.fn();
    const editorCancel = vi.fn();
    registerSurface('editor', {
      transport: { togglePlay: vi.fn() }, silence: vi.fn(),
      jog: { rimTicks: vi.fn(), touchTicks: vi.fn(), shiftRimTicks: vi.fn(), touch: editorTouch, cancel: editorCancel },
    });
    touch(true);
    claimAudible('editor', { silencePrevious: false });
    expect(end).toHaveBeenCalledOnce();
    touch(false);
    forgetHardwareState();
    expect(editorTouch).not.toHaveBeenCalled();
    expect(editorCancel).not.toHaveBeenCalled();
    expect(jog.touch).toHaveBeenLastCalledWith('A', false);
  });

  it.each(['replace', 'unregister'] as const)('cancels contact on surface %s', (action) => {
    touch(true);
    if (action === 'replace') registerSurface('shared', { transport: { togglePlay: vi.fn() }, silence: vi.fn() });
    else unregisterSurface('shared');
    expect(end).toHaveBeenCalledOnce();
    expect(active).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([18, 16])('grid chord pad %s consumes contact and ticks, including contact begun first', (pad) => {
    touch(true);
    message(0x97, pad, 127);
    expect(end).toHaveBeenCalledOnce();
    touch(false);
    touch(true);
    ticks();
    ticks(33);
    ticks(35);
    expect(begin).toHaveBeenCalledOnce();
    expect(move).not.toHaveBeenCalled();
    expect(jog.rimTicks).not.toHaveBeenCalled();
    message(0x97, pad, 0);
    ticks(); // Still touching does not create a new hold after the chord.
    expect(move).not.toHaveBeenCalled();
    touch(false);
    touch(true);
    expect(begin).toHaveBeenCalledTimes(2);
  });

  it('unplug cancels stationary holds, released rotation and ordinary bends', () => {
    touch(true);
    forgetHardwareState();
    expect(end).toHaveBeenCalledOnce();
    touch(false);
    touch(true);
    ticks();
    touch(false);
    forgetHardwareState();
    expect(end).toHaveBeenCalledTimes(2);
    ticks(33);
    vi.advanceTimersByTime(25);
    expect(bend).not.toHaveBeenLastCalledWith(0);
    forgetHardwareState();
    expect(bend).toHaveBeenLastCalledWith(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('layer deselection cancels that deck and rearms translator contact state', () => {
    touch(true);
    ticks();
    touch(false);
    message(0x90, 60, 0); // No selected-down need have been observed.
    expect(end).toHaveBeenCalledOnce();
    expect(jog.cancel).toHaveBeenLastCalledWith('A');
    expect(vi.getTimerCount()).toBe(0);
    touch(true);
    message(0x92, 60, 0); // C's deselection cannot cancel A.
    expect(active).toBe(true);
    message(0x90, 60, 0);
    expect(active).toBe(false);
    touch(true); // Missing hardware touch-up cannot leave note 54 dedup stuck.
    expect(active).toBe(true);
  });

  it('shifted contact never starts scratching, and shifted release ends a normal hold', () => {
    touch(true, true);
    ticks(41);
    touch(false, true);
    expect(begin).not.toHaveBeenCalled();
    touch(true);
    expect(active).toBe(true);
    touch(false, true);
    expect(active).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    touch(true);
    expect(begin).toHaveBeenCalledTimes(2);
    touch(true, true);
    expect(active).toBe(false);
  });

  it('hardware Vinyl-off rotation terminates stale contact while ordinary rim keeps it held', () => {
    touch(true);
    ticks(33);
    expect(move).toHaveBeenCalledOnce();
    ticks(35);
    expect(active).toBe(false);
    vi.advanceTimersByTime(25);
    expect(bend).toHaveBeenCalled();
  });

  it('shift seek cancels once, not on each tick of the accelerated seek stream', () => {
    touch(true);
    ticks();
    touch(false);
    const count = vi.mocked(jog.cancel!).mock.calls.length;
    ticks(41);
    ticks(38);
    expect(jog.cancel).toHaveBeenCalledTimes(count + 1);
    expect(jog.shiftRimTicks).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('re-touch holds the same released spin without cutting pending motion or relatching Slip', () => {
    rate.mockReturnValue(-3);
    touch(true);
    vi.advanceTimersByTime(20);
    ticks();
    touch(false);
    vi.advanceTimersByTime(1);
    touch(true);
    expect(end).not.toHaveBeenCalled();
    expect(begin).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1_000);
    expect(active).toBe(true);
    touch(false);
    expect(end).toHaveBeenCalledOnce();
  });

  it('cancels a scratch when begin synchronously displaces the surface', () => {
    begin.mockImplementation(() => {
      active = true;
      claimAudible('editor');
    });
    touch(true);
    expect(active).toBe(false);
    expect(end).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('routes four logical deck contacts without falling back to shared decks', () => {
    const contacts = vi.fn();
    registerSurface('editor', {
      transport: { togglePlay: vi.fn() }, silence: vi.fn(),
      jog: { rimTicks: vi.fn(), touchTicks: vi.fn(), shiftRimTicks: vi.fn(), touch: contacts },
    });
    claimAudible('editor');
    for (let channel = 0; channel < 4; channel++) message(0x90 | channel, 54, 127);
    expect(contacts.mock.calls).toEqual((['A', 'B', 'C', 'D'] as ChannelId[]).map((deck) => [deck, true]));
    expect(begin).not.toHaveBeenCalled();
  });
});
