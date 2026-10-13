// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { getSlot, resetSlots, setSlot } from '../waveform/styleSlots';
import { TrackWaveformPreview } from './TrackWaveformPreview';
import { requestPreviewImage } from '../waveform/previewImage';
import type { HotCue } from '../types';

vi.mock('../api/client', () => ({ api: { waveforms: { getPreview: vi.fn(), getData: vi.fn() } } }));
vi.mock('../settings/persistedSettings', () => ({ writeSetting: vi.fn(), removeSetting: vi.fn() }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
let serial = 0;
let raster: ReturnType<typeof vi.spyOn>;
const colors: string[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  resetSlots();
  colors.length = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillStyle: '',
    clearRect: vi.fn(),
    fillRect(this: { fillStyle: string }) { colors.push(this.fillStyle); },
  } as unknown as CanvasRenderingContext2D);
  raster = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => `data:image/png;base64,${++serial}`);
  const bytes = readFileSync('src/waveform/fixtures/golden.wfb');
  vi.mocked(api.waveforms.getPreview).mockResolvedValue({
    etag: `test-${++serial}`,
    blob: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement('div');
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  client.clear();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.useRealTimers();
});

async function render(show = true, cues?: HotCue[], trackId = 1) {
  await act(async () => {
    root.render(<QueryClientProvider client={client}>
      {show && <TrackWaveformPreview trackId={trackId} duration={2} cues={cues} />}
    </QueryClientProvider>);
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
}

it('uses the saved minimap colors, updates live, and reuses images across remounts', async () => {
  setSlot('minimap', { styleId: 'additive-rgb', params: { colors: [[1, 0, 0], [1, 0, 0], [1, 0, 0]] } });
  await render();
  expect(container.querySelector('img')).not.toBeNull();
  expect(api.waveforms.getData).not.toHaveBeenCalled();
  expect(raster).toHaveBeenCalledTimes(1);
  const first = container.querySelector('img')!.src;
  expect(colors.some(color => {
    const [red, green, blue] = color.match(/\d+/g)!.map(Number);
    return red > Math.max(green, blue) + 100;
  })).toBe(true);
  await render(false);
  await render();
  expect(container.querySelector('img')!.src).toBe(first);
  expect(raster).toHaveBeenCalledTimes(1);
  await act(async () => { setSlot('full', { params: { master: 0.2 } }); });
  await render();
  expect(raster).toHaveBeenCalledTimes(1);
  await act(async () => { setSlot('minimap', { params: { master: getSlot('minimap').params.master / 2 } }); });
  await render();
  expect(container.querySelector('img')!.src).not.toBe(first);
  expect(raster).toHaveBeenCalledTimes(2);
  await act(async () => { resetSlots(); });
  await render();
  expect(raster).toHaveBeenCalledTimes(3);
  expect(api.waveforms.getPreview).toHaveBeenCalledTimes(1);
});

it('polls pending generation and refreshes changed data without repainting unchanged data', async () => {
  const ready = await api.waveforms.getPreview(1);
  vi.mocked(api.waveforms.getPreview).mockClear().mockResolvedValue(null);
  await render();
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('.track-waveform-placeholder')).not.toBeNull();
  vi.mocked(api.waveforms.getPreview).mockResolvedValue(ready);
  await act(async () => { await vi.advanceTimersByTimeAsync(8100); });
  await render();
  expect(container.querySelector('img')).not.toBeNull();
  const src = container.querySelector('img')!.src;
  expect(raster).toHaveBeenCalledTimes(1);
  await act(async () => { await client.invalidateQueries({ queryKey: ['waveform-preview', 1] }); });
  await render();
  expect(container.querySelector('img')!.src).toBe(src);
  expect(raster).toHaveBeenCalledTimes(1);
  vi.mocked(api.waveforms.getPreview).mockResolvedValue({ ...ready!, etag: `${ready!.etag}-changed` });
  await act(async () => { await client.invalidateQueries({ queryKey: ['waveform-preview', 1] }); });
  await render();
  expect(container.querySelector('img')!.src).not.toBe(src);
  expect(raster).toHaveBeenCalledTimes(2);
});

it('does not keep polling a deleted track or show another track\'s old image', async () => {
  await render();
  expect(container.querySelector('img')).not.toBeNull();
  vi.mocked(api.waveforms.getPreview).mockRejectedValue(Object.assign(new Error('Deleted'), { status: 404 }));
  await render(true, [], 2);
  expect(container.querySelector('img')).toBeNull();
  vi.mocked(api.waveforms.getPreview).mockClear();
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(api.waveforms.getPreview).not.toHaveBeenCalled();
});

it('backs off failed generation and discovers an explicit task retry', async () => {
  const ready = await api.waveforms.getPreview(1);
  vi.mocked(api.waveforms.getPreview).mockClear().mockRejectedValue(Object.assign(new Error('Failed generation'), { status: 409 }));
  await render();
  expect(container.querySelector('.track-waveform-placeholder')?.getAttribute('title')).toContain('retry it in Tasks');
  await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
  expect(api.waveforms.getPreview).toHaveBeenCalledTimes(1);
  vi.mocked(api.waveforms.getPreview).mockResolvedValue(ready);
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  await render();
  expect(container.querySelector('img')).not.toBeNull();
});

it('updates cue positions/colors without repainting the waveform and ignores out-of-range markers', async () => {
  const cue = { id: 5, slot_number: 2, time_seconds: 1, color: '#00ff00', label: 'Drop' } as HotCue;
  await render(true, [cue, { ...cue, id: 6, time_seconds: 3 }]);
  const marker = container.querySelector<HTMLElement>('.track-waveform-cue')!;
  expect(container.querySelectorAll('.track-waveform-cue')).toHaveLength(1);
  expect(marker.style.getPropertyValue('--cue-position')).toBe('50%');
  expect(marker.style.color).toBe('rgb(0, 255, 0)');
  expect(marker.style.width).toBe('1px');
  expect(marker.querySelector('i')!.style.width).toBe('3px');
  expect(marker.querySelector('i')!.style.height).toBe('3px');
  expect(marker.title).toBe('Hotcue 2: Drop (1.0s)');
  await render(true, [{ ...cue, time_seconds: 2, color: '#ff0000' }]);
  expect(container.querySelector<HTMLElement>('.track-waveform-cue')!.style.getPropertyValue('--cue-position')).toBe('100%');
  expect(raster).toHaveBeenCalledTimes(1);
  await render(true, []);
  expect(container.querySelector('.track-waveform-cue')).toBeNull();
});

it('deduplicates queued renders, cancels abandoned work, and bounds the raster cache', async () => {
  const wire = (await api.waveforms.getPreview(1))!;
  const data = { ...wire, duration: 2 };
  const slot = getSlot('minimap');
  const abandoned = vi.fn();
  const cancel = requestPreviewImage(data, slot, abandoned);
  cancel();
  await vi.advanceTimersByTimeAsync(100);
  expect(raster).not.toHaveBeenCalled();
  expect(abandoned).not.toHaveBeenCalled();
  const first = vi.fn();
  const second = vi.fn();
  requestPreviewImage(data, slot, first);
  requestPreviewImage(data, slot, second);
  await vi.advanceTimersByTimeAsync(100);
  expect(raster).toHaveBeenCalledTimes(1);
  expect(first).toHaveBeenCalledWith(second.mock.calls[0][0]);
  for (let i = 0; i < 128; i++) {
    requestPreviewImage({ ...data, etag: `${data.etag}-${i}` }, slot, () => {});
  }
  await vi.advanceTimersByTimeAsync(1000);
  expect(raster).toHaveBeenCalledTimes(129);
  requestPreviewImage(data, slot, () => {});
  await vi.advanceTimersByTimeAsync(100);
  expect(raster).toHaveBeenCalledTimes(130);
});
