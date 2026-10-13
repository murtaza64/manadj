// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import TagEditor, { type TagEditorHandle } from './TagEditor';
import { ViewActiveContext } from '../contexts/viewActive';
import type { Track } from '../types';

vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: [] }) }));
vi.mock('../api/client', () => ({ api: { analyze: { getGrid: async () => null }, tags: { listAll: vi.fn() } } }));
vi.mock('../hooks/useDeck', () => ({
  useDeck: () => ({ engine: {}, loadedTrack: { id: 7 } }),
  useDeckReady: () => true,
  useDeckSnapshot: () => 0,
}));
vi.mock('./deckControls/BpmControl', () => ({ BpmControl: () => null }));
vi.mock('./WaveformMinimap', () => ({ default: () => null }));
vi.mock('./TagManagementModal', () => ({ default: () => null }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it('active energy editing does not consume Settings input or hidden-view keys', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const ref = createRef<TagEditorHandle>();
  const save = vi.fn();
  const track = { id: 7, title: 'Test', filename: 'test.wav', tags: [], energy: 2 } as unknown as Track;
  const render = async (active: boolean) => act(async () => root.render(
    <>
      <ViewActiveContext value={active}><TagEditor ref={ref} track={track} onSave={save} /></ViewActiveContext>
      <div className="settings-page"><input type="number" aria-label="Test setting" /></div>
    </>
  ));
  try {
    await render(true);
    act(() => ref.current!.toggleEnergyEditMode());
    const input = host.querySelector<HTMLInputElement>('[aria-label="Test setting"]')!;
    const event = new KeyboardEvent('keydown', { key: '3', bubbles: true, cancelable: true });
    act(() => { input.focus(); input.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(false);
    expect(save).not.toHaveBeenCalled();
    await render(false);
    act(() => { input.blur(); document.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true })); });
    expect(save).not.toHaveBeenCalled();
    await render(true);
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true })); });
    expect(save).toHaveBeenCalledWith({ energy: 3, tag_ids: [] });
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
