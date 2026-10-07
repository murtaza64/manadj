// npm ci --prefix scripts/site; node site/test_browser.mjs <site-root-url> [...]
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { chromium } = createRequire(new URL('../scripts/site/package.json', import.meta.url))('playwright');
const roots = process.argv.slice(2);
assert(roots.length, 'Pass one or more served site root URLs, including a subpath');
const screenshots = mkdtempSync(join(tmpdir(), 'manadj-help-browser-'));
const browser = await chromium.launch();
try {
  for (const root of roots) {
    const context = await browser.newContext();
    const errors = [];
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
    });
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin !== new URL(root).origin) {
        errors.push(`External request: ${route.request().url()}`);
        return route.abort();
      }
      return route.continue();
    });
    const response = await context.request.get(new URL('help/manifest.json', root).href);
    assert(response.ok());
    const manifest = await response.json();
    assert(manifest.length > 0);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const article of manifest) {
        const url = new URL(`help/${article.slug}/index.html`, root).href;
        await page.goto(url, { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
        assert.equal(await page.locator('h1').textContent(), article.title);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow: ${width} ${url}`);
        for (const anchor of article.anchors) {
          assert(await page.evaluate(id => document.getElementById(id) !== null, anchor), `${url}#${anchor}`);
        }
        assert.equal(await page.locator('.help-navigation').getAttribute('open') !== null, width > 760);
        const toc = page.locator('.help-toc a').first();
        if (await toc.count()) {
          await toc.click();
          assert(new URL(page.url()).hash);
          assert(await page.evaluate(() => document.querySelector(':target').getBoundingClientRect().top >= 40));
        }
      }
      await page.goto(new URL('help/perform/index.html', root).href);
      await page.screenshot({ path: join(screenshots, `perform-${roots.indexOf(root)}-${width}.png`), fullPage: true });
      if (width === 390) {
        await page.locator('.help-navigation summary').click();
        assert(await page.locator('.help-navigation').getAttribute('open') !== null);
      }
      await page.goto(new URL('help/index.html', root).href);
      assert.equal(await page.locator('.help-cards > li').count(), manifest.length);
      await page.locator('.help-cards a').first().click();
      assert(page.url().includes(`/help/${manifest[0].slug}/index.html`));
    }
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS ${root}: ${manifest.length} articles, desktop/mobile, TOC, navigation, local assets`);
  }
} finally {
  await browser.close();
}
console.log(`Screenshots: ${screenshots}`);
