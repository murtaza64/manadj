#!/usr/bin/env -S uv run --script
# /// script
# dependencies = [
#     "pillow>=12.3.0",
#     "playwright",
# ]
# ///
"""Measure Mix editor idle and pan/zoom work against a sandbox saved mix artifact."""

import argparse
import asyncio
import json

from playwright.async_api import async_playwright


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--uuid")
    parser.add_argument("--routine", help="Saved routine UUID")
    parser.add_argument("--backend", help="Open through the picker instead of dev imports (production builds)")
    parser.add_argument("--profile", action="store_true")
    parser.add_argument("--screenshot")
    parser.add_argument("--interactions", action="store_true")
    parser.add_argument("--scroll-check", action="store_true")
    parser.add_argument("--selection-check", action="store_true")
    parser.add_argument("--width", type=int, default=1600)
    parser.add_argument("--dpr", type=float, default=2)
    parser.add_argument("--max-pan-paints", type=int, default=4)
    parser.add_argument("--max-frame-ms", type=float, default=17)
    args = parser.parse_args()
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=[
            '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
            '--disable-backgrounding-occluded-windows',
        ])
        page = await browser.new_page(viewport={"width": args.width, "height": 1000}, device_scale_factor=args.dpr)
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: print(m.text, flush=True) if m.text.startswith("[editor-perf]") else None)
        # Never persist artifact edits from a performance probe.
        async def guard(route):
            if route.request.method == "PUT" and "/api/routines/" in route.request.url and route.request.url.endswith("/edits"):
                detail = await (await page.request.get(route.request.url.removesuffix("/edits"))).json()
                await route.fulfill(json={**detail, **route.request.post_data_json})
            elif route.request.method in ("PUT", "PATCH", "DELETE", "POST"):
                await route.fulfill(json={})
            else:
                await route.continue_()
        await page.route("**/api/transitions/**", guard)
        await page.route("**/api/routines/**", guard)
        await page.add_init_script("""(() => {
          window.wavePaints = 0;
          window.lanePaints = 0;
          window.stripPaints = 0;
          window.canvasPaints = new WeakMap();
          const clear = CanvasRenderingContext2D.prototype.clearRect;
          CanvasRenderingContext2D.prototype.clearRect = function(...args) {
            window.canvasPaints.set(this.canvas, (window.canvasPaints.get(this.canvas) || 0) + 1);
            if (this.canvas.parentElement?.classList.contains('rt-wave-row')) window.wavePaints++;
            if (this.canvas.parentElement?.classList.contains('editor-lanehit')) window.lanePaints++;
            if (this.canvas.parentElement?.classList.contains('rt-lanestrip')) window.stripPaints++;
            return clear.apply(this,args);
          };
        })()""")
        await page.goto(args.url + "/?view=routine")
        await page.wait_for_selector(".mp-search")
        if args.routine and args.backend:
            row = await (await page.request.get(f"{args.backend}/api/routines/{args.routine}")).json()
            group = page.locator('.mp-group').filter(has_text='Saved Routines').locator('..')
            label = row['name'] or f"{len(row['cast'])}-track routine"
            await group.locator('.mp-row').filter(has_text=label).click()
            chosen = {"kind": "routine", "uuid": args.routine}
        elif args.routine:
            chosen = await page.evaluate("""async uuid => {
              const {requestMixEdit} = await import('/src/routines/openMix.ts');
              requestMixEdit({open:{kind:'routine',uuid}});
              return {kind:'routine',uuid};
            }""", args.routine)
        elif args.backend:
            rows = await (await page.request.get(args.backend + "/api/transitions")).json()
            row = next(r for r in rows if not args.uuid or r["uuid"] == args.uuid)
            chosen = {"uuid": row["uuid"], "a": row["a_track_id"], "b": row["b_track_id"]}
            for track_id in (chosen["a"], chosen["b"]):
                track = await (await page.request.get(f"{args.backend}/api/tracks/{track_id}")).json()
                await page.locator(".mp-search").fill(track["title"] or track["filename"])
                await page.locator(".mp-row").filter(has_text=track["title"] or track["filename"]).first.click()
            group = page.locator(".mp-group").filter(has_text="Transitions").locator("..")
            await group.locator(".mp-row").filter(has_text=row["name"] or "Transition").first.click()
        else:
            chosen = await page.evaluate("""async uuid => {
          const {api} = await import('/src/api/client.ts');
          const rows = await api.transitions.list();
          const row = uuid ? rows.find(r => r.uuid===uuid) : rows[0];
          if (!row) throw Error('No saved transition');
          const {requestMixEdit} = await import('/src/routines/openMix.ts');
          requestMixEdit({open:{kind:'transition',aTrackId:row.a_track_id,bTrackId:row.b_track_id,uuid:row.uuid}});
          return {uuid:row.uuid, a:row.a_track_id,b:row.b_track_id};
            }""", args.uuid)
        await page.wait_for_selector(".rt-wave-row > canvas")
        await page.wait_for_timeout(5000)
        # Metadata and waveform arrivals are valid paints, not idle regressions.
        await page.evaluate("""async () => {
          let last = window.wavePaints, quiet = 0;
          for(let i=0;i<40 && quiet<4;i++) {
            await new Promise(r => setTimeout(r,250));
            quiet = last===window.wavePaints ? quiet+1 : 0;
            last=window.wavePaints;
          }
        }""")
        if not await page.locator('.rt-wave-row > canvas').count():
            raise RuntimeError({"errors": errors, "page": (await page.locator('body').inner_text())[:3000]})
        print(f"Loaded {chosen}", flush=True)
        cdp = await page.context.new_cdp_session(page)
        if args.profile:
            await cdp.send("Profiler.enable")
            await cdp.send("Profiler.start")
        result = await page.evaluate("""async () => {
          const frame = () => new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(Error('Animation frames stopped: '+document.visibilityState)), 5000);
            requestAnimationFrame(t => {clearTimeout(timer); resolve(t);});
          });
          const canvas = document.querySelector('.rt-wave-row > canvas');
          const rect = canvas.parentElement.getBoundingClientRect();
          const measure = async (kind) => {
            console.log('[editor-perf] '+kind);
            const times=[];
            const initial = canvas.style.transform + canvas.width;
            let moved = false;
            window.wavePaints=0;
            window.lanePaints=0;
            window.stripPaints=0;
            await frame();
            for(let i=0;i<90;i++) {
              const t=performance.now();
              if(kind!=='idle') canvas.dispatchEvent(new WheelEvent('wheel', {
                bubbles:true,cancelable:true,clientX:rect.x+rect.width/2,clientY:rect.y+20,
                deltaX:kind==='pan' ? (i<45?12:-12):0,
                deltaY:kind==='zoom' ? (i<45?-4:4):0,ctrlKey:kind==='zoom',
              }));
              await frame();
              moved ||= canvas.style.transform + canvas.width !== initial;
              times.push(performance.now()-t);
            }
            times.sort((a,b)=>a-b);
            return {paints:window.wavePaints,lanePaints:window.lanePaints,stripPaints:window.stripPaints,moved,p50:times[45],p95:times[85],max:times[89],over34:times.filter(t=>t>34).length};
          };
          return {idle:await measure('idle'),pan:await measure('pan'),zoom:await measure('zoom')};
        }""")
        profile = (await cdp.send("Profiler.stop"))["profile"] if args.profile else {"nodes": []}
        nodes = {n["id"]: n["callFrame"] for n in profile["nodes"]}
        costs = {}
        for sample, delta in zip(profile.get("samples", []), profile.get("timeDeltas", [])):
            f = nodes[sample]
            key = f["functionName"] + " " + f["url"].split("?")[0].split("/src/")[-1]
            costs[key] = costs.get(key, 0) + delta / 1000
        print(json.dumps({"transition": chosen, "frames": result, "cpu_ms": sorted(costs.items(), key=lambda kv: -kv[1])[:25], "errors":errors}, indent=2))
        if args.scroll_check:
            before = await page.evaluate("""() => {
              const waves = [...document.querySelectorAll('.rt-wave-row > canvas')];
              const canvas = waves[0], rect = canvas.parentElement.getBoundingClientRect();
              canvas.dispatchEvent(new WheelEvent('wheel', {bubbles:true,cancelable:true,ctrlKey:true,
                deltaY:-20,clientX:rect.x+rect.width/2,clientY:rect.y+20}));
              return window.canvasPaints.get(waves.at(-1)) || 0;
            }""")
            await page.wait_for_timeout(100)
            await page.locator('.rt-wave-row').last.scroll_into_view_if_needed()
            await page.wait_for_function("""before => {
              const wave = [...document.querySelectorAll('.rt-wave-row > canvas')].at(-1);
              return (window.canvasPaints.get(wave) || 0) > before;
            }""", arg=before)
            await page.evaluate("document.querySelector('.rt-timeline').scrollTop = 0")
            await page.wait_for_timeout(100)
            print("Offscreen last row repaints on re-entry after zoom.")
        if args.interactions:
            await page.locator('button[title="Fit the window"]').click()
            await page.wait_for_timeout(200)
            signature = "() => [...document.querySelectorAll('.rt-wave-row > canvas')].map(c => c.toDataURL())"
            before = await page.evaluate(signature)
            row = page.locator('.rt-wave-row').nth(1)
            rect = await row.bounding_box()
            x, y = rect["x"] + rect["width"] * 0.65, rect["y"] + rect["height"] / 2
            await page.mouse.click(x, y)
            await page.keyboard.down("Alt")
            await page.mouse.move(x, y)
            await page.mouse.down()
            await page.mouse.move(x + 80, y, steps=8)
            await page.mouse.up()
            await page.keyboard.up("Alt")
            await page.wait_for_timeout(200)
            assert await page.evaluate(signature) != before, "Material drag did not invalidate waveform"
            await page.keyboard.press("ControlOrMeta+z")
            await page.wait_for_timeout(200)
            assert await page.evaluate(signature) == before, "Undo did not restore waveform pixels"
            print("Native material drag invalidates waveforms; undo restores identical pixels (writes intercepted).")
        if args.selection_check:
            from io import BytesIO
            from PIL import Image

            await page.locator('button[title="Fit the window"]').click()
            rows = page.locator('.rt-wave-row')
            for index in (0, 1):
                rect = await rows.nth(index).bounding_box()
                await rows.nth(index).click(position={'x': rect['width'] * 0.8, 'y': rect['height'] / 2},
                                            modifiers=['Control'] if index else [])
            await page.mouse.move(20, 20)
            for stage in ('selected', 'after navigation'):
                if stage == 'after navigation':
                    await rows.first.dispatch_event('wheel', {'deltaX': 120, 'deltaY': 0})
                    await rows.first.dispatch_event('wheel', {'deltaY': -20, 'ctrlKey': True})
                    await page.wait_for_timeout(100)
                selected = await page.locator('.rt-wave-row.rt-selected').evaluate_all("""rows => rows.map(row => {
                  const r = row.getBoundingClientRect(), style = getComputedStyle(row);
                  return {x:r.x,y:r.y,width:r.width,height:r.height,
                    color:style.outlineColor.match(/\\d+/g).map(Number), outline:style.outlineWidth,
                    overlay:getComputedStyle(row,'::after').outlineWidth};
                })""")
                assert len(selected) == 2, selected
                image = Image.open(BytesIO(await page.screenshot(path=args.screenshot))).convert('RGB')
                samples = []
                for row in selected:
                    for inset in (1.5, 2.0):
                        positions = [
                            (row['x'] + row['width'] * 0.8, row['y'] + inset),
                            (row['x'] + row['width'] * 0.8, row['y'] + row['height'] - inset),
                            (row['x'] + inset, row['y'] + row['height'] * 0.8),
                            (row['x'] + row['width'] - inset, row['y'] + row['height'] * 0.8),
                        ]
                        for x, y in positions:
                            pixel = image.getpixel((round(x * args.dpr), round(y * args.dpr)))
                            samples.append(max(abs(a-b) for a,b in zip(pixel, row['color'])) <= 12)
                print(json.dumps({'selection':stage, 'rows':selected, 'visibleEdgeSamples':sum(samples), 'total':len(samples)}, indent=2))
                assert all(samples), 'Selection border is too thin or covered by the waveform'
            print('Two selected rows retain visible borders through pan/zoom.')
        if args.screenshot:
            await page.locator('button[title="Fit the window"]').click()
            await page.screenshot(path=args.screenshot)
        await browser.close()
        assert not errors, errors
        assert result["idle"]["paints"] == 0, "Stationary waveform is repainting"
        assert all(result[k]["paints"] > 0 or result[k]["moved"] for k in ("pan", "zoom")), "Probe did not move the view"
        assert result["pan"]["paints"] <= args.max_pan_paints, "Pan raster cache regressed"
        assert all(result[k]["p95"] < args.max_frame_ms for k in ("pan", "zoom")), result


asyncio.run(main())
