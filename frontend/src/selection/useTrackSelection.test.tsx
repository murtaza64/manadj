// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useTrackSelection, type TrackSelection } from './useTrackSelection';
import type { Track } from '../types';

vi.mock('../hooks/useKeyboardShortcuts', () => ({
  scrollTrackIntoView: vi.fn(), trackRowInView: () => true,
  visibleTrackIds: () => new Set([1, 2, 3, 4, 5, 6]),
}));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const root = createRoot(document.createElement('div'));
let selection: TrackSelection;
const tracks = Array.from({ length: 12 }, (_, index) => ({ id: index + 1 } as Track));
function Probe({ rows = tracks }: { rows?: Track[] }) {
  const current = useTrackSelection(rows);
  useEffect(() => { selection = current; });
  return null;
}
afterEach(() => act(() => root.render(null)));

it('extends and shrinks a keyboard range from a fixed root, then resets on plain navigation', () => {
  act(() => root.render(<Probe />));
  act(() => selection.handleNavigate(1));
  act(() => selection.handleNavigate(1, true));
  act(() => selection.handleNavigate(1, true));
  expect(selection.selection).toEqual({ ids: [1, 2, 3], anchorId: 3 });
  act(() => selection.handleNavigate(-1, true));
  expect(selection.selection).toEqual({ ids: [1, 2], anchorId: 2 });
  act(() => selection.handleNavigate(1));
  act(() => selection.handleNavigate(1, true));
  expect(selection.selection).toEqual({ ids: [3, 4], anchorId: 4 });
});

it('moves half the viewport and clamps to list boundaries', () => {
  act(() => root.render(<Probe />));
  act(() => selection.handleNavigate(1));
  act(() => selection.handleNavigateHalfPage(1));
  expect(selection.selection.anchorId).toBe(4);
  act(() => selection.handleNavigateHalfPage(-1));
  expect(selection.selection.anchorId).toBe(1);
  act(() => selection.handleNavigateHalfPage(-1));
  expect(selection.selection.anchorId).toBe(1);
  act(() => selection.handleNavigateEnd(1));
  act(() => selection.handleNavigateHalfPage(1));
  expect(selection.selection.anchorId).toBe(12);
});

it('reanchors keyboard ranges after the displayed list changes', () => {
  act(() => root.render(<Probe />));
  act(() => selection.handleNavigate(1));
  act(() => selection.handleNavigate(1, true));
  act(() => root.render(<Probe rows={tracks.slice(1)} />));
  act(() => selection.handleNavigate(1, true));
  act(() => selection.handleNavigate(1, true));
  expect(selection.selection).toEqual({ ids: [2, 3, 4], anchorId: 4 });
});
