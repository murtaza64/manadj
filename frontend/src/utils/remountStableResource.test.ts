// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { StrictMode, createElement, useEffect } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { RemountStableResource } from './remountStableResource';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('RemountStableResource', () => {
  it('reuses one resource across the StrictMode setup-cleanup-setup cycle', async () => {
    const create = vi.fn(() => ({ id: crypto.randomUUID() }));
    const destroy = vi.fn();
    const lease = new RemountStableResource(create, destroy);

    const first = lease.mount();
    lease.unmount();
    const second = lease.mount();
    await Promise.resolve();

    expect(second).toBe(first);
    expect(create).toHaveBeenCalledTimes(1);
    expect(destroy).not.toHaveBeenCalled();

    lease.unmount();
    await Promise.resolve();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('creates one resource when a real effect mounts under StrictMode', async () => {
    const create = vi.fn(() => ({}));
    const destroy = vi.fn();
    const lease = new RemountStableResource(create, destroy);
    const host = document.createElement('div');
    const root = createRoot(host);

    function Owner() {
      useEffect(() => {
        lease.mount();
        return () => lease.unmount();
      }, []);
      return null;
    }

    await act(async () => {
      root.render(createElement(StrictMode, null, createElement(Owner)));
      await Promise.resolve();
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(destroy).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    expect(destroy).toHaveBeenCalledOnce();
  });
});
