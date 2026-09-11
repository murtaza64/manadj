import { afterEach, describe, expect, it, vi } from 'vitest';
import { WaveformRendererV2 } from './WaveformRendererV2';

function harness(overrides = {}) {
  vi.stubGlobal('window', { devicePixelRatio: 1.5 });
  const gl = {
    SCISSOR_TEST: 0x0c11,
    viewport: vi.fn(), enable: vi.fn(), disable: vi.fn(), scissor: vi.fn(),
  };
  const drawBody = vi.fn();
  const drawOverlays = vi.fn();
  const clearRect = vi.fn();
  const getSlipReturnPlayhead = vi.fn<() => number | null>(() => 30);
  const renderer: WaveformRendererV2 = Object.create(WaveformRendererV2.prototype);
  Object.assign(renderer, {
    gl, canvas: { clientWidth: 200, clientHeight: 67, width: 300, height: 101 },
    data: { duration: 100 }, peakTex: {}, bandLoTex: {}, bandHiTex: {},
    config: { playMarkerPosition: 0.25 }, visibleSeconds: 8,
    modSplit: true, anchor: 'center', isMinimap: false, externalWindow: false,
    displaySegments: null, getSlipReturnPlayhead, drawBody, drawOverlays,
    ensureOverlayContext: () => ({ clearRect }),
    ...overrides,
  });
  return { renderer, gl, drawBody, drawOverlays, clearRect, getSlipReturnPlayhead };
}

afterEach(() => vi.unstubAllGlobals());

describe('performance Slip waveform', () => {
  it('clips body and marks to separate timelines at physical-pixel boundaries', () => {
    const h = harness();
    h.renderer.renderFrame({ getPlayhead: () => 10 });
    const upper = { startTime: 8, visibleSeconds: 8, playhead: 10, w: 300, h: 101, dpr: 1.5 };
    const lower = { ...upper, startTime: 28, playhead: 30 };
    expect(h.gl.viewport).toHaveBeenCalledExactlyOnceWith(0, 0, 300, 101);
    expect(h.gl.scissor.mock.calls).toEqual([[0, 51, 300, 50], [0, 0, 300, 51]]);
    expect(h.drawBody.mock.calls).toEqual([[upper], [lower]]);
    expect(h.drawOverlays.mock.calls).toEqual([
      [upper, { textClip: { x0: 0, y0: 0, w: 300, h: 50 } }],
      [lower, { textClip: { x0: 0, y0: 50, w: 300, h: 51 } }],
    ]);
    expect(h.clearRect).toHaveBeenCalledExactlyOnceWith(0, 0, 300, 101);
    expect(h.gl.disable).toHaveBeenLastCalledWith(h.gl.SCISSOR_TEST);
  });

  it('polls the return timeline while the audible platter is held, then rejoins on release', () => {
    const h = harness();
    const clock = { getPlayhead: () => 10 };
    h.renderer.renderFrame(clock);
    h.getSlipReturnPlayhead.mockReturnValue(31);
    h.renderer.renderFrame(clock);
    expect(h.drawBody).toHaveBeenLastCalledWith(expect.objectContaining({ playhead: 31, startTime: 29 }));
    h.getSlipReturnPlayhead.mockReturnValue(null);
    h.drawBody.mockClear();
    h.drawOverlays.mockClear();
    h.gl.scissor.mockClear();
    h.renderer.renderFrame({ getPlayhead: () => 31 });
    expect(h.drawBody).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ playhead: 31 }));
    expect(h.drawOverlays).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ playhead: 31 }));
    expect(h.gl.scissor).not.toHaveBeenCalled();
  });

  it.each([null, 10, NaN])('keeps one pass without a distinct valid Slip position (%s)', (slip) => {
    const h = harness();
    h.getSlipReturnPlayhead.mockReturnValue(slip);
    h.renderer.renderFrame({ getPlayhead: () => 10 });
    expect(h.drawBody).toHaveBeenCalledTimes(1);
    expect(h.gl.enable).not.toHaveBeenCalled();
  });

  it.each([{ modSplit: false }, { isMinimap: true }, { anchor: 'bottom' },
    { externalWindow: true, windowStart: 0, windowEnd: 1 }])('leaves other waveform surfaces unchanged: %j', (overrides) => {
    const h = harness(overrides);
    h.renderer.renderFrame({ getPlayhead: () => 10 });
    expect(h.drawBody).toHaveBeenCalledTimes(1);
    expect(h.getSlipReturnPlayhead).not.toHaveBeenCalled();
  });

  it('restores GL clipping even if a split pass fails', () => {
    const h = harness();
    h.drawBody.mockImplementation(() => { throw new Error('draw failed'); });
    expect(() => h.renderer.renderFrame({ getPlayhead: () => 10 })).toThrow('draw failed');
    expect(h.gl.disable).toHaveBeenLastCalledWith(h.gl.SCISSOR_TEST);
  });
});
