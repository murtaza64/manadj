#!/usr/bin/env -S uv run --script
# /// script
# dependencies = ["playwright"]
# ///
"""Measure simultaneous keyboard deck starts against a sandbox lane app."""

import argparse
import asyncio
import json

from playwright.async_api import async_playwright


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--track-id", type=int, default=1)
    parser.add_argument("--follow-off", action="store_true")
    parser.add_argument("--profile", action="store_true")
    args = parser.parse_args()
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        page = await browser.new_page(viewport={"width": 1600, "height": 1000})
        await page.add_init_script("""navigator.requestMIDIAccess = async () => ({
          inputs: new Map(), outputs: new Map(), addEventListener() {}, removeEventListener() {}
        });""")
        page.on("pageerror", lambda e: print("PAGE ERROR:", e))
        page.on("console", lambda m: print("CONSOLE:", m.text) if m.type in ("warning", "error") or "vite" in m.text else None)
        page.on("framenavigated", lambda f: print("NAVIGATED:", f.url))
        await page.goto(f"{args.url}/?view=performance")
        await page.wait_for_function("!!window.__manadj")
        await page.evaluate("""async id => {
          const {setQuantize} = await import('/src/playback/quantizeStore.ts');
          setQuantize(false);
          await Promise.all(['A', 'B'].map(d => __manadj.loadTrackById(d, id)));
        }""", args.track_id)
        await page.wait_for_function("""() => ['A', 'B'].every(d =>
          __manadj.engines[d].getSnapshot().loadState === 'ready')""", timeout=60000)
        await page.evaluate("""async off => {
          const {getFollowFlags, dispatchFollow} = await import('/src/follow/followStore.ts');
          for (const deck of ['A', 'B', 'C', 'D']) {
            if (getFollowFlags()[deck] !== (!off && deck === 'A')) {
              dispatchFollow({type: 'toggle', deck, loaded: true});
            }
          }
        }""", args.follow_off)
        await page.evaluate("""() => {
          window.timing = [];
          document.addEventListener('keydown', e => timing.push({
            kind: 'key', key: e.key, eventTime: e.timeStamp, wall: performance.now(),
            audio: __manadj.mixer.now(),
          }), true);
          for (const d of ['A', 'B']) {
            const engine = __manadj.engines[d];
            engine.pause(); engine.seek(30); engine.setPitch(0);
            const original = engine.beginStart.bind(engine);
            engine.beginStart = (...args) => {
              const before = performance.now();
              original(...args);
              timing.push({kind: 'start', deck: d, wall: performance.now(),
                cost: performance.now() - before, audio: engine.anchorCtxTime,
                position: engine.anchorPosition});
            };
          }
        }""")
        await page.wait_for_timeout(1500)
        cdp = await page.context.new_cdp_session(page)
        if args.profile:
            await cdp.send("Profiler.enable")
        results = []
        for trial in range(5):
            await page.evaluate("""() => {
              for (const d of ['A', 'B']) {
                __manadj.engines[d].pause(); __manadj.engines[d].seek(30);
              }
              timing.length = 0;
            }""")
            await page.wait_for_timeout(500)
            if args.profile:
                await cdp.send("Profiler.start")
            await asyncio.gather(*[cdp.send("Input.dispatchKeyEvent", {
                "type": "keyDown", "key": key, "code": code,
                "windowsVirtualKeyCode": ord(key.upper()),
            }) for key, code in [("d", "KeyD"), ("k", "KeyK")]])
            await page.wait_for_timeout(300)
            for key in ["d", "k"]:
                await cdp.send("Input.dispatchKeyEvent", {"type": "keyUp", "key": key})
            result = await page.evaluate("""() => ({timing: [...timing],
              delta: __manadj.engines.A.getPlayhead() - __manadj.engines.B.getPlayhead(),
              states: ['A', 'B'].map(d => __manadj.engines[d].getSnapshot().playing)})""")
            results.append(result)
            print(json.dumps({"trial": trial, **result}, indent=2))
            if args.profile:
                profile = (await cdp.send("Profiler.stop"))["profile"]
                nodes = {n["id"]: n["callFrame"] for n in profile["nodes"]}
                costs = {}
                for sample, delta in zip(profile.get("samples", []), profile.get("timeDeltas", [])):
                    frame = nodes[sample]
                    key = frame["functionName"] + " " + frame["url"].split("?")[0].split("/src/")[-1]
                    costs[key] = costs.get(key, 0) + delta / 1000
                print(json.dumps(sorted(costs.items(), key=lambda item: -item[1])[:15], indent=2))
        await browser.close()
        assert all(all(r["states"]) for r in results), "Both decks must start"
        assert max(abs(r["delta"]) for r in results) < 0.02, "Simultaneous starts diverged by >20ms"


asyncio.run(main())
