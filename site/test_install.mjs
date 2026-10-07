// node site/test_install.mjs http://127.0.0.1:8790/
// Optional screenshots: SITE_REVIEW_DIR=<existing directory>.
import { chromium } from '../scripts/site/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';

const base = new URL(process.argv[2] || 'http://127.0.0.1:8790/');
const browser = await chromium.launch();
try {
  // Route a synthetic Pages subpath to the existing server, without another server.
  for (const prefix of ['', 'preview/manadj/']) {
    for (const width of [1440, 900, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      const errors = [];
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== base.origin) {
          errors.push(`External resource: ${url}`);
          return route.abort();
        }
        if (prefix) {
          const start = `${base.pathname}${prefix}`;
          if (!url.pathname.startsWith(start)) {
            errors.push(`Escaped subpath: ${url}`);
            return route.abort();
          }
          url.pathname = base.pathname + url.pathname.slice(start.length);
          return route.fulfill({ response: await route.fetch({ url: url.href }) });
        }
        return route.continue();
      });
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
      page.on('requestfailed', (r) => {
        if (r.failure()?.errorText !== 'net::ERR_ABORTED') errors.push(`Failed: ${r.url()}`);
      });
      const start = new URL(prefix, base);
      for (const name of ['index.html', 'install.html']) {
        await page.goto(new URL(name, start).href, { waitUntil: 'networkidle' });
        await page.evaluate(async () => {
          document.querySelectorAll('img').forEach((img) => { img.loading = 'eager'; });
          await document.fonts.ready;
          await Promise.all([...document.images].map((img) => img.decode()));
        });
        assert.equal(await page.locator('h1').count(), 1);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: overflow at ${width}`);
        assert(await page.evaluate(() => document.fonts.check('14px "Ubuntu Mono"')));
        assert.equal(await page.locator('#download .btn-primary').count(), 2);
        assert(await page.locator('#download').innerText().then((text) => text.includes('untested on Windows hardware')));
        if (name === 'index.html') {
          assert.equal(await page.locator('.chapter[data-slug]').count(), 11);
          assert.equal(await page.locator('video[controls]').count(), 3);
          await page.getByRole('link', { name: 'Download / Get started' }).click();
          assert.equal(new URL(page.url()).hash, '#download');
        }
        if (process.env.SITE_REVIEW_DIR && !prefix && [1440, 390].includes(width)) {
          await page.screenshot({ path: `${process.env.SITE_REVIEW_DIR}/${name}-${width}.png`, fullPage: true });
        }
      }
      await page.locator('.install-toc a[href="#cue-mode"]').click();
      assert.equal(new URL(page.url()).hash, '#cue-mode');
      const headingTop = await page.locator('#cue-mode').evaluate((el) => el.getBoundingClientRect().top);
      assert(headingTop >= 40 && headingTop < 150, 'Anchor must clear the sticky nav');
      await page.locator('.install-toc a[href="#rerun-setup"]').click();
      assert.equal(new URL(page.url()).hash, '#rerun-setup');
      await page.getByRole('link', { name: 'Back to the feature tour' }).click();
      await page.waitForLoadState('networkidle');
      assert.equal(page.url(), new URL('index.html#perform', start).href);
      await page.locator('.segment[href="install.html"]').click();
      await page.waitForLoadState('networkidle');
      assert.equal(page.url(), new URL('install.html', start).href);
      await page.getByRole('link', { name: 'macOS install steps' }).click();
      assert.equal(new URL(page.url()).hash, '#macos');
      assert.deepEqual(errors, []);
      console.log(`Both pages, navigation, local resources: ${width}px /${prefix}`);
      await context.close();
    }
  }
  const plain = await browser.newContext({ javaScriptEnabled: false });
  const page = await plain.newPage();
  await page.goto(new URL('install.html', base).href);
  await page.locator('.install-toc a[href="#welcome"]').click();
  assert.equal(new URL(page.url()).hash, '#welcome');
  assert.equal(await page.locator('#download .btn-primary').count(), 2);
  console.log('Install content, downloads and navigation work without JavaScript');
  await plain.close();
} finally {
  await browser.close();
}
