#!/usr/bin/env -S uv run --script
# /// script
# dependencies = ["playwright"]
# ///
"""Compare waveform frame gaps for beatjump size, loop size, and jumps."""

import argparse
import asyncio
import json
from itertools import pairwise

from playwright.async_api import async_playwright


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--track-id", type=int, default=1)
    parser.add_argument("--profile", action="store_true")
    args = parser.parse_args()
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        page = await browser.new_page(viewport={"width": 1600, "height": 1000})
        await page.add_init_script("""performance.setResourceTimingBufferSize(10000);
          navigator.requestMIDIAccess = async () => ({inputs: new Map(), outputs: new Map(),
            addEventListener() {}, removeEventListener() {}});""")
        await page.goto(f"{args.url}/?view=performance")
        await page.wait_for_function("!!window.__manadj")
        await page.evaluate("id => __manadj.loadTrackById('A', id)", args.track_id)
        await page.wait_for_function("__manadj.engines.A.getSnapshot().loadState === 'ready'", timeout=60000)
        await page.evaluate("""async () => {
          const url = performance.getEntriesByType('resource').find(e =>
            new URL(e.name).pathname.endsWith('/src/waveform/WaveformRendererV2.ts')).name;
          const {WaveformRendererV2} = await import(url);
          const render = WaveformRendererV2.prototype.renderFrame;
          window.frames = [];
          WaveformRendererV2.prototype.renderFrame = function(clock) {
            if (clock === __manadj.engines.A) frames.push(performance.now());
            return render.call(this, clock);
          };
          __manadj.engines.A.seek(30);
          __manadj.engines.A.play();
        }""")
        await page.wait_for_timeout(3000)
        cdp = await page.context.new_cdp_session(page)
        await cdp.send("Profiler.enable")
        results = {}
        for name, title in [("loop-size", "Double loop size"),
                            ("jump", "Jump forward"),
                            ("beatjump-size", "Double beatjump size")]:
            gaps = []
            for trial in range(3):
                await page.evaluate("frames.length = 0")
                await page.wait_for_timeout(100)
                if args.profile:
                    await cdp.send("Profiler.start")
                button_title = title.replace("Double", "Halve") if trial % 2 else title
                await page.locator(f'button[title^="{button_title}"]:visible').first.click()
                await page.wait_for_timeout(400)
                times = await page.evaluate("frames")
                assert len(times) > 5, "Playing waveform must keep rendering"
                gaps.append(max(b - a for a, b in pairwise(times)))
                if args.profile:
                    profile = (await cdp.send("Profiler.stop"))["profile"]
                    nodes = {n["id"]: n["callFrame"] for n in profile["nodes"]}
                    costs = {}
                    for sample, delta in zip(profile.get("samples", []), profile.get("timeDeltas", [])):
                        frame = nodes[sample]
                        key = frame["functionName"] + " " + frame["url"].split("?")[0].split("/src/")[-1]
                        costs[key] = costs.get(key, 0) + delta / 1000
                    print(name, json.dumps(sorted(costs.items(), key=lambda x: -x[1])[:12]))
            results[name] = gaps
        print(json.dumps(results, indent=2))
        await browser.close()
        assert max(results["beatjump-size"]) < 100, "Beatjump size stalls waveform for >=100ms"


asyncio.run(main())
