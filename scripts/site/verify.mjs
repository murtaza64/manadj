// Browser check against a served build. No app or Library access.
// node scripts/site/verify.mjs http://127.0.0.1:8790/
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const url = process.argv[2];
if (!url) throw Error('Supply the served site URL');
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../../.lane-tmp/site-review');
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
try {
  for (const width of [1440, 900, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (res) => { if (res.status() >= 400) errors.push(`${res.status()} ${res.url()}`); });
    page.on('requestfailed', (req) => errors.push(`Failed ${req.url()}`));
    page.on('request', (req) => {
      if (new URL(req.url()).origin !== new URL(url).origin) errors.push(`External request: ${req.url()}`);
    });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
      document.querySelectorAll('img').forEach((img) => { img.loading = 'eager'; });
      await document.fonts.ready;
      await Promise.all([...document.images].map((img) => img.decode()));
    });
    assert.equal(await page.locator('h1').count(), 1);
    assert.deepEqual(await page.locator('.chapter[data-slug]').evaluateAll((els) => els.map((el) => el.dataset.slug)),
      ['acquire', 'curate', 'perform', 'follow', 'capture', 'editor', 'sets', 'sync']);
    assert.deepEqual(await page.locator('.segment').allTextContents(),
      ['INSTALL', 'ACQUIRE', 'CURATE', 'PERFORM', 'FOLLOW', 'CAPTURE', 'EDIT', 'ARRANGE', 'SYNC', 'HELP']);
    assert.deepEqual(await page.locator('.loop-step').evaluateAll((els) => els.map((el) => el.getAttribute('href'))),
      ['#acquire', '#curate', '#perform', '#follow', '#capture', '#editor', '#sets', '#sync']);
    assert.equal(await page.locator('#words, .glossary, .chips, [id^="term-"], a[href="#words"], a[href^="#term-"]').count(), 0);
    assert.equal(await page.locator('video').count(), 3);
    assert(await page.evaluate(() => document.fonts.check('700 48px "Ubuntu Mono"')));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}`);
    assert(await page.locator('video').evaluateAll((videos) => videos.every((v) => v.paused && !v.autoplay && v.controls && v.muted)));
    await page.screenshot({ path: `${out}/site-${width}.png`, fullPage: width === 390 });
    if (width === 1440) {
      for (const video of await page.locator('video').all()) {
        await video.scrollIntoViewIfNeeded();
        await video.evaluate((v) => v.play());
        await page.waitForTimeout(1800);
        const first = await video.evaluate((v) => {
          const canvas = document.createElement('canvas');
          canvas.width = 144; canvas.height = 90;
          canvas.getContext('2d').drawImage(v, 0, 0, 144, 90);
          return { time: v.currentTime, frame: canvas.toDataURL(), width: v.videoWidth, height: v.videoHeight };
        });
        await page.waitForTimeout(2200);
        const second = await video.evaluate((v) => {
          const canvas = document.createElement('canvas');
          canvas.width = 144; canvas.height = 90;
          canvas.getContext('2d').drawImage(v, 0, 0, 144, 90);
          return { time: v.currentTime, frame: canvas.toDataURL(), duration: v.duration };
        });
        assert(second.time > first.time + 1, 'Video clock must advance');
        assert.notEqual(first.frame, second.frame, 'Recording must contain visible motion');
        assert.equal(first.width, 1440);
        assert.equal(first.height, 900);
        assert(second.duration >= 15);
        console.log('Video decoded and moving:', await video.locator('source').getAttribute('src'), second.duration);
        await video.evaluate((v) => v.pause());
      }
      await page.locator('.segment[href="#sets"]').click();
      await page.waitForTimeout(300);
      assert(await page.locator('.segment[href="#sets"]').evaluate((el) => el.classList.contains('active')));
      assert.equal(new URL(page.url()).hash, '#sets');
      assert.equal(await page.locator('#sets .chapter-head .kicker').innerText(), '07 · ARRANGE');
    }
    assert.deepEqual(errors, []);
    console.log(`Layout/fonts/assets passed at ${width}px`);
    await context.close();
  }
  const plain = await browser.newContext({ javaScriptEnabled: false });
  const page = await plain.newPage();
  await page.goto(url);
  assert.equal(await page.locator('.chapter[data-slug]').count(), 8);
  assert.equal(await page.locator('video[controls]').count(), 3);
  console.log('No-JavaScript content and native video controls passed');
  await plain.close();
} finally {
  await browser.close();
}
