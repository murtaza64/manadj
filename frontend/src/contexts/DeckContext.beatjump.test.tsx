// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { DeckProvider, DeckScope } from './DeckContext';
import { useDeck, useDecks } from '../hooks/useDeck';
import { BeatjumpRow } from '../components/deckControls/BeatjumpRow';
import { api } from '../api/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it('updates shared beatjump controls without rerendering deck and registry consumers', async () => {
  const recover = vi.spyOn(api.sessions, 'recover').mockResolvedValue(0);
  const renders = { deck: vi.fn(), registry: vi.fn() };
  function Library() {
    useDeck();
    renders.deck();
    return null;
  }
  function CrossDeckLibrary() {
    useDecks();
    renders.registry();
    return null;
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    await act(async () => root.render(
      <QueryClientProvider client={client}>
        <DeckProvider>
          <CrossDeckLibrary />
          <DeckScope deck="A"><Library /><BeatjumpRow /></DeckScope>
          <DeckScope deck="A"><BeatjumpRow /></DeckScope>
          <DeckScope deck="B"><BeatjumpRow /></DeckScope>
        </DeckProvider>
      </QueryClientProvider>,
    ));
    renders.deck.mockClear();
    renders.registry.mockClear();
    const sizes = () => [...container.querySelectorAll('summary')].map(el => el.textContent);
    expect(sizes()).toEqual(['32', '32', '32']);
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[title="Double beatjump size"]')!.click();
    });
    expect(sizes()).toEqual(['64', '64', '32']);
    expect(renders.deck).not.toHaveBeenCalled();
    expect(renders.registry).not.toHaveBeenCalled();
    await act(async () => {
      container.querySelectorAll<HTMLButtonElement>('[title="Halve beatjump size"]')[1].click();
    });
    expect(sizes()).toEqual(['32', '32', '32']);
    expect(renders.deck).not.toHaveBeenCalled();
    expect(renders.registry).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    client.clear();
    recover.mockRestore();
  }
});
