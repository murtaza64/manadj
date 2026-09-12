#!/usr/bin/env -S uv run --script
# /// script
# dependencies = ["playwright"]
# ///
"""Check stem waveform pixels using the production WebGL renderer and synthetic data.

uv run scripts/debug/waveform_stems_webgl.py --url http://localhost:<lane-vite-port>
Install Chromium if needed: uv run --with playwright playwright install chromium
"""

import argparse
import asyncio
import json

from playwright.async_api import async_playwright


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    args = parser.parse_args()
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(device_scale_factor=1)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        # Import through Vite without mounting the app or touching library data.
        await page.route("**/__waveform_test", lambda route: route.fulfill(
            content_type="text/html", body="<!doctype html><body></body>"
        ))
        await page.goto(args.url.rstrip("/") + "/__waveform_test")
        result = await page.evaluate("""async () => {
          const { WaveformRendererV2 } = await import('/src/waveform/WaveformRendererV2.ts');
          const { packWaveformArrays } = await import('/src/waveform/blob.ts');
          const { ALL_ON, stemMaskHistoryFor } = await import('/src/performance/stemMaskHistory.ts');
          const canvas = document.createElement('canvas');
          canvas.style.cssText = 'width:300px;height:128px';
          document.body.append(canvas);
          const renderer = new WaveformRendererV2(canvas, { showTimeReadout: false });
          const gl = canvas.getContext('webgl2');
          const data = (peak, bands) => packWaveformArrays({
            header: { version: 2, sampleRate: 512, duration: 30, peakHop: 128,
              bandHop: 512, stftWindow: 2048, nBands: 8, gamma: 0.5,
              bandEdges: [0,1,2,3,4,5,6,7,8], peakCount: 120, bandCount: 30 },
            peaks: new Uint8Array(120).fill(peak),
            bands: Uint8Array.from({length: 240}, (_, i) => bands[i % 8]),
          });
          // Deliberately unlike the all-stem composite: parity must use the mix.
          const mix = data(180, [150,140,130,120,110,100,90,80]);
          const solo = data(90, [50,60,70,80,90,100,110,120]);
          const silence = data(0, Array(8).fill(0));
          const stems = [solo, solo, solo, solo];
          const partial = [1,0,0,0];
          const history = stemMaskHistoryFor('A');
          let checks = 0;
          function render(waveform, mask = null, split = true) {
            renderer.setWaveformData(waveform);
            renderer.setDisplayWindow(0, 1);
            renderer.setStemMask(mask, split);
            renderer.renderFrame({getPlayhead: () => 20});
            const pixels = new Uint8Array(canvas.width * canvas.height * 4);
            gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            if (gl.getError() !== gl.NO_ERROR) throw new Error('WebGL error');
            return pixels;
          }
          function match(actual, expected, x, upper, label, tolerance = 0) {
            // Interior patches avoid playhead/wash boundaries; readPixels is bottom-up.
            let max = 0;
            for (let y = upper ? 66 : 2; y < (upper ? 126 : 62); y++) {
              for (let dx = -3; dx <= 3; dx++) {
                const i = (y * canvas.width + x + dx) * 4;
                for (let c = 0; c < 3; c++) max = Math.max(max, Math.abs(actual[i+c] - expected[i+c]));
              }
            }
            if (max > tolerance) throw new Error(`${label}: pixel difference ${max}`);
            checks++;
          }
          try {
            for (const style of ['additive-rgb', 'spectral-hue']) {
              renderer.setStyle(style);
              for (const modulation of [null, () => ({low: 0.5, mid: 0.7, high: 0.4, gain: 0.8})]) {
                renderer.setModulation(modulation);
                renderer.setModulationSplit(true);
                const original = render(mix);
                const isolated = render(solo);
                const silent = render(silence);
                if (!original.some((v, i) => v !== isolated[i])) throw new Error('Degenerate fixture');
                renderer.setStemWaveforms(stems);
                const allOn = render(mix, () => ALL_ON);
                for (const x of [50, 150, 250]) for (const upper of [false, true]) {
                  match(allOn, original, x, upper, `${style} all-on`);
                }
                for (const split of [true, false]) {
                  const muted = render(mix, () => partial, split);
                  const off = render(mix, () => [0,0,0,0], split);
                  for (const x of [50, 250]) for (const upper of [false, true]) {
                    const raw = split && x > 200 && !upper;
                    match(muted, raw ? original : isolated, x, upper, 'partial mask', 1);
                    match(off, raw ? original : silent, x, upper, 'all muted');
                  }
                }
                history.clear();
                history.record(0, true, partial);
                history.record(10, true, ALL_ON);
                history.record(20, true, ALL_ON);
                for (const live of [ALL_ON, partial]) {
                  const past = render(mix, t => history.at(t, live));
                  for (const upper of [false, true]) {
                    match(past, isolated, 50, upper, 'muted history', 1);
                    match(past, original, 150, upper, 'all-on history');
                    match(past, upper && live === partial ? isolated : original,
                      250, upper, 'live mask after history', 1);
                  }
                }
                renderer.setStemWaveforms(null);
              }
            }
            return {checks};
          } finally { renderer.dispose(); }
        }""")
        assert not errors, errors
        print(json.dumps(result))
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
