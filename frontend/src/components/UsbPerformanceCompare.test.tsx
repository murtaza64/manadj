// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { api, type ExternalDrivePerformanceComparison } from '../api/client';
import { UsbPerformanceCompare } from './UsbPerformanceCompare';

vi.mock('./PerfDiffViewer', () => ({ PerfDiffViewer: ({ sides, onImport, referenceLabel }: { sides: unknown; onImport: object; referenceLabel: string }) => <div data-reference={referenceLabel} data-testid="viewer" data-sides={JSON.stringify(sides)} data-actions={Object.keys(onImport).join(',')} /> }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });
const sample = (): ExternalDrivePerformanceComparison => ({
  ordinal: 2, track_id: 7, fingerprint: 'review', duration: 240, newer_source: null, read_only: true, alignment: 'Exact audio',
  usb: { state: 'read', reason: null, decode_offset_ms: 49, beats: [{ time: .25, beat: 1, bpm: 120 }, { time: .77, beat: 2, bpm: 119 }],
    cues: [{ kind: 'memory', slot: 0, time: 1.002, loop_end: 3.003, label: 'USB loop', color: '#ff0000' }] },
  library: { grid_origin: 'edited', tempo_changes: [{ start_time: .25, bpm: 120, bar_position: 1 }],
    cues: [{ kind: 'hot', slot: 1, time: 1.001, loop_end: null, label: 'Library intro', color: '#00ff00' }] },
  limits: ['Read only.'],
});
const mount = async () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  await act(async () => { root.render(<UsbPerformanceCompare root="/USB" ordinal={2} fingerprint="review" />); });
  return host;
};
it('reads only on demand, binds the row, preserves stored beats/loops and offers no write action', async () => {
  const read = vi.spyOn(api.externalDrives, 'performance').mockResolvedValue(sample());
  const host = await mount(); expect(read).not.toHaveBeenCalled();
  await act(async () => { host.querySelector('button')!.click(); });
  expect(read).toHaveBeenCalledExactlyOnceWith('/USB', 2, 'review');
  const viewer = host.querySelector('[data-testid="viewer"]')!;
  const sides = JSON.parse(viewer.getAttribute('data-sides')!);
  expect(sides.externals[0].beats).toEqual([{ time: .25, isDownbeat: true }, { time: .77, isDownbeat: false }]);
  expect(sides.externals[0].cues[0].loop_end).toBe(3.003);
  expect(viewer.getAttribute('data-actions')).toBe('');
  expect(viewer.getAttribute('data-reference')).toContain('Shared Library waveform');
  expect(viewer.getAttribute('data-reference')).toContain('USB supplies cue/grid overlays only');
  expect(host.textContent).toContain('1.002s / 3.003s'); expect(host.textContent).toContain('Newer source unknown');
  expect(host.textContent).toContain('Library intro'); expect(host.textContent).toContain('USB loop');
});
it('unavailable analysis never renders an empty USB side as a successful comparison', async () => {
  const data = sample(); data.usb = { state: 'unavailable', reason: 'Missing analysis.', cues: [], beats: [] };
  vi.spyOn(api.externalDrives, 'performance').mockResolvedValue(data);
  const host = await mount(); await act(async () => { host.querySelector('button')!.click(); });
  expect(host.querySelector('[data-testid="viewer"]')).toBeNull();
  expect(host.textContent).toContain('USB comparison unknown'); expect(host.textContent).toContain('Library intro');
});
it('failed or stale reads show the reason without inventing any comparison', async () => {
  vi.spyOn(api.externalDrives, 'performance').mockRejectedValue(new Error('Review changed. Recheck.'));
  const host = await mount(); await act(async () => { host.querySelector('button')!.click(); });
  expect(host.querySelector('[role="alert"]')!.textContent).toBe('Review changed. Recheck.');
  expect(host.querySelector('[data-testid="viewer"]')).toBeNull();
});
