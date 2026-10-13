// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.hoisted(() => {
  const values = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
    key: (i: number) => [...values.keys()][i] ?? null,
    get length() {
      return values.size;
    },
  };
});

import { getCueMode, setCueMode } from '../../playback/cueModeStore';
import { CUE_MODE_GUIDE_ID } from './CueModeGuide';
import '../allGuides';
import { getGuide, setGuideStatus } from '../guides';

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));
  setCueMode('gated');
  setGuideStatus(CUE_MODE_GUIDE_ID, 'not-started');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function button(name: string): HTMLButtonElement {
  const b = [...host.querySelectorAll('button')].find((el) => el.textContent?.includes(name));
  if (!b) throw new Error(`no button ${name}`);
  return b;
}

function Guide(props: { onDone: () => void; onSkip: () => void }) {
  const { Component } = getGuide(CUE_MODE_GUIDE_ID)!;
  return <Component {...props} />;
}

describe('Cue mode guide', () => {
  it('registers per the contract', () => {
    const guide = getGuide(CUE_MODE_GUIDE_ID);
    expect(guide).toMatchObject({ title: 'Cue mode', order: 30 });
    expect(guide!.status()).toBe('not-started');
  });

  it('choosing Trigger and continuing sets the mode and marks done', () => {
    const onDone = vi.fn();
    const onSkip = vi.fn();
    act(() => root.render(<Guide onDone={onDone} onSkip={onSkip} />));
    act(() => button('Trigger').click());
    expect(getCueMode()).toBe('trigger');
    expect(button('Trigger').getAttribute('aria-checked')).toBe('true');
    act(() => button('Continue').click());
    expect(onDone).toHaveBeenCalledOnce();
    expect(onSkip).not.toHaveBeenCalled();
    expect(getGuide(CUE_MODE_GUIDE_ID)!.status()).toBe('done');
  });

  it('skip marks skipped and leaves the mode Gated', () => {
    const onSkip = vi.fn();
    act(() => root.render(<Guide onDone={vi.fn()} onSkip={onSkip} />));
    act(() => button('Skip').click());
    expect(onSkip).toHaveBeenCalledOnce();
    expect(getCueMode()).toBe('gated');
    expect(getGuide(CUE_MODE_GUIDE_ID)!.status()).toBe('skipped');
  });

});
