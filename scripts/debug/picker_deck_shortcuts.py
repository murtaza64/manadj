#!/usr/bin/env -S uv run --script
# /// script
# dependencies = ["playwright"]
# ///
"""Smoke-test loaded-deck picker shortcuts in an isolated browser context."""

import argparse
import asyncio

from playwright.async_api import async_playwright, expect


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True)
    parser.add_argument('--screenshot')
    args = parser.parse_args()
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={'width': 1440, 'height': 1000})
        errors, writes = [], []
        page.on('pageerror', lambda e: errors.append(str(e)))

        async def guard(route):
            if route.request.method in ('PUT', 'POST', 'PATCH', 'DELETE'):
                writes.append(route.request.url)
                await route.fulfill(json={})
            else:
                await route.continue_()

        await page.route('**/api/transitions/**', guard)
        await page.route('**/api/routines/**', guard)
        await page.goto(args.url + '/?view=routine')
        await page.wait_for_selector('.mp-search')
        await page.wait_for_function('!!window.__manadj')
        assert await page.locator('.mp-deck-shortcuts').count() == 0
        await page.evaluate("""async () => {
          await Promise.all([['A',9],['C',171],['D',642]].map(([deck,id]) => window.__manadj.loadTrackById(deck,id)));
          window.shortcutLoads = 0;
          for (const engine of Object.values(window.__manadj.engines)) {
            const load = engine.load.bind(engine);
            engine.load = (...args) => { window.shortcutLoads++; return load(...args); };
          }
        }""")
        group = page.get_by_role('group', name='Loaded deck tracks')
        await group.wait_for()
        assert await group.get_by_role('button').count() == 3
        assert await page.locator('[aria-label^="Search deck B:"]').count() == 0
        a = page.locator('[aria-label^="Search deck A:"]')
        c = page.locator('[aria-label^="Search deck C:"]')
        d = page.locator('[aria-label^="Search deck D:"]')
        await a.click()
        await c.focus()
        await page.keyboard.press('Enter')
        await expect(a).to_be_disabled()
        await expect(c).to_be_disabled()
        assert await page.locator('.mp-chip.set').count() == 2
        outgoing = await page.locator('.mp-chip.set').first.inner_text()
        incoming = await page.locator('.mp-chip.set').last.inner_text()
        await d.focus()
        await page.keyboard.press('Space')
        await expect(d).to_be_disabled()
        assert await page.locator('.mp-chip.set').first.inner_text() == outgoing
        assert await page.locator('.mp-chip.set').last.inner_text() != incoming
        await expect(c).to_be_enabled()
        assert await page.locator('.rt-timeline').count() == 0, 'Shortcut opened an artifact'
        assert await page.evaluate('window.shortcutLoads') == 0, 'Shortcut reloaded a deck'
        assert await page.evaluate('Object.values(window.__manadj.engines).every(e => !e.getSnapshot().playing)')
        await page.evaluate("window.__manadj.loadTrackById('C',9)")
        await page.wait_for_function("document.querySelector('[aria-label^=\"Search deck C:\"]').disabled")
        assert await page.locator('.mp-chip.set').first.inner_text() == outgoing
        if args.screenshot:
            await page.evaluate("Promise.all([window.__manadj.loadTrackById('B',655), window.__manadj.loadTrackById('C',171)])")
            while await page.locator('.mp-chipx').count():
                await page.locator('.mp-chipx').first.click()
            await expect(group.get_by_role('button')).to_have_count(4)
            await page.screenshot(path=args.screenshot)
        await page.set_viewport_size({'width': 390, 'height': 844})
        assert await group.get_by_role('button').evaluate_all("""buttons => buttons.every(button => {
          const rect = button.getBoundingClientRect();
          return rect.width > 0 && rect.left >= 0 && rect.right <= innerWidth;
        })"""), 'Deck shortcuts overflow the narrow viewport'
        assert not errors, errors
        assert not writes, writes
        await browser.close()
        print('A/C/D identity, native Enter/Space, incoming replacement, duplicate-track updates: passed; no artifact writes, opens, deck reloads or playback from shortcuts.')


asyncio.run(main())
