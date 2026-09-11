#!/usr/bin/env -S uv run --script
# /// script
# dependencies = ["playwright"]
# ///
"""Browser-only Set smoke test; all backend writes are intercepted.

uv run scripts/debug/set_move_smoke.py --url http://localhost:5573 --set-id 2
Install Chromium: uv run --with playwright playwright install chromium
"""

import argparse
import asyncio
import json
from pathlib import Path
from urllib.parse import urlparse

from playwright.async_api import async_playwright


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--set-id", type=int, required=True)
    parser.add_argument(
        "--include-payloads", action="store_true", help="Print full captured PUT bodies"
    )
    parser.add_argument(
        "--include-samples", action="store_true", help="Print per-frame scroll samples"
    )
    args = parser.parse_args()
    screenshots = Path(__file__).resolve().parents[2] / ".lane-app"
    if not screenshots.is_dir():
        parser.error("Expected an existing .lane-app screenshot directory")
    report = {"url": args.url, "set_id": args.set_id, "checks": [], "edges": {}}
    writes, blocked, errors, boot_writes = [], [], [], []

    def check(name, passed, **details):
        report["checks"].append({"name": name, "pass": bool(passed), **details})

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1600, "height": 1000}, service_workers="block"
        )

        async def intercept(route):
            request = route.request
            if request.method in ("GET", "HEAD", "OPTIONS"):
                await route.continue_()
            elif (
                request.method == "PUT"
                and urlparse(request.url).path == f"/api/sets/{args.set_id}/entries"
            ):
                writes.append(request.post_data_json)
                await route.fulfill(json={})
            elif (request.method, urlparse(request.url).path) in (
                ("PUT", "/api/settings/trackListSort"),
                ("POST", "/api/sessions/recover"),
            ):
                boot_writes.append({"method": request.method, "url": request.url})
                await route.fulfill(json={"closed": 0} if request.method == "POST" else {})
            else:
                blocked.append({"method": request.method, "url": request.url})
                await route.abort("blockedbyclient")

        await context.route("**/*", intercept)
        await context.add_init_script("""(() => {
            // Headless Chromium has no MIDI device; suppress the adapter's one-shot reload.
            sessionStorage.setItem('manadj-midi-boot-reloaded', '1');
            window.smokeDragEvents = [];
            for (const type of ['dragstart', 'dragover', 'dragend', 'drop']) {
                document.addEventListener(type, e => window.smokeDragEvents.push({
                    type, trusted: e.isTrusted, x: e.clientX, y: e.clientY
                }), true);
            }
        })()""")
        page = await context.new_page()
        page.set_default_timeout(12000)
        page.on("pageerror", lambda error: errors.append(str(error)))
        try:
            await page.goto(args.url)
            await page.wait_for_timeout(5000)
            await page.locator(f'[data-entry-key="set:{args.set_id}"]').click()
            rows = page.locator("[data-set-track-row]")
            await rows.first.wait_for()
            await page.wait_for_timeout(6000)
            pane = await rows.first.evaluate_handle("r => r.closest('[tabindex=\"-1\"]')")

            async def order():
                return await rows.evaluate_all("rs => rs.map(r => Number(r.dataset.setTrackRow))")

            original = await order()
            report["tracks"] = len(original)
            assert len(original) > 50, "Choose a Set with more than 50 tracks"

            async def geometry():
                return await pane.evaluate("""p => {
                    const r = p.getBoundingClientRect();
                    return {x:r.x, y:r.y, width:r.width, height:r.height,
                        bannerHeight:p.querySelector('.set-move-banner')?.getBoundingClientRect().height ?? 0,
                        scrollTop:p.scrollTop, max:p.scrollHeight-p.clientHeight};
                }""")

            async def wheel_to(locator):
                # Wheel only: locator.click must not do the navigation for us.
                for _ in range(100):
                    box, area = await locator.bounding_box(), await geometry()
                    assert box, "Destination has no bounding box"
                    center = box["y"] + box["height"] / 2
                    top = area["y"] + area["bannerHeight"] + 4
                    bottom = area["y"] + area["height"] - 4
                    if top <= center <= bottom:
                        return
                    await page.mouse.move(area["x"] + 100, (top + bottom) / 2)
                    await page.mouse.wheel(0, max(-650, min(650, center - (top + bottom) / 2)))
                    await page.wait_for_timeout(70)
                raise AssertionError("Wheel navigation did not reach destination")

            async def sample(count=25):
                return await pane.evaluate(
                    """async (p, count) => {
                    const samples = [], start = performance.now();
                    for (let i = 0; i <= count; i++) {
                        samples.push({ms: +(performance.now()-start).toFixed(1),
                            scrollTop:p.scrollTop,
                            order:[...p.querySelectorAll('[data-set-track-row]')]
                                .map(r => Number(r.dataset.setTrackRow))});
                        if (i < count) await new Promise(r => setTimeout(r, 40));
                    }
                    return samples;
                }""",
                    count,
                )

            async def cancel_drag(name):
                nonlocal page, rows, pane
                await page.keyboard.press("Escape")
                await page.mouse.up()
                await page.wait_for_timeout(150)
                stopped = await sample(10)
                drift = max(s["scrollTop"] for s in stopped) - min(s["scrollTop"] for s in stopped)
                check(
                    name + " cancel",
                    await order() == original and drift == 0 and not writes,
                    restored=await order() == original,
                    drift_px=drift,
                    writes=len(writes),
                    native_dragends=await page.evaluate(
                        "window.smokeDragEvents.filter(e => e.type === 'dragend').length"
                    ),
                )
                # A fresh page isolates subsequent scenarios from a failed native cancel.
                await page.close()
                page = await context.new_page()
                page.set_default_timeout(12000)
                page.on("pageerror", lambda error: errors.append(str(error)))
                await page.goto(args.url)
                await page.wait_for_timeout(2000)
                await page.locator(f'[data-entry-key="set:{args.set_id}"]').click()
                rows = page.locator("[data-set-track-row]")
                await rows.first.wait_for()
                await page.wait_for_timeout(3000)
                pane = await rows.first.evaluate_handle("r => r.closest('[tabindex=\"-1\"]')")

            for edge in ("bottom", "top", "top_overshoot"):
                await page.keyboard.press("Escape")
                await wheel_to(rows.first)
                area = await geometry()
                await page.mouse.move(area["x"] + 100, area["y"] + area["height"] / 2)
                if edge != "bottom":
                    await page.mouse.wheel(0, 3500)
                    await page.wait_for_timeout(300)
                area = await geometry()
                source = await rows.evaluate_all("""rs => {
                    const p = rs[0].closest('[tabindex="-1"]').getBoundingClientRect();
                    const r = rs.find(r => {
                        const b = r.getBoundingClientRect();
                        return b.top > p.top + 110 && b.bottom < p.bottom - 80;
                    });
                    const b = r.getBoundingClientRect();
                    return {id:Number(r.dataset.setTrackRow), x:b.left+65, y:b.top+b.height/2};
                }""")
                event_start = await page.evaluate("window.smokeDragEvents.length")
                await page.mouse.move(source["x"], source["y"])
                await page.mouse.down()
                await page.mouse.move(source["x"], source["y"] + 18, steps=5)
                await page.mouse.move(source["x"], source["y"] + 30, steps=3)
                y = area["y"] + area["height"] - 4 if edge == "bottom" else area["y"] + 4
                if edge == "top_overshoot":
                    # Establish an in-pane preview, then overshoot vertically within the page.
                    await page.mouse.move(source["x"], area["y"] + 4, steps=10)
                    await page.wait_for_timeout(80)
                    y = max(1, area["y"] - 28)
                await page.mouse.move(source["x"], y, steps=12)
                samples = await sample()
                events = await page.evaluate(
                    "start => window.smokeDragEvents.slice(start)", event_start
                )
                direction = 1 if edge == "bottom" else -1
                deltas = [
                    (b["scrollTop"] - a["scrollTop"]) * direction
                    for a, b in zip(samples, samples[1:])
                ]
                progressing = sum(d > 0 for d in deltas)
                changed = sum(s["order"] != original for s in samples)
                preview_versions = len({tuple(s["order"]) for s in samples})
                metrics = {
                    "pointer": {"x": source["x"], "y": y},
                    "pane": area,
                    "pane_after": await geometry(),
                    "last_dragover": next(
                        (e for e in reversed(events) if e["type"] == "dragover"), None
                    ),
                    "elapsed_ms": samples[-1]["ms"],
                    "scroll_start": samples[0]["scrollTop"],
                    "scroll_end": samples[-1]["scrollTop"],
                    "progress_intervals": progressing,
                    "intervals": len(deltas),
                    "max_sample_gap_ms": max(
                        b["ms"] - a["ms"] for a, b in zip(samples, samples[1:])
                    ),
                    "preview_samples": changed,
                    "preview_versions": preview_versions,
                    "preview_reset_ms": next(
                        (s["ms"] for s in samples if s["order"] == original), None
                    ),
                    "native_dragstarts": sum(
                        e["type"] == "dragstart" and e["trusted"] for e in events
                    ),
                    "native_dragovers": sum(
                        e["type"] == "dragover" and e["trusted"] for e in events
                    ),
                }
                if args.include_samples:
                    metrics["samples"] = [
                        {"ms": s["ms"], "scrollTop": s["scrollTop"]} for s in samples
                    ]
                report["edges"][edge] = metrics
                check(
                    edge + " continuous preview",
                    progressing >= 20
                    and all(d >= 0 for d in deltas)
                    and changed == len(samples)
                    and preview_versions > 1
                    and metrics["native_dragstarts"] == 1
                    and not writes,
                )
                await cancel_drag(edge)

            async def arm(ids):
                await page.keyboard.press("Escape")
                for i, track_id in enumerate(ids):
                    row = page.locator(f'[data-set-track-row="{track_id}"]')
                    await wheel_to(row)
                    await row.click(
                        position={"x": 65, "y": 20}, modifiers=["ControlOrMeta"] if i else []
                    )
                await row.click(button="right", position={"x": 65, "y": 20})
                label = "Move track" if len(ids) == 1 else f"Move {len(ids)} tracks"
                await page.get_by_role("menuitem", name=label, exact=True).click()
                await page.get_by_role("button", name="Cancel move", exact=True).wait_for()

            async def move(name, ids, index, screenshot=False):
                before, count = await order(), len(writes)
                await arm(ids)
                target = page.locator(f'button[data-set-move-index="{index}"]')
                await wheel_to(target)
                check(
                    name + " armed without writes", len(writes) == count and await order() == before
                )
                if screenshot:
                    await page.screenshot(path=str(screenshots / "set-move-desktop.png"))
                    await page.set_viewport_size({"width": 900, "height": 900})
                    await wheel_to(target)
                    await page.screenshot(path=str(screenshots / "set-move-compact.png"))
                    await page.set_viewport_size({"width": 1600, "height": 1000})
                    await wheel_to(target)
                moving = [track for track in before if track in ids]
                expected = (
                    [track for track in before[:index] if track not in ids]
                    + moving
                    + [track for track in before[index:] if track not in ids]
                )
                box = await target.bounding_box()
                await page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
                await page.wait_for_timeout(500)
                payload_order = (
                    [item["track_id"] for item in writes[-1]["items"]]
                    if len(writes) > count
                    else []
                )
                check(
                    name + " committed once",
                    len(writes) == count + 1
                    and await order() == expected
                    and payload_order == expected
                    and await page.locator("[data-set-move-index]").count() == 0,
                    writes_delta=len(writes) - count,
                    destination=index,
                    moved_ids=moving,
                    final_indices=[(await order()).index(track) for track in moving],
                )

            before, count = await order(), len(writes)
            await arm([before[0]])
            check(
                "pin actions disabled during move",
                await page.get_by_role("button", name="Auto-fill").is_disabled()
                and await page.get_by_role("button", name="Resolve from evidence").is_disabled(),
            )
            await page.keyboard.press("Tab")
            check(
                "Tab reaches Cancel",
                await page.evaluate(
                    "document.activeElement?.getAttribute('aria-label') === 'Cancel move'"
                ),
            )
            await page.keyboard.press("Tab")
            destination = await page.evaluate("document.activeElement?.dataset.setMoveIndex")
            check("Tab reaches a destination", destination is not None)
            if destination is not None:
                index = int(destination)
                expected = before[1:index] + [before[0]] + before[index:]
                await page.keyboard.press("Enter")
                await page.wait_for_timeout(300)
                check(
                    "Enter commits a destination",
                    await order() == expected and len(writes) == count + 1,
                )
            await page.keyboard.press("Escape")
            await move("single to 40", [original[0]], 40, screenshot=True)
            for via in ("Escape", "button"):
                before, count = await order(), len(writes)
                await arm([before[2]])
                await wheel_to(page.locator('[data-set-move-index="50"]'))
                if via == "Escape":
                    await page.keyboard.press("Escape")
                else:
                    await page.get_by_role("button", name="Cancel move", exact=True).click()
                await page.wait_for_timeout(250)
                check(
                    "move cancel " + via,
                    await order() == before
                    and len(writes) == count
                    and await page.locator("[data-set-move-index]").count() == 0,
                )
            await move("start boundary", [(await order())[4]], 0)
            await move("end boundary", [(await order())[2]], len(original))
            before = await order()
            await move("noncontiguous selection to 50", [before[4], before[1]], 50)
        except Exception as error:
            check("harness completed", False, error=f"{type(error).__name__}: {error}")
            await page.keyboard.press("Escape")
            await page.mouse.up()
            await page.screenshot(path=str(screenshots / "set-move-failure.png"))
        finally:
            check("no unexpected writes", not blocked, blocked=blocked)
            check("no browser errors", not errors, errors=errors)
            report["intercepted_put_count"] = len(writes)
            if args.include_payloads:
                report["intercepted_puts"] = writes
            report["stubbed_boot_writes"] = boot_writes
            report["screenshots"] = [
                str(screenshots / name)
                for name in ("set-move-desktop.png", "set-move-compact.png")
                if (screenshots / name).exists()
            ]
            report["pass"] = all(item["pass"] for item in report["checks"])
            print(json.dumps(report, indent=2))
            await browser.close()
    return 0 if report["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
