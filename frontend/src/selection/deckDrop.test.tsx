// @vitest-environment jsdom
import { act, useEffect, type DragEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useDeckDropTarget, type DeckDropHandlers, type DeckDropPolicy, type DeckDropState } from './deckDrop';
import { setTrackDragPayload } from './trackDrag';

const getById = vi.fn(async (id: number) => ({ id, title: `t${id}` }));
vi.mock('../api/client', () => ({ api: { tracks: { getById: (id: number) => getById(id) } } }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const root = createRoot(document.createElement('div'));
let handlers: DeckDropHandlers;
let state: DeckDropState;

function Probe({ policy }: { policy: DeckDropPolicy | null }) {
  const r = useDeckDropTarget('B', policy);
  useEffect(() => {
    handlers = r.dropHandlers;
    state = r.dropState;
  });
  return null;
}

function fakeDataTransfer(): DataTransfer {
  const store = new Map<string, string>();
  return {
    setData: (k: string, v: string) => void store.set(k, v),
    getData: (k: string) => store.get(k) ?? '',
    get types() {
      return [...store.keys()];
    },
    effectAllowed: 'none',
    dropEffect: 'none',
  } as unknown as DataTransfer;
}

function dragEvent(ids: number[] | null) {
  const dataTransfer = fakeDataTransfer();
  if (ids) setTrackDragPayload(dataTransfer, ids);
  return {
    dataTransfer,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    relatedTarget: null,
    currentTarget: document.createElement('div'),
  } as unknown as DragEvent & { preventDefault: ReturnType<typeof vi.fn> };
}

afterEach(() => {
  getById.mockClear();
  act(() => root.render(null));
});

it('loads the primary (first) dragged track onto the deck', async () => {
  const load = vi.fn();
  act(() => root.render(<Probe policy={{ load }} />));
  const over = dragEvent([7, 3, 9]);
  act(() => handlers.onDragEnter(over));
  expect(over.preventDefault).toHaveBeenCalled();
  expect(over.dataTransfer.dropEffect).toBe('copy');
  expect(state).toBe('ok');
  await act(async () => handlers.onDrop(dragEvent([7, 3, 9])));
  expect(getById).toHaveBeenCalledTimes(1);
  expect(getById).toHaveBeenCalledWith(7);
  expect(load).toHaveBeenCalledWith('B', { id: 7, title: 't7' });
  expect(state).toBe(null);
});

it('refuses on hover and on drop while the deck is locked', async () => {
  const load = vi.fn();
  const onRefused = vi.fn();
  act(() => root.render(<Probe policy={{ load, isRefused: () => true, onRefused }} />));
  const over = dragEvent([5]);
  act(() => handlers.onDragEnter(over));
  expect(over.dataTransfer.dropEffect).toBe('none');
  expect(state).toBe('refused');
  expect(onRefused).toHaveBeenCalledWith('B');
  await act(async () => handlers.onDrop(dragEvent([5])));
  expect(getById).not.toHaveBeenCalled();
  expect(load).not.toHaveBeenCalled();
});

it('ignores non-track drags and is inert without a policy', () => {
  act(() => root.render(<Probe policy={{ load: vi.fn() }} />));
  const other = dragEvent(null);
  act(() => handlers.onDragOver(other));
  expect(other.preventDefault).not.toHaveBeenCalled();
  expect(state).toBe(null);

  act(() => root.render(<Probe policy={null} />));
  const track = dragEvent([1]);
  act(() => handlers.onDragOver(track));
  expect(track.preventDefault).not.toHaveBeenCalled();
});

it('clears the highlight when the drag leaves the surface', () => {
  act(() => root.render(<Probe policy={{ load: vi.fn() }} />));
  act(() => handlers.onDragEnter(dragEvent([1])));
  expect(state).toBe('ok');
  act(() => handlers.onDragLeave(dragEvent([1])));
  expect(state).toBe(null);
});
