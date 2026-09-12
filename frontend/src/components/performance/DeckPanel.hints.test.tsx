// @vitest-environment jsdom
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeckContext, DeckRegistryContext, type DeckContextValue } from '../../hooks/useDeck';
import { MixerContext } from '../../hooks/useMixer';
import { CHANNEL_IDS, type ChannelId, type Mixer } from '../../playback/mixer';
import { _resetControlFocusForTests, focusDeck } from '../../performance/controlFocus';
import { BeatjumpRow } from '../deckControls/BeatjumpRow';
import { LoopRow } from '../deckControls/LoopRow';
import { DeckPanel } from './DeckPanel';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
});
vi.mock('../WaveformMinimap', () => ({ default: () => null }));
vi.mock('../WebGLWaveform', () => ({ default: () => null }));
vi.mock('../../waveform/useStemWaveform', () => ({ useStemWaveforms: () => null }));
vi.mock('../../performance/PlayGuideMinimapMarks', () => ({ PlayGuideMinimapMarks: () => null }));
vi.mock('../deckControls/BpmControl', () => ({ BpmControl: () => null }));
vi.mock('../../hooks/useTakeoverHint', () => ({ useTakeoverHint: () => null }));
vi.mock('../../hooks/useAtCuePoint', () => ({ useAtCuePoint: () => true }));
vi.mock('../../hooks/useHotCueActions', () => ({
  useHotCueActions: () => ({ enabled: true, bySlot: new Map(), down: vi.fn(), up: vi.fn(), remove: vi.fn(), decorate: vi.fn() }),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
let style: HTMLStyleElement;
let queryClient: QueryClient;
let decks: Record<ChannelId, DeckContextValue>;
let mixer: Mixer;

beforeEach(() => {
  _resetControlFocusForTests();
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const snapshot = {
    trackId: 1, loadState: 'ready', playing: false, pendingPlay: false,
    previewing: false, hotCuePreviewSlot: null, cuePoint: 0, loop: null,
    pendingLoopBeats: 4, hasBeatgrid: true, bpm: 120, pitchPercent: 0,
    bendPercent: 0, keyLock: true, vinylMode: true, slipMode: false, stemsLoaded: false,
  };
  const syncGroup = {
    match: vi.fn(), toggle: vi.fn(), setPitch: vi.fn(), subscribe: () => () => {},
    getSnapshot: () => ({ tempo: null, decks: { A: 'off', B: 'off', C: 'off', D: 'off' } }),
  };
  decks = Object.fromEntries(CHANNEL_IDS.map(deck => [deck, {
    deck, syncGroup,
    loadedTrack: { id: 1, title: 'Track', artist: 'Artist', bpm: 120, tags: [] },
    loadTrack: vi.fn(), beatjumpBeats: 4, setBeatjumpBeats: vi.fn(),
    engine: {
      getSnapshot: () => snapshot, subscribe: () => () => {},
      jumpBeats: vi.fn(), resizeLoop: vi.fn(), toggleLoop: vi.fn(),
    },
  }])) as unknown as Record<ChannelId, DeckContextValue>;
  const channel = { trim: 0.5, eq: { low: 0.5, mid: 0.5, high: 0.5 }, filter: 0, fader: 1, pfl: false, stems: {} };
  mixer = {
    subscribe: () => () => {}, getChannelState: () => channel, getAutomation: () => null,
  } as unknown as Mixer;
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(['track', 1], decks.A.loadedTrack);
  style = document.createElement('style');
  style.textContent = readFileSync('src/components/performance/PerformanceView.css', 'utf8');
  document.head.append(style);
  container = document.createElement('div');
  container.className = 'perf-root';
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  queryClient.clear();
  container.remove();
  style.remove();
});

function render(deck: ChannelId, rowsOnly = false) {
  focusDeck(deck);
  act(() => root.render(
    <QueryClientProvider client={queryClient}>
      <DeckRegistryContext value={decks}>
        <DeckContext value={decks[deck]}>
          <MixerContext value={mixer}>
            {rowsOnly ? <><BeatjumpRow /><LoopRow /></> : <DeckPanel mirrored={deck === 'B' || deck === 'D'} />}
          </MixerContext>
        </DeckContext>
      </DeckRegistryContext>
    </QueryClientProvider>,
  ));
}

describe('DeckPanel keyboard hints', () => {
  it.each([
    ['A', 'A', 'S', 'B', 'G', 'T', 'Z X C V', 'Q W E R'],
    ['B', 'L', ';', 'N', 'H', 'Y', 'M , . /', 'U I O P'],
    ['C', 'A', 'S', 'B', 'G', 'T', 'Z X C V', 'Q W E R'],
    ['D', 'L', ';', 'N', 'H', 'Y', 'M , . /', 'U I O P'],
  ] as const)('places the correct hand hints on Deck %s', (deck, back, forward, loop, fader, jog, pads, knobs) => {
    render(deck);
    const hint = (selector: string, text: string) => {
      const node = container.querySelector(`${selector} > .perf-kbd`)!;
      expect(node?.textContent).toBe(text);
      expect(node.getAttribute('aria-hidden')).toBe('true');
      expect(getComputedStyle(node).position).toBe('absolute');
      expect(getComputedStyle(node).pointerEvents).toBe('none');
      expect(node.querySelectorAll('.perf-kbd-shift > svg')).toHaveLength(text.includes('\u21e7') ? 1 : 0);
    };
    hint('.deck-jumprow > button:first-child', back);
    hint('.deck-jumprow > button:last-child', forward);
    for (const [label, chord, cap] of [
      ['Halve beatjump size', `Shift+${back}`, `\u21e7${back}`],
      ['Double beatjump size', `Shift+${forward}`, `\u21e7${forward}`],
      ['Halve loop size', `Cmd+Shift+${back}`, `\u2318\u21e7${back}`],
      ['Double loop size', `Cmd+Shift+${forward}`, `\u2318\u21e7${forward}`],
    ]) {
      const button = container.querySelector(`[title="${label} (${chord})"]`);
      expect(button).not.toBeNull();
      hint(`[title="${label} (${chord})"]`, cap);
      expect(button!.querySelector('.perf-kbd')!.classList.contains('perf-kbd-offset')).toBe(true);
    }
    hint('[aria-label="Loop 4"]', loop);
    hint('[aria-label="Match tempo"]', `\u2318${fader}`);
    hint('[aria-label="Sync tempo"]', `\u2318\u21e7${fader}`);
    hint('.deck-cuewalk > button:first-child', `\u2318${back}`);
    hint('.deck-cuewalk > button:last-child', `\u2318${forward}`);
    const cueWalkStyle = getComputedStyle(container.querySelector('.deck-cuewalk > button')!);
    expect(cueWalkStyle.lineHeight).toBe('7px');
    expect(cueWalkStyle.paddingTop).toBe('0px');
    expect(cueWalkStyle.paddingBottom).toBe('13px');
    hint('.player-button-cue', deck === 'A' || deck === 'C' ? 'F' : 'J');
    hint('.player-button-paused', deck === 'A' || deck === 'C' ? 'D' : 'K');

    const nudge = container.querySelector('.perf-nudge')!;
    expect([...nudge.children].map(node => node.tagName)).toEqual(['BUTTON', 'KBD', 'BUTTON']);
    expect(nudge.querySelectorAll('.perf-kbd')).toHaveLength(1);
    expect(nudge.querySelector('kbd')?.textContent).toBe(jog);
    const jogStyle = getComputedStyle(nudge.querySelector('kbd')!);
    expect(jogStyle.left).toBe('50%');
    expect(jogStyle.top).toBe('50%');
    expect(jogStyle.transform).toBe('translate(-50%, -50%)');
    expect(jogStyle.pointerEvents).toBe('none');

    const padHints = [...container.querySelectorAll('.perf-pad-wrap > .perf-kbd')];
    expect(padHints.map(node => node.textContent).join(' ')).toBe(pads);
    for (const node of padHints) {
      expect(node.previousElementSibling?.matches('button.hot-cue')).toBe(true);
      expect(getComputedStyle(node).right).toBe('2px');
      expect(getComputedStyle(node).pointerEvents).toBe('none');
    }
    expect([...container.querySelectorAll('.perf-knob .perf-kbd')].map(node => node.textContent).join(' ')).toBe(knobs);
    const volumeHint = container.querySelector('.perf-fader .perf-kbd')!;
    expect(volumeHint.textContent).toBe(fader);
    expect(volumeHint.classList.contains('perf-kbd-inline')).toBe(true);
    expect(getComputedStyle(volumeHint).position).toBe('static');
    expect(getComputedStyle(volumeHint).bottom).toBe('-6px');
    expect(getComputedStyle(volumeHint).right).toBe('-4px');
  });

  it('preserves hint visibility gates', () => {
    render('A');
    const hint = container.querySelector('.perf-match > .perf-kbd')!;
    act(() => focusDeck('C'));
    expect(getComputedStyle(hint).display).toBe('none');
    act(() => focusDeck('A'));
    container.classList.add('kbd-hints-off');
    expect(getComputedStyle(hint).display).toBe('none');
    container.classList.remove('kbd-hints-off');
    expect(getComputedStyle(hint).display).not.toBe('none');
  });

  it.each(['toggle', 'deck focus'])('recenters labels when hints are hidden by %s', reason => {
    render('A');
    const play = container.querySelector('.player-button-paused')!;
    const cueWalk = container.querySelector('.deck-cuewalk > button')!;
    const pad = container.querySelector('.perf-pad-wrap .hot-cue')!;
    const sync = container.querySelector('.perf-sync-label')!;
    expect(getComputedStyle(play).paddingRight).toBe('14px');
    expect(getComputedStyle(cueWalk).paddingBottom).toBe('13px');
    expect(getComputedStyle(pad).paddingRight).toBe('12px');
    expect(getComputedStyle(sync).transform).toBe('translateY(-6px)');
    if (reason === 'toggle') container.classList.add('kbd-hints-off');
    if (reason === 'deck focus') act(() => focusDeck('C'));
    expect(getComputedStyle(play).paddingRight).toBe('0px');
    expect(getComputedStyle(cueWalk).paddingBottom).toBe('0px');
    expect(getComputedStyle(pad).paddingRight).toBe('0px');
    expect(getComputedStyle(sync).transform).not.toBe('translateY(-6px)');
  });

  it('greys out hints without moving labels during library focus, while KBD off still hides them', () => {
    render('A');
    const hint = container.querySelector('.perf-sync > .perf-kbd')!;
    const play = container.querySelector('.player-button-paused')!;
    const library = document.createElement('div');
    library.className = 'perf-keyboard-scope';
    library.dataset.libraryFocus = 'true';
    container.append(library);
    expect(getComputedStyle(hint).visibility).not.toBe('hidden');
    expect(getComputedStyle(hint).display).not.toBe('none');
    expect(getComputedStyle(hint).getPropertyValue('--perf-kbd-ink')).toBe('var(--overlay1)');
    expect(getComputedStyle(play).paddingRight).toBe('14px');
    expect(getComputedStyle(container.querySelector('.deck-cuewalk > button')!).paddingBottom).toBe('13px');
    expect(getComputedStyle(container.querySelector('.perf-sync-label')!).transform).toBe('translateY(-6px)');
    container.classList.add('kbd-hints-off');
    expect(getComputedStyle(hint).display).toBe('none');
    expect(getComputedStyle(play).paddingRight).toBe('0px');
    container.classList.remove('kbd-hints-off');
    library.remove();
    expect(getComputedStyle(hint).getPropertyValue('--perf-kbd-ink')).toBe('var(--text)');
  });

  it('keeps shared rows hint-free for other callers and preserves resize actions', () => {
    render('A', true);
    expect(container.querySelector('.perf-kbd')).toBeNull();
    for (const title of ['Halve beatjump size', 'Double beatjump size', 'Halve loop size', 'Double loop size']) {
      const button = container.querySelector<HTMLButtonElement>(`[title="${title}"]`)!;
      expect(button.disabled).toBe(false);
      act(() => button.click());
    }
    expect(vi.mocked(decks.A.setBeatjumpBeats).mock.calls).toEqual([[2], [8]]);
    expect(vi.mocked(decks.A.engine.resizeLoop).mock.calls).toEqual([['halve'], ['double']]);
  });
});
