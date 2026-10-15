#!/usr/bin/env -S uv run --script
# /// script
# dependencies = ["playwright"]
# ///
"""Frame-pacing probe for desktop surfaces (docs/research/desktop-smoothness.md).

Headed Chromium on the real GPU (audio muted), against a lane dev app. Writes
are intercepted (non-GET /api/** answer {}), so the Sandbox DB is untouched.

Per scenario it reports, over --seconds of steady state:
  frame intervals (rAF): p50/p95/p99/max, dropped frames vs the median vsync
  long tasks (>50 ms), React commits/s and React render ms/s (dev profiler)
  main-thread busy (CDP Performance metrics) and renderer/GPU process CPU %

Scenarios: perform (--decks N, --play), library-scroll, session-replay,
session-pan, editor-play, routine-play.
"""

import argparse
import asyncio
import json
import statistics

from playwright.async_api import async_playwright

INIT = r"""(() => {
  performance.setResourceTimingBufferSize(20000);
  const s = window.__smooth = {frames: [], longtasks: [], commits: 0, renderMs: 0,
    detail: false, renders: {}};
  const raf = window.requestAnimationFrame.bind(window);
  s.heads = [];
  const tick = (t) => {
    s.frames.push(t);
    const e = window.__engines && window.__engines.size ? window.__engines.values().next().value : null;
    if (e && s.trackHead) s.heads.push([t, e.getPlayhead(), e.getVisualPlayhead ? e.getVisualPlayhead() : e.getPlayhead()]);
    raf(tick);
  };
  raf(tick);
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) s.longtasks.push(e.duration);
    }).observe({entryTypes: ['longtask']});
  } catch {}
  const nameOf = (f) => {
    const t = f.type;
    if (!t || typeof t === 'string') return null;
    return t.displayName || t.name || (t.render && (t.render.displayName || t.render.name)) ||
      (t.type && (t.type.displayName || t.type.name)) || null;
  };
  // React DevTools' rule: a function/memo/forwardRef fiber rendered this
  // commit iff PerformedWork (flag 1) is set; subtrees whose child pointer
  // is unchanged since the alternate were not visited at all.
  const RENDERABLE = new Set([0, 1, 11, 14, 15]);
  const walk = (fiber) => {
    const stack = [fiber];
    while (stack.length) {
      const f = stack.pop();
      const prev = f.alternate;
      if (RENDERABLE.has(f.tag) && (f.flags & 1) && (!prev || prev !== f)) {
        const n = nameOf(f);
        if (n) s.renders[n] = (s.renders[n] || 0) + 1;
      }
      if (f.sibling) stack.push(f.sibling);
      if (f.child && !(prev && prev.child === f.child)) stack.push(f.child);
    }
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    isDisabled: false, supportsFiber: true, renderers: new Map(),
    inject(r) { const id = this.renderers.size + 1; this.renderers.set(id, r); return id; },
    onCommitFiberRoot(_id, root) {
      s.commits++;
      const d = root.current.actualDuration;
      if (d) s.renderMs += d;
      if (s.detail) walk(root.current);
    },
    onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {},
    on() {}, off() {}, emit() {}, sub() {},
  };
  // Capture DeckEngine instances as renderers poll them (dev-only probe hook).
  window.__engines = new Set();
  sessionStorage.setItem('manadj-midi-boot-reloaded', '1');
})()"""


def summarize(intervals: list[float]) -> dict:
    if not intervals:
        return {}
    xs = sorted(intervals)
    q = lambda p: xs[min(len(xs) - 1, int(p * len(xs)))]
    vsync = statistics.median(xs)
    dropped = sum(max(0, round(i / vsync) - 1) for i in xs)
    return {
        "frames": len(xs), "vsync_ms": round(vsync, 2), "hz": round(1000 / vsync),
        "p50": round(q(0.5), 2), "p95": round(q(0.95), 2), "p99": round(q(0.99), 2),
        "max": round(xs[-1], 2), "dropped": dropped,
        "dropped_pct": round(100 * dropped / (dropped + len(xs)), 1),
        "over_1_5x": sum(1 for i in xs if i > vsync * 1.5),
    }


def trace_totals(path: str, secs: float) -> dict:
    """Self-time per event name on the renderer main thread (CrRendererMain)."""
    data = json.load(open(path))
    events = data["traceEvents"] if isinstance(data, dict) else data
    main = {(e["pid"], e["tid"]) for e in events
            if e.get("ph") == "M" and e.get("name") == "thread_name" and e["args"].get("name") == "CrRendererMain"}
    gpu = {(e["pid"], e["tid"]) for e in events
           if e.get("ph") == "M" and e.get("name") == "thread_name" and e["args"].get("name") in ("CrGpuMain", "VizCompositorThread")}
    out = {}
    for label, threads in (("main", main), ("gpu_viz", gpu)):
        per_thread: dict = {}
        for e in events:
            if (e.get("pid"), e.get("tid")) in threads and e.get("ph") == "X" and "dur" in e:
                per_thread.setdefault((e["pid"], e["tid"]), []).append(e)
        totals: dict[str, float] = {}
        for evs in per_thread.values():
            evs.sort(key=lambda e: (e["ts"], -e["dur"]))
            stack: list = []
            for e in evs:
                while stack and stack[-1]["ts"] + stack[-1]["dur"] <= e["ts"]:
                    stack.pop()
                if stack:
                    totals[stack[-1]["name"]] = totals.get(stack[-1]["name"], 0) - e["dur"]
                totals[e["name"]] = totals.get(e["name"], 0) + e["dur"]
                stack.append(e)
        out[label] = {k: round(v / 1000 / secs, 1) for k, v in sorted(totals.items(), key=lambda kv: -kv[1])[:18]}
    return out


async def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--url", required=True)
    ap.add_argument("--scenario", default="perform")
    ap.add_argument("--decks", type=int, default=4)
    ap.add_argument("--tracks", default="9,171,600,780")
    ap.add_argument("--play", action="store_true")
    ap.add_argument("--seconds", type=float, default=8)
    ap.add_argument("--warmup", type=float, default=2)
    ap.add_argument("--settle", type=float, default=6)
    ap.add_argument("--react-detail", action="store_true")
    ap.add_argument("--session-at", type=float, default=600, help="session-replay start (s)")
    ap.add_argument("--scroll-px", type=int, default=24, help="library-scroll px per frame")
    ap.add_argument("--profile", action="store_true", help="V8 CPU profile top functions")
    ap.add_argument("--headless", action="store_true")
    ap.add_argument("--trace", help="write a Chrome trace JSON here and print main-thread totals by event")
    ap.add_argument("--width", type=int, default=1600)
    ap.add_argument("--height", type=int, default=1000)
    ap.add_argument("--screenshot")
    ap.add_argument("--label", default="")
    ap.add_argument("--extra-url", default="", help="extra query string")
    ap.add_argument("--eval-file", default="")
    ap.add_argument("--post-eval", default="", help="JS expression evaluated after measuring (printed to stderr)")
    ap.add_argument("--eval", default="", help="JS expression evaluated before warmup (experiments)")
    args = ap.parse_args()
    tracks = [int(t) for t in args.tracks.split(",")]

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=args.headless, args=[
            "--mute-audio", "--autoplay-policy=no-user-gesture-required",
            "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
            "--disable-backgrounding-occluded-windows",
            f"--window-size={args.width},{args.height + 90}",
        ])
        context = await browser.new_context(
            viewport={"width": args.width, "height": args.height}, device_scale_factor=2,
            permissions=["midi", "midi-sysex"])
        page = await context.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        async def settings(route):
            if route.request.method != "GET":
                await route.fulfill(json={})
                return
            resp = await route.fetch()
            data = await resp.json()
            st = data.get("settings", {})
            st["manadj-perf-deck-count"] = str(args.decks)
            st["manadj-tour-state"] = json.dumps({"skippedAll": True})
            await route.fulfill(response=resp, json=data)

        async def guard(route):
            req = route.request
            if req.method in ("GET", "HEAD"):
                await route.continue_()
            elif req.method == "PUT" and req.url.endswith("/edits"):
                # Editor autosave: answer with the would-be saved detail (the
                # editor adopts the response) without persisting anything.
                detail = await (await page.request.get(req.url.removesuffix("/edits"))).json()
                await route.fulfill(json={**detail, **(req.post_data_json or {})})
            else:
                await route.fulfill(json={})

        await page.route("**/api/**", guard)
        await page.route("**/api/settings", settings)
        await page.add_init_script(INIT)
        loaded = {d: (tracks[i] if i < len(tracks) else None) for i, d in enumerate("ABCD")}
        await page.add_init_script(
            f"localStorage.setItem('manadj-loaded-tracks', {json.dumps(json.dumps(loaded))})")

        if args.scenario == "blank":
            await page.goto(f"{args.url}/api-blank-probe")
            await page.set_content("<html><body style='background:#000'><div style='width:40px;height:40px;background:red;animation:m 1s linear infinite'></div><style>@keyframes m{to{transform:translateX(800px)}}</style></body></html>")
        view = {"blank": None, "perform": "performance", "library-scroll": "library",
                "session-replay": "history", "session-pan": "history",
                "editor-play": "routine", "routine-play": "routine"}[args.scenario]
        if view:
            await page.goto(f"{args.url}/?view={view}{args.extra_url}")
            await page.wait_for_selector(".app-shell", timeout=30000)
        if view: await page.evaluate("""async () => {
          const url = performance.getEntriesByType('resource').map(e => e.name)
            .filter(n => n.includes('/src/playback/DeckEngine.ts')).pop() || '/src/playback/DeckEngine.ts';
          let DeckEngine;
          try { ({DeckEngine} = await import(url)); } catch { return; }  // production build
          const orig = DeckEngine.prototype.getPlayhead;
          DeckEngine.prototype.getPlayhead = function(...a) { window.__engines.add(this); return orig.apply(this, a); };
        }""")
        await page.wait_for_timeout(args.settle * 1000)

        action = None
        if args.scenario == "perform" and args.play:
            n = await page.evaluate("""async (decks) => {
              const all = [...window.__engines];
              let started = 0;
              for (const e of all) {
                const snap = e.getSnapshot ? e.getSnapshot() : null;
                if (snap && snap.loadState !== 'ready') continue;
                if (started >= decks) break;
                e.play(); started++;
              }
              return {engines: all.length, started};
            }""", args.decks)
            action = n
        elif args.scenario == "library-scroll":
            action = await page.evaluate("""(stepPx) => {
              const rows = [...document.querySelectorAll('tbody, .track-list, [class*=tracklist]')];
              const scroller = [...document.querySelectorAll('*')].filter(e => {
                const s = getComputedStyle(e);
                return (s.overflowY === 'auto' || s.overflowY === 'scroll') && e.scrollHeight > e.clientHeight * 3;
              }).sort((a,b) => b.scrollHeight - a.scrollHeight)[0];
              if (!scroller) return {error: 'no scroller'};
              window.__scroller = scroller;
              let dir = 1;
              const step = () => {
                if (!window.__scrolling) return;
                const max = scroller.scrollHeight - scroller.clientHeight;
                if (scroller.scrollTop >= max - 40) dir = -1;
                if (scroller.scrollTop <= 40) dir = 1;
                scroller.scrollTop += dir * stepPx;
                requestAnimationFrame(step);
              };
              window.__scrolling = true; requestAnimationFrame(step);
              return {scroller: scroller.className, height: scroller.scrollHeight};
            }""", args.scroll_px)
        elif args.scenario == "session-replay":
            action = await page.evaluate("""async (at) => {
              const mod = (p) => performance.getEntriesByType('resource').map(e => e.name)
                .filter(n => n.includes(p)).pop() || p;
              const {api} = await import(mod('/src/api/client.ts'));
              const rows = await api.sessions.list();
              const dur = s => Date.parse(s.ended_at + 'Z') - Date.parse(s.started_at + 'Z');
              const row = rows.filter(s => s.ended_at).sort((a, b) => dur(b) - dur(a))[0];
              const {requestSessionMoment} = await import(mod('/src/sessions/openSession.ts'));
              requestSessionMoment({sessionUuid: row.uuid, atS: at});
              return {uuid: row.uuid, minutes: Math.round(dur(row) / 60000)};
            }""", args.session_at)
            await page.wait_for_timeout(10000)
            await page.mouse.click(5, args.height - 5)
            await page.keyboard.press("Space")
            await page.wait_for_timeout(4000)
        elif args.scenario == "editor-play":
            action = await page.evaluate("""async () => {
              const mod = (p) => performance.getEntriesByType('resource').map(e => e.name)
                .filter(n => n.includes(p)).pop() || p;
              const {api} = await import(mod('/src/api/client.ts'));
              const rows = await api.routines.list();
              const row = rows.sort((a, b) => (b.cast?.length ?? 0) - (a.cast?.length ?? 0))[0];
              const {requestMixEdit} = await import(mod('/src/routines/openMix.ts'));
              requestMixEdit({open: {kind: 'routine', uuid: row.uuid}});
              return {uuid: row.uuid, cast: row.cast?.length};
            }""")
            await page.wait_for_timeout(8000)
            await page.mouse.click(args.width // 2, args.height - 5)
            await page.keyboard.press("Space")
            await page.wait_for_timeout(2000)

        if args.eval_file:
            args.eval = open(args.eval_file).read()
        if args.eval:
            out_eval = await page.evaluate(args.eval)
            print("eval:", out_eval, file=__import__("sys").stderr, flush=True)
        await page.wait_for_timeout(args.warmup * 1000)
        cdp = await context.new_cdp_session(page)
        bcdp = await browser.new_browser_cdp_session()
        await cdp.send("Performance.enable")
        if args.profile:
            await cdp.send("Profiler.enable")
            await cdp.send("Profiler.setSamplingInterval", {"interval": 200})
            await cdp.send("Profiler.start")

        async def proc():
            info = await bcdp.send("SystemInfo.getProcessInfo")
            return {p["type"] + str(p["id"]): (p["type"], p["cpuTime"]) for p in info["processInfo"]}

        if args.trace:
            await browser.start_tracing(page=page, path=args.trace, categories=[
                "devtools.timeline", "disabled-by-default-devtools.timeline", "blink", "cc", "gpu", "viz", "v8.execute"])
        m0 = {m["name"]: m["value"] for m in (await cdp.send("Performance.getMetrics"))["metrics"]}
        p0 = await proc()
        await page.evaluate(f"""() => {{ const s = window.__smooth; s.frames = []; s.longtasks = [];
          s.heads = []; s.trackHead = true; s.commits = 0; s.renderMs = 0; s.renders = {{}}; s.detail = {str(args.react_detail).lower()};
          if (window.__gpu) {{ window.__gpu.ms = 0; window.__gpu.n = 0; window.__gpu.byKind = {{}}; }} }}""")
        await page.wait_for_timeout(args.seconds * 1000)
        res = await page.evaluate("""() => { const s = window.__smooth; s.detail = false;
          return {heads: s.heads, gpu: window.__gpu ? {ms: window.__gpu.ms, n: window.__gpu.n, noext: !!window.__gpu.noext, byKind: window.__gpu.byKind} : null, frames: s.frames, longtasks: s.longtasks, commits: s.commits, renderMs: s.renderMs, renders: s.renders}; }""")
        if args.trace:
            await browser.stop_tracing()
        m1 = {m["name"]: m["value"] for m in (await cdp.send("Performance.getMetrics"))["metrics"]}
        p1 = await proc()
        secs = args.seconds
        frames = res["frames"]
        intervals = [b - a for a, b in zip(frames, frames[1:])]
        heads = res.get("heads") or []

        def motion(col):
            if len(heads) <= 20 or heads[-1][col] == heads[0][col]:
                return None
            rate = (heads[-1][col] - heads[0][col]) / ((heads[-1][0] - heads[0][0]) / 1000)
            errs, stalls = [], 0
            for a, b in zip(heads, heads[1:]):
                dt = (b[0] - a[0]) / 1000
                if dt <= 0 or b[col] < a[col]:
                    continue
                stalls += b[col] == a[col]
                errs.append(abs((b[col] - a[col]) - rate * dt) * 1000)
            errs.sort()
            return {"rate": round(rate, 4), "frames": len(errs), "stalled_frames": stalls,
                    "step_err_ms_p50": round(errs[len(errs) // 2], 2),
                    "step_err_ms_p95": round(errs[int(len(errs) * 0.95)], 2)}
        head_stats = {"raw": motion(1), "visual": motion(2)} if heads else None
        cpu = {}
        for k, (typ, t1) in p1.items():
            if k in p0:
                cpu[typ] = round(cpu.get(typ, 0) + 100 * (t1 - p0[k][1]) / secs, 1)
        out = {
            "label": args.label, "scenario": args.scenario, "decks": args.decks, "play": args.play,
            "action": action,
            "frame": summarize(intervals),
            "longtasks": {"count": len(res["longtasks"]), "max": round(max(res["longtasks"], default=0), 1)},
            "react": {"commits_per_s": round(res["commits"] / secs, 1),
                      "render_ms_per_s": round(res["renderMs"] / secs, 1)},
            "main_thread_pct": {k: round(100 * (m1[k] - m0[k]) / secs, 1)
                                for k in ("TaskDuration", "ScriptDuration", "LayoutDuration", "RecalcStyleDuration")},
            "process_cpu_pct": cpu,
            "errors": errors[:5],
            "playhead_motion": head_stats,
            "waveform_gpu": None if not res.get("gpu") else {
                "ms_per_s": round(res["gpu"]["ms"] / secs, 1), "draws_per_s": round(res["gpu"]["n"] / secs),
                "noext": res["gpu"]["noext"],
                "by_kind_ms_per_draw": {k: [round(v["ms"] / max(1, v["n"]), 3), round(v["n"] / secs)] for k, v in res["gpu"]["byKind"].items()}},
        }
        if args.react_detail:
            out["react"]["top_renders_per_s"] = {k: round(v / secs, 1) for k, v in
                                                 sorted(res["renders"].items(), key=lambda kv: -kv[1])[:25]}
        if args.profile:
            prof = (await cdp.send("Profiler.stop"))["profile"]
            nodes = {n["id"]: n["callFrame"] for n in prof["nodes"]}
            costs: dict[str, float] = {}
            for sample, delta in zip(prof.get("samples", []), prof.get("timeDeltas", [])):
                f = nodes[sample]
                key = f"{f['functionName'] or '(anon)'} {f['url'].split('?')[0].split('/src/')[-1].split('/deps/')[-1]}:{f['lineNumber'] + 1}"
                costs[key] = costs.get(key, 0) + delta / 1000
            out["cpu_self_ms_per_s"] = {k: round(v / secs, 2) for k, v in
                                        sorted(costs.items(), key=lambda kv: -kv[1])[:30]}
        if args.post_eval:
            print("post-eval:", await page.evaluate(args.post_eval), file=__import__("sys").stderr, flush=True)
        if args.screenshot:
            await page.screenshot(path=args.screenshot)
        if args.trace:
            out["trace_main_ms_per_s"] = trace_totals(args.trace, secs)
        print(json.dumps(out, indent=1))
        await browser.close()


asyncio.run(main())
