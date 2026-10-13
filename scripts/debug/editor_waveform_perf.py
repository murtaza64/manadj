#!/usr/bin/env -S uv run --script
# /// script
# dependencies = ["playwright"]
# ///
"""Compare real waveform column output and CPU time between two dev servers."""

import argparse
import asyncio
import json
import math

from playwright.async_api import async_playwright


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--baseline-url", required=True)
    parser.add_argument("--track-id", type=int, default=9)
    args = parser.parse_args()
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        results = []
        for url in (args.baseline_url, args.url):
            page = await browser.new_page()
            # Load modules without booting React, audio or the application stores.
            await page.goto(url + "/@vite/client")
            results.append(await page.evaluate("""async trackId => {
              const {api} = await import('/src/api/client.ts');
              const {decodeWaveformBlob} = await import('/src/waveform/blob.ts');
              const {createStyledColumnRenderer} = await import('/src/sets/ladderWaveStyle.ts');
              const {DEFAULT_PARAMS, STYLE_REGISTRY} = await import('/src/waveform/styles.ts');
              const wave = decodeWaveformBlob(await api.waveforms.getData(trackId));
              const result = {};
              for (const style of STYLE_REGISTRY) {
                const render = createStyledColumnRenderer(wave, style.id, DEFAULT_PARAMS).render;
                const mod = x => ({eq:[x%7/3,0.8,1.2],scale:x%11/5});
                const output = [1,0.4,1].map(brightness => render(10,40,128,brightness,mod));
                for(let i=0;i<15;i++) render(10,40,1600,1,mod);
                const times=[];
                for(let i=0;i<40;i++) {
                  const start=performance.now();
                  for(let n=0;n<5;n++) render(10+i/10,40+i/10,1600,1,mod);
                  times.push((performance.now()-start)/5);
                }
                times.sort((a,b)=>a-b);
                result[style.id]={medianMs:times[20],output};
              }
              return result;
            }""", args.track_id))
            await page.close()
        await browser.close()
    baseline, current = results
    for style in baseline:
        for before, after in zip(baseline[style]["output"], current[style]["output"], strict=True):
            for a, b in zip(before, after, strict=True):
                assert a["outOfTrack"] == b["outOfTrack"]
                assert len(a["segments"]) == len(b["segments"])
                for s, t in zip(a["segments"], b["segments"], strict=True):
                    assert s["css"] == t["css"], (style, s, t)
                    assert math.isclose(s["y0"], t["y0"], abs_tol=1e-12)
                    assert math.isclose(s["y1"], t["y1"], abs_tol=1e-12)
    print(json.dumps({s: {"before_ms": baseline[s]["medianMs"], "after_ms": current[s]["medianMs"]} for s in baseline}, indent=2))
    print("All styles: identical colors and segment geometry within 1e-12, including modulation and brightness changes.")


asyncio.run(main())
