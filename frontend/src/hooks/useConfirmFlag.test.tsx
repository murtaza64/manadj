// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { useConfirmFlag, CONFIRM_DISARM_MS } from './useConfirmFlag';

// Minimal hook harness (no testing-library in this repo): render a probe
// component and publish the hook's latest return value from an effect.
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function renderConfirmFlag(disarmMs?: number) {
  const result = { current: null as unknown as ReturnType<typeof useConfirmFlag> };
  function Probe() {
    const value = useConfirmFlag(disarmMs);
    useEffect(() => {
      result.current = value;
    });
    return null;
  }
  const container = document.createElement('div');
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(<Probe />);
  });
  return { result, unmount: () => act(() => root.unmount()) };
}

describe('useConfirmFlag (two-step confirm with timeout disarm)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts disarmed; first fire arms without confirming', () => {
    const { result, unmount } = renderConfirmFlag();
    expect(result.current.armed).toBe(false);
    let fired = true;
    act(() => {
      fired = result.current.fire();
    });
    expect(fired).toBe(false);
    expect(result.current.armed).toBe(true);
    unmount();
  });

  it('second fire within the window confirms and disarms', () => {
    const { result, unmount } = renderConfirmFlag();
    act(() => void result.current.fire());
    let fired = false;
    act(() => {
      fired = result.current.fire();
    });
    expect(fired).toBe(true);
    expect(result.current.armed).toBe(false);
    unmount();
  });

  it('auto-disarms after the timeout — the next fire arms again', () => {
    const { result, unmount } = renderConfirmFlag();
    act(() => void result.current.fire());
    act(() => vi.advanceTimersByTime(CONFIRM_DISARM_MS));
    expect(result.current.armed).toBe(false);
    let fired = true;
    act(() => {
      fired = result.current.fire();
    });
    expect(fired).toBe(false);
    unmount();
  });

  it('stays armed just under the window', () => {
    const { result, unmount } = renderConfirmFlag(3000);
    act(() => void result.current.fire());
    act(() => vi.advanceTimersByTime(2999));
    expect(result.current.armed).toBe(true);
    unmount();
  });

  it('disarm() resets an armed flag', () => {
    const { result, unmount } = renderConfirmFlag();
    act(() => void result.current.fire());
    act(() => result.current.disarm());
    expect(result.current.armed).toBe(false);
    unmount();
  });
});
