/**
 * Silence-loop past-EOF tail rendering (gh#424, user's MCR choice A):
 * the minimap domain extends to cover a region that runs past the last
 * audible sample, so the flat tail, its projected ticks and the green
 * loop band stay visible, and the folded phantom playhead lands inside
 * the canvas. GL is irrelevant here: instances are built via
 * Object.create with only the fields computeView/pushPlayhead read.
 */
import { describe, expect, it } from 'vitest';
import { WaveformRendererV2 } from './WaveformRendererV2';

type Fields = Record<string, unknown>;

interface View {
  startTime: number;
  visibleSeconds: number;
  playhead: number;
  w: number;
  h: number;
  dpr: number;
}

function makeMinimap(duration: number, regions: { start: number; end: number }[]) {
  const renderer = Object.create(WaveformRendererV2.prototype) as WaveformRendererV2;
  Object.assign(renderer as unknown as Fields, {
    isMinimap: true,
    externalWindow: false,
    data: { duration },
    regions: regions.map((r) => ({ ...r, color: [0, 1, 0], fillAlpha: 0.18, edges: true })),
    lastPlayhead: 0,
    config: {},
  });
  return renderer;
}

function computeView(renderer: WaveformRendererV2, w = 1000, h = 100): View {
  return (renderer as unknown as { computeView: (w: number, h: number, dpr: number) => View })
    .computeView(w, h, 1);
}

function playheadX(renderer: WaveformRendererV2, view: View): number {
  const verts: number[] = [];
  (renderer as unknown as { pushPlayhead: (v: View, out: number[]) => void }).pushPlayhead(
    view,
    verts,
  );
  return verts[0];
}

describe('minimap domain with a silence loop', () => {
  it('extends the visible domain to cover a region running past EOF', () => {
    // 300s track, 64-beat silence loop at 120bpm: 32s region from 320 to 352.
    const renderer = makeMinimap(300, [{ start: 320, end: 352 }]);
    const view = computeView(renderer);
    expect(view.startTime).toBe(0);
    expect(view.visibleSeconds).toBe(352);
  });

  it('keeps the domain at track duration without a past-EOF region', () => {
    expect(computeView(makeMinimap(300, [])).visibleSeconds).toBe(300);
    expect(computeView(makeMinimap(300, [{ start: 100, end: 104 }])).visibleSeconds).toBe(300);
  });

  it('maps the folded phantom playhead (past duration) inside the canvas', () => {
    const renderer = makeMinimap(300, [{ start: 320, end: 352 }]);
    const view = computeView(renderer);
    // Playhead folded mid-loop: 336 = half of the 320..352 region.
    const x = playheadX(renderer, { ...view, playhead: 336 });
    expect(x).toBeCloseTo((336 / 352) * 1000, 6);
    expect(x).toBeLessThan(1000);
    // Without the extension the same playhead would land off-canvas
    // (336/300 * 1000 = 1120) — the old duration-normalized mapping.
    expect((336 / 300) * 1000).toBeGreaterThan(1000);
  });
});
