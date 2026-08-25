// @vitest-environment jsdom
/**
 * Performance section toggles (perf-layout 12 / gh#68): mixer-strip
 * buttons ↔ PerformanceView reflow, through the real perfSectionsStore.
 * (The real MixerStrip renders PerfSectionToggles; it's stubbed here, so
 * the toggles mount alongside the view — same store, same contract.)
 * Heavy deck surfaces are stubbed; the assertions are the feature's contract:
 * click toggles, state persists, hidden sections are display:none but
 * STAY MOUNTED (display only — audio/transport untouched). The freed space
 * goes to the shared browse panel below the view (App-level, gh#165) —
 * that reflow is plain flex and is verified in-browser.
 */
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PerfSectionToggles } from './PerfSectionToggles';
import { setPerfSectionShown } from '../../performance/perfSectionsStore';
import { PerformanceView } from './PerformanceView';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// vitest's jsdom bridge does not expose window.localStorage as a global
// (searchKeys.test idiom), and PerformanceView + perfSectionsStore read it
// at module scope — install the stand-in BEFORE imports run.
vi.hoisted(() => {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  } as Storage;
});

vi.mock('../../contexts/DeckContext', () => ({
  DeckScope: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock('./DeckPanel', () => ({
  DeckPanel: () => <div className="stub-deckpanel" />,
  DeckWaveform: () => <div className="stub-waveform" />,
}));
vi.mock('./MixerStrip', () => ({
  MixerStrip: () => <div className="stub-mixer" />,
}));
vi.mock('./DeckKeys', () => ({ DeckKeys: () => null }));
vi.mock('../../links/PerformancePairLinks', () => ({ EdgePairLinks: () => null }));
vi.mock('../../performance/PlayGuideOverlay', () => ({ PlayGuideOverlay: () => null }));
vi.mock('../../performance/useMidiCursorSuppression', () => ({
  useMidiCursorSuppression: () => {},
}));
vi.mock('../../performance/controlFocus', () => ({
  useControlFocus: () => ({ left: 'A', right: 'B' }),
  toggleControlFocus: () => {},
}));
vi.mock('../../sets/spaceTransport', () => ({ dispatchSetSpace: () => {} }));
vi.mock('../../hooks/useDeck', () => {
  const deck = () => ({
    engine: {
      subscribe: () => () => {},
      isAudioRunning: () => false,
      getSnapshot: () => ({ pendingPlay: false }),
    },
    loadTrack: () => {},
  });
  const decks = { A: deck(), B: deck(), C: deck(), D: deck() };
  return { useDecks: () => decks };
});

let root: Root | null = null;

function mount() {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <>
        <PerfSectionToggles />
        <PerformanceView />
      </>
    );
  });
  return host;
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
  // The store is a module singleton — reset for the next test.
  act(() => {
    setPerfSectionShown('waveforms', true);
    setPerfSectionShown('decks', true);
  });
  localStorage.clear();
});

const display = (el: Element | null) => (el as HTMLElement).style.display;

describe('performance section toggles', () => {
  it('renders both sections and lit toggles by default', () => {
    const host = mount();
    const buttons = host.querySelectorAll('.perf-section-toggle');
    expect(buttons).toHaveLength(2);
    for (const b of buttons) {
      expect(b.classList.contains('on')).toBe(true);
      expect(b.getAttribute('aria-pressed')).toBe('true');
    }
    expect(display(host.querySelector('.perf-waves'))).toBe('');
    expect(display(host.querySelector('.perf-decks'))).toBe('');
  });

  it('clicking DECKS hides the deck grid, persists, and keeps it mounted', () => {
    const host = mount();
    const [, decksBtn] = host.querySelectorAll<HTMLButtonElement>('.perf-section-toggle');
    act(() => decksBtn.click());

    expect(display(host.querySelector('.perf-decks'))).toBe('none');
    // Display only: the panels are still in the DOM — nothing was unmounted,
    // so deck/audio state can't have been disturbed by hiding.
    expect(host.querySelectorAll('.stub-deckpanel')).toHaveLength(4);
    // Independent: waveforms untouched.
    expect(display(host.querySelector('.perf-waves'))).toBe('');
    // Button reflects hidden; state persisted for the next boot.
    expect(decksBtn.classList.contains('on')).toBe(false);
    expect(decksBtn.getAttribute('aria-pressed')).toBe('false');
    expect(JSON.parse(localStorage.getItem('manadj-perf-sections')!)).toEqual({
      waveforms: true,
      decks: false,
    });

    act(() => decksBtn.click());
    expect(display(host.querySelector('.perf-decks'))).toBe('');
    expect(decksBtn.classList.contains('on')).toBe(true);
  });

  it('clicking WAVEFORMS hides the wave stack independently and restores it', () => {
    const host = mount();
    const [wavesBtn] = host.querySelectorAll<HTMLButtonElement>('.perf-section-toggle');
    act(() => wavesBtn.click());

    expect(display(host.querySelector('.perf-waves'))).toBe('none');
    // Hide-don't-unmount: the wave rows are still mounted (zoom survives).
    expect(host.querySelectorAll('.stub-waveform')).toHaveLength(4);
    expect(display(host.querySelector('.perf-decks'))).toBe('');
    expect(JSON.parse(localStorage.getItem('manadj-perf-sections')!)).toEqual({
      waveforms: false,
      decks: true,
    });

    act(() => wavesBtn.click());
    expect(display(host.querySelector('.perf-waves'))).toBe('');
  });

  it('both hidden: the surface keeps only the mixer strip', () => {
    const host = mount();
    const [wavesBtn, decksBtn] = host.querySelectorAll<HTMLButtonElement>('.perf-section-toggle');
    act(() => {
      wavesBtn.click();
      decksBtn.click();
    });
    expect(display(host.querySelector('.perf-waves'))).toBe('none');
    expect(display(host.querySelector('.perf-decks'))).toBe('none');
    expect(host.querySelector('.stub-mixer')).not.toBeNull();
  });
});
