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
    parser.add_argument("--other-track-id", type=int)
    parser.add_argument("--follow-off", action="store_true")
    parser.add_argument("--profile", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--max-handler-gap-ms", type=float, default=20)
    args = parser.parse_args()
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        page = await browser.new_page(viewport={"width": 1600, "height": 1000})
        await page.add_init_script("""performance.setResourceTimingBufferSize(10000);
        navigator.requestMIDIAccess = async () => ({
          inputs: new Map(), outputs: new Map(), addEventListener() {}, removeEventListener() {}
        });""")
        page.on("pageerror", lambda e: print("PAGE ERROR:", e))
        page.on("console", lambda m: print("CONSOLE:", m.text) if m.type in ("warning", "error") or "vite" in m.text else None)
        page.on("framenavigated", lambda f: print("NAVIGATED:", f.url))
        await page.goto(f"{args.url}/?view=performance")
        await page.wait_for_function("!!window.__manadj")
        await page.evaluate("""async ([a, b]) => {
          const {setQuantize} = await import('/src/playback/quantizeStore.ts');
          setQuantize(false);
          await Promise.all([__manadj.loadTrackById('A', a), __manadj.loadTrackById('B', b)]);
        }""", [args.track_id, args.other_track_id or args.track_id])
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
        await page.evaluate("""async () => {
          window.timing = [];
          const moduleUrl = performance.getEntriesByType('resource').find(e =>
            new URL(e.name).pathname.endsWith('/src/follow/rankedFollow.ts'))?.name;
          if (!moduleUrl) throw new Error('Follow ranking module was not loaded');
          const {FollowRanking} = await import(moduleUrl);
          const derive = FollowRanking.prototype.derive;
          FollowRanking.prototype.derive = function (...args) {
            const before = performance.now();
            const result = derive.apply(this, args);
            timing.push({kind: 'follow-derive', cost: performance.now() - before,
              references: args[0].map(r => r.track.id)});
            const project = result.project;
            result.project = (...args) => {
              const before = performance.now();
              const tracks = project(...args);
              timing.push({kind: 'follow-project', cost: performance.now() - before});
              return tracks;
            };
            return result;
          };
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
            keys = [e for e in result["timing"] if e["kind"] == "key"]
            assert len(keys) == 2, "Expected both keyboard events"
            summary = {"handler_gap_ms": keys[1]["wall"] - keys[0]["wall"],
                       "phase_ms": result["delta"] * 1000, "playing": result["states"]}
            print(json.dumps({"trial": trial, **(result if args.verbose else summary)}, indent=2))
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
        for result in results:
            for event in result["timing"]:
                if event["kind"] == "follow-derive":
                    assert len(set(event["references"])) == len(event["references"]), event
        assert max(abs(r["delta"]) for r in results) < 0.02, "Simultaneous starts diverged by >20ms"
        keys = [[entry for entry in r["timing"] if entry["kind"] == "key"] for r in results]
        gaps = [events[1]["wall"] - events[0]["wall"] for events in keys]
        print(f"Handler gaps (ms): {gaps}")
        for kind in ("follow-derive", "follow-project"):
            costs = [e["cost"] for r in results for e in r["timing"] if e["kind"] == kind]
            print(f"Max {kind} (ms): {max(costs) if costs else 'not observed'}")
        assert max(gaps) < args.max_handler_gap_ms, "UI work delayed the second keyboard handler"


asyncio.run(main())
