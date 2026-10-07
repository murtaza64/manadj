// @vitest-environment jsdom
// Setup framework (#288): sequence host status transitions and the
// Settings → Setup section (status list, single-guide relaunch, full
// re-run). Guides are faked at the registry seam.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';

vi.mock('./allGuides', () => ({})); // keep the real Rekordbox guide out
vi.mock('../settings/persistedSettings', () => ({
  writeSetting: (k: string, v: string) => localStorage.setItem(k, v),
}));

import { guideStatus, registerGuide, saveSetupJourney, setupJourney, setGuideStatus, type GuideProps, type SetupGuide } from './guides';
import { SetupSequence } from './SetupSequence';
import { SetupOverlay } from './SetupOverlay';
import SetupSettings from './SetupSettings';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function fakeGuide(id: string, order: number): SetupGuide {
  return {
    id,
    title: `Guide ${id}`,
    order,
    status: () => guideStatus(id),
    Component: ({ onDone, onSkip }: GuideProps) => (
      <div data-testid={`guide-${id}`}>
        <button onClick={onDone}>done {id}</button>
        <button onClick={onSkip}>skip {id}</button>
      </div>
    ),
  };
}

function fakeStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (k: string) => values.get(k) ?? null,
    key: (i: number) => [...values.keys()][i] ?? null,
    removeItem: (k: string) => void values.delete(k),
    setItem: (k: string, v: string) => void values.set(k, v),
  };
}

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeStorage());
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function click(label: string) {
  const b = [...container.querySelectorAll('button')].find((el) => el.textContent === label);
  if (!b) throw new Error(`no button "${label}" in: ${container.textContent}`);
  act(() => b.click());
}

describe('SetupSequence', () => {
  it('keeps Tab inside when a loading guide leaves only a header button', () => {
    const guide = fakeGuide('loading', 1);
    guide.Component = () => <p role="status">Loading</p>;
    act(() => root.render(<SetupOverlay onClose={vi.fn()}><SetupSequence guides={[guide]} onFinish={vi.fn()} /></SetupOverlay>));
    const body = container.querySelector<HTMLElement>('.setup-sequence-body')!;
    body.focus();
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
    expect(document.activeElement?.textContent).toBe('Finish later');
  });
  it('keeps the six-step host visible while an external guide loads lazily', async () => {
    let resolve: (value: { default: SetupGuide['Component'] }) => void = () => {};
    const loading = new Promise<{ default: SetupGuide['Component'] }>((r) => { resolve = r; });
    const ids = ['rekordbox-import', 'tracks-directory', 'cue-mode', 'soundcloud', 'soulseek', 'controller-check'];
    const guides = ids.map((id, i) => fakeGuide(id, i));
    guides[3] = { ...guides[3], Component: lazy(() => loading) };
    act(() => root.render(<SetupSequence guides={guides} initialIndex={3} onFinish={vi.fn()} />));
    expect(container.querySelectorAll('.setup-step')).toHaveLength(6);
    expect(container.textContent).toContain('Step 4 of 6');
    expect(container.textContent).toContain('Opening your next setup guide');
    await act(async () => resolve({ default: fakeGuide('soundcloud', 4).Component }));
    click('done soundcloud');
    expect(container.textContent).toContain('Step 5 of 6');
    click('skip soulseek');
    expect(container.textContent).toContain('Step 6 of 6');
    click('done controller-check');
    expect(container.textContent).toContain('Ready when you are.');
  });

  it('preserves Done even when an external guide writes Skipped before its callback', () => {
    setGuideStatus('self-writing', 'done');
    const guide = fakeGuide('self-writing', 1);
    guide.Component = ({ onSkip }) => <button onClick={() => { setGuideStatus(guide.id, 'skipped'); onSkip(); }}>external skip</button>;
    act(() => root.render(<SetupSequence guides={[guide]} onFinish={vi.fn()} />));
    click('external skip');
    expect(guideStatus(guide.id)).toBe('done');
  });
  it('advances on done/skip, records each status, then finishes', () => {
    const onFinish = vi.fn();
    const guides = [fakeGuide('a', 1), fakeGuide('b', 2)];
    act(() => root.render(<SetupSequence guides={guides} onFinish={onFinish} />));
    expect(container.querySelector('[aria-current=step]')?.textContent).toContain('Guide a');
    click('skip a');
    expect(guideStatus('a')).toBe('skipped');
    expect(container.querySelector('[data-testid=guide-b]')).not.toBeNull();
    click('done b');
    expect(guideStatus('b')).toBe('done');
    expect(onFinish).not.toHaveBeenCalled();
    click('Open manaDJ');
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('checkpoints progress and pauses without completing or losing statuses', () => {
    const onPause = vi.fn();
    const guides = [fakeGuide('resume-a', 1), fakeGuide('resume-b', 2)];
    saveSetupJourney({ ids: guides.map((g) => g.id), index: 0 });
    act(() => root.render(<SetupSequence guides={guides} persist onPause={onPause} onFinish={vi.fn()} />));
    click('skip resume-a');
    expect(setupJourney()?.index).toBe(1);
    expect(container.querySelector('.setup-step.skipped')?.textContent).toContain('Skipped');
    click('Finish later');
    expect(onPause).toHaveBeenCalledOnce();
    expect(guideStatus('resume-b')).toBe('not-started');
    setGuideStatus('unrelated', 'done');
    expect(setupJourney()?.index).toBe(1);
  });

  it('does not demote a done guide when skipping its replay', () => {
    setGuideStatus('done-guide', 'done');
    act(() => root.render(<SetupSequence guides={[fakeGuide('done-guide', 1)]} onFinish={vi.fn()} />));
    click('skip done-guide');
    expect(guideStatus('done-guide')).toBe('done');
  });

  it('Finish later leaves the remaining guides not started', () => {
    const onFinish = vi.fn();
    act(() => root.render(<SetupSequence guides={[fakeGuide('c', 1)]} onFinish={onFinish} />));
    click('Finish later');
    expect(onFinish).toHaveBeenCalled();
    expect(guideStatus('c')).toBe('not-started');
  });
});

describe('Settings → Setup', () => {
  beforeEach(() => {
    registerGuide(fakeGuide('x', 10));
    registerGuide(fakeGuide('y', 20));
  });

  it('lists guides in order with live status', () => {
    act(() => root.render(<SetupSettings />));
    const rows = [...container.querySelectorAll('.setup-guide-row')].map((r) => r.textContent);
    expect(rows[0]).toContain('Guide x');
    expect(rows[0]).toContain('Not started');
    click('Start'); // first row
    click('done x');
    expect(container.querySelector('[data-testid=setup-relaunch]')).toBeNull();
    expect(container.querySelector('[data-testid=setup-row-x]')?.textContent).toContain('Done');
  });

  it('closing a relaunched finished guide keeps it done', () => {
    localStorage.setItem('manadj-setup-state', JSON.stringify({ y: 'done' }));
    act(() => root.render(<SetupSettings />));
    const openY = container.querySelector('[data-testid=setup-row-y] button') as HTMLButtonElement;
    act(() => openY.click());
    click('skip y');
    expect(guideStatus('y')).toBe('done');
  });

  it('Run setup again replays every guide in a suppressing overlay', () => {
    act(() => root.render(<SetupSettings />));
    click('Run setup again');
    const overlay = container.querySelector('[data-testid=setup-relaunch]');
    expect(overlay?.hasAttribute('data-tour-suppress')).toBe(true);
    click('done x');
    click('skip y');
    click('Open manaDJ');
    expect(container.querySelector('[data-testid=setup-relaunch]')).toBeNull();
    expect(guideStatus('x')).toBe('done');
    expect(guideStatus('y')).toBe('skipped');
  });
});
