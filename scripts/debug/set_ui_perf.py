#!/usr/bin/env -S uv run --script
# /// script
# dependencies = ["playwright"]
# ///
"""Profile Set dragging in Chromium. Cancels previews; intercepts native-drop writes.

uv run scripts/debug/set_ui_perf.py --url http://localhost:5573 --set-id 2
Install Chromium if needed: uv run --with playwright playwright install chromium
"""

import argparse
import asyncio
import json
import re

from playwright.async_api import async_playwright


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--set-id", type=int, required=True)
    parser.add_argument("--max-step-ms", type=float, default=100)
    args = parser.parse_args()
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": 1600, "height": 1000})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        writes = []
        track_reads = []
        page.on(
            "request",
            lambda request: (
                track_reads.append(request.url)
                if re.search(r"/api/tracks/\d+$", request.url)
                else None
            ),
        )

        async def intercept_write(route):
            writes.append(route.request.post_data_json)
            await route.fulfill(json={})

        await page.route(f"**/api/sets/{args.set_id}/entries", intercept_write)
        await page.goto(args.url)
        await page.wait_for_timeout(4000)
        await page.locator(f'[data-entry-key="set:{args.set_id}"]').click()
        await page.wait_for_timeout(4000)
        await page.wait_for_selector("[data-set-track-row]")
        await page.wait_for_timeout(6000)
        track_reads.clear()
        cdp = await page.context.new_cdp_session(page)
        await cdp.send("Profiler.enable")
        await cdp.send("Profiler.start")
        result = await page.evaluate("""async () => {
          const rows = () => [...document.querySelectorAll('[data-set-track-row]')];
          const original = rows().map(r => r.dataset.setTrackRow);
          const source = rows()[0];
          const dataTransfer = new DataTransfer();
          const activationStart = performance.now();
          source.dispatchEvent(new DragEvent('dragstart', {bubbles:true, dataTransfer}));
          // Native dragstart and the first dragover arrive in separate tasks.
          await new Promise(r => setTimeout(r, 25));
          const activationMs = performance.now() - activationStart;
          const times = [];
          for (let i = 1; i < Math.min(original.length, 35); i++) {
            const target = rows()[i];
            target.scrollIntoView({block:'center'});
            const rect = target.getBoundingClientRect();
            const start = performance.now();
            target.dispatchEvent(new DragEvent('dragover', {
              bubbles:true, cancelable:true, dataTransfer, clientY:rect.bottom-1,
            }));
            await new Promise(r => setTimeout(r, 25));
            times.push(performance.now()-start);
          }
          const changed = rows().map(r => r.dataset.setTrackRow).join() !== original.join();
          await new Promise(r => setTimeout(r, 600));
          source.dispatchEvent(new DragEvent('dragend', {bubbles:true, dataTransfer}));
          await new Promise(r => setTimeout(r, 500));
          return {rows: original.length, changed, restored: rows().map(r => r.dataset.setTrackRow).join() === original.join(),
            activationMs, steps:times.length, meanMs:times.reduce((a,b)=>a+b,0)/times.length, maxMs:Math.max(...times)};
        }""")
        profile = (await cdp.send("Profiler.stop"))["profile"]
        nodes = {n["id"]: n["callFrame"] for n in profile["nodes"]}
        costs = {}
        for sample, delta in zip(profile.get("samples", []), profile.get("timeDeltas", [])):
            frame = nodes[sample]
            key = frame["functionName"] + " " + frame["url"].split("?")[0].split("/src/")[-1]
            costs[key] = costs.get(key, 0) + delta / 1000
        print(json.dumps(result, indent=2))
        print(json.dumps(sorted(costs.items(), key=lambda kv: -kv[1])[:30], indent=2))
        assert not writes, "Preview must not persist"
        # Native Chromium drag/drop, with persistence intercepted above.
        rows = page.locator("[data-set-track-row]")
        source_id = await rows.first.get_attribute("data-set-track-row")
        await rows.first.drag_to(rows.nth(4), target_position={"x": 100, "y": 25})
        await page.wait_for_timeout(700)
        assert len(writes) == 1, writes
        assert await rows.first.get_attribute("data-set-track-row") != source_id
        print("Native drag/drop: one intercepted write; preview cancel: no writes")
        assert not track_reads, f"Reorder refetched {len(track_reads)} tracks"
        assert not errors, errors
        assert result["changed"] and result["restored"], result
        assert result["maxMs"] < args.max_step_ms, result
        await browser.close()


asyncio.run(main())
