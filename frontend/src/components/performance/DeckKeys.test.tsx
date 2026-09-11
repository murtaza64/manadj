// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { KeepAliveView } from '../../contexts/KeepAliveView';
import { DeckKeys } from './DeckKeys';
import { DECK_KEYS } from './performanceKeys';

const engine = vi.hoisted(() => ({
  jumpBeats: vi.fn(), setBend: vi.fn(), cueUp: vi.fn(), cueDown: vi.fn(),
  togglePlay: vi.fn(), toggleLoop: vi.fn(),
}));
vi.mock('../../hooks/useDeck', () => ({
  useDeck: () => ({ deck: 'A', engine, loadedTrack: { id: 7 }, beatjumpBeats: 32 }),
  useDeckReady: () => true,
  useDeckSnapshot: () => true,
}));
vi.mock('../../hooks/useHotCueActions', () => ({
  useHotCueActions: () => ({ enabled: true, down: vi.fn(), up: vi.fn() }),
}));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it('retained Performance view does not handle Export beat-jump keys', () => {
  const root = createRoot(document.createElement('div'));
  const render = (active: boolean) => act(() => root.render(
    <KeepAliveView active={active}><DeckKeys /></KeepAliveView>
  ));
  const key = (value: string) => act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true }));
  });
  try {
    render(true);
    key('s');
    expect(engine.jumpBeats.mock.calls).toEqual([[32]]);
    key(DECK_KEYS.A.cue);
    expect(engine.cueDown).toHaveBeenCalledTimes(1);
    render(false);
    engine.cueUp.mockClear();
    act(() => document.dispatchEvent(new KeyboardEvent('keyup', { key: DECK_KEYS.A.cue, bubbles: true })));
    expect(engine.cueUp).toHaveBeenCalledTimes(1);
    engine.jumpBeats.mockClear();
    key('s');
    key('a');
    expect(engine.jumpBeats).not.toHaveBeenCalled();
    render(true);
    key('a');
    expect(engine.jumpBeats.mock.calls).toEqual([[-32]]);
    render(false);
    render(true);
    engine.jumpBeats.mockClear();
    key('s');
    expect(engine.jumpBeats.mock.calls).toEqual([[32]]);
  } finally {
    act(() => root.unmount());
  }
});
