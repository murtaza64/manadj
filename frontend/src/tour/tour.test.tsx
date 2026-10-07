// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { visibleSteps } from './anchors';
import { TourOverlay } from './TourOverlay';
import type { TourSection } from './steps';
import { TOUR_SECTIONS } from './steps';
import {
  TOUR_STATE_KEY,
  _resetTourStoresForTests,
  activeTourSection,
  allToursSkipped,
  isSectionSeen,
  markSectionSeen,
  resetTourProgress,
  setLibrarySubview,
  setTourArea,
  skipAllTours,
} from './tourState';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const cleanups: Array<() => void> = [];

function mount(node: React.ReactNode) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(node);
  });
  const unmount = () => {
    act(() => root.unmount());
    container.remove();
  };
  cleanups.push(unmount);
  return { container, unmount };
}

// jsdom has no layout: getBoundingClientRect is all zeros. Give anchors a
// real rect so findAnchor treats them as rendered.
function addAnchor(anchor: string): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-tour', anchor);
  el.getBoundingClientRect = () =>
    ({ top: 100, left: 100, width: 200, height: 40, bottom: 140, right: 300, x: 100, y: 100, toJSON: () => ({}) }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

function popoverTitle(): string | null {
  return document.querySelector('.tour-popover-title')?.textContent ?? null;
}

function popoverCount(): string | null {
  return document.querySelector('.tour-popover-count')?.textContent ?? null;
}

function clickButton(label: string) {
  const button = [...document.querySelectorAll('button')].find(
    (b) => b.textContent === label
  );
  expect(button, `button "${label}"`).toBeTruthy();
  act(() => {
    button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function pressKey(key: string) {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

const SECTION: TourSection = {
  id: 'library',
  label: 'Library',
  steps: [
    { anchor: 't.one', title: 'One', body: 'first' },
    { anchor: 't.two', title: 'Two', body: 'second' },
    { anchor: 't.three', title: 'Three', body: 'third' },
  ],
};

// Fake localStorage at the true seam (persistedSettings.test.ts idiom —
// vitest's jsdom env ships no localStorage).
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeStorage());
  _resetTourStoresForTests();
});

afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
  document.body.innerHTML = '';
});

describe('visibleSteps (story 5)', () => {
  it('keeps only steps whose anchor is rendered with a nonzero rect', () => {
    addAnchor('t.one');
    addAnchor('t.three');
    // t.two missing entirely; a zero-rect anchor is also invisible:
    const flat = document.createElement('div');
    flat.setAttribute('data-tour', 't.flat');
    document.body.appendChild(flat);
    const steps = visibleSteps([
      ...SECTION.steps,
      { anchor: 't.flat', title: 'Flat', body: 'zero rect' },
    ]);
    expect(steps.map((s) => s.anchor)).toEqual(['t.one', 't.three']);
  });
});

describe('TourOverlay sequencing', () => {
  it('walks visible steps with Next and finishes with Done', () => {
    addAnchor('t.one');
    addAnchor('t.two');
    let done = 0;
    mount(<TourOverlay section={SECTION} auto onDone={() => done++} onSkipAll={() => {}} />);
    expect(popoverTitle()).toBe('One');
    expect(popoverCount()).toBe('1 / 2');
    clickButton('Next');
    expect(popoverTitle()).toBe('Two');
    clickButton('Done');
    expect(done).toBe(1);
  });

  it('skips steps whose anchor is missing', () => {
    addAnchor('t.one');
    addAnchor('t.three');
    mount(<TourOverlay section={SECTION} auto onDone={() => {}} onSkipAll={() => {}} />);
    clickButton('Next');
    expect(popoverTitle()).toBe('Three');
    expect(popoverCount()).toBe('2 / 2');
  });

  it('closes immediately when no anchor on screen is visible', () => {
    let done = 0;
    mount(<TourOverlay section={SECTION} auto onDone={() => done++} onSkipAll={() => {}} />);
    expect(done).toBe(1);
  });

  it('Escape closes (capture phase claims the event)', () => {
    addAnchor('t.one');
    let done = 0;
    mount(<TourOverlay section={SECTION} auto onDone={() => done++} onSkipAll={() => {}} />);
    pressKey('Escape');
    expect(done).toBe(1);
  });

  it('arrow keys navigate', () => {
    addAnchor('t.one');
    addAnchor('t.two');
    mount(<TourOverlay section={SECTION} auto onDone={() => {}} onSkipAll={() => {}} />);
    pressKey('ArrowRight');
    expect(popoverTitle()).toBe('Two');
    pressKey('ArrowLeft');
    expect(popoverTitle()).toBe('One');
  });

  it('a backdrop click closes instead of silently advancing', () => {
    addAnchor('t.one'); addAnchor('t.two');
    let done = 0;
    mount(<TourOverlay section={SECTION} auto onDone={() => done++} onSkipAll={() => {}} />);
    act(() => document.querySelector('.tour-overlay')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(done).toBe(1);
    expect(popoverTitle()).toBe('One');
  });

  it('keeps the popover inside the viewport for a full-height anchor', () => {
    const anchor = addAnchor('t.one');
    anchor.getBoundingClientRect = () => ({ top: 0, left: 0, width: 200, height: window.innerHeight, bottom: window.innerHeight, right: 200 }) as DOMRect;
    mount(<TourOverlay section={SECTION} auto onDone={() => {}} onSkipAll={() => {}} />);
    const panel = document.querySelector<HTMLElement>('.tour-popover')!;
    expect(Number.parseFloat(panel.style.top)).toBeGreaterThanOrEqual(8);
    expect(panel.style.transform).toBe('');
  });

  it('is a keyboard overlay: role=dialog silences deck hotkeys', () => {
    addAnchor('t.one');
    mount(<TourOverlay section={SECTION} auto onDone={() => {}} onSkipAll={() => {}} />);
    expect(document.querySelector('[role="dialog"].tour-overlay')).toBeTruthy();
  });

  it('offers Skip all tours only on auto-start', () => {
    addAnchor('t.one');
    const first = mount(
      <TourOverlay section={SECTION} auto onDone={() => {}} onSkipAll={() => {}} />
    );
    const hasSkipAll = () =>
      [...document.querySelectorAll('button')].some((b) => b.textContent === 'Skip all tours');
    expect(hasSkipAll()).toBe(true);
    first.unmount();
    mount(<TourOverlay section={SECTION} auto={false} onDone={() => {}} onSkipAll={() => {}} />);
    expect(hasSkipAll()).toBe(false);
  });

  it('advances past a step whose anchor disappears mid-tour', () => {
    const one = addAnchor('t.one');
    addAnchor('t.two');
    mount(<TourOverlay section={SECTION} auto onDone={() => {}} onSkipAll={() => {}} />);
    expect(popoverTitle()).toBe('One');
    one.remove();
    // The re-measure path also runs on resize.
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(popoverTitle()).toBe('Two');
  });
});

describe('tour progress persistence', () => {
  it('is inventoried as a persisted preference', async () => {
    const { PERSISTED_SETTING_KEYS } = await import('../settings/persistedSettings');
    expect(PERSISTED_SETTING_KEYS).toContain(TOUR_STATE_KEY);
  });

  it('marks sections seen and persists to the setting cache', () => {
    expect(isSectionSeen('library')).toBe(false);
    markSectionSeen('library');
    expect(isSectionSeen('library')).toBe(true);
    const stored = JSON.parse(localStorage.getItem(TOUR_STATE_KEY)!);
    expect(stored.seen.library).toBe(true);
  });

  it('skip-all sticks and reset clears everything', () => {
    markSectionSeen('sync');
    skipAllTours();
    expect(allToursSkipped()).toBe(true);
    resetTourProgress();
    expect(allToursSkipped()).toBe(false);
    expect(isSectionSeen('sync')).toBe(false);
    expect(localStorage.getItem(TOUR_STATE_KEY)).toBeNull();
  });
});

describe('active section derivation', () => {
  it('library subview wins only inside the library area', () => {
    setTourArea('library');
    setLibrarySubview('sets');
    expect(activeTourSection()).toBe('sets');
    setTourArea('performance');
    expect(activeTourSection()).toBe('performance');
    setTourArea('library');
    setLibrarySubview(null);
    expect(activeTourSection()).toBe('library');
  });

  it('Settings has no tour (#324)', () => {
    setTourArea('settings');
    expect(activeTourSection()).toBeNull();
    expect(TOUR_SECTIONS.some((s) => (s.id as string) === 'settings')).toBe(false);
  });
});

describe('step data', () => {
  it('covers every PRD area with a few steps each', () => {
    const ids = TOUR_SECTIONS.map((s) => s.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'library',
        'performance',
        'edit',
        'sync',
        'sets',
        'sessions',
        'history',
      ])
    );
    for (const section of TOUR_SECTIONS) {
      expect(section.steps.length).toBeGreaterThanOrEqual(2);
      expect(section.steps.length).toBeLessThanOrEqual(6);
    }
  });

  it('Perform comes first and carries the Modes step; no copy points at EXPORT in the top bar (#301)', () => {
    expect(TOUR_SECTIONS[0].id).toBe('performance');
    expect(TOUR_SECTIONS[0].steps[0].anchor).toBe('topbar.modes');
    const modes = TOUR_SECTIONS[0].steps[0].body;
    expect(modes).toContain('\u22ef holds EXPORT');
    const library = TOUR_SECTIONS.find((s) => s.id === 'library')!;
    expect(library.steps.map((s) => s.anchor)).not.toContain('topbar.modes');
  });
});
