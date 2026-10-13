// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MixPicker, type MixPickerProps } from './MixPicker';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const tracks = [1, 2, 3].map((id) => ({ id, title: `Track ${id}`, artist: `Artist ${id}` }));
let host: HTMLDivElement;
let root: Root;
let props: MixPickerProps;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  props = {
    openPair: null, openRefKey: null, tracks,
    transitions: [2, 3].map((b) => ({ a_track_id: 1, b_track_id: b, uuid: `1-${b}`, position: 0,
      name: `One into ${b}`, favorite: false })),
    cameos: [], routines: [], routineTakes: [], candidates: [], takes: [],
    deckTracks: [{ deck: 'A', track: tracks[0] }, { deck: 'C', track: tracks[1] }, { deck: 'D', track: tracks[2] }],
    busy: false, onOpen: vi.fn(), onRenameTransition: vi.fn(),
    onToggleFavoriteTransition: vi.fn(), onDeleteTransition: vi.fn(),
    trackById: (id) => tracks.find((t) => t.id === id),
  };
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = () => act(() => root.render(<MixPicker {...props} />));
const shortcut = (deck: string) => host.querySelector<HTMLButtonElement>(`[aria-label^="Search deck ${deck}:"]`)!;
const pick = (deck: string) => act(() => shortcut(deck).click());
const chips = () => [...host.querySelectorAll('.mp-chip.set')].map((chip) => chip.firstChild?.textContent);

it('fills the next empty track chip and replaces incoming without opening an artifact', () => {
  render();
  expect(host.querySelectorAll('.mp-deck-shortcut')).toHaveLength(3);
  expect(shortcut('B')).toBeNull();
  pick('A');
  expect(chips()).toEqual(['Track 1']);
  expect(document.activeElement).toBe(host.querySelector('.mp-search'));
  pick('C');
  expect(chips()).toEqual(['Track 1', 'Track 2']);
  expect(host.textContent).toContain('One into 2');
  expect(shortcut('A').disabled).toBe(true);
  expect(shortcut('C').disabled).toBe(true);
  pick('D');
  expect(chips()).toEqual(['Track 1', 'Track 3']);
  expect(host.textContent).toContain('One into 3');
  expect(shortcut('C').disabled).toBe(false);
  expect(props.onOpen).not.toHaveBeenCalled();
});

it('tracks load/unload changes without silently retargeting the picker', () => {
  render();
  pick('A');
  props = { ...props, deckTracks: [{ deck: 'A', track: tracks[2] }] };
  render();
  expect(host.querySelectorAll('.mp-deck-shortcut')).toHaveLength(1);
  expect(shortcut('A').textContent).toContain('Track 3');
  expect(chips()).toEqual(['Track 1']);
  props = { ...props, deckTracks: [] };
  render();
  expect(host.querySelector('.mp-deck-shortcuts')).toBeNull();
  expect(chips()).toEqual(['Track 1']);
});

it('uses loaded metadata before the library arrives and prevents duplicate-track pairs', () => {
  props = { ...props, tracks: [], trackById: () => undefined,
    deckTracks: [{ deck: 'A', track: tracks[0] }, { deck: 'D', track: tracks[0] }] };
  render();
  pick('A');
  expect(chips()).toEqual(['Track 1']);
  expect(shortcut('D').disabled).toBe(true);
  pick('D');
  expect(chips()).toHaveLength(1);
});

it('refills outgoing when it was cleared, leaving the incoming track intact', () => {
  props = { ...props, openPair: { aTrackId: 1, bTrackId: 2 } };
  render();
  act(() => host.querySelector<HTMLButtonElement>('.mp-chipx')!.click());
  pick('D');
  expect(chips()).toEqual(['Track 3', 'Track 2']);
  expect(props.onOpen).not.toHaveBeenCalled();
});

it('leaves Enter and Space to native button activation rather than opening the highlighted artifact', () => {
  props = { ...props, openPair: { aTrackId: 1, bTrackId: 2 } };
  render();
  for (const key of ['Enter', ' ']) {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    act(() => shortcut('D').dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
  }
  expect(props.onOpen).not.toHaveBeenCalled();
  pick('D');
  expect(chips()).toEqual(['Track 1', 'Track 3']);
});
