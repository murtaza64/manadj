#!/usr/bin/env -S uv run --script
# /// script
# dependencies = ["playwright"]
# ///
"""Measure sustained Session zoom, counting fresh raster work versus stretched blits."""

import argparse
import asyncio
import json

from playwright.async_api import async_playwright


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True, help="Lane dev app URL")
    parser.add_argument("--uuid", help="Defaults to the longest ended Session")
    parser.add_argument("--backend", help="Use UI navigation, including on production builds")
    parser.add_argument("--dpr", type=float, default=2)
    parser.add_argument("--require-live", action="store_true")
    parser.add_argument("--screenshot")
    parser.add_argument("--profile", action="store_true")
    parser.add_argument("--frames", type=int, default=90)
    parser.add_argument("--max-frame-ms", type=float, default=34)
    parser.add_argument("--ui-check", help="Screenshot path prefix; check desktop/narrow session views")
    args = parser.parse_args()
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--disable-background-timer-throttling"])
        page = await browser.new_page(viewport={"width": 1600, "height": 1000}, device_scale_factor=args.dpr)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))

        async def guard(route):
            if route.request.method not in ("GET", "HEAD"):
                await route.fulfill(json={})
            else:
                await route.continue_()

        await page.route("**/api/**", guard)
        await page.add_init_script("""(() => {
          window.sessionPaint = {fresh:0, blit:0};
          for (const method of ['fillRect', 'drawImage']) {
            const original = CanvasRenderingContext2D.prototype[method];
            CanvasRenderingContext2D.prototype[method] = function(...args) {
              if(this.canvas.classList.contains('stl-canvas'))
                window.sessionPaint[method === 'fillRect' ? 'fresh' : 'blit']++;
              return original.apply(this,args);
            };
          }
        })()""")
        await page.goto(args.url)
        print('App loaded', flush=True)
        await page.wait_for_selector(".app-shell")
        await page.wait_for_timeout(3000)
        if args.backend:
            rows = await (await page.request.get(args.backend + '/api/sessions')).json()
            from datetime import datetime
            chosen = next((s for s in rows if s['uuid'] == args.uuid), None) if args.uuid else max(
                (s for s in rows if s['ended_at']),
                key=lambda s: datetime.fromisoformat(s['ended_at']) - datetime.fromisoformat(s['started_at']))
            await page.get_by_text('▦ Sessions', exact=True).first.click()
            print('Session list opened', flush=True)
            await page.wait_for_selector('.session-day')
            target = page.locator(f'[data-session-uuid="{chosen["uuid"]}"] .session-open')
            if not await target.count():
                day = await page.evaluate("""iso => {
                    const d=new Date(/(?:Z|[+-]\\d{2}:?\\d{2})$/i.test(iso)?iso:iso+'Z');
                    return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
                }""", chosen['started_at'])
                await page.locator(f'[aria-controls="sessions-{day}"]').click()
            await target.click()
        else:
            chosen = await page.evaluate("""async uuid => {
          const {api} = await import('/src/api/client.ts');
          const rows = await api.sessions.list();
          const duration = s => Date.parse(s.ended_at+'Z') - Date.parse(s.started_at+'Z');
          const row = uuid ? rows.find(s=>s.uuid===uuid) : rows.filter(s=>s.ended_at).sort((a,b)=>duration(b)-duration(a))[0];
          const {requestSessionMoment} = await import('/src/sessions/openSession.ts');
          requestSessionMoment({sessionUuid:row.uuid,atS:null});
          return row;
            }""", args.uuid)
        await page.wait_for_selector(".stl-canvas")
        print(f'Timeline opened: {chosen["uuid"]}', flush=True)
        await page.wait_for_timeout(8000)
        if not await page.locator('.stl-scroll:visible').count():
            raise RuntimeError({"errors": errors, "body": (await page.locator('body').inner_text())[:4000]})
        cdp = await page.context.new_cdp_session(page)
        await cdp.send('Performance.enable')
        before_metrics = {m['name']: m['value'] for m in (await cdp.send('Performance.getMetrics'))['metrics']}
        if args.profile:
            await cdp.send("Profiler.enable")
            await cdp.send("Profiler.start")
        result = await page.evaluate("""async count => {
          const el = [...document.querySelectorAll('.stl-scroll')].find(e=>e.clientWidth);
          const rect = el.getBoundingClientRect();
          const frame = () => new Promise((resolve,reject)=> {
            const timer=setTimeout(()=>reject(Error('Animation frames stopped')),5000);
            requestAnimationFrame(t=> {clearTimeout(timer); resolve(t);});
          });
          const results = {};
          for(const kind of ['idle','zoom','pan']) {
            const times=[]; let freshFrames=0, blitFrames=0, changedFrames=0, staleFrames=0;
            await frame();
            for(let i=0;i<count;i++) {
              window.sessionPaint={fresh:0,blit:0};
              const start=performance.now();
              const beforeWidth=el.querySelector('.stl-stage').style.width;
              if(kind!=='idle') el.dispatchEvent(new WheelEvent('wheel', {
                bubbles:true,cancelable:true,ctrlKey:kind==='zoom',
                clientX:rect.x+rect.width/2,clientY:rect.y+80,
                deltaY:kind==='zoom' ? (i<count*2/3?-8:8):0,
                deltaX:kind==='pan' ? (i<count/2?12:-12):0,
              }));
              await frame();
              times.push(performance.now()-start);
              freshFrames += Number(window.sessionPaint.fresh>0);
              blitFrames += Number(window.sessionPaint.blit>0);
              if(el.querySelector('.stl-stage').style.width!==beforeWidth) {
                changedFrames++;
                staleFrames += Number(window.sessionPaint.fresh===0);
              }
            }
            times.sort((a,b)=>a-b);
            results[kind]={p50:times[Math.floor(count/2)],p95:times[Math.floor(count*.95)],max:times[count-1],freshFrames,blitFrames,changedFrames,staleFrames,
              canvasWidth:el.querySelector('canvas').width,viewport:el.clientWidth,scroll:el.scrollLeft,scrollWidth:el.scrollWidth,nodes:el.querySelectorAll('*').length,
              tags:[...el.querySelectorAll('*')].reduce((a,e)=>{a[e.tagName]=(a[e.tagName]||0)+1;return a;},{})};
            await new Promise(r=>setTimeout(r,300));
          }
          return results;
        }""", args.frames)
        if args.screenshot:
            await page.screenshot(path=args.screenshot)
        if args.ui_check:
            await page.get_by_title('Zoom to fit', exact=True).click()
            await page.screenshot(path=args.ui_check + '-timeline.png')
            await page.locator('.stl-controls').get_by_role('button', name='Sessions').click()
            await page.wait_for_timeout(1000)
            await page.evaluate("document.querySelector('.sessions-list').scrollTop=0")
            more = page.locator('.session-show-more').first
            await more.scroll_into_view_if_needed()
            section = more.locator('..')
            before_count = await section.locator('.session-row').count()
            await more.click()
            assert await section.locator('.session-row').count() > before_count
            await more.click()
            await page.evaluate("document.querySelector('.sessions-list').scrollTop=0")
            await page.wait_for_timeout(1000)
            await page.screenshot(path=args.ui_check + '-list.png')
            await page.set_viewport_size({'width': 390, 'height': 900})
            await page.wait_for_timeout(500)
            await page.screenshot(path=args.ui_check + '-list-narrow.png')
            dims = await page.locator('.sessions-list').evaluate('(el)=>({width:el.clientWidth,scroll:el.scrollWidth})')
            assert dims['scroll'] <= dims['width'] + 1, dims
            await page.locator('.session-open').first.click()
            await page.wait_for_selector('.stl-canvas')
            await page.wait_for_timeout(1000)
            await page.screenshot(path=args.ui_check + '-timeline-narrow.png')
            print('Day expansion and narrow layouts checked', flush=True)
        costs = {}
        metrics = {m['name']: m['value']-before_metrics.get(m['name'],0)
                   for m in (await cdp.send('Performance.getMetrics'))['metrics']
                   if m['name'] in ('LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'LayoutCount')}
        if args.profile:
            profile = (await cdp.send("Profiler.stop"))["profile"]
            nodes = {n["id"]: n["callFrame"] for n in profile["nodes"]}
            for sample, delta in zip(profile.get("samples", []), profile.get("timeDeltas", [])):
                frame = nodes[sample]
                key = frame["functionName"] + " " + frame["url"].split("?")[0].split("/src/")[-1]
                costs[key] = costs.get(key, 0) + delta / 1000
        print(json.dumps({"session": chosen, "dpr": args.dpr, "frames": result, "errors": errors,
                          "metrics": metrics, "cpu_ms": sorted(costs.items(), key=lambda kv: -kv[1])[:20]}, indent=2))
        await browser.close()
        assert not errors, errors
        if args.require_live:
            assert result["zoom"]["changedFrames"] > 0, result
            assert result["zoom"]["staleFrames"] == 0, result
            assert result["zoom"]["blitFrames"] == 0, result
            assert result["zoom"]["p95"] < args.max_frame_ms, result


asyncio.run(main())
