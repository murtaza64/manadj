import { describe, expect, it } from 'vitest';
import {
  explicitSwitch,
  HOLD_TAP_MS,
  initialModeState,
  modeKeyDown,
  modeKeyUp,
} from './editorMode';

describe('editor mode machine (ADR 0038)', () => {
  it('defaults to select (the home mode)', () => {
    expect(initialModeState().mode).toBe('select');
  });

  it('V/J switch sticky modes', () => {
    let s = initialModeState();
    s = modeKeyDown(s, 'j', 0);
    expect(s.mode).toBe('jump');
    s = modeKeyDown(s, 'v', 10);
    expect(s.mode).toBe('select');
  });

  it('ignores unbound keys and key repeat', () => {
    let s = initialModeState();
    expect(modeKeyDown(s, 'x', 0)).toBe(s);
    s = modeKeyDown(s, 'h', 0);
    const repeated = modeKeyDown(s, 'h', 50, true);
    expect(repeated).toBe(s);
  });

  it('tap H = sticky pan', () => {
    let s = initialModeState();
    s = modeKeyDown(s, 'h', 0);
    expect(s.mode).toBe('pan');
    s = modeKeyUp(s, 'h', HOLD_TAP_MS - 1);
    expect(s.mode).toBe('pan');
    expect(s.holdDownAt).toBeNull();
  });

  it('hold H = momentary pan, reverting to the prior mode on release', () => {
    let s = initialModeState();
    s = modeKeyDown(s, 'j', 0);
    s = modeKeyDown(s, 'h', 100);
    expect(s.mode).toBe('pan');
    s = modeKeyUp(s, 'h', 100 + HOLD_TAP_MS + 1);
    expect(s.mode).toBe('jump');
  });

  it('H while already sticky-pan is a no-op (nothing to return to)', () => {
    let s = initialModeState();
    s = modeKeyDown(s, 'h', 0);
    s = modeKeyUp(s, 'h', 10); // tap → sticky pan
    const again = modeKeyDown(s, 'h', 500);
    expect(again).toBe(s);
    // A long release with no pending hold changes nothing.
    expect(modeKeyUp(again, 'h', 2000).mode).toBe('pan');
  });

  it('explicit switch during a hold cancels the revert', () => {
    let s = initialModeState();
    s = modeKeyDown(s, 'h', 0); // holding from select
    s = modeKeyDown(s, 'j', 50); // mind changed mid-hold
    expect(s.mode).toBe('jump');
    s = modeKeyUp(s, 'h', 1000); // late release must not undo it
    expect(s.mode).toBe('jump');
  });

  it('toolbar (explicitSwitch) clears any pending hold', () => {
    let s = initialModeState();
    s = modeKeyDown(s, 'h', 0);
    s = explicitSwitch(s, 'select');
    expect(s.mode).toBe('select');
    expect(modeKeyUp(s, 'h', 1000).mode).toBe('select');
  });
});
